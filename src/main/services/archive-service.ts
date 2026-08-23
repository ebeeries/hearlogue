import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { Db } from '../database/types';
import {
  openDatabase,
  closeDatabase,
  databaseSize,
  removeDatabaseFiles,
  assertSchemaCompatible,
} from '../database/db';
import { realDatabasePath, demoDatabasePath, backupsDir, dataDir } from '../utils/paths';
import { seedArchiveDefaults } from './seed';
import { readSettings, writeSettings, readMetadata, writeMetadata } from '../database/repositories/settings';
import { analyticsAreStale, resetDerivedAnalytics, rebuildAnalytics, type RebuildSettings } from '../analytics/rebuild';
import { LATEST_SCHEMA_VERSION, currentSchemaVersion } from '../database/migrations';
import { createLogger } from '../utils/logger';
import { HearlogueError } from '../utils/errors';
import { ANALYTICS_ENGINE_VERSION, BACKUP_FORMAT_VERSION } from '@shared/constants/app';
import type {
  ArchiveState,
  AppSettings,
  IntegrityReport,
  BackupResult,
  BackupManifest,
  RestoreResult,
} from '@shared/types/domain';

const log = createLogger('archive');

/**
 * Owns the live database connection and everything that can replace it:
 * switching into the Demo Archive, restoring a backup, deleting the archive.
 *
 * The demo lives in its own file. There is no flag inside a shared database that
 * could be misread — exploring the demo physically cannot touch imported
 * history, and leaving the demo is just a reconnection.
 */
class ArchiveService {
  private db: Db | null = null;
  private demo = false;
  private importRunning = false;

  /** Opens the appropriate archive, honouring the persisted demo preference. */
  open(): Db {
    if (this.db) return this.db;

    // The demo preference is stored in the real archive, so it survives restarts.
    const real = openDatabase(realDatabasePath());
    seedArchiveDefaults(real);
    const settings = readSettings(real);

    if (settings.demoMode) {
      closeDatabase(real);
      this.demo = true;
      this.db = this.openDemo();
    } else {
      this.demo = false;
      this.db = real;
    }

    log.info('archive opened', { demo: this.demo, schema: currentSchemaVersion(this.db) });
    return this.db;
  }

  private openDemo(): Db {
    const db = openDatabase(demoDatabasePath());
    seedArchiveDefaults(db);
    writeSettings(db, { demoMode: true });
    return db;
  }

  get current(): Db {
    return this.db ?? this.open();
  }

  get isDemo(): boolean {
    return this.demo;
  }

  get databaseFile(): string {
    return this.demo ? demoDatabasePath() : realDatabasePath();
  }

  setImportRunning(running: boolean): void {
    this.importRunning = running;
  }

  close(): void {
    closeDatabase(this.db);
    this.db = null;
  }

  /** Reconnects after a file-level change (restore, delete, demo switch). */
  private reconnect(demo: boolean): void {
    this.close();
    this.demo = demo;
    this.db = demo ? this.openDemo() : (() => {
      const db = openDatabase(realDatabasePath());
      seedArchiveDefaults(db);
      writeSettings(db, { demoMode: false });
      return db;
    })();
  }

  enterDemo(): void {
    if (this.demo) return;
    // Record the choice in the real archive first, so a crash mid-switch still
    // reopens into the demo rather than into a half-configured state.
    const real = this.current;
    writeSettings(real, { demoMode: true });
    this.reconnect(true);
    log.info('entered demo archive');
  }

  exitDemo(): void {
    if (!this.demo) return;
    this.reconnect(false);
    log.info('exited demo archive');
  }

  /** True when the demo file has no events yet and needs generating. */
  demoNeedsSeeding(): boolean {
    if (!this.demo) return false;
    const row = this.current.prepare('SELECT COUNT(*) AS n FROM playback_events').get() as {
      n: number;
    };
    return row.n === 0;
  }

  settings(): AppSettings {
    return readSettings(this.current);
  }

  rebuildSettings(): RebuildSettings {
    const s = this.settings();
    return {
      qualifyingPlayMs: s.qualifyingPlayMs,
      includePrivateSessions: s.includePrivateSessions,
      sessionGapMinutes: s.sessionGapMinutes,
      dormancyDays: s.dormancyDays,
    };
  }

  state(): ArchiveState {
    const db = this.current;
    const counts = db
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM playback_events) AS eventCount,
          (SELECT COUNT(*) FROM tracks)          AS trackCount,
          (SELECT COUNT(*) FROM artists)         AS artistCount,
          (SELECT COUNT(*) FROM albums)          AS albumCount,
          (SELECT MIN(ts) FROM playback_events)  AS firstTs,
          (SELECT MAX(ts) FROM playback_events)  AS lastTs`,
      )
      .get() as {
      eventCount: number;
      trackCount: number;
      artistCount: number;
      albumCount: number;
      firstTs: number | null;
      lastTs: number | null;
    };

    const builtAt = readMetadata(db, 'analytics_built_at');

    return {
      hasArchive: counts.eventCount > 0,
      isDemo: this.demo,
      ...counts,
      analyticsVersion: Number(readMetadata(db, 'analytics_version') ?? 0),
      analyticsBuiltAt: builtAt ? Number(builtAt) : null,
      analyticsStale:
        counts.eventCount > 0 && analyticsAreStale(db, this.rebuildSettings()),
      importRunning: this.importRunning,
    };
  }

  /** Rebuild analytics in-process. Used for setting changes, not for imports. */
  rebuildNow(onStep?: (step: string, index: number, total: number) => void): void {
    rebuildAnalytics(
      this.current,
      this.rebuildSettings(),
      (step, index, total) => onStep?.(step, index, total),
      Date.now(),
    );
  }

  resetDerived(): void {
    resetDerivedAnalytics(this.current);
  }

  /**
   * Deletes the imported archive and everything derived from it.
   *
   * Only HEARLOGUE's own database is removed — the user's original Spotify
   * export files are never touched, and are not even known to this method.
   */
  deleteArchive(): void {
    if (this.demo) {
      throw new HearlogueError('DEMO_ACTIVE', 'error.demoActive');
    }
    this.close();
    removeDatabaseFiles(realDatabasePath());
    this.db = openDatabase(realDatabasePath());
    seedArchiveDefaults(this.db);
    this.demo = false;
    log.info('archive deleted and recreated empty');
  }

  integrity(): IntegrityReport {
    const db = this.current;
    const checks: IntegrityReport['checks'] = [];

    const integrity = db.pragma('integrity_check') as { integrity_check: string }[];
    const integrityOk = integrity.length === 1 && integrity[0].integrity_check === 'ok';
    checks.push({
      name: 'integrity_check',
      ok: integrityOk,
      detail: integrityOk ? 'ok' : integrity.map((r) => r.integrity_check).join('; ').slice(0, 200),
    });

    const foreignKeys = db.pragma('foreign_key_check') as unknown[];
    checks.push({
      name: 'foreign_key_check',
      ok: foreignKeys.length === 0,
      detail: foreignKeys.length === 0 ? 'ok' : `${foreignKeys.length} violations`,
    });

    const schema = currentSchemaVersion(db);
    checks.push({
      name: 'schema_version',
      ok: schema === LATEST_SCHEMA_VERSION,
      detail: `${schema} / ${LATEST_SCHEMA_VERSION}`,
    });

    const analyticsVersion = Number(readMetadata(db, 'analytics_version') ?? 0);
    checks.push({
      name: 'analytics_version',
      ok: analyticsVersion === ANALYTICS_ENGINE_VERSION,
      detail: `${analyticsVersion} / ${ANALYTICS_ENGINE_VERSION}`,
    });

    const orphans = db
      .prepare(
        `SELECT COUNT(*) AS n FROM playback_events e
         LEFT JOIN tracks t ON t.id = e.track_id WHERE t.id IS NULL`,
      )
      .get() as { n: number };
    checks.push({
      name: 'orphan_events',
      ok: orphans.n === 0,
      detail: orphans.n === 0 ? 'ok' : `${orphans.n} orphans`,
    });

    const pageCount = (db.pragma('page_count', { simple: true }) as number) ?? 0;
    const freePages = (db.pragma('freelist_count', { simple: true }) as number) ?? 0;

    return {
      ok: checks.every((c) => c.ok),
      checks,
      sizeBytes: databaseSize(this.databaseFile),
      pageCount,
      freePages,
    };
  }

  /**
   * Backup uses SQLite's own online backup API, so it is safe to run while the
   * app is live and produces a consistent file rather than a torn copy.
   */
  async backup(targetPath?: string): Promise<BackupResult> {
    const db = this.current;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file =
      targetPath ?? path.join(backupsDir(), `hearlogue-backup-${stamp}.hearlogue`);

    fs.mkdirSync(path.dirname(file), { recursive: true });
    await db.backup(file);

    // The manifest travels inside the backup itself, so a restore can verify
    // compatibility before overwriting anything.
    const manifest: BackupManifest = {
      formatVersion: BACKUP_FORMAT_VERSION,
      appVersion: app.getVersion(),
      createdAt: Date.now(),
      schemaVersion: currentSchemaVersion(db),
      eventCount: (db.prepare('SELECT COUNT(*) AS n FROM playback_events').get() as { n: number }).n,
      isDemo: this.demo,
    };

    const backupDb = openDatabase(file, { skipMigrations: true });
    try {
      writeMetadata(backupDb, 'backup_manifest', JSON.stringify(manifest));
    } finally {
      closeDatabase(backupDb);
    }

    const size = fs.statSync(file).size;
    log.info('backup created', { size, events: manifest.eventCount });
    return { path: file, sizeBytes: size, createdAt: manifest.createdAt };
  }

  inspectBackup(file: string): BackupManifest {
    if (!fs.existsSync(file)) {
      throw new HearlogueError('NOT_FOUND', 'error.fileMissing', path.basename(file));
    }
    let db: Db | null = null;
    try {
      db = openDatabase(file, { readonly: true, skipMigrations: true });
      assertSchemaCompatible(db);
      const raw = readMetadata(db, 'backup_manifest');
      if (!raw) {
        throw new HearlogueError('BACKUP_INCOMPATIBLE', 'error.notABackup', path.basename(file));
      }
      const manifest = JSON.parse(raw) as BackupManifest;
      if (manifest.formatVersion > BACKUP_FORMAT_VERSION) {
        throw new HearlogueError(
          'BACKUP_INCOMPATIBLE',
          'error.backupTooNew',
          String(manifest.formatVersion),
        );
      }
      return manifest;
    } catch (err) {
      if (err instanceof HearlogueError) throw err;
      throw new HearlogueError('BACKUP_INCOMPATIBLE', 'error.notABackup', path.basename(file), err);
    } finally {
      closeDatabase(db);
    }
  }

  /**
   * Restores a backup over the real archive.
   *
   * The current archive is copied aside first. A restore that fails part-way
   * therefore loses nothing, and the safety copy is left on disk deliberately —
   * silently deleting a user's only remaining data would be the worst possible
   * outcome of a recovery flow.
   */
  restore(file: string): RestoreResult {
    const manifest = this.inspectBackup(file);

    if (this.demo) this.exitDemo();
    this.close();

    const target = realDatabasePath();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safety = path.join(dataDir(), `pre-restore-${stamp}.db`);

    try {
      if (fs.existsSync(target)) fs.copyFileSync(target, safety);
      removeDatabaseFiles(target);
      fs.copyFileSync(file, target);
    } catch (err) {
      // Put the original back before surfacing the failure.
      try {
        if (fs.existsSync(safety)) fs.copyFileSync(safety, target);
      } catch {
        /* the safety copy remains on disk for manual recovery */
      }
      this.db = openDatabase(target);
      throw new HearlogueError('UNKNOWN', 'error.restoreFailed', undefined, err);
    }

    this.db = openDatabase(target);
    seedArchiveDefaults(this.db);
    writeSettings(this.db, { demoMode: false });
    this.demo = false;

    const eventCount = (
      this.db.prepare('SELECT COUNT(*) AS n FROM playback_events').get() as { n: number }
    ).n;

    log.info('backup restored', { events: eventCount, from: manifest.createdAt });
    return { restored: true, manifest, eventCount };
  }

  /** Compacts the database file after large deletions. */
  vacuum(): void {
    this.current.exec('VACUUM');
  }
}

export const archiveService = new ArchiveService();
