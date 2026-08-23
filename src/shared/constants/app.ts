/**
 * Product-level constants. Kept free of any runtime dependency so that both the
 * main process and the renderer can import them safely.
 */

export const APP_NAME = 'HEARLOGUE';
export const APP_TAGLINE = 'Your past is still playing.';
export const APP_DESCRIPTION =
  'Turn years of listening history into the story of your musical life.';
export const APP_ID = 'app.hearlogue.desktop';

/** Bumped whenever the shape of a backup archive changes. */
export const BACKUP_FORMAT_VERSION = 1;

/** Bumped whenever derived analytics need a forced recomputation. */
export const ANALYTICS_ENGINE_VERSION = 4;

export const MIN_WINDOW_WIDTH = 1080;
export const MIN_WINDOW_HEIGHT = 700;
export const DEFAULT_WINDOW_WIDTH = 1440;
export const DEFAULT_WINDOW_HEIGHT = 920;
export const TITLEBAR_HEIGHT = 40;

/** Only these origins may ever be handed to the OS shell. */
export const EXTERNAL_URL_ALLOWLIST = [
  'https://open.spotify.com',
  'https://support.spotify.com',
  'https://www.spotify.com',
  'https://accounts.spotify.com',
] as const;

export const LOG_FILE_MAX_BYTES = 2 * 1024 * 1024;
export const LOG_FILE_MAX_COUNT = 5;
