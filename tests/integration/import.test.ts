import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runImport } from '@main/import/run-import';
import { resolveSources } from '@main/import/parsers/sources';
import { generateDemoEvents, toSpotifyExportJson } from '@main/services/demo-generator';
import { createTempArchive, TEST_SETTINGS, TEST_NOW, type TempArchive } from '../fixtures/archive';
import { writeZip } from '../fixtures/zip';
import type { ImportJob } from '@main/import/protocol';
import type { ImportProgress } from '@shared/types/domain';

/**
 * Import pipeline integration tests.
 *
 * These run the importer against real files on disk — loose JSON, a folder, and
 * a genuine ZIP archive — because the ways an import goes wrong are almost all
 * to do with what is actually in the file rather than with the maths afterwards.
 */

let archive: TempArchive | null = null;
let workDir = '';

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearlogue-import-'));
});

afterEach(() => {
  archive?.cleanup();
  archive = null;
  fs.rmSync(workDir, { recursive: true, force: true });
});

function job(paths: string[], overrides: Partial<ImportJob> = {}): ImportJob {
  return {
    importId: 1,
    databaseFile: archive!.file,
    kind: 'files',
    paths,
    sourceType: 'files',
    sourceName: 'test',
    settings: TEST_SETTINGS,
    now: TEST_NOW,
    ...overrides,
  };
}

function hooks(): { onProgress: (p: ImportProgress) => void; isCancelled: () => boolean; seen: ImportProgress[] } {
  const seen: ImportProgress[] = [];
  return {
    seen,
    onProgress: (progress) => seen.push({ ...progress }),
    isCancelled: () => false,
  };
}

function startImportRow(): void {
  archive!.db
    .prepare(
      "INSERT INTO imports (id, started_at, source_type, source_name, status) VALUES (1, ?, 'files', 'test', 'running')",
    )
    .run(TEST_NOW);
}

function writeHistoryFiles(dir: string, intensity = 90): { paths: string[]; eventCount: number } {
  const dataset = generateDemoEvents({ seed: 31, intensity, now: TEST_NOW });
  const byYear = new Map<number, typeof dataset.events>();
  for (const event of dataset.events) {
    const year = new Date(event.ts).getFullYear();
    const bucket = byYear.get(year);
    if (bucket) bucket.push(event);
    else byYear.set(year, [event]);
  }

  const paths: string[] = [];
  for (const [year, events] of [...byYear.entries()].sort((a, b) => a[0] - b[0])) {
    const file = path.join(dir, `Streaming_History_Audio_${year}.json`);
    fs.writeFileSync(file, JSON.stringify(toSpotifyExportJson(events)), 'utf8');
    paths.push(file);
  }
  return { paths, eventCount: dataset.events.length };
}

describe('source resolution', () => {
  it('walks a folder and finds only history files', () => {
    const dir = path.join(workDir, 'MyData');
    fs.mkdirSync(dir, { recursive: true });
    writeHistoryFiles(dir, 20);
    // The rest of a Spotify export, which must be ignored.
    fs.writeFileSync(path.join(dir, 'Userdata.json'), JSON.stringify({ username: 'x' }));
    fs.writeFileSync(path.join(dir, 'Playlist1.json'), JSON.stringify({ playlists: [] }));
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'hello');

    return resolveSources([dir]).then((resolved) => {
      expect(resolved.sources.length).toBeGreaterThan(0);
      for (const source of resolved.sources) {
        expect(source.name).toMatch(/Streaming_History/);
      }
    });
  });

  it('reads entries out of a real ZIP archive', async () => {
    const dataset = generateDemoEvents({ seed: 5, intensity: 20, now: TEST_NOW });
    const zipPath = path.join(workDir, 'my_spotify_data.zip');
    writeZip(zipPath, [
      {
        name: 'MyData/Streaming_History_Audio_2019.json',
        content: JSON.stringify(toSpotifyExportJson(dataset.events.slice(0, 500))),
      },
      { name: 'MyData/Userdata.json', content: JSON.stringify({ username: 'someone' }) },
    ]);

    const resolved = await resolveSources([zipPath]);
    expect(resolved.zipCount).toBe(1);
    expect(resolved.sources).toHaveLength(1);
    const text = await resolved.sources[0].read();
    expect(JSON.parse(text)).toHaveLength(500);
  });

  it('reports a corrupt ZIP rather than throwing something opaque', async () => {
    const zipPath = path.join(workDir, 'broken.zip');
    fs.writeFileSync(zipPath, Buffer.from('this is definitely not a zip file'));
    await expect(resolveSources([zipPath])).rejects.toMatchObject({ code: 'CORRUPT_ARCHIVE' });
  });

  it('reports a missing path clearly', async () => {
    await expect(resolveSources([path.join(workDir, 'nope.json')])).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('running an import', () => {
  it('imports loose JSON files and reports what happened', async () => {
    archive = createTempArchive();
    startImportRow();
    const { paths } = writeHistoryFiles(workDir);

    const h = hooks();
    const report = await runImport(archive.db, job(paths), h);

    expect(report.eventsInserted).toBeGreaterThan(1000);
    expect(report.eventsDuplicate).toBe(0);
    expect(report.existingBefore).toBe(0);
    expect(report.totalAfter).toBe(report.eventsInserted);
    expect(report.yearsFrom).toBeLessThan(report.yearsTo!);
    expect(report.highlights.length).toBeGreaterThan(2);

    // Progress must actually progress, and finish.
    expect(h.seen.length).toBeGreaterThan(3);
    expect(h.seen[h.seen.length - 1].phase).toBe('complete');
    expect(h.seen[h.seen.length - 1].progress).toBe(1);

    const status = archive.db.prepare('SELECT status FROM imports WHERE id = 1').get() as {
      status: string;
    };
    expect(status.status).toBe('complete');
  });

  it('imports from a ZIP exactly as it would from a folder', async () => {
    const dataset = generateDemoEvents({ seed: 77, intensity: 60, now: TEST_NOW });
    const payload = JSON.stringify(toSpotifyExportJson(dataset.events));

    const jsonPath = path.join(workDir, 'Streaming_History_Audio_2019.json');
    fs.writeFileSync(jsonPath, payload, 'utf8');
    const zipPath = path.join(workDir, 'export.zip');
    writeZip(zipPath, [{ name: 'MyData/Streaming_History_Audio_2019.json', content: payload }]);

    archive = createTempArchive('from-json');
    startImportRow();
    const fromJson = await runImport(archive.db, job([jsonPath]), hooks());
    archive.cleanup();

    archive = createTempArchive('from-zip');
    startImportRow();
    const fromZip = await runImport(archive.db, job([zipPath]), hooks());

    expect(fromZip.eventsInserted).toBe(fromJson.eventsInserted);
    expect(fromZip.tracks).toBe(fromJson.tracks);
    expect(fromZip.artists).toBe(fromJson.artists);
  });

  it('is idempotent: re-importing the same export adds nothing', async () => {
    archive = createTempArchive();
    startImportRow();
    const { paths } = writeHistoryFiles(workDir);

    const first = await runImport(archive.db, job(paths), hooks());

    archive.db
      .prepare(
        "INSERT INTO imports (id, started_at, source_type, source_name, status) VALUES (2, ?, 'files', 'test', 'running')",
      )
      .run(TEST_NOW);
    const second = await runImport(archive.db, job(paths, { importId: 2 }), hooks());

    expect(second.eventsInserted).toBe(0);
    expect(second.totalAfter).toBe(first.totalAfter);
    // The files were recognised by hash, so they were not even parsed again.
    expect(second.filesSkipped).toBeGreaterThan(0);
  });

  it('merges only genuinely new plays from a later export', async () => {
    archive = createTempArchive();
    const dataset = generateDemoEvents({ seed: 12, intensity: 90, now: TEST_NOW });
    const half = Math.floor(dataset.events.length / 2);

    const firstFile = path.join(workDir, 'Streaming_History_Audio_part1.json');
    fs.writeFileSync(firstFile, JSON.stringify(toSpotifyExportJson(dataset.events.slice(0, half))));

    // A later export always contains everything, including what you already had.
    const fullFile = path.join(workDir, 'Streaming_History_Audio_full.json');
    fs.writeFileSync(fullFile, JSON.stringify(toSpotifyExportJson(dataset.events)));

    startImportRow();
    const first = await runImport(archive.db, job([firstFile]), hooks());

    archive.db
      .prepare(
        "INSERT INTO imports (id, started_at, source_type, source_name, status) VALUES (2, ?, 'files', 'test', 'running')",
      )
      .run(TEST_NOW);
    const second = await runImport(archive.db, job([fullFile], { importId: 2 }), hooks());

    expect(second.eventsInserted).toBeGreaterThan(0);
    expect(second.eventsDuplicate).toBeGreaterThan(0);
    expect(second.eventsInserted + second.eventsDuplicate).toBe(second.eventsFound);
    expect(second.totalAfter).toBeGreaterThan(first.totalAfter);
    expect(second.totalAfter).toBeLessThanOrEqual(dataset.events.length);
  });

  it('skips podcast rows and counts them as invalid rather than failing', async () => {
    archive = createTempArchive();
    startImportRow();

    const dataset = generateDemoEvents({ seed: 3, intensity: 20, now: TEST_NOW });
    const music = toSpotifyExportJson(dataset.events.slice(0, 300));
    const podcasts = Array.from({ length: 50 }, (_, i) => ({
      ts: new Date(TEST_NOW - i * 86_400_000).toISOString(),
      ms_played: 1_800_000,
      episode_name: `Episode ${i}`,
      episode_show_name: 'A Show',
      spotify_episode_uri: `spotify:episode:${i}`,
    }));

    const file = path.join(workDir, 'Streaming_History_Audio_mixed.json');
    fs.writeFileSync(file, JSON.stringify([...music, ...podcasts]));

    const report = await runImport(archive.db, job([file]), hooks());
    expect(report.eventsInserted).toBe(300);
    expect(report.eventsInvalid).toBe(50);
  });

  it('refuses a selection that contains no listening history', async () => {
    archive = createTempArchive();
    startImportRow();
    const file = path.join(workDir, 'Streaming_History_Audio_empty.json');
    fs.writeFileSync(file, JSON.stringify([{ playlistName: 'Chill' }]));

    await expect(runImport(archive.db, job([file]), hooks())).rejects.toMatchObject({
      code: 'IMPORT_NO_DATA',
    });
  });

  it('survives a file that is not valid JSON', async () => {
    archive = createTempArchive();
    startImportRow();

    const good = path.join(workDir, 'Streaming_History_Audio_good.json');
    const dataset = generateDemoEvents({ seed: 9, intensity: 20, now: TEST_NOW });
    fs.writeFileSync(good, JSON.stringify(toSpotifyExportJson(dataset.events.slice(0, 200))));

    const broken = path.join(workDir, 'Streaming_History_Audio_broken.json');
    fs.writeFileSync(broken, '{ "not": "closed"');

    const report = await runImport(archive.db, job([good, broken]), hooks());
    expect(report.eventsInserted).toBe(200);
    expect(report.filesSkipped).toBe(1);
  });

  it('stops when cancelled and leaves the import marked, not half-reported', async () => {
    archive = createTempArchive();
    startImportRow();
    const { paths } = writeHistoryFiles(workDir, 120);

    let calls = 0;
    await expect(
      runImport(archive.db, job(paths), {
        onProgress: () => undefined,
        // Cancel once the run is genuinely under way.
        isCancelled: () => ++calls > 3,
      }),
    ).rejects.toMatchObject({ code: 'IMPORT_CANCELLED' });
  });

  it('honours the private-session preference at import time', async () => {
    const dataset = generateDemoEvents({ seed: 55, intensity: 80, now: TEST_NOW });
    const withPrivate = dataset.events.filter((event) => event.incognito).length;
    expect(withPrivate).toBeGreaterThan(0);

    const file = path.join(workDir, 'Streaming_History_Audio_all.json');
    fs.writeFileSync(file, JSON.stringify(toSpotifyExportJson(dataset.events)));

    archive = createTempArchive('with-private');
    startImportRow();
    const included = await runImport(archive.db, job([file]), hooks());
    archive.cleanup();

    archive = createTempArchive('without-private');
    startImportRow();
    const excluded = await runImport(
      archive.db,
      job([file], { settings: { ...TEST_SETTINGS, includePrivateSessions: false } }),
      hooks(),
    );

    expect(excluded.eventsInserted).toBe(included.eventsInserted - withPrivate);
  });

  it('never writes an IP address or user agent, even when the export has them', async () => {
    archive = createTempArchive();
    startImportRow();

    const dataset = generateDemoEvents({ seed: 21, intensity: 20, now: TEST_NOW });
    const records = toSpotifyExportJson(dataset.events.slice(0, 200)).map((record) => ({
      ...(record as Record<string, unknown>),
      ip_addr_decrypted: '203.0.113.42',
      user_agent_decrypted: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      username: 'a-real-username',
    }));

    const file = path.join(workDir, 'Streaming_History_Audio_privacy.json');
    fs.writeFileSync(file, JSON.stringify(records));
    await runImport(archive.db, job([file]), hooks());

    // Search the entire database file for the values that must never be stored.
    const raw = fs.readFileSync(archive.file).toString('latin1');
    expect(raw).not.toContain('203.0.113.42');
    expect(raw).not.toContain('a-real-username');
    expect(raw).not.toContain('Mozilla/5.0');

    // The platform is stored only as a coarse family.
    const platforms = archive.db
      .prepare('SELECT DISTINCT platform FROM playback_events')
      .pluck()
      .all() as string[];
    for (const platform of platforms) {
      expect(['windows', 'android', 'ios', 'web', 'macos', 'linux', 'cast', 'partner', 'other']).toContain(
        platform,
      );
    }
  });
});
