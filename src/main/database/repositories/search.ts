import type { Db } from '../types';
import type { SearchHit, SearchHitKind, SearchFilters } from '@shared/types/domain';
import { MS_PER_DAY } from '@shared/utils/time';

/**
 * Global search.
 *
 * FTS5 handles the matching; the surrounding SQL adds the numbers that make a
 * result useful (plays, listening time, when it was last heard) and applies the
 * filters. Empty queries are valid — they mean "browse everything that passes
 * these filters", which is how the advanced-filter panel works.
 */

/**
 * Turns raw user input into an FTS5 MATCH expression.
 *
 * The split must mirror how the `unicode61` tokenizer indexed the text, which
 * treats every non-alphanumeric character as a separator. Splitting on a
 * hand-written punctuation list instead would leave a token like `&` in the
 * query — indexed as nothing, so `"Alder & Ash"` would match nothing at all.
 * Any name with an ampersand, a plus or an apostrophe depends on this.
 *
 * Every token is then quoted, so FTS operators typed by accident ("NEAR", "AND",
 * a stray quote) are treated as text rather than as syntax. A trailing `*` gives
 * prefix matching on the final token, which is what makes search feel live while
 * typing.
 */
export function toMatchExpression(input: string): string | null {
  const tokens = input
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0);

  if (tokens.length === 0) return null;

  return tokens
    .map((token, index) => (index === tokens.length - 1 ? `"${token}"*` : `"${token}"`))
    .join(' AND ');
}

export interface SearchQuery {
  query: string;
  limit: number;
  offset: number;
  filters: SearchFilters;
  now: number;
}

interface RawHit {
  kind: SearchHitKind;
  id: number;
  title: string;
  subtitle: string | null;
  rank: number;
}

function statsFor(db: Db, kind: SearchHitKind, id: number): {
  plays: number;
  msPlayed: number;
  lastTs: number | null;
  firstTs: number | null;
  lostScore: number;
} {
  switch (kind) {
    case 'track': {
      const row = db
        .prepare(
          'SELECT q_plays AS plays, ms_played AS msPlayed, last_ts AS lastTs, first_ts AS firstTs, lost_score AS lostScore FROM track_stats WHERE track_id = ?',
        )
        .get(id) as
        | { plays: number; msPlayed: number; lastTs: number | null; firstTs: number | null; lostScore: number }
        | undefined;
      return row ?? { plays: 0, msPlayed: 0, lastTs: null, firstTs: null, lostScore: 0 };
    }
    case 'artist': {
      const row = db
        .prepare(
          'SELECT q_plays AS plays, ms_played AS msPlayed, last_ts AS lastTs, first_ts AS firstTs FROM artist_stats WHERE artist_id = ?',
        )
        .get(id) as
        | { plays: number; msPlayed: number; lastTs: number | null; firstTs: number | null }
        | undefined;
      return { ...(row ?? { plays: 0, msPlayed: 0, lastTs: null, firstTs: null }), lostScore: 0 };
    }
    case 'album': {
      const row = db
        .prepare(
          'SELECT q_plays AS plays, ms_played AS msPlayed, last_ts AS lastTs, first_ts AS firstTs FROM album_stats WHERE album_id = ?',
        )
        .get(id) as
        | { plays: number; msPlayed: number; lastTs: number | null; firstTs: number | null }
        | undefined;
      return { ...(row ?? { plays: 0, msPlayed: 0, lastTs: null, firstTs: null }), lostScore: 0 };
    }
    default:
      return { plays: 0, msPlayed: 0, lastTs: null, firstTs: null, lostScore: 0 };
  }
}

function passesFilters(
  db: Db,
  hit: RawHit,
  stats: ReturnType<typeof statsFor>,
  filters: SearchFilters,
  now: number,
): boolean {
  if (filters.kinds && filters.kinds.length > 0 && !filters.kinds.includes(hit.kind)) return false;

  const entityKind = hit.kind === 'track' || hit.kind === 'artist' || hit.kind === 'album';

  if (filters.minPlays != null && stats.plays < filters.minPlays) return false;

  if (filters.year != null && entityKind) {
    const column = hit.kind === 'track' ? 'track_id' : hit.kind === 'artist' ? 'artist_id' : 'album_id';
    const row = db
      .prepare(`SELECT COUNT(*) AS n FROM playback_events WHERE ${column} = ? AND year = ?`)
      .get(hit.id, filters.year) as { n: number };
    if (row.n === 0) return false;
  }

  const firstYear = stats.firstTs !== null ? new Date(stats.firstTs).getFullYear() : null;
  const lastYear = stats.lastTs !== null ? new Date(stats.lastTs).getFullYear() : null;

  if (filters.firstHeardFrom != null && (firstYear === null || firstYear < filters.firstHeardFrom))
    return false;
  if (filters.firstHeardTo != null && (firstYear === null || firstYear > filters.firstHeardTo))
    return false;
  if (filters.lastHeardFrom != null && (lastYear === null || lastYear < filters.lastHeardFrom))
    return false;
  if (filters.lastHeardTo != null && (lastYear === null || lastYear > filters.lastHeardTo))
    return false;

  if (filters.artistId != null) {
    if (hit.kind === 'track') {
      const row = db.prepare('SELECT artist_id AS a FROM tracks WHERE id = ?').get(hit.id) as
        | { a: number }
        | undefined;
      if (row?.a !== filters.artistId) return false;
    } else if (hit.kind === 'album') {
      const row = db.prepare('SELECT artist_id AS a FROM albums WHERE id = ?').get(hit.id) as
        | { a: number }
        | undefined;
      if (row?.a !== filters.artistId) return false;
    } else if (hit.kind === 'artist') {
      if (hit.id !== filters.artistId) return false;
    } else {
      return false;
    }
  }

  if (filters.tagId != null) {
    if (hit.kind !== 'track') return false;
    const row = db
      .prepare('SELECT 1 AS ok FROM track_tags WHERE track_id = ? AND tag_id = ?')
      .get(hit.id, filters.tagId) as { ok: number } | undefined;
    if (!row) return false;
  }

  if (filters.minLostFavoriteScore != null) {
    if (hit.kind !== 'track' || stats.lostScore < filters.minLostFavoriteScore) return false;
  }

  if (filters.status && filters.status !== 'any') {
    if (filters.status === 'favorite' || filters.status === 'retired') {
      if (hit.kind !== 'track') return false;
      const row = db
        .prepare('SELECT favorite, retired FROM track_flags WHERE track_id = ?')
        .get(hit.id) as { favorite: number; retired: number } | undefined;
      if (!row) return false;
      if (filters.status === 'favorite' && row.favorite !== 1) return false;
      if (filters.status === 'retired' && row.retired !== 1) return false;
    } else if (filters.status === 'dormant') {
      if (stats.lastTs === null || now - stats.lastTs < 365 * MS_PER_DAY) return false;
    } else if (filters.status === 'active') {
      if (stats.lastTs === null || now - stats.lastTs > 180 * MS_PER_DAY) return false;
    }
  }

  return true;
}

/** Kind ordering used to break ties, so artists surface above deep-cut tracks. */
const KIND_BOOST: Record<SearchHitKind, number> = {
  artist: 1.15,
  album: 1.05,
  track: 1,
  era: 1.1,
  tag: 1.2,
  collection: 1.2,
};

export function search(db: Db, request: SearchQuery): { items: SearchHit[]; total: number } {
  const match = toMatchExpression(request.query);
  const kindFilter =
    request.filters.kinds && request.filters.kinds.length > 0 ? request.filters.kinds : null;

  let raw: RawHit[];

  if (match) {
    // Fetch generously: filters are applied after matching, so the FTS slice has
    // to be wide enough that filtering does not empty the page.
    raw = db
      .prepare(
        `SELECT kind, entity_id AS id, title, subtitle, bm25(search_index) AS rank
         FROM search_index
         WHERE search_index MATCH @match
         ${kindFilter ? `AND kind IN (${kindFilter.map((k) => `'${k}'`).join(',')})` : ''}
         ORDER BY rank ASC
         LIMIT 600`,
      )
      .all({ match }) as RawHit[];
  } else {
    raw = db
      .prepare(
        `SELECT si.kind, si.entity_id AS id, si.title, si.subtitle, 0 AS rank
         FROM search_index si
         ${kindFilter ? `WHERE si.kind IN (${kindFilter.map((k) => `'${k}'`).join(',')})` : ''}
         LIMIT 4000`,
      )
      .all() as RawHit[];
  }

  const hits: SearchHit[] = [];
  for (const row of raw) {
    const stats = statsFor(db, row.kind, row.id);
    if (!passesFilters(db, row, stats, request.filters, request.now)) continue;
    // bm25 returns negative numbers where more negative is a better match.
    const textScore = match ? -row.rank : 0;
    const popularity = Math.log1p(stats.plays);
    hits.push({
      kind: row.kind,
      id: row.id,
      title: row.title,
      subtitle: row.subtitle && row.subtitle.length > 0 ? row.subtitle : null,
      plays: stats.plays,
      msPlayed: stats.msPlayed,
      lastTs: stats.lastTs,
      score: (textScore * 2 + popularity) * KIND_BOOST[row.kind],
    });
  }

  hits.sort((a, b) => b.score - a.score || b.plays - a.plays);

  return {
    items: hits.slice(request.offset, request.offset + request.limit),
    total: hits.length,
  };
}

export interface SearchFacets {
  years: number[];
  artists: { id: number; name: string; plays: number }[];
  tags: { id: number; name: string; color: string }[];
}

/** Values the advanced-filter panel offers, drawn from the archive itself. */
export function searchFacets(db: Db): SearchFacets {
  return {
    years: db.prepare('SELECT year FROM yearly_stats ORDER BY year DESC').pluck().all() as number[],
    artists: db
      .prepare(
        `SELECT a.id, a.name, s.q_plays AS plays
         FROM artist_stats s JOIN artists a ON a.id = s.artist_id
         ORDER BY s.q_plays DESC LIMIT 200`,
      )
      .all() as { id: number; name: string; plays: number }[],
    tags: db.prepare('SELECT id, name, color FROM tags ORDER BY position ASC').all() as {
      id: number;
      name: string;
      color: string;
    }[],
  };
}
