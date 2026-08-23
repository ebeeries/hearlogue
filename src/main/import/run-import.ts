import type { Db } from '../database/types';
import { Ingestor } from './ingest';
import { resolveSources, sha256OfString, type ResolvedSource } from './parsers/sources';
import { normalizeRecord, looksLikeStreamingHistory, tallyRejection, type RejectionTally } from './parsers/normalize';
import { rebuildAnalytics } from '../analytics/rebuild';
import { knownFileHashes } from '../database/repositories/settings';
import { dropEventIndexes, ensureEventIndexes } from '../database/indexes';
import { lostFavoriteCount } from '../database/repositories/discovery';
import { generateDemoEvents, toSpotifyExportJson } from '../services/demo-generator';
import { HearlogueError } from '../utils/errors';
import { IMPORT_PROGRESS_INTERVAL_MS } from '@shared/constants/analytics';
import { localParts } from '@shared/utils/time';
import type { ImportJob } from './protocol';
import { emptyProgress } from './protocol';
import type { ImportProgress, ImportReport, ImportHighlight } from '@shared/types/domain';

/**
 * The import itself, written so it can run in the worker *and* be driven
 * directly by the integration tests.
 *
 * Progress is coarse on purpose: three quarters of the bar is file ingestion and
 * the last quarter is the analytics rebuild, because that is roughly how the
 * time divides on a real archive. Reporting is throttled so a fast import does
 * not spend its budget serialising progress objects.
 */

export interface RunImportHooks {
  onProgress: (progress: ImportProgress) => void;
  isCancelled: () => boolean;
}

const INGEST_SHARE = 0.75;

export async function runImport(
  db: Db,
  job: ImportJob,
  hooks: RunImportHooks,
): Promise<ImportReport> {
  const started = Date.now();
  const progress = emptyProgress(job.importId);
  let lastReport = 0;

  const report = (force = false): void => {
    const now = Date.now();
    if (!force && now - lastReport < IMPORT_PROGRESS_INTERVAL_MS) return;
    lastReport = now;
    hooks.onProgress({ ...progress });
  };

  const checkCancelled = (): void => {
    if (hooks.isCancelled()) throw new HearlogueError('IMPORT_CANCELLED', 'error.importCancelled');
  };

  progress.phase = 'scanning';
  progress.messageKey = 'import.message.reading';
  report(true);

  const resolved =
    job.kind === 'demo'
      ? { sources: demoSources(job) }
      : await resolveSources(job.paths);

  if (resolved.sources.length === 0) {
    throw new HearlogueError('IMPORT_NO_DATA', 'error.noHistoryFiles');
  }

  const existingBefore = (
    db.prepare('SELECT COUNT(*) AS n FROM playback_events').get() as { n: number }
  ).n;

  const seenHashes = knownFileHashes(db);
  const recordFile = db.prepare(
    `INSERT INTO import_files (import_id, file_name, file_hash, size_bytes, events_found, events_inserted, events_duplicate, skipped)
     VALUES (@importId, @fileName, @fileHash, @sizeBytes, @eventsFound, @eventsInserted, @eventsDuplicate, @skipped)`,
  );

  progress.filesTotal = resolved.sources.length;
  progress.phase = 'parsing';
  report(true);

  const ingestor = new Ingestor(db, job.importId);
  ingestor.primeCaches();

  const rejections: RejectionTally = {};
  let filesSkipped = 0;
  const hashesThisRun = new Set<string>();

  /**
   * Ingest every resolved source.
   *
   * On a first import into an empty archive the secondary indexes are dropped
   * first and rebuilt afterwards: maintaining seven B-trees per row costs about
   * a fifth of the time on a very large export, while rebuilding them over the
   * finished table takes seconds.
   *
   * Only for the empty case — on an existing archive those indexes serve the
   * incremental lookups, and rebuilding them over old rows would cost more than
   * it saves. If the app dies mid-import, opening the database restores them on
   * the next launch, so the archive is never left permanently slow.
   */
  const bulkLoad = existingBefore === 0;

  const ingestAll = async (): Promise<void> => {
    for (const source of resolved.sources) {
      checkCancelled();
      progress.currentFile = source.name;
      report();

      const outcome = await ingestSource(source, {
        db,
        ingestor,
        job,
        progress,
        rejections,
        seenHashes,
        hashesThisRun,
        report,
        checkCancelled,
      });

      if (outcome.skipped) filesSkipped += 1;

      recordFile.run({
        importId: job.importId,
        fileName: source.name,
        fileHash: outcome.hash,
        sizeBytes: source.sizeBytes,
        eventsFound: outcome.found,
        eventsInserted: outcome.inserted,
        eventsDuplicate: outcome.duplicate,
        skipped: outcome.skipped ? 1 : 0,
      });

      progress.filesDone += 1;
      progress.progress = (progress.filesDone / progress.filesTotal) * INGEST_SHARE;
      report(true);
    }

    checkCancelled();

    progress.phase = 'writing';
    progress.messageKey = 'import.message.writing';
    report(true);
    ingestor.flush();
  };

  if (bulkLoad) dropEventIndexes(db);
  try {
    await ingestAll();
  } finally {
    if (bulkLoad) {
      progress.messageKey = 'import.message.indexing';
      report(true);
      ensureEventIndexes(db);
    }
  }


  if (ingestor.counters.inserted === 0 && existingBefore === 0) {
    throw new HearlogueError('IMPORT_NO_DATA', 'error.noPlaysFound');
  }

  progress.phase = 'analytics';
  progress.messageKey = 'import.message.analytics';
  report(true);

  const analytics = rebuildAnalytics(
    db,
    job.settings,
    (step, index, total) => {
      progress.analyticsStep = step;
      progress.progress = INGEST_SHARE + ((index + 1) / total) * (1 - INGEST_SHARE);
      report();
    },
    job.now,
  );

  progress.phase = 'finalizing';
  progress.progress = 0.99;
  report(true);

  const totalAfter = (
    db.prepare('SELECT COUNT(*) AS n FROM playback_events').get() as { n: number }
  ).n;

  const bounds = db
    .prepare('SELECT MIN(year) AS lo, MAX(year) AS hi FROM playback_events')
    .get() as { lo: number | null; hi: number | null };

  db.prepare(
    `UPDATE imports
     SET finished_at = ?, file_count = ?, events_found = ?, events_inserted = ?,
         events_duplicate = ?, events_invalid = ?, status = 'complete'
     WHERE id = ?`,
  ).run(
    Date.now(),
    resolved.sources.length,
    ingestor.counters.found,
    ingestor.counters.inserted,
    ingestor.counters.duplicate,
    ingestor.counters.invalid,
    job.importId,
  );

  const result: ImportReport = {
    importId: job.importId,
    filesProcessed: resolved.sources.length - filesSkipped,
    filesSkipped,
    eventsFound: ingestor.counters.found,
    eventsInserted: ingestor.counters.inserted,
    eventsDuplicate: ingestor.counters.duplicate,
    eventsInvalid: ingestor.counters.invalid,
    existingBefore,
    totalAfter,
    artists: (db.prepare('SELECT COUNT(*) AS n FROM artists').get() as { n: number }).n,
    tracks: (db.prepare('SELECT COUNT(*) AS n FROM tracks').get() as { n: number }).n,
    albums: (db.prepare('SELECT COUNT(*) AS n FROM albums').get() as { n: number }).n,
    yearsFrom: bounds.lo,
    yearsTo: bounds.hi,
    durationMs: Date.now() - started,
    highlights: buildHighlights(db, bounds, analytics.eras),
  };

  progress.phase = 'complete';
  progress.progress = 1;
  progress.eventsInserted = ingestor.counters.inserted;
  report(true);

  return result;
}

/**
 * The Demo Archive as a set of in-memory "files".
 *
 * Splitting it per year keeps the progress bar honest and — more importantly —
 * means the demo travels the same parse → normalise → fingerprint → ingest path
 * as a real export, so a bug in that path cannot hide behind the demo.
 */
function demoSources(job: ImportJob): ResolvedSource[] {
  const dataset = generateDemoEvents({ intensity: job.demoIntensity ?? 520, now: job.now });
  const byYear = new Map<number, typeof dataset.events>();
  for (const event of dataset.events) {
    const year = localParts(event.ts).year;
    const bucket = byYear.get(year);
    if (bucket) bucket.push(event);
    else byYear.set(year, [event]);
  }

  return [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, events]) => {
      const name = `Demo_Streaming_History_${year}.json`;
      return {
        name,
        origin: `demo://${name}`,
        sizeBytes: events.length * 320,
        read: async () => JSON.stringify(toSpotifyExportJson(events)),
      };
    });
}

interface IngestContext {
  db: Db;
  ingestor: Ingestor;
  job: ImportJob;
  progress: ImportProgress;
  rejections: RejectionTally;
  seenHashes: Set<string>;
  hashesThisRun: Set<string>;
  report: (force?: boolean) => void;
  checkCancelled: () => void;
}

interface SourceOutcome {
  hash: string;
  found: number;
  inserted: number;
  duplicate: number;
  skipped: boolean;
}

async function ingestSource(source: ResolvedSource, ctx: IngestContext): Promise<SourceOutcome> {
  const before = { ...ctx.ingestor.counters };

  let text: string;
  try {
    text = await source.read();
  } catch {
    ctx.progress.eventsInvalid += 1;
    return { hash: '', found: 0, inserted: 0, duplicate: 0, skipped: true };
  }

  const hash = sha256OfString(text);

  // A file already absorbed by a completed import cannot contain anything new —
  // the fingerprint index would reject every row anyway, so skip the parse.
  if (ctx.seenHashes.has(hash) || ctx.hashesThisRun.has(hash)) {
    return { hash, found: 0, inserted: 0, duplicate: 0, skipped: true };
  }
  ctx.hashesThisRun.add(hash);

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return { hash, found: 0, inserted: 0, duplicate: 0, skipped: true };
  }

  if (!looksLikeStreamingHistory(payload)) {
    return { hash, found: 0, inserted: 0, duplicate: 0, skipped: true };
  }

  const records = payload as unknown[];
  for (let i = 0; i < records.length; i++) {
    if ((i & 8191) === 0) ctx.checkCancelled();

    ctx.ingestor.counters.found += 1;
    ctx.progress.eventsFound += 1;

    const outcome = normalizeRecord(records[i], ctx.job.settings.includePrivateSessions);
    if (!outcome.event) {
      if (outcome.reason) tallyRejection(ctx.rejections, outcome.reason);
      ctx.ingestor.counters.invalid += 1;
      ctx.progress.eventsInvalid += 1;
      continue;
    }

    ctx.ingestor.add(outcome.event);

    if ((i & 2047) === 0) {
      syncProgress(ctx);
      ctx.report();
    }
  }

  ctx.ingestor.flush();
  syncProgress(ctx);

  return {
    hash,
    found: ctx.ingestor.counters.found - before.found,
    inserted: ctx.ingestor.counters.inserted - before.inserted,
    duplicate: ctx.ingestor.counters.duplicate - before.duplicate,
    skipped: false,
  };
}

function syncProgress(ctx: IngestContext): void {
  const c = ctx.ingestor.counters;
  ctx.progress.eventsInserted = c.inserted;
  ctx.progress.eventsDuplicate = c.duplicate;
  ctx.progress.artists = c.artists;
  ctx.progress.tracks = c.tracks;
  ctx.progress.albums = c.albums;
  if (c.minTs !== null) ctx.progress.yearsFrom = localParts(c.minTs).year;
  if (c.maxTs !== null) ctx.progress.yearsTo = localParts(c.maxTs).year;
}

/**
 * The payoff shown on the final import step.
 *
 * These are chosen to be immediately meaningful rather than merely large: how
 * much of a life the archive covers, which year mattered most, and how many
 * songs are waiting to be rediscovered.
 */
function buildHighlights(
  db: Db,
  bounds: { lo: number | null; hi: number | null },
  eraCount: number,
): ImportHighlight[] {
  const highlights: ImportHighlight[] = [];

  if (bounds.lo !== null && bounds.hi !== null) {
    highlights.push({
      key: 'import.highlight.years',
      values: { years: bounds.hi - bounds.lo + 1, from: bounds.lo, to: bounds.hi },
    });
  }

  const biggestYear = db
    .prepare('SELECT year, plays, ms_played AS ms FROM yearly_stats ORDER BY ms_played DESC LIMIT 1')
    .get() as { year: number; plays: number; ms: number } | undefined;
  if (biggestYear) {
    highlights.push({
      key: 'import.highlight.biggestYear',
      values: {
        year: biggestYear.year,
        plays: biggestYear.plays,
        hours: Math.round(biggestYear.ms / 3_600_000),
      },
    });
  }

  const lost = lostFavoriteCount(db);
  if (lost > 0) {
    const oldest = db
      .prepare(
        'SELECT last_ts FROM track_stats WHERE lost_score > 0 ORDER BY last_ts ASC LIMIT 1',
      )
      .get() as { last_ts: number } | undefined;
    const years = oldest ? Math.floor((Date.now() - oldest.last_ts) / (365 * 86_400_000)) : 0;
    highlights.push({
      key: 'import.highlight.lostFavorites',
      values: { count: lost, years: Math.max(1, years) },
    });
  }

  const totalMs = (
    db.prepare('SELECT COALESCE(SUM(ms_played), 0) AS ms FROM track_stats').get() as { ms: number }
  ).ms;
  highlights.push({
    key: 'import.highlight.totalTime',
    values: { hours: Math.round(totalMs / 3_600_000), days: Math.round(totalMs / 86_400_000) },
  });

  if (eraCount > 0) {
    highlights.push({ key: 'import.highlight.eras', values: { count: eraCount } });
  }

  return highlights;
}
