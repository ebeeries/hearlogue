import type { AppError, AppErrorCode } from '@shared/types/common';

/**
 * Errors that reach the renderer are always reduced to a code plus a
 * localisation key. Stack traces stay in the log file; the UI shows a sentence a
 * person can act on.
 */
export class HearlogueError extends Error {
  readonly code: AppErrorCode;
  readonly messageKey: string;
  readonly detail?: string;

  constructor(code: AppErrorCode, messageKey: string, detail?: string, cause?: unknown) {
    super(`${code}: ${messageKey}${detail ? ` (${detail})` : ''}`);
    this.name = 'HearlogueError';
    this.code = code;
    this.messageKey = messageKey;
    this.detail = detail;
    if (cause instanceof Error) this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
  }

  toAppError(): AppError {
    return { code: this.code, messageKey: this.messageKey, detail: this.detail };
  }
}

export function notFound(what: string): HearlogueError {
  return new HearlogueError('NOT_FOUND', 'error.notFound', what);
}

export function noArchive(): HearlogueError {
  return new HearlogueError('NO_ARCHIVE', 'error.noArchive');
}

const SQLITE_MESSAGE_MAP: { test: RegExp; code: AppErrorCode; key: string }[] = [
  { test: /SQLITE_BUSY|database is locked/i, code: 'DB_LOCKED', key: 'error.dbLocked' },
  { test: /SQLITE_CORRUPT|malformed/i, code: 'DB_CORRUPT', key: 'error.dbCorrupt' },
  { test: /SQLITE_FULL|disk (is )?full|ENOSPC/i, code: 'DISK_FULL', key: 'error.diskFull' },
  { test: /SQLITE_READONLY|EACCES|EPERM/i, code: 'PERMISSION', key: 'error.permission' },
];

/** Converts any thrown value into a shape safe to send across IPC. */
export function toAppError(err: unknown): AppError {
  if (err instanceof HearlogueError) return err.toAppError();

  const message = err instanceof Error ? err.message : String(err);
  for (const entry of SQLITE_MESSAGE_MAP) {
    if (entry.test.test(message)) {
      return { code: entry.code, messageKey: entry.key };
    }
  }
  if (/Unexpected token|JSON at position|not valid JSON/i.test(message)) {
    return { code: 'UNSUPPORTED_FORMAT', messageKey: 'error.badJson' };
  }
  if (/ENOENT/i.test(message)) {
    return { code: 'NOT_FOUND', messageKey: 'error.fileMissing' };
  }
  return { code: 'UNKNOWN', messageKey: 'error.unknown' };
}

export function isHearlogueError(err: unknown): err is HearlogueError {
  return err instanceof HearlogueError;
}
