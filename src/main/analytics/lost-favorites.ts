import type { Db } from '../database/types';
import type { AggregateOptions } from './aggregates';
import {
  buildCsr,
  ensureBuffer,
  entityCount,
  fillTimestamps,
  makeScratch,
  FLAG_QUALIFYING,
  type EventColumns,
} from './sequences';
import { lostFavoriteScore, peakWindow, longestGap } from './scoring';
import { MS_PER_DAY } from '@shared/utils/time';

/**
 * Fills in the per-track figures that require walking a track's play history in
 * order, then scores every track as a candidate Lost Favorite.
 *
 * The two are done together because they share the same expensive traversal: the
 * peak-window count that feeds the score is the same number the track detail
 * page shows as "densest stretch".
 */

const PEAK_WINDOW_DAYS = 90;

export interface TrackSequenceResult {
  scored: number;
  qualified: number;
}

export function buildTrackSequences(
  db: Db,
  columns: EventColumns,
  options: AggregateOptions & { dormancyDays: number },
): TrackSequenceResult {
  const csr = buildCsr(
    columns.trackId,
    columns.n,
    columns.maxTrackId,
    (i) => (columns.flags[i] & FLAG_QUALIFYING) !== 0,
  );

  const rows = db
    .prepare(
      `SELECT track_id, plays, q_plays, skips, ms_played, first_ts, last_ts,
              distinct_days, active_months, recent_plays
       FROM track_stats`,
    )
    .all() as {
    track_id: number;
    plays: number;
    q_plays: number;
    skips: number;
    ms_played: number;
    first_ts: number | null;
    last_ts: number | null;
    distinct_days: number;
    active_months: number;
    recent_plays: number;
  }[];

  const update = db.prepare(`
    UPDATE track_stats
    SET peak_window_plays = @peak,
        longest_gap_days = @gapDays,
        longest_gap_from = @gapFrom,
        longest_gap_to = @gapTo,
        lost_score = @score,
        lost_dims = @dims
    WHERE track_id = @trackId
  `);

  let buffer = makeScratch(2048);
  const windowMs = PEAK_WINDOW_DAYS * MS_PER_DAY;
  let qualified = 0;

  const run = db.transaction(() => {
    for (const row of rows) {
      const count = entityCount(csr, row.track_id);
      let peak = 0;
      let gapDays = 0;
      let gapFrom: number | null = null;
      let gapTo: number | null = null;

      if (count > 0) {
        buffer = ensureBuffer(buffer, count);
        fillTimestamps(csr, columns, row.track_id, buffer);
        peak = peakWindow(buffer, 0, count, windowMs).count;
        const gap = longestGap(buffer, 0, count);
        gapDays = gap.days;
        gapFrom = gap.from;
        gapTo = gap.to;
      }

      const result = lostFavoriteScore({
        qualifyingPlays: row.q_plays,
        plays: row.plays,
        msPlayed: row.ms_played,
        skips: row.skips,
        firstTs: row.first_ts,
        lastTs: row.last_ts,
        distinctDays: row.distinct_days,
        activeMonths: row.active_months,
        peakWindowPlays: peak,
        recentPlays: row.recent_plays,
        now: options.now,
        dormancyDays: options.dormancyDays,
      });

      if (result.score > 0) qualified += 1;

      update.run({
        trackId: row.track_id,
        peak,
        gapDays,
        gapFrom,
        gapTo,
        score: result.score,
        dims: result.score > 0 ? JSON.stringify(result.dimensions) : null,
      });
    }
  });

  run();

  return { scored: rows.length, qualified };
}

/**
 * Same sequential treatment for artists — the detail page needs "you disappeared
 * for N days before coming back", which only a walk of the play history answers.
 */
export function buildArtistSequences(db: Db, columns: EventColumns): void {
  const csr = buildCsr(
    columns.artistId,
    columns.n,
    columns.maxArtistId,
    (i) => (columns.flags[i] & FLAG_QUALIFYING) !== 0,
  );

  const ids = db.prepare('SELECT artist_id FROM artist_stats').all() as { artist_id: number }[];
  const update = db.prepare(`
    UPDATE artist_stats
    SET longest_gap_days = @gapDays, longest_gap_from = @gapFrom, longest_gap_to = @gapTo
    WHERE artist_id = @artistId
  `);

  let buffer = makeScratch(4096);

  const run = db.transaction(() => {
    for (const { artist_id: artistId } of ids) {
      const count = entityCount(csr, artistId);
      if (count < 2) {
        update.run({ artistId, gapDays: 0, gapFrom: null, gapTo: null });
        continue;
      }
      buffer = ensureBuffer(buffer, count);
      fillTimestamps(csr, columns, artistId, buffer);
      const gap = longestGap(buffer, 0, count);
      update.run({ artistId, gapDays: gap.days, gapFrom: gap.from, gapTo: gap.to });
    }
  });

  run();
}
