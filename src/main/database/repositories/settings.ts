import type { Db } from '../types';
import type { AppSettings, ImportHistoryEntry } from '@shared/types/domain';
import { DEFAULT_SETTINGS } from '@shared/models/defaults';

/**
 * Settings live in the archive database rather than in a JSON file, so a backup
 * captures preferences alongside the data they describe (a qualifying-play
 * threshold means nothing without the archive it was applied to).
 */

export function readSettings(db: Db): AppSettings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as {
    key: string;
    value: string;
  }[];

  const result: AppSettings = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    if (!(row.key in DEFAULT_SETTINGS)) continue;
    try {
      (result as unknown as Record<string, unknown>)[row.key] = JSON.parse(row.value);
    } catch {
      /* a corrupt value falls back to the default rather than failing startup */
    }
  }
  return result;
}

export function writeSettings(db: Db, patch: Partial<AppSettings>): AppSettings {
  const stmt = db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );
  const now = Date.now();
  const run = db.transaction(() => {
    for (const [key, value] of Object.entries(patch)) {
      if (!(key in DEFAULT_SETTINGS)) continue;
      if (value === undefined) continue;
      stmt.run(key, JSON.stringify(value), now);
    }
  });
  run();
  return readSettings(db);
}

export function resetSettings(db: Db): AppSettings {
  db.prepare('DELETE FROM settings').run();
  return writeSettings(db, DEFAULT_SETTINGS);
}

export function readMetadata(db: Db, key: string): string | null {
  const row = db.prepare('SELECT value FROM app_metadata WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function writeMetadata(db: Db, key: string, value: string): void {
  db.prepare(
    'INSERT INTO app_metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}

export function importHistory(db: Db, limit = 25): ImportHistoryEntry[] {
  return db
    .prepare(
      `SELECT id, started_at AS startedAt, finished_at AS finishedAt,
              source_type AS sourceType, source_name AS sourceName, file_count AS fileCount,
              events_found AS eventsFound, events_inserted AS eventsInserted,
              events_duplicate AS eventsDuplicate, status
       FROM imports ORDER BY started_at DESC LIMIT ?`,
    )
    .all(limit) as ImportHistoryEntry[];
}

/** Files already absorbed, so a repeated ZIP can be skipped without re-parsing. */
export function knownFileHashes(db: Db): Set<string> {
  const rows = db
    .prepare(
      `SELECT DISTINCT f.file_hash FROM import_files f
       JOIN imports i ON i.id = f.import_id
       WHERE i.status = 'complete'`,
    )
    .pluck()
    .all() as string[];
  return new Set(rows);
}
