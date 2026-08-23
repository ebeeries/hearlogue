import { app, BrowserWindow, session, Menu } from 'electron';
import { APP_ID, APP_NAME } from '@shared/constants/app';
import { PUSH } from '@shared/constants/channels';
import { createMainWindow } from './windows/main-window';
import { registerHandlers } from './ipc/handlers';
import { broadcast } from './ipc/register';
import { archiveService } from './services/archive-service';
import { importService } from './services/import-service';
import { configureLogger, createLogger, flushLogger } from './utils/logger';
import { logsDir } from './utils/paths';
import { buildApplicationMenu } from './windows/menu';
import { handleSquirrelEvent } from './windows/squirrel';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;

/**
 * Application entry point.
 *
 * Ordering matters: logging first so a failure during startup is recorded,
 * then the security policy, then the archive, then IPC, then the window. The
 * window is created last so it can never render against a half-initialised
 * backend.
 */

const isDev = !app.isPackaged;

/**
 * The relaxed policy is required only while Vite's dev server is serving the
 * renderer — not merely because the build is unpackaged. Keying off the dev
 * server URL means a locally built app still runs under the shipping policy,
 * which is what the end-to-end tests exercise.
 */
const usingDevServer = typeof MAIN_WINDOW_VITE_DEV_SERVER_URL === 'string';

let log = createLogger('main');

function applySecurityPolicy(): void {
  const csp = usingDevServer
    ? // The dev server needs its websocket and injects styles at runtime.
      "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
      "style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: blob:; " +
      "font-src 'self' data:; " +
      "connect-src 'self' ws://localhost:* http://localhost:*; " +
      "object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none';"
    : // Packaged: no remote anything. Inline styles are required by the chart
      // library, which sets element styles directly; scripts remain locked down.
      "default-src 'self'; " +
      "script-src 'self'; " +
      "style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: blob:; " +
      "font-src 'self' data:; " +
      "connect-src 'self'; " +
      "media-src 'none'; worker-src 'self' blob:; " +
      "object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none';";

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
        'X-Content-Type-Options': ['nosniff'],
      },
    });
  });

  // The app needs no device access whatsoever; deny every permission request.
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);

  // Nothing should ever be requested from the network. Allow only the dev
  // server's own assets, and block everything else outright.
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url;
    const local =
      url.startsWith('file:') ||
      url.startsWith('devtools:') ||
      url.startsWith('data:') ||
      url.startsWith('blob:') ||
      (usingDevServer && (url.startsWith('http://localhost') || url.startsWith('ws://localhost')));
    if (!local) {
      log.warn('blocked network request from renderer');
      callback({ cancel: true });
      return;
    }
    callback({});
  });
}

function wireImportEvents(): void {
  importService.bind({
    onProgress: (progress) => broadcast(PUSH.importProgress, progress),
    onDone: (report) => {
      broadcast(PUSH.importDone, report);
      broadcast(PUSH.archiveChanged, archiveService.state());
    },
    onFailed: () => broadcast(PUSH.archiveChanged, archiveService.state()),
    onCancelled: () => broadcast(PUSH.archiveChanged, archiveService.state()),
  });
}

function bootstrap(): void {
  configureLogger(logsDir(), isDev ? 'debug' : 'info');
  log = createLogger('main');
  log.info('starting', {
    version: app.getVersion(),
    electron: process.versions.electron,
    platform: process.platform,
  });

  applySecurityPolicy();

  try {
    archiveService.open();
  } catch (err) {
    log.error('failed to open archive', err);
  }

  registerHandlers();
  wireImportEvents();

  Menu.setApplicationMenu(
    buildApplicationMenu({
      onNavigate: (route) => broadcast(PUSH.navigate, route),
      isDev,
    }),
  );

  createMainWindow();
}

/* ------------------------------ lifecycle ------------------------------ */

app.setAppUserModelId(APP_ID);
app.setName(APP_NAME);

// Disable the renderer's HTTP cache directory churn; the app never fetches.
app.commandLine.appendSwitch('disable-http-cache');

const isSquirrelHook = handleSquirrelEvent();
const gotLock = isSquirrelHook ? false : app.requestSingleInstanceLock();

if (isSquirrelHook) {
  // The installer hook has already scheduled its own exit.
} else if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows();
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });

  void app.whenReady().then(bootstrap);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    importService.shutdown();
    archiveService.close();
    flushLogger();
  });
}

// A renderer must never be able to attach Node integration to a child frame.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => {
    const devUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL;
    const allowed =
      url.startsWith('file:') || (devUrl !== undefined && url.startsWith(devUrl));
    if (!allowed) event.preventDefault();
  });
});

process.on('uncaughtException', (err) => {
  log.error('uncaught exception', err);
});

process.on('unhandledRejection', (reason) => {
  log.error('unhandled rejection', reason);
});
