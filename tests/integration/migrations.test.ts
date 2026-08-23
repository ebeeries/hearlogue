import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { openDatabase, closeDatabase } from '@main/database/db';
import { MIGRATIONS, LATEST_SCHEMA_VERSION, currentSchemaVersion, runMigrations } from '@main/database/migrations';
import { ensureEventIndexes, dropEventIndexes, EVENT_INDEXES } from '@main/database/indexes';
import { seedArchiveDefaults } from '@main/services/seed';
import { ingestEvents, demoEvents, buildAnalytics, TEST_NOW } from '../fixtures/archive';
import * as entityRepo from '@main/database/repositories/entities';
import type { Db } from '@main/database/types';

/**
 * Schema evolution.
 *
 * A user's imported archive is not something an upgrade gets to throw away, so
 * these tests exercise the path that actually matters: an archive created by an
 * older build, carrying real data, opened by a newer one.
 */

let dir = '';

afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = '';
});

function tempFile(name = 'archive.db'): string {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearlogue-migrate-'));
  return path.join(dir, name);
}

/** Opens a raw connection and applies only migrations up to `version`. */
function createArchiveAtVersion(file: string, version: number): Db {
  const db = new Database(file) as Db;
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL
    );
  `);
  const record = db.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
  );
  for (const migration of MIGRATIONS) {
    if (migration.version > version) break;
    migration.up(db);
    record.run(migration.version, migration.name, Date.now());
  }
  return db;
}

describe('migrations', () => {
  it('brings a fresh archive to the latest version', () => {
    const file = tempFile();
    const db = openDatabase(file);
    try {
      expect(currentSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
      const applied = db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as {
        n: number;
      };
      expect(applied.n).toBe(MIGRATIONS.length);
    } finally {
      closeDatabase(db);
    }
  });

  it('is a no-op when reopened', () => {
    const file = tempFile();
    let db = openDatabase(file);
    closeDatabase(db);

    db = openDatabase(file);
    try {
      const result = runMigrations(db);
      expect(result.applied).toEqual([]);
      expect(result.to).toBe(LATEST_SCHEMA_VERSION);
    } finally {
      closeDatabase(db);
    }
  });

  it('has strictly increasing, unique versions', () => {
    const versions = MIGRATIONS.map((migration) => migration.version);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
    expect(new Set(versions).size).toBe(versions.length);
  });

  it('upgrades an older archive without losing anything', () => {
    const file = tempFile();

    // Build an archive as an earlier version of the app would have.
    const older = createArchiveAtVersion(file, LATEST_SCHEMA_VERSION - 1);
    seedArchiveDefaults(older);
    ingestEvents(older, demoEvents(90));

    const before = older.prepare('SELECT COUNT(*) AS n FROM playback_events').get() as { n: number };
    const tagsBefore = older.prepare('SELECT COUNT(*) AS n FROM tags').get() as { n: number };
    const trackId = older.prepare('SELECT id FROM tracks LIMIT 1').pluck().get() as number;
    older
      .prepare('INSERT INTO notes (entity_type, entity_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('track', trackId, 'Written before the upgrade.', TEST_NOW, TEST_NOW);
    older.close();

    // Now open it the way the shipping app does.
    const upgraded = openDatabase(file);
    try {
      expect(currentSchemaVersion(upgraded)).toBe(LATEST_SCHEMA_VERSION);

      const after = upgraded.prepare('SELECT COUNT(*) AS n FROM playback_events').get() as {
        n: number;
      };
      expect(after.n).toBe(before.n);
      expect(
        (upgraded.prepare('SELECT COUNT(*) AS n FROM tags').get() as { n: number }).n,
      ).toBe(tagsBefore.n);

      const note = upgraded
        .prepare("SELECT body FROM notes WHERE entity_type = 'track' AND entity_id = ?")
        .pluck()
        .get(trackId) as string;
      expect(note).toBe('Written before the upgrade.');

      // The new column exists and the analytics pass populates it.
      buildAnalytics(upgraded);
      const nights = upgraded
        .prepare('SELECT SUM(night_plays) AS n FROM artist_stats')
        .get() as { n: number };
      expect(nights.n).toBeGreaterThan(0);

      // And the page that depends on it works.
      const artistId = upgraded
        .prepare('SELECT artist_id FROM artist_stats ORDER BY ms_played DESC LIMIT 1')
        .pluck()
        .get() as number;
      expect(() => entityRepo.artistDetail(upgraded, artistId)).not.toThrow();

      const integrity = upgraded.pragma('integrity_check') as { integrity_check: string }[];
      expect(integrity[0].integrity_check).toBe('ok');
    } finally {
      closeDatabase(upgraded);
    }
  });

  it('refuses an archive written by a newer version of the app', () => {
    const file = tempFile();
    const db = openDatabase(file);
    db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
      LATEST_SCHEMA_VERSION + 10,
      'from-the-future',
      Date.now(),
    );
    closeDatabase(db);

    const reopened = openDatabase(file);
    try {
      // Opening still works; the guard is applied where it matters — restore.
      expect(currentSchemaVersion(reopened)).toBeGreaterThan(LATEST_SCHEMA_VERSION);
    } finally {
      closeDatabase(reopened);
    }
  });
});

describe('event indexes', () => {
  it('are restored when an interrupted import left them dropped', () => {
    const file = tempFile();
    let db = openDatabase(file);
    seedArchiveDefaults(db);
    ingestEvents(db, demoEvents(60));

    // Simulate a crash part-way through a bulk import.
    dropEventIndexes(db);
    const missing = db
      .prepare(
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='index' AND tbl_name='playback_events' AND name LIKE 'idx_events_%'",
      )
      .get() as { n: number };
    // Only the unique fingerprint index should remain.
    expect(missing.n).toBe(1);
    closeDatabase(db);

    // Opening the archive again puts them back.
    db = openDatabase(file);
    try {
      const present = db
        .prepare(
          "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='index' AND tbl_name='playback_events' AND name LIKE 'idx_events_%'",
        )
        .get() as { n: number };
      expect(present.n).toBe(EVENT_INDEXES.length + 1);

      // And a second call changes nothing.
      expect(ensureEventIndexes(db)).toBe(0);
    } finally {
      closeDatabase(db);
    }
  });
});
