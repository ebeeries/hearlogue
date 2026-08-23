import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '@main/database/db';
import type { Db } from '@main/database/types';
import { Ingestor } from '@main/import/ingest';
import { rebuildAnalytics, type RebuildSettings } from '@main/analytics/rebuild';
import { generateDemoEvents } from '@main/services/demo-generator';
import { seedArchiveDefaults } from '@main/services/seed';
import type { NormalizedEvent } from '@shared/schemas/spotify';
import { DEFAULT_SETTINGS } from '@shared/models/defaults';

/**
 * Test fixtures.
 *
 * Integration tests run against a real SQLite file in a temp directory rather
 * than an in-memory database, so that WAL behaviour, file size checks and the
 * backup/restore paths are exercised the same way they are in production.
 */

export const TEST_NOW = Date.UTC(2026, 7, 23, 12, 0, 0);

export const TEST_SETTINGS: RebuildSettings = {
  qualifyingPlayMs: DEFAULT_SETTINGS.qualifyingPlayMs,
  includePrivateSessions: DEFAULT_SETTINGS.includePrivateSessions,
  sessionGapMinutes: DEFAULT_SETTINGS.sessionGapMinutes,
  dormancyDays: DEFAULT_SETTINGS.dormancyDays,
};

export interface TempArchive {
  db: Db;
  file: string;
  dir: string;
  cleanup: () => void;
}

export function createTempArchive(name = 'archive'): TempArchive {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearlogue-test-'));
  const file = path.join(dir, `${name}.db`);
  const db = openDatabase(file);
  seedArchiveDefaults(db);
  return {
    db,
    file,
    dir,
    cleanup: () => {
      try {
        if (db.open) db.close();
      } catch {
        /* already closed */
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function ingestEvents(db: Db, events: NormalizedEvent[], importId: number | null = null): void {
  const ingestor = new Ingestor(db, importId);
  ingestor.primeCaches();
  for (const event of events) ingestor.add(event);
  ingestor.flush();
}

/** A compact but structurally rich archive: eras, obsessions and abandonment. */
export function demoEvents(intensity = 160): NormalizedEvent[] {
  return generateDemoEvents({ seed: 4242, intensity, now: TEST_NOW }).events;
}

export function buildAnalytics(db: Db, overrides: Partial<RebuildSettings> = {}) {
  return rebuildAnalytics(db, { ...TEST_SETTINGS, ...overrides }, () => {}, TEST_NOW);
}

/** Full pipeline: fresh archive, synthetic history, analytics built. */
export function createAnalyzedArchive(intensity = 160): TempArchive {
  const archive = createTempArchive();
  ingestEvents(archive.db, demoEvents(intensity));
  buildAnalytics(archive.db);
  return archive;
}
