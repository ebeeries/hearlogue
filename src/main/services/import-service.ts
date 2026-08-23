import { utilityProcess, type UtilityProcess } from 'electron';
import { archiveService } from './archive-service';
import { importWorkerPath } from '../utils/paths';
import { describeSourceSelection } from '../import/parsers/sources';
import { emptyProgress, type ImportJob, type WorkerOutbound } from '../import/protocol';
import { createLogger } from '../utils/logger';
import { HearlogueError, toAppError } from '../utils/errors';
import type { ImportProgress, ImportReport } from '@shared/types/domain';
import type { AppError } from '@shared/types/common';

const log = createLogger('import');

/**
 * Drives the import worker and mirrors its progress back to the renderer.
 *
 * The main process deliberately holds no write connection while an import runs:
 * the worker owns writes, this side only reads, and WAL keeps both honest.
 */

export interface ImportServiceEvents {
  onProgress: (progress: ImportProgress) => void;
  onDone: (report: ImportReport) => void;
  onFailed: (error: AppError) => void;
  onCancelled: () => void;
}

class ImportService {
  private child: UtilityProcess | null = null;
  private progress: ImportProgress = emptyProgress();
  private report: ImportReport | null = null;
  private listeners: ImportServiceEvents | null = null;

  bind(listeners: ImportServiceEvents): void {
    this.listeners = listeners;
  }

  get isRunning(): boolean {
    return this.child !== null;
  }

  status(): { progress: ImportProgress; report: ImportReport | null } {
    return { progress: this.progress, report: this.report };
  }

  start(paths: string[], options: { kind?: 'files' | 'demo'; demoIntensity?: number } = {}): ImportProgress {
    if (this.child) throw new HearlogueError('IMPORT_RUNNING', 'error.importRunning');

    const kind = options.kind ?? 'files';
    const db = archiveService.current;
    const described =
      kind === 'demo'
        ? { type: 'demo', name: 'Demo Archive' }
        : describeSourceSelection(paths);

    const info = db
      .prepare(
        `INSERT INTO imports (started_at, source_type, source_name, status)
         VALUES (?, ?, ?, 'running')`,
      )
      .run(Date.now(), described.type, described.name);

    const job: ImportJob = {
      importId: Number(info.lastInsertRowid),
      databaseFile: archiveService.databaseFile,
      kind,
      paths,
      sourceType: described.type,
      sourceName: described.name,
      demoIntensity: options.demoIntensity,
      settings: archiveService.rebuildSettings(),
      now: Date.now(),
    };

    this.report = null;
    this.progress = { ...emptyProgress(job.importId), phase: 'preparing', messageKey: 'import.message.preparing' };
    archiveService.setImportRunning(true);

    const child = utilityProcess.fork(importWorkerPath(), [], {
      serviceName: 'hearlogue-import',
      stdio: 'ignore',
    });
    this.child = child;

    child.on('message', (message: WorkerOutbound) => this.handle(message));
    child.on('exit', (code) => {
      const wasRunning = this.child !== null;
      this.child = null;
      archiveService.setImportRunning(false);
      if (wasRunning && this.progress.phase !== 'complete' && this.progress.phase !== 'cancelled') {
        log.error('import worker exited unexpectedly', { code });
        this.fail({ code: 'UNKNOWN', messageKey: 'error.importWorkerCrashed' });
      }
    });

    child.postMessage({ type: 'start', job });
    log.info('import started', { kind, files: paths.length, importId: job.importId });

    return this.progress;
  }

  cancel(): void {
    if (!this.child) return;
    log.info('import cancellation requested');
    this.child.postMessage({ type: 'cancel' });
  }

  private handle(message: WorkerOutbound): void {
    switch (message.type) {
      case 'progress':
        this.progress = message.progress;
        this.listeners?.onProgress(this.progress);
        break;

      case 'done':
        this.report = message.report;
        this.progress = { ...this.progress, phase: 'complete', progress: 1 };
        this.finish();
        log.info('import complete', {
          inserted: message.report.eventsInserted,
          duplicate: message.report.eventsDuplicate,
          ms: message.report.durationMs,
        });
        this.listeners?.onProgress(this.progress);
        this.listeners?.onDone(message.report);
        break;

      case 'failed':
        log.error('import failed', message.error);
        this.fail(message.error);
        break;

      case 'cancelled':
        this.progress = { ...this.progress, phase: 'cancelled' };
        this.finish();
        this.listeners?.onProgress(this.progress);
        this.listeners?.onCancelled();
        break;

      default:
        break;
    }
  }

  private fail(error: AppError): void {
    this.progress = { ...this.progress, phase: 'failed', error };
    this.finish();
    this.listeners?.onProgress(this.progress);
    this.listeners?.onFailed(error);
  }

  private finish(): void {
    const child = this.child;
    this.child = null;
    archiveService.setImportRunning(false);
    try {
      child?.kill();
    } catch (err) {
      log.warn('failed to stop import worker', toAppError(err));
    }
  }

  shutdown(): void {
    this.finish();
  }
}

export const importService = new ImportService();
