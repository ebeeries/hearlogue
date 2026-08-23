import type { Db, Migration } from '../types';
import { migration001 } from './001-initial';
import { migration002 } from './002-search';
import { migration003 } from './003-artist-nights';

/**
 * Ordered migration list. Adding a schema change means appending a new file and
 * a new entry here — the database is never dropped and recreated, because a
 * user's imported archive is not something we get to throw away on an upgrade.
 */
export const MIGRATIONS: Migration[] = [migration001, migration002, migration003];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

export function currentSchemaVersion(db: Db): number {
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as
    | { v: number | null }
    | undefined;
  return row?.v ?? 0;
}

export function runMigrations(db: Db): { from: number; to: number; applied: string[] } {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);

  const from = currentSchemaVersion(db);
  const applied: string[] = [];
  const record = db.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
  );

  for (const migration of MIGRATIONS) {
    if (migration.version <= from) continue;
    const run = db.transaction(() => {
      migration.up(db);
      record.run(migration.version, migration.name, Date.now());
    });
    run();
    applied.push(`${migration.version}-${migration.name}`);
  }

  return { from, to: currentSchemaVersion(db), applied };
}
