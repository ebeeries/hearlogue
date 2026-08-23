import { chromium, type Browser, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Launch harness for the end-to-end tests.
 *
 * The app is started as a normal Electron process and driven over the Chrome
 * DevTools Protocol, rather than through Playwright's `_electron` helper. That
 * helper injects a `-r <loader>` argument which current Electron versions reject
 * outright, and attaching to a packaged build would additionally require blowing
 * out the `EnableNodeCliInspectArguments` fuse — a fuse worth keeping.
 *
 * Connecting over CDP exercises exactly what a user runs: the production main
 * bundle, the real preload bridge, and the shipping content-security policy.
 */

export interface AppHandle {
  page: Page;
  browser: Browser;
  process: ChildProcess;
  userDataDir: string;
  close: () => Promise<void>;
}

function electronBinary(): string {
  const binary = path.resolve(
    'node_modules/electron/dist',
    process.platform === 'win32' ? 'electron.exe' : 'electron',
  );
  if (!fs.existsSync(binary)) {
    throw new Error(`Electron binary not found at ${binary}. Run "npm install" first.`);
  }
  return binary;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForDevTools(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(
    `Electron did not expose DevTools on port ${port} within ${timeoutMs}ms: ${String(lastError)}`,
  );
}

export async function launchApp(options: { timeoutMs?: number } = {}): Promise<AppHandle> {
  const timeoutMs = options.timeoutMs ?? 60_000;

  const mainBundle = path.resolve('.vite/build/main.js');
  const rendererBundle = path.resolve('.vite/renderer/main_window/index.html');
  for (const artifact of [mainBundle, rendererBundle]) {
    if (!fs.existsSync(artifact)) {
      throw new Error(`Missing build artifact ${artifact}. Run "npm run package" first.`);
    }
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearlogue-e2e-'));
  const port = await freePort();

  /**
   * `ELECTRON_RUN_AS_NODE` is set by some toolchains and CI images. If it leaks
   * into this spawn, Electron starts as a bare Node process, `app` is undefined
   * and the failure looks nothing like its cause — so it is stripped explicitly.
   */
  const env: NodeJS.ProcessEnv = { ...process.env, HEARLOGUE_E2E: '1' };
  delete env.ELECTRON_RUN_AS_NODE;

  const child = spawn(
    electronBinary(),
    ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`],
    {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    },
  );

  const stderr: string[] = [];
  const capture = (chunk: Buffer): void => {
    const text = chunk.toString();
    stderr.push(text);
    // Surfaced in the Playwright output so a crash is diagnosable from the run.
    if (process.env.E2E_VERBOSE) process.stdout.write(`[electron] ${text}`);
  };
  child.stderr?.on('data', capture);
  child.stdout?.on('data', capture);

  let exited = false;
  let exitInfo = '';
  child.on('exit', (code, signal) => {
    exited = true;
    exitInfo = `code=${code} signal=${signal}`;
    process.stdout.write(`[electron] process exited ${exitInfo}\n${stderr.join('').slice(-3000)}\n`);
  });

  try {
    await waitForDevTools(port, timeoutMs);
  } catch (err) {
    child.kill();
    throw new Error(
      `${String(err)}\nelectron stderr:\n${stderr.join('').slice(-2000)}\nexited=${exited}`,
    );
  }

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);

  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? (await context.waitForEvent('page', { timeout: timeoutMs }));
  await page.waitForLoadState('domcontentloaded');

  // Renderer failures are otherwise invisible from the test process.
  page.on('pageerror', (err) => {
    process.stdout.write(`[renderer error] ${err.message}\n`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      process.stdout.write(`[renderer console] ${message.text()}\n`);
    }
  });

  const close = async (): Promise<void> => {
    await browser.close().catch(() => undefined);
    if (!exited) {
      child.kill();
      // Give the process a moment to release its lock on the temp directory.
      await new Promise((resolve) => setTimeout(resolve, 900));
    }
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch {
      // A leftover temp directory is harmless; the OS clears it eventually.
    }
  };

  return { page, browser, process: child, userDataDir, close };
}
