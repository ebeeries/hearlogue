import { openForImport, closeDatabase } from '../../database/db';
import { runImport } from '../run-import';
import { toAppError } from '../../utils/errors';
import type { WorkerInbound, WorkerOutbound } from '../protocol';

/**
 * Import worker entry point.
 *
 * Runs inside an Electron `utilityProcess`: a full Node environment with access
 * to the native SQLite binding, but no window, no renderer and no shared event
 * loop with the process serving the UI. WAL mode lets this process write while
 * the main process keeps answering read queries, which is why the app stays
 * usable while an import is running.
 */

declare const process: NodeJS.Process & {
  parentPort: {
    postMessage(message: unknown): void;
    on(event: 'message', listener: (event: { data: unknown }) => void): void;
  };
};

let cancelled = false;

function send(message: WorkerOutbound): void {
  process.parentPort.postMessage(message);
}

process.parentPort.on('message', (event) => {
  const message = event.data as WorkerInbound;

  if (message?.type === 'cancel') {
    cancelled = true;
    return;
  }

  if (message?.type !== 'start') return;

  const { job } = message;
  let db = null as ReturnType<typeof openForImport> | null;

  void (async () => {
    try {
      db = openForImport(job.databaseFile);
      const report = await runImport(db, job, {
        onProgress: (progress) => send({ type: 'progress', progress }),
        isCancelled: () => cancelled,
      });
      send({ type: 'done', report });
    } catch (err) {
      const error = toAppError(err);
      if (error.code === 'IMPORT_CANCELLED') {
        markImport(db, job.importId, 'cancelled', error.code);
        send({ type: 'cancelled' });
      } else {
        markImport(db, job.importId, 'failed', error.code);
        send({ type: 'failed', error });
      }
    } finally {
      closeDatabase(db);
      db = null;
    }
  })();
});

function markImport(
  db: ReturnType<typeof openForImport> | null,
  importId: number,
  status: string,
  code: string,
): void {
  if (!db) return;
  try {
    db.prepare('UPDATE imports SET finished_at = ?, status = ?, error_code = ? WHERE id = ?').run(
      Date.now(),
      status,
      code,
      importId,
    );
  } catch {
    /* the database may itself be the reason we are here */
  }
}
