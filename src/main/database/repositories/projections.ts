/**
 * Shared SQL projections.
 *
 * Columns are aliased to the camelCase names used by the domain types, so a row
 * returned by better-sqlite3 is already the shape the renderer expects and no
 * hand-written mapping layer sits in between to drift out of sync.
 */

/**
 * A Spotify link for an artist or an album.
 *
 * The export contains `spotify_track_uri` and nothing else — no artist or album
 * identifiers at all. Rather than leave "Open in Spotify" and "Revive" dead on
 * every artist and album, these resolve to that entity's most-played track,
 * which is a real link into their catalogue and one tap from the artist page.
 */
export const ARTIST_LINK_URI = `(
  SELECT t.uri FROM tracks t
  LEFT JOIN track_stats lts ON lts.track_id = t.id
  WHERE t.artist_id = a.id AND t.uri IS NOT NULL
  ORDER BY COALESCE(lts.q_plays, 0) DESC
  LIMIT 1
)`;

export const ALBUM_LINK_URI = `(
  SELECT t.uri FROM tracks t
  LEFT JOIN track_stats lts ON lts.track_id = t.id
  WHERE t.album_id = al.id AND t.uri IS NOT NULL
  ORDER BY COALESCE(lts.q_plays, 0) DESC
  LIMIT 1
)`;

export const TRACK_SUMMARY = `
  SELECT
    t.id                                      AS id,
    t.name                                    AS name,
    t.artist_id                               AS artistId,
    ar.name                                   AS artist,
    t.album_id                                AS albumId,
    al.name                                   AS album,
    t.uri                                     AS uri,
    COALESCE(ts.plays, 0)                     AS plays,
    COALESCE(ts.q_plays, 0)                   AS qualifyingPlays,
    COALESCE(ts.ms_played, 0)                 AS msPlayed,
    ts.first_ts                               AS firstTs,
    ts.last_ts                                AS lastTs,
    CASE WHEN COALESCE(ts.plays, 0) > 0
         THEN CAST(COALESCE(ts.skips, 0) AS REAL) / ts.plays
         ELSE 0 END                           AS skipRate
  FROM tracks t
  JOIN artists ar ON ar.id = t.artist_id
  LEFT JOIN albums al ON al.id = t.album_id
  LEFT JOIN track_stats ts ON ts.track_id = t.id
`;

export const ARTIST_SUMMARY = `
  SELECT
    a.id                            AS id,
    a.name                          AS name,
    COALESCE(a.uri, ${ARTIST_LINK_URI}) AS uri,
    COALESCE(s.plays, 0)            AS plays,
    COALESCE(s.q_plays, 0)          AS qualifyingPlays,
    COALESCE(s.ms_played, 0)        AS msPlayed,
    COALESCE(s.track_count, 0)      AS trackCount,
    s.first_ts                      AS firstTs,
    s.last_ts                       AS lastTs
  FROM artists a
  LEFT JOIN artist_stats s ON s.artist_id = a.id
`;

export const ALBUM_SUMMARY = `
  SELECT
    al.id                           AS id,
    al.name                         AS name,
    al.artist_id                    AS artistId,
    ar.name                         AS artist,
    COALESCE(al.uri, ${ALBUM_LINK_URI}) AS uri,
    COALESCE(s.plays, 0)            AS plays,
    COALESCE(s.q_plays, 0)          AS qualifyingPlays,
    COALESCE(s.ms_played, 0)        AS msPlayed,
    COALESCE(s.track_count, 0)      AS trackCount,
    s.first_ts                      AS firstTs,
    s.last_ts                       AS lastTs
  FROM albums al
  JOIN artists ar ON ar.id = al.artist_id
  LEFT JOIN album_stats s ON s.album_id = al.id
`;

/** Applies a limit/offset pair safely (values are always bound, never inlined). */
export function paginate(sql: string): string {
  return `${sql} LIMIT @limit OFFSET @offset`;
}
