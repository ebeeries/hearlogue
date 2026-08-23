import type { Db } from '../database/types';
import type { AggregateOptions } from './aggregates';
import { qualifyingExpr, eventFilter } from './aggregates';
import { graveyardScore } from './scoring';
import {
  GRAVEYARD_MIN_PLAYS,
  GRAVEYARD_MIN_DAYS_MISSING,
  GRAVEYARD_MAX_RECENT_PLAYS,
} from '@shared/constants/analytics';
import { MS_PER_DAY } from '@shared/utils/time';
import type { EntityKind } from '@shared/types/common';

/**
 * The Graveyard.
 *
 * Not "things you haven't played lately" — things that genuinely mattered and
 * then stopped entirely. The gates are deliberately strict: an entity has to
 * clear a real play-count floor, have been silent for at least two years, and
 * show no meaningful return, before it is called abandoned.
 *
 * `rank_at_peak` is what separates a former favourite from a former curiosity:
 * it records where the entity stood among everything else listened to during its
 * best year.
 */

const TABLES: Record<EntityKind, { table: string; idColumn: string; eventColumn: string }> = {
  track: { table: 'track_stats', idColumn: 'track_id', eventColumn: 'track_id' },
  artist: { table: 'artist_stats', idColumn: 'artist_id', eventColumn: 'artist_id' },
  album: { table: 'album_stats', idColumn: 'album_id', eventColumn: 'album_id' },
};

interface Candidate {
  id: number;
  peak_year: number | null;
  plays: number;
  ms_played: number;
  last_ts: number;
  rank_at_peak: number | null;
}

export function buildGraveyard(db: Db, options: AggregateOptions): number {
  const q = qualifyingExpr(options.qualifyingPlayMs);
  const filter = eventFilter(options.includePrivateSessions);
  const cutoff = options.now - GRAVEYARD_MIN_DAYS_MISSING * MS_PER_DAY;

  const insert = db.prepare(`
    INSERT OR REPLACE INTO graveyard (
      kind, entity_id, peak_year, historical_plays, ms_played, last_ts, days_missing,
      rank_at_peak, score
    ) VALUES (@kind, @entityId, @peakYear, @plays, @msPlayed, @lastTs, @daysMissing, @rank, @score)
  `);

  let total = 0;

  const run = db.transaction(() => {
    db.exec('DELETE FROM graveyard;');

    for (const kind of ['track', 'artist', 'album'] as EntityKind[]) {
      const { table, idColumn, eventColumn } = TABLES[kind];
      const minPlays = GRAVEYARD_MIN_PLAYS[kind];

      const candidates = db
        .prepare(
          `
          WITH per_year AS (
            SELECT ${eventColumn} AS eid, year,
                   SUM(CASE WHEN ${q} THEN 1 ELSE 0 END) AS n
            FROM playback_events
            WHERE ${filter} AND ${eventColumn} IS NOT NULL
            GROUP BY ${eventColumn}, year
          ),
          ranked AS (
            SELECT eid, year, n,
                   RANK() OVER (PARTITION BY year ORDER BY n DESC) AS rnk
            FROM per_year
          )
          SELECT s.${idColumn} AS id,
                 s.peak_year,
                 s.q_plays AS plays,
                 s.ms_played,
                 s.last_ts,
                 r.rnk AS rank_at_peak
          FROM ${table} s
          LEFT JOIN ranked r ON r.eid = s.${idColumn} AND r.year = s.peak_year
          WHERE s.q_plays >= @minPlays
            AND s.last_ts IS NOT NULL
            AND s.last_ts <= @cutoff
            AND s.recent_plays <= @maxRecent
        `,
        )
        .all({ minPlays, cutoff, maxRecent: GRAVEYARD_MAX_RECENT_PLAYS }) as Candidate[];

      for (const candidate of candidates) {
        const daysMissing = Math.floor((options.now - candidate.last_ts) / MS_PER_DAY);
        const score = graveyardScore({
          kind,
          historicalPlays: candidate.plays,
          daysMissing,
          rankAtPeak: candidate.rank_at_peak,
        });
        insert.run({
          kind,
          entityId: candidate.id,
          peakYear: candidate.peak_year,
          plays: candidate.plays,
          msPlayed: candidate.ms_played,
          lastTs: candidate.last_ts,
          daysMissing,
          rank: candidate.rank_at_peak,
          score,
        });
        total += 1;
      }
    }
  });

  run();
  return total;
}
