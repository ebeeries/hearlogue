import { describe, it, expect, afterEach } from 'vitest';
import {
  createTempArchive,
  createAnalyzedArchive,
  demoEvents,
  ingestEvents,
  buildAnalytics,
  TEST_NOW,
  type TempArchive,
} from '../fixtures/archive';
import { LATEST_SCHEMA_VERSION, currentSchemaVersion } from '@main/database/migrations';
import { analyticsAreStale } from '@main/analytics/rebuild';
import { TEST_SETTINGS } from '../fixtures/archive';

let archive: TempArchive | null = null;

afterEach(() => {
  archive?.cleanup();
  archive = null;
});

describe('database migrations', () => {
  it('brings a fresh file to the latest schema version', () => {
    archive = createTempArchive();
    expect(currentSchemaVersion(archive.db)).toBe(LATEST_SCHEMA_VERSION);
  });

  it('is idempotent when reopened', () => {
    archive = createTempArchive();
    const before = currentSchemaVersion(archive.db);
    const rows = archive.db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as {
      n: number;
    };
    expect(before).toBe(LATEST_SCHEMA_VERSION);
    expect(rows.n).toBe(LATEST_SCHEMA_VERSION);
  });

  it('seeds starter tags and collections exactly once', () => {
    archive = createTempArchive();
    const tags = archive.db.prepare('SELECT COUNT(*) AS n FROM tags').get() as { n: number };
    const collections = archive.db.prepare('SELECT COUNT(*) AS n FROM smart_collections').get() as {
      n: number;
    };
    expect(tags.n).toBeGreaterThan(4);
    expect(collections.n).toBeGreaterThan(1);
  });
});

describe('ingestion', () => {
  it('stores events and resolves entities', () => {
    archive = createTempArchive();
    const events = demoEvents(120);
    ingestEvents(archive.db, events);

    const counts = archive.db
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM playback_events) AS events,
          (SELECT COUNT(*) FROM tracks) AS tracks,
          (SELECT COUNT(*) FROM artists) AS artists,
          (SELECT COUNT(*) FROM albums) AS albums`,
      )
      .get() as { events: number; tracks: number; artists: number; albums: number };

    expect(counts.events).toBeGreaterThan(1000);
    expect(counts.events).toBeLessThanOrEqual(events.length);
    expect(counts.artists).toBeGreaterThan(10);
    expect(counts.tracks).toBeGreaterThan(50);
    expect(counts.albums).toBeGreaterThan(10);
  });

  it('is idempotent — re-ingesting the same export adds nothing', () => {
    archive = createTempArchive();
    const events = demoEvents(120);

    ingestEvents(archive.db, events);
    const first = (
      archive.db.prepare('SELECT COUNT(*) AS n FROM playback_events').get() as { n: number }
    ).n;

    ingestEvents(archive.db, events);
    const second = (
      archive.db.prepare('SELECT COUNT(*) AS n FROM playback_events').get() as { n: number }
    ).n;

    expect(second).toBe(first);
  });

  it('merges only genuinely new events from a later export', () => {
    archive = createTempArchive();
    const events = demoEvents(120);
    const half = Math.floor(events.length / 2);

    ingestEvents(archive.db, events.slice(0, half));
    const afterFirst = (
      archive.db.prepare('SELECT COUNT(*) AS n FROM playback_events').get() as { n: number }
    ).n;

    ingestEvents(archive.db, events);
    const afterSecond = (
      archive.db.prepare('SELECT COUNT(*) AS n FROM playback_events').get() as { n: number }
    ).n;

    expect(afterSecond).toBeGreaterThan(afterFirst);
    expect(afterSecond).toBeLessThanOrEqual(events.length);
  });
});

describe('analytics rebuild', () => {
  it('produces every derived table', () => {
    archive = createAnalyzedArchive(160);
    const db = archive.db;

    const tableCount = (name: string): number =>
      (db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get() as { n: number }).n;

    expect(tableCount('track_stats')).toBeGreaterThan(50);
    expect(tableCount('artist_stats')).toBeGreaterThan(10);
    expect(tableCount('album_stats')).toBeGreaterThan(10);
    expect(tableCount('monthly_track_stats')).toBeGreaterThan(100);
    expect(tableCount('monthly_artist_stats')).toBeGreaterThan(50);
    expect(tableCount('daily_stats')).toBeGreaterThan(100);
    expect(tableCount('hourly_stats')).toBeGreaterThan(20);
    expect(tableCount('yearly_stats')).toBeGreaterThan(5);
    expect(tableCount('sessions')).toBeGreaterThan(50);
    expect(tableCount('search_index')).toBeGreaterThan(50);
  });

  it('detects eras, obsessions and graveyard entries in a realistic history', () => {
    archive = createAnalyzedArchive(200);
    const db = archive.db;

    const eras = db.prepare('SELECT * FROM eras ORDER BY position').all() as {
      id: number;
      auto_title: string;
      months: number;
      start_ym: string;
      end_ym: string;
    }[];
    expect(eras.length).toBeGreaterThanOrEqual(2);
    for (const era of eras) {
      expect(era.months).toBeGreaterThanOrEqual(1);
      expect(era.auto_title.length).toBeGreaterThan(3);
      expect(era.start_ym <= era.end_ym).toBe(true);
    }

    const obsessions = (
      db.prepare("SELECT COUNT(*) AS n FROM obsessions WHERE kind = 'track'").get() as { n: number }
    ).n;
    expect(obsessions).toBeGreaterThan(0);

    const graves = (
      db.prepare("SELECT COUNT(*) AS n FROM graveyard WHERE kind = 'artist'").get() as { n: number }
    ).n;
    expect(graves).toBeGreaterThan(0);
  });

  it('scores lost favorites only for genuinely dormant, well-played tracks', () => {
    archive = createAnalyzedArchive(200);
    const rows = archive.db
      .prepare(
        `SELECT ts.lost_score, ts.q_plays, ts.last_ts
         FROM track_stats ts WHERE ts.lost_score > 0 ORDER BY ts.lost_score DESC LIMIT 40`,
      )
      .all() as { lost_score: number; q_plays: number; last_ts: number }[];

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.q_plays).toBeGreaterThanOrEqual(8);
      expect(TEST_NOW - row.last_ts).toBeGreaterThanOrEqual(365 * 86_400_000);
      expect(row.lost_score).toBeLessThanOrEqual(100);
    }
  });

  it('marks analytics stale when a threshold changes and fresh after a rebuild', () => {
    archive = createAnalyzedArchive(120);
    expect(analyticsAreStale(archive.db, TEST_SETTINGS)).toBe(false);
    expect(analyticsAreStale(archive.db, { ...TEST_SETTINGS, qualifyingPlayMs: 45_000 })).toBe(true);

    buildAnalytics(archive.db, { qualifyingPlayMs: 45_000 });
    expect(analyticsAreStale(archive.db, { ...TEST_SETTINGS, qualifyingPlayMs: 45_000 })).toBe(
      false,
    );
  });

  it('rebuilds cleanly a second time without duplicating derived rows', () => {
    archive = createAnalyzedArchive(120);
    const before = (
      archive.db.prepare('SELECT COUNT(*) AS n FROM track_stats').get() as { n: number }
    ).n;
    buildAnalytics(archive.db);
    const after = (
      archive.db.prepare('SELECT COUNT(*) AS n FROM track_stats').get() as { n: number }
    ).n;
    expect(after).toBe(before);
  });
});
