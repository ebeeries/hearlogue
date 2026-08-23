import type { ImportProgress, ImportReport } from '@shared/types/domain';
import type { AppError } from '@shared/types/common';

/**
 * The message contract between the main process and the import worker.
 *
 * The worker runs in a separate Electron `utilityProcess` with its own SQLite
 * connection. That is what keeps the window fully interactive during a
 * million-event import: the heavy work never touches the process that answers
 * the renderer.
 */

export interface ImportJob {
  importId: number;
  databaseFile: string;
  /**
   * `files` reads a real Spotify export from disk. `demo` synthesises the Demo
   * Archive — it runs through the identical ingest and analytics path so the
   * demo is never a special case the rest of the app has to know about.
   */
  kind: 'files' | 'demo';
  paths: string[];
  sourceType: string;
  sourceName: string;
  /** Events per active month when generating the demo archive. */
  demoIntensity?: number;
  settings: {
    qualifyingPlayMs: number;
    includePrivateSessions: boolean;
    sessionGapMinutes: number;
    dormancyDays: number;
  };
  /** Fixed clock, so progress and analytics agree on "now". */
  now: number;
}

export type WorkerInbound = { type: 'start'; job: ImportJob } | { type: 'cancel' };

export type WorkerOutbound =
  | { type: 'progress'; progress: ImportProgress }
  | { type: 'done'; report: ImportReport }
  | { type: 'failed'; error: AppError }
  | { type: 'cancelled' };

export function emptyProgress(importId: number | null = null): ImportProgress {
  return {
    importId,
    phase: 'idle',
    progress: 0,
    filesTotal: 0,
    filesDone: 0,
    currentFile: null,
    eventsFound: 0,
    eventsInserted: 0,
    eventsDuplicate: 0,
    eventsInvalid: 0,
    artists: 0,
    tracks: 0,
    albums: 0,
    yearsFrom: null,
    yearsTo: null,
    analyticsStep: null,
    messageKey: null,
    error: null,
  };
}
