import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTempArchive, TEST_NOW, TEST_SETTINGS, type TempArchive } from '../fixtures/archive';
import { generateDemoEvents, toSpotifyExportJson } from '@main/services/demo-generator';
import { runImport } from '@main/import/run-import';
import * as archiveRepo from '@main/database/repositories/archive';
import * as discoveryRepo from '@main/database/repositories/discovery';
import * as calendarRepo from '@main/database/repositories/calendar';
import * as searchRepo from '@main/database/repositories/search';
import * as rewindRepo from '@main/database/repositories/rewind';
import * as entityRepo from '@main/database/repositories/entities';
import type { ImportJob } from '@main/import/protocol';

/**
 * Scale test.
 *
 * HEARLOGUE claims to handle a million playback events. This drives the real
 * importer over real JSON files of roughly that size and checks two things:
 * that the import finishes in a sane time, and — more importantly — that every
 * screen's query stays fast afterwards, because that is what using the app
 * actually feels like.
 *
 * Skipped by default; it takes minutes and about a gigabyte of scratch space.
 *
 *   HEARLOGUE_PERF=1 npx vitest run tests/integration/performance.test.ts
 */

const ENABLED = process.env.HEARLOGUE_PERF === '1';
const TARGET_EVENTS = 1_000_000;

/** A query behind a screen must answer within this to feel instant. */
const QUERY_BUDGET_MS = 400;

let archive: TempArchive | null = null;
let workDir = '';

afterAll(() => {
  archive?.cleanup();
  archive = null;
  if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
});

function report(label: string, ms: number): void {
  console.log(`  ${label.padEnd(34)} ${String(ms).padStart(7)} ms`);
}

describe.skipIf(!ENABLED)('one million events', () => {
  it(
    'imports, analyses and then answers every screen quickly',
    async () => {
      workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearlogue-perf-'));
      archive = createTempArchive('large');

      // Write the export the way Spotify does: one JSON file per year.
      let started = Date.now();
      const dataset = generateDemoEvents({ seed: 1234, intensity: 7300, now: TEST_NOW });
      const byYear = new Map<number, typeof dataset.events>();
      for (const event of dataset.events) {
        const year = new Date(event.ts).getFullYear();
        const bucket = byYear.get(year);
        if (bucket) bucket.push(event);
        else byYear.set(year, [event]);
      }
      const paths: string[] = [];
      for (const [year, events] of [...byYear.entries()].sort((a, b) => a[0] - b[0])) {
        const file = path.join(workDir, `Streaming_History_Audio_${year}.json`);
        fs.writeFileSync(file, JSON.stringify(toSpotifyExportJson(events)), 'utf8');
        paths.push(file);
      }
      report('write export files', Date.now() - started);

      const bytes = paths.reduce((sum, file) => sum + fs.statSync(file).size, 0);
      console.log(
        `  ${dataset.events.length.toLocaleString()} events across ${paths.length} files, ` +
          `${(bytes / 1024 / 1024).toFixed(0)} MB`,
      );
      expect(dataset.events.length).toBeGreaterThan(TARGET_EVENTS * 0.9);

      archive.db
        .prepare(
          "INSERT INTO imports (id, started_at, source_type, source_name, status) VALUES (1, ?, 'files', 'perf', 'running')",
        )
        .run(TEST_NOW);

      const job: ImportJob = {
        importId: 1,
        databaseFile: archive.file,
        kind: 'files',
        paths,
        sourceType: 'files',
        sourceName: 'perf',
        settings: TEST_SETTINGS,
        now: TEST_NOW,
      };

      started = Date.now();
      const result = await runImport(archive.db, job, {
        onProgress: () => undefined,
        isCancelled: () => false,
      });
      const importMs = Date.now() - started;
      report('full import (parse+write+analyse)', importMs);

      console.log(`  stored ${result.totalAfter.toLocaleString()} events`);
      expect(result.totalAfter).toBeGreaterThan(TARGET_EVENTS * 0.85);

      // The indexes dropped for the bulk load must be back.
      const indexes = archive.db
        .prepare(
          "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'index' AND tbl_name = 'playback_events' AND name LIKE 'idx_events_%'",
        )
        .get() as { n: number };
      expect(indexes.n).toBe(8);

      // ---- the part that matters: is the app fast to use afterwards? ----
      const db = archive.db;
      const budgets: [string, () => unknown][] = [
        ['archive overview', () => archiveRepo.lifetimeStats(db)],
        ['yearly points', () => archiveRepo.yearlyPoints(db)],
        ['rediscovery card', () => archiveRepo.rediscovery(db, TEST_NOW)],
        ['records board', () => archiveRepo.records(db, TEST_NOW)],
        ['listening clock', () => archiveRepo.clockStats(db)],
        ['on this day', () => archiveRepo.onThisDay(db, TEST_NOW)],
        ['top tracks', () => archiveRepo.topTracks(db, 50)],
        [
          'lost favorites page',
          () =>
            discoveryRepo.lostFavorites(db, {
              filter: 'all', offset: 0, limit: 40, diversify: true, now: TEST_NOW,
            }),
        ],
        [
          'graveyard page',
          () => discoveryRepo.graveyard(db, { kind: 'artist', offset: 0, limit: 40, minDaysMissing: null }),
        ],
        ['calendar heatmap', () => calendarRepo.heatmap(db, null, null, 'msPlayed')],
        ['sessions page', () => calendarRepo.listSessions(db, 'longest', 0, 40)],
        [
          'search (text)',
          () => searchRepo.search(db, { query: 'nocturne', limit: 40, offset: 0, filters: {}, now: TEST_NOW }),
        ],
        [
          'search (browse + filter)',
          () =>
            searchRepo.search(db, {
              query: '', limit: 40, offset: 0, filters: { kinds: ['track'], minPlays: 50 }, now: TEST_NOW,
            }),
        ],
        ['rewind year', () => rewindRepo.rewindYear(db, rewindRepo.availableYears(db)[3], TEST_NOW)],
        [
          'day detail',
          () => {
            const date = db
              .prepare('SELECT local_date FROM daily_stats ORDER BY plays DESC LIMIT 1')
              .pluck()
              .get() as string;
            return calendarRepo.dayDetail(db, date);
          },
        ],
        [
          'track detail',
          () => {
            const id = db
              .prepare('SELECT track_id FROM track_stats ORDER BY q_plays DESC LIMIT 1')
              .pluck()
              .get() as number;
            return entityRepo.trackDetail(db, id);
          },
        ],
        [
          'artist detail',
          () => {
            const id = db
              .prepare('SELECT artist_id FROM artist_stats ORDER BY ms_played DESC LIMIT 1')
              .pluck()
              .get() as number;
            return entityRepo.artistDetail(db, id);
          },
        ],
      ];

      for (const [label, run] of budgets) {
        const start = Date.now();
        run();
        const elapsed = Date.now() - start;
        report(label, elapsed);
        expect(elapsed, `${label} took ${elapsed}ms`).toBeLessThan(QUERY_BUDGET_MS);
      }
    },
    { timeout: 30 * 60 * 1000 },
  );
});
