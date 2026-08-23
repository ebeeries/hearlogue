import fs from 'node:fs';
import path from 'node:path';
import { LOG_FILE_MAX_BYTES, LOG_FILE_MAX_COUNT } from '@shared/constants/app';

/**
 * Minimal rotating file logger.
 *
 * What is deliberately absent matters as much as what is here: this logger only
 * ever receives lifecycle events, counts and error messages. Listening history,
 * track names, note bodies and file contents are never passed to it, and the
 * `redact` helper truncates anything unexpectedly large before it reaches disk.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let logDirectory: string | null = null;
let minLevel: LogLevel = 'info';
let stream: fs.WriteStream | null = null;
let currentSize = 0;

const MAX_DETAIL_CHARS = 500;

export function configureLogger(dir: string, level: LogLevel = 'info'): void {
  logDirectory = dir;
  minLevel = level;
  closeStream();
  openStream();
}

export function loggerDirectory(): string | null {
  return logDirectory;
}

function logFilePath(): string {
  return path.join(logDirectory ?? '.', 'hearlogue.log');
}

function openStream(): void {
  if (!logDirectory) return;
  try {
    if (!fs.existsSync(logDirectory)) fs.mkdirSync(logDirectory, { recursive: true });
    const file = logFilePath();
    currentSize = fs.existsSync(file) ? fs.statSync(file).size : 0;
    stream = fs.createWriteStream(file, { flags: 'a' });
    stream.on('error', () => {
      stream = null;
    });
  } catch {
    stream = null;
  }
}

function closeStream(): void {
  try {
    stream?.end();
  } catch {
    /* the log stream is best-effort; never let it break the app */
  }
  stream = null;
}

function rotateIfNeeded(): void {
  if (!logDirectory || currentSize < LOG_FILE_MAX_BYTES) return;
  closeStream();
  try {
    const base = logFilePath();
    const oldest = `${base}.${LOG_FILE_MAX_COUNT}`;
    if (fs.existsSync(oldest)) fs.unlinkSync(oldest);
    for (let i = LOG_FILE_MAX_COUNT - 1; i >= 1; i--) {
      const from = `${base}.${i}`;
      if (fs.existsSync(from)) fs.renameSync(from, `${base}.${i + 1}`);
    }
    if (fs.existsSync(base)) fs.renameSync(base, `${base}.1`);
  } catch {
    /* ignore rotation failures */
  }
  currentSize = 0;
  openStream();
}

/** Clamps a value to something safe to persist. Never pass user content here. */
export function redact(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text: string;
  if (value instanceof Error) {
    text = `${value.name}: ${value.message}`;
  } else if (typeof value === 'object') {
    try {
      text = JSON.stringify(value);
    } catch {
      text = '[unserialisable]';
    }
  } else {
    text = String(value);
  }
  text = text.replace(/[\r\n]+/g, ' ');
  return text.length > MAX_DETAIL_CHARS ? `${text.slice(0, MAX_DETAIL_CHARS)}...[truncated]` : text;
}

function write(level: LogLevel, scope: string, message: string, detail?: unknown): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}${
    detail === undefined ? '' : ` :: ${redact(detail)}`
  }\n`;
  if (level === 'error') console.error(line.trimEnd());
  else if (level === 'warn') console.warn(line.trimEnd());
  if (!stream) return;
  try {
    stream.write(line);
    currentSize += Buffer.byteLength(line);
    rotateIfNeeded();
  } catch {
    /* ignore */
  }
}

export interface Logger {
  debug(message: string, detail?: unknown): void;
  info(message: string, detail?: unknown): void;
  warn(message: string, detail?: unknown): void;
  error(message: string, detail?: unknown): void;
}

export function createLogger(scope: string): Logger {
  return {
    debug: (m, d) => write('debug', scope, m, d),
    info: (m, d) => write('info', scope, m, d),
    warn: (m, d) => write('warn', scope, m, d),
    error: (m, d) => write('error', scope, m, d),
  };
}

export function flushLogger(): void {
  closeStream();
}
