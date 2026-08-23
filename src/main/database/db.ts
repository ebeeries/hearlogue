import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type { Db } from './types';
import { runMigrations, LATEST_SCHEMA_VERSION } from './migrations';
import { ensureEventIndexes } from './indexes';
import { createLogger } from '../utils/logger';
import { HearlogueError } from '../utils/errors';

const log = createLogger('db');

/**
 * SQLite connection management.
 *
 * WAL is enabled so the import worker can write while the main process keeps
 * serving reads to the UI — that is what allows the interface to stay live and
 * navigable during a million-event import instead of showing a spinner.
 */

export interface OpenOptions {
  readonly?: boolean;
  /** Skip migrations — used by the backup verifier, which must not mutate. */
  skipMigrations?: boolean;
}

export function openDatabase(file: string, options: OpenOptions = {}): Db {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new Database(file, { readonly: options.readonly === true }) as Db;

  if (!options.readonly) {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
  }
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 8000');
  db.pragma('temp_store = MEMORY');
  db.pragma('cache_size = -32000'); // ~32 MB page cache
  db.pragma('mmap_size = 268435456'); // 256 MB

  if (!options.readonly && !options.skipMigrations) {
    const result = runMigrations(db);
    if (result.applied.length > 0) {
      log.info('migrations applied', {
        from: result.from,
        to: result.to,
        count: result.applied.length,
      });
    }
    // A bulk import drops these to go faster. If it was interrupted they will be
    // missing here, and rebuilding them is the cost of one startup rather than a
    // permanently slow archive.
    ensureEventIndexes(db);
  }

  return db;
}

/** A connection tuned for bulk ingestion. Only ever used by the import worker. */
export function openForImport(file: string): Db {
  const db = openDatabase(file);
  db.pragma('cache_size = -128000'); // ~128 MB while writing
  db.pragma('wal_autocheckpoint = 4000');
  return db;
}

export function closeDatabase(db: Db | null): void {
  if (!db) return;
  try {
    if (db.open) {
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();
    }
  } catch (err) {
    log.warn('close failed', err);
  }
}

export function assertSchemaCompatible(db: Db): void {
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as
    | { v: number | null }
    | undefined;
  const version = row?.v ?? 0;
  if (version > LATEST_SCHEMA_VERSION) {
    throw new HearlogueError(
      'BACKUP_INCOMPATIBLE',
      'error.schemaTooNew',
      `db=${version} app=${LATEST_SCHEMA_VERSION}`,
    );
  }
}

/** Best-effort byte size of the database including its WAL sidecar. */
export function databaseSize(file: string): number {
  let total = 0;
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      total += fs.statSync(`${file}${suffix}`).size;
    } catch {
      /* sidecars may not exist */
    }
  }
  return total;
}

/** Removes a database file and its sidecars. */
export function removeDatabaseFiles(file: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(`${file}${suffix}`, { force: true });
    } catch (err) {
      log.warn('failed to remove database file', err);
    }
  }
}
