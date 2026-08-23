import { BrowserWindow, screen, shell, app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import {
  MIN_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  DEFAULT_WINDOW_HEIGHT,
  TITLEBAR_HEIGHT,
  APP_NAME,
} from '@shared/constants/app';
import { userDataDir } from '../utils/paths';
import { isAllowedExternalUrl } from '../services/external';
import { createLogger } from '../utils/logger';

const log = createLogger('window');

/**
 * Window creation, security posture and geometry persistence.
 *
 * Window bounds live in their own small JSON file rather than in the archive
 * database: they must be readable before any database is opened, and losing them
 * is harmless.
 */

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized: boolean;
}

const DEFAULT_STATE: WindowState = {
  width: DEFAULT_WINDOW_WIDTH,
  height: DEFAULT_WINDOW_HEIGHT,
  maximized: false,
};

function stateFile(): string {
  return path.join(userDataDir(), 'window-state.json');
}

function readState(): WindowState {
  try {
    const raw = fs.readFileSync(stateFile(), 'utf8');
    const parsed = { ...DEFAULT_STATE, ...(JSON.parse(raw) as Partial<WindowState>) };

    // A monitor may have been unplugged since the last run.
    if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
      const visible = screen.getAllDisplays().some((display) => {
        const b = display.workArea;
        return (
          parsed.x! + parsed.width > b.x &&
          parsed.x! < b.x + b.width &&
          parsed.y! + 80 > b.y &&
          parsed.y! < b.y + b.height
        );
      });
      if (!visible) {
        delete parsed.x;
        delete parsed.y;
      }
    }

    return {
      ...parsed,
      width: Math.max(MIN_WINDOW_WIDTH, parsed.width),
      height: Math.max(MIN_WINDOW_HEIGHT, parsed.height),
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function writeState(window: BrowserWindow): void {
  try {
    const maximized = window.isMaximized();
    const bounds = maximized ? window.getNormalBounds() : window.getBounds();
    const state: WindowState = {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      maximized,
    };
    fs.writeFileSync(stateFile(), JSON.stringify(state), 'utf8');
  } catch (err) {
    log.warn('failed to persist window state', err);
  }
}

export function createMainWindow(): BrowserWindow {
  const state = readState();

  const window = new BrowserWindow({
    title: APP_NAME,
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    show: false,
    backgroundColor: '#0B0D0F',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0B0D0F',
      symbolColor: '#918B7E',
      height: TITLEBAR_HEIGHT,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // The three settings that matter most: no Node in the renderer, an
      // isolated context for the bridge, and the Chromium sandbox on.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });

  if (state.maximized) window.maximize();

  window.once('ready-to-show', () => {
    window.show();
    if (state.maximized) window.maximize();
  });

  // Nothing in this app opens a second window. Any attempt to is an external
  // link, and goes through the same allowlist as an explicit request.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    else log.warn('blocked window.open', { blocked: true });
    return { action: 'deny' };
  });

  // The renderer may only ever be the local app bundle or the dev server.
  window.webContents.on('will-navigate', (event, url) => {
    const target = new URL(url);
    const devUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL
      ? new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
      : null;
    const isDevServer = devUrl !== null && target.origin === devUrl.origin;
    if (target.protocol !== 'file:' && !isDevServer) {
      event.preventDefault();
      if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    }
  });

  window.webContents.on('will-attach-webview', (event) => event.preventDefault());

  let saveTimer: NodeJS.Timeout | null = null;
  const scheduleSave = (): void => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => writeState(window), 400);
  };
  window.on('resize', scheduleSave);
  window.on('move', scheduleSave);
  window.on('maximize', scheduleSave);
  window.on('unmaximize', scheduleSave);
  window.on('close', () => {
    if (saveTimer) clearTimeout(saveTimer);
    writeState(window);
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void window.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  return window;
}
