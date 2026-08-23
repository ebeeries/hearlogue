import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

/**
 * All runtime state lives under Electron's `userData` directory — never inside
 * the application bundle or the repository. The demo archive gets its own file
 * so that exploring the demo can never touch a real imported history.
 */

let cachedUserData: string | null = null;

export function userDataDir(): string {
  if (!cachedUserData) {
    cachedUserData = app.getPath('userData');
  }
  return cachedUserData;
}

/** Overridable in tests and for the Playwright harness. */
export function setUserDataDirForTesting(dir: string): void {
  cachedUserData = dir;
}

export function dataDir(): string {
  return ensureDir(path.join(userDataDir(), 'archive'));
}

export function logsDir(): string {
  return ensureDir(path.join(userDataDir(), 'logs'));
}

export function backupsDir(): string {
  return ensureDir(path.join(userDataDir(), 'backups'));
}

export function realDatabasePath(): string {
  return path.join(dataDir(), 'hearlogue.db');
}

export function demoDatabasePath(): string {
  return path.join(dataDir(), 'hearlogue-demo.db');
}

export function ensureDir(dir: string): string {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/** Location of the compiled import worker bundle, in dev and when packaged. */
export function importWorkerPath(): string {
  return path.join(__dirname, 'import-worker.cjs');
}
