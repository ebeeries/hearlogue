import type { Db } from './types';
import { createLogger } from '../utils/logger';

const log = createLogger('db');

/**
 * Secondary indexes on `playback_events`.
 *
 * These are created by the initial migration and are declared again here so a
 * bulk import can drop them, insert, and rebuild them in one pass. Maintaining
 * seven B-trees per row costs roughly a fifth of the time on a million-event
 * import, and rebuilding them afterwards takes seconds.
 *
 * The unique index on `fingerprint` is deliberately absent from this list: it is
 * what makes an import idempotent, so it must stay live while rows are written.
 */
export const EVENT_INDEXES: { name: string; sql: string }[] = [
  { name: 'idx_events_ts', sql: 'CREATE INDEX IF NOT EXISTS idx_events_ts ON playback_events(ts)' },
  {
    name: 'idx_events_track_ts',
    sql: 'CREATE INDEX IF NOT EXISTS idx_events_track_ts ON playback_events(track_id, ts)',
  },
  {
    name: 'idx_events_artist_ts',
    sql: 'CREATE INDEX IF NOT EXISTS idx_events_artist_ts ON playback_events(artist_id, ts)',
  },
  {
    name: 'idx_events_album_ts',
    sql: 'CREATE INDEX IF NOT EXISTS idx_events_album_ts ON playback_events(album_id, ts)',
  },
  {
    name: 'idx_events_date',
    sql: 'CREATE INDEX IF NOT EXISTS idx_events_date ON playback_events(local_date)',
  },
  { name: 'idx_events_ym', sql: 'CREATE INDEX IF NOT EXISTS idx_events_ym ON playback_events(ym)' },
  {
    name: 'idx_events_year',
    sql: 'CREATE INDEX IF NOT EXISTS idx_events_year ON playback_events(year)',
  },
];

/**
 * Recreates any missing event index.
 *
 * Called on every write connection, which is what makes dropping them for an
 * import safe: if the app is killed mid-import, the indexes are simply rebuilt
 * the next time the archive is opened rather than being lost.
 */
export function ensureEventIndexes(db: Db): number {
  const existing = new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'playback_events'")
      .pluck()
      .all() as string[],
  );

  const missing = EVENT_INDEXES.filter((index) => !existing.has(index.name));
  if (missing.length === 0) return 0;

  log.info('rebuilding event indexes', { count: missing.length });
  for (const index of missing) db.exec(index.sql);
  return missing.length;
}

/** Drops the secondary indexes ahead of a bulk insert. */
export function dropEventIndexes(db: Db): void {
  for (const index of EVENT_INDEXES) {
    db.exec(`DROP INDEX IF EXISTS ${index.name}`);
  }
}
