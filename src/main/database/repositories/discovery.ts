import type { Db } from '../types';
import { TRACK_SUMMARY } from './projections';
import type {
  LostFavorite,
  LostFavoriteFilter,
  LostFavoriteDimensions,
  GraveyardItem,
  TrackSummary,
} from '@shared/types/domain';
import type { EntityKind, Paginated } from '@shared/types/common';
import {
  LOST_FAVORITE_MIN_SCORE,
  LOST_FAVORITE_ARTIST_DIVERSITY_CAP,
} from '@shared/constants/analytics';
import { MS_PER_DAY } from '@shared/utils/time';

/**
 * Lost Favorites and the Graveyard — the two rediscovery surfaces.
 */

interface LostRow extends TrackSummary {
  score: number;
  dims: string | null;
  peakYear: number | null;
  peakWindowPlays: number;
  activeMonths: number;
}

const EMPTY_DIMENSIONS: LostFavoriteDimensions = {
  historicalAffinity: 0,
  dormancy: 0,
  peakIntensity: 0,
  engagementQuality: 0,
  historicalConsistency: 0,
};

function parseDimensions(raw: string | null): LostFavoriteDimensions {
  if (!raw) return EMPTY_DIMENSIONS;
  try {
    return { ...EMPTY_DIMENSIONS, ...(JSON.parse(raw) as Partial<LostFavoriteDimensions>) };
  } catch {
    return EMPTY_DIMENSIONS;
  }
}

/** Extra WHERE clauses per filter chip. */
function filterClause(filter: LostFavoriteFilter): string {
  switch (filter) {
    case 'deepCuts':
      // Songs that mattered to you but were never the artist's headline track.
      return `AND ts.q_plays < (
                SELECT MAX(inner_ts.q_plays) FROM track_stats inner_ts
                JOIN tracks inner_t ON inner_t.id = inner_ts.track_id
                WHERE inner_t.artist_id = t.artist_id
              ) * 0.6`;
    case 'oldFavorites':
      return 'AND ts.q_plays >= 40';
    case 'forgottenArtists':
      // The whole artist went quiet, not just this song.
      return `AND EXISTS (
                SELECT 1 FROM graveyard g WHERE g.kind = 'artist' AND g.entity_id = t.artist_id
              )`;
    case 'forgottenAlbums':
      return `AND t.album_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM graveyard g WHERE g.kind = 'album' AND g.entity_id = t.album_id
              )`;
    case 'years3':
      return 'AND ts.last_ts <= @years3';
    case 'years5':
      return 'AND ts.last_ts <= @years5';
    case 'years10':
      return 'AND ts.last_ts <= @years10';
    default:
      return '';
  }
}

/**
 * Interleaves results so a single artist cannot dominate the page.
 *
 * Without this a listener who spent 2018 inside one record sees that record and
 * nothing else — which is exactly the opposite of rediscovery. Entries beyond
 * the per-artist cap are held back and appended after everything else, so
 * nothing is silently dropped.
 */
export function diversifyByArtist<T extends { artistId: number }>(
  items: T[],
  cap = LOST_FAVORITE_ARTIST_DIVERSITY_CAP,
): T[] {
  const counts = new Map<number, number>();
  const primary: T[] = [];
  const overflow: T[] = [];
  for (const item of items) {
    const seen = counts.get(item.artistId) ?? 0;
    if (seen < cap) {
      primary.push(item);
      counts.set(item.artistId, seen + 1);
    } else {
      overflow.push(item);
    }
  }
  return [...primary, ...overflow];
}

export interface LostFavoritesQuery {
  filter: LostFavoriteFilter;
  offset: number;
  limit: number;
  diversify: boolean;
  search?: string;
  now: number;
}

export function lostFavorites(db: Db, query: LostFavoritesQuery): Paginated<LostFavorite> {
  const params: Record<string, unknown> = {
    minScore: LOST_FAVORITE_MIN_SCORE,
    limit: query.limit,
    offset: query.offset,
    years3: query.now - 3 * 365 * MS_PER_DAY,
    years5: query.now - 5 * 365 * MS_PER_DAY,
    years10: query.now - 10 * 365 * MS_PER_DAY,
  };

  let searchClause = '';
  if (query.search && query.search.trim().length > 0) {
    searchClause = 'AND (t.name LIKE @search COLLATE NOCASE OR ar.name LIKE @search COLLATE NOCASE)';
    params.search = `%${query.search.trim()}%`;
  }

  const clause = `WHERE ts.lost_score >= @minScore ${filterClause(query.filter)} ${searchClause}`;

  const total = (
    db
      .prepare(
        `SELECT COUNT(*) AS n
         FROM tracks t
         JOIN artists ar ON ar.id = t.artist_id
         JOIN track_stats ts ON ts.track_id = t.id
         ${clause}`,
      )
      .get(params) as { n: number }
  ).n;

  // Diversification needs a wider slice than the page it produces.
  const fetchLimit = query.diversify ? Math.min(query.limit * 4, 400) : query.limit;
  const rows = db
    .prepare(
      `SELECT sub.*, ts2.lost_score AS score, ts2.lost_dims AS dims,
              ts2.peak_year AS peakYear, ts2.peak_window_plays AS peakWindowPlays,
              ts2.active_months AS activeMonths
       FROM (
         ${TRACK_SUMMARY} ${clause}
         ORDER BY ts.lost_score DESC, ts.q_plays DESC
         LIMIT @fetchLimit OFFSET @offset
       ) sub
       JOIN track_stats ts2 ON ts2.track_id = sub.id
       ORDER BY score DESC, sub.qualifyingPlays DESC`,
    )
    .all({ ...params, fetchLimit }) as LostRow[];

  const ordered = query.diversify ? diversifyByArtist(rows) : rows;

  const items: LostFavorite[] = ordered.slice(0, query.limit).map((row) => {
    const { dims, ...rest } = row;
    return {
      ...rest,
      dimensions: parseDimensions(dims),
      daysSinceLastPlay:
        row.lastTs === null ? 0 : Math.floor((query.now - row.lastTs) / MS_PER_DAY),
    };
  });

  return { items, total, offset: query.offset, limit: query.limit };
}

export interface GraveyardQuery {
  kind: EntityKind;
  offset: number;
  limit: number;
  minDaysMissing: number | null;
}

export function graveyard(db: Db, query: GraveyardQuery): Paginated<GraveyardItem> {
  const params: Record<string, unknown> = {
    kind: query.kind,
    limit: query.limit,
    offset: query.offset,
    minDays: query.minDaysMissing ?? 0,
  };

  const total = (
    db
      .prepare('SELECT COUNT(*) AS n FROM graveyard WHERE kind = @kind AND days_missing >= @minDays')
      .get(params) as { n: number }
  ).n;

  const items = db
    .prepare(
      `SELECT
        g.kind                                  AS kind,
        g.entity_id                             AS entityId,
        CASE g.kind
          WHEN 'track'  THEN (SELECT t.name  FROM tracks  t  WHERE t.id  = g.entity_id)
          WHEN 'artist' THEN (SELECT a.name  FROM artists a  WHERE a.id  = g.entity_id)
          WHEN 'album'  THEN (SELECT al.name FROM albums  al WHERE al.id = g.entity_id)
        END                                     AS name,
        CASE g.kind
          WHEN 'track'  THEN (SELECT ar.name FROM tracks t JOIN artists ar ON ar.id = t.artist_id WHERE t.id = g.entity_id)
          WHEN 'album'  THEN (SELECT ar.name FROM albums al JOIN artists ar ON ar.id = al.artist_id WHERE al.id = g.entity_id)
          ELSE NULL
        END                                     AS secondary,
        /*
         * Artists and albums have no Spotify identifier in the export, so
         * "Revive" falls back to their most-played track — a real link into
         * their catalogue rather than a dead button.
         */
        CASE g.kind
          WHEN 'track'  THEN (SELECT t.uri FROM tracks t WHERE t.id = g.entity_id)
          WHEN 'artist' THEN (
            SELECT t.uri FROM tracks t
            LEFT JOIN track_stats lts ON lts.track_id = t.id
            WHERE t.artist_id = g.entity_id AND t.uri IS NOT NULL
            ORDER BY COALESCE(lts.q_plays, 0) DESC LIMIT 1
          )
          WHEN 'album'  THEN (
            SELECT t.uri FROM tracks t
            LEFT JOIN track_stats lts ON lts.track_id = t.id
            WHERE t.album_id = g.entity_id AND t.uri IS NOT NULL
            ORDER BY COALESCE(lts.q_plays, 0) DESC LIMIT 1
          )
        END                                     AS uri,
        g.peak_year                             AS peakYear,
        g.historical_plays                      AS historicalPlays,
        g.ms_played                             AS msPlayed,
        g.last_ts                               AS lastTs,
        g.days_missing                          AS daysMissing,
        g.rank_at_peak                          AS rankAtPeak,
        g.score                                 AS score
       FROM graveyard g
       WHERE g.kind = @kind AND g.days_missing >= @minDays
       ORDER BY g.score DESC, g.historical_plays DESC
       LIMIT @limit OFFSET @offset`,
    )
    .all(params) as GraveyardItem[];

  return { items, total, offset: query.offset, limit: query.limit };
}

export function lostFavoriteCount(db: Db): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM track_stats WHERE lost_score >= ?')
    .get(LOST_FAVORITE_MIN_SCORE) as { n: number };
  return row.n;
}
