import { shell, clipboard, nativeImage, dialog, type BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { EXTERNAL_URL_ALLOWLIST } from '@shared/constants/app';
import { HearlogueError } from '../utils/errors';
import { createLogger } from '../utils/logger';
import { logsDir } from '../utils/paths';

const log = createLogger('external');

/**
 * The only place in the app that can hand something to the operating system.
 *
 * Nothing from the renderer is trusted here. A URL must parse, must be https,
 * and its origin must appear verbatim in the allowlist — a prefix check would
 * accept `https://open.spotify.com.example.com`, so the origin is compared
 * exactly.
 */

export function isAllowedExternalUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  return EXTERNAL_URL_ALLOWLIST.some((allowed) => {
    const base = new URL(allowed);
    return url.origin === base.origin;
  });
}

/** Converts `spotify:track:xyz` into the https link the shell can open. */
export function spotifyUriToUrl(uri: string): string | null {
  const match = /^spotify:(track|album|artist):([A-Za-z0-9]{1,64})$/.exec(uri);
  if (!match) return null;
  return `https://open.spotify.com/${match[1]}/${match[2]}`;
}

export async function openExternal(rawUrl: string): Promise<void> {
  const candidate = rawUrl.startsWith('spotify:') ? spotifyUriToUrl(rawUrl) : rawUrl;

  if (!candidate || !isAllowedExternalUrl(candidate)) {
    log.warn('blocked external url', { host: safeHost(candidate ?? rawUrl) });
    throw new HearlogueError('EXTERNAL_BLOCKED', 'error.externalBlocked');
  }

  try {
    await shell.openExternal(candidate);
  } catch (err) {
    log.error('failed to open external url', err);
    throw new HearlogueError('EXTERNAL_BLOCKED', 'error.externalFailed');
  }
}

/** Host only — never log a full URL, which can carry identifiers. */
function safeHost(raw: string): string {
  try {
    return new URL(raw).host;
  } catch {
    return 'invalid';
  }
}

export async function openLogsFolder(): Promise<void> {
  await shell.openPath(logsDir());
}

export function revealInFolder(target: string): void {
  shell.showItemInFolder(target);
}

const DATA_URL_PREFIX = 'data:image/png;base64,';

function decodeShareCard(dataUrl: string): Buffer {
  if (!dataUrl.startsWith(DATA_URL_PREFIX)) {
    throw new HearlogueError('VALIDATION', 'error.badImage');
  }
  const base64 = dataUrl.slice(DATA_URL_PREFIX.length);
  if (!/^[A-Za-z0-9+/=]+$/.test(base64)) {
    throw new HearlogueError('VALIDATION', 'error.badImage');
  }
  return Buffer.from(base64, 'base64');
}

function sanitiseFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned.length > 0 ? cleaned : 'hearlogue-card';
}

export async function saveShareCard(
  window: BrowserWindow | null,
  dataUrl: string,
  suggestedName: string,
): Promise<string | null> {
  const buffer = decodeShareCard(dataUrl);
  const defaultName = `${sanitiseFileName(suggestedName)}.png`;

  const result = await dialog.showSaveDialog(window ?? undefined!, {
    title: 'Save card',
    defaultPath: defaultName,
    filters: [{ name: 'PNG image', extensions: ['png'] }],
  });

  if (result.canceled || !result.filePath) return null;

  const target = result.filePath.toLowerCase().endsWith('.png')
    ? result.filePath
    : `${result.filePath}.png`;

  await fs.promises.writeFile(target, buffer);
  log.info('share card saved', { bytes: buffer.byteLength, ext: path.extname(target) });
  return target;
}

export function copyShareCard(dataUrl: string): void {
  const image = nativeImage.createFromBuffer(decodeShareCard(dataUrl));
  if (image.isEmpty()) throw new HearlogueError('VALIDATION', 'error.badImage');
  clipboard.writeImage(image);
}
