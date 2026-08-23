import { ipcMain, type IpcMainInvokeEvent, type WebContents, BrowserWindow } from 'electron';
import type { ZodTypeAny, z } from 'zod';
import { toAppError } from '../utils/errors';
import { createLogger } from '../utils/logger';
import type { AppError } from '@shared/types/common';
import type { PushChannel } from '@shared/constants/channels';

const log = createLogger('ipc');

/**
 * IPC plumbing.
 *
 * Two rules are enforced here rather than trusted to each handler:
 *
 *  1. Every payload is parsed by a Zod schema before a handler sees it. The
 *     renderer is a browser context and is treated as untrusted input.
 *  2. Nothing throws across the bridge. Handlers return a discriminated result,
 *     so a failure arrives as a code and a translation key while the stack trace
 *     stays in the log file.
 */

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: AppError };

const registered = new Set<string>();

export function handle<S extends ZodTypeAny, R>(
  channel: string,
  schema: S,
  handler: (input: z.infer<S>, event: IpcMainInvokeEvent) => R | Promise<R>,
): void {
  if (registered.has(channel)) {
    throw new Error(`Duplicate IPC channel registration: ${channel}`);
  }
  registered.add(channel);

  ipcMain.handle(channel, async (event, raw): Promise<IpcResult<R>> => {
    const parsed = schema.safeParse(raw ?? {});
    if (!parsed.success) {
      log.warn('rejected malformed payload', { channel, issues: parsed.error.issues.length });
      return {
        ok: false,
        error: { code: 'VALIDATION', messageKey: 'error.badRequest', detail: channel },
      };
    }

    try {
      const data = await handler(parsed.data, event);
      return { ok: true, data };
    } catch (err) {
      const error = toAppError(err);
      // NOT_FOUND is an ordinary outcome of navigating to something removed.
      if (error.code === 'NOT_FOUND') log.debug('handler not found', { channel });
      else log.error('handler failed', { channel, code: error.code, message: String(err) });
      return { ok: false, error };
    }
  });
}

export function clearRegistrations(): void {
  for (const channel of registered) ipcMain.removeHandler(channel);
  registered.clear();
}

/** Sends a push message to every open window. */
export function broadcast(channel: PushChannel, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    const contents: WebContents = window.webContents;
    if (contents.isDestroyed()) continue;
    contents.send(channel, payload);
  }
}
