import type { Db } from '../database/types';
import { SKIP_MAX_MS, LOST_FAVORITE_RECENT_WINDOW_DAYS } from '@shared/constants/analytics';
import { MS_PER_DAY } from '@shared/utils/time';

/**
 * Set-based aggregate construction.
 *
 * Everything that can be expressed as a GROUP BY lives here and runs entirely
 * inside SQLite. Only genuinely sequential questions — "how many plays in the
 * densest 30 days", "how long was the silence" — are pulled into JavaScript, and
 * those live in sequences.ts.
 */

export interface AggregateOptions {
  qualifyingPlayMs: number;
  includePrivateSessions: boolean;
  now: number;
}

/** SQL fragment marking a playback event as a qualifying play. */
export function qualifyingExpr(minMs: number): string {
  return `(ms_played >= ${Math.max(0, Math.floor(minMs))})`;
}

/**
 * SQL fragment marking a playback event as a skip.
 *
 * Two signals: Spotify's own `skipped` flag when present, and the behavioural
 * pattern of jumping away within the first few seconds. Both are needed —
 * `skipped` is absent from large stretches of older exports.
 */
export const SKIP_EXPR = `(
  skipped = 1
  OR (ms_played < ${SKIP_MAX_MS} AND reason_end IN ('fwdbtn', 'backbtn'))
)`;

/** WHERE fragment applying the private-session preference. */
export function eventFilter(includePrivate: boolean): string {
  return includePrivate ? '1=1' : 'incognito = 0';
}

function clearDerived(db: Db): void {
  db.exec(`
    DELETE FROM track_stats;
    DELETE FROM artist_stats;
    DELETE FROM album_stats;
    DELETE FROM monthly_track_stats;
    DELETE FROM monthly_artist_stats;
    DELETE FROM daily_stats;
    DELETE FROM hourly_stats;
    DELETE FROM yearly_stats;
    DELETE FROM sessions;
    DELETE FROM era_artists;
    DELETE FROM era_tracks;
    DELETE FROM eras;
    DELETE FROM obsessions;
    DELETE FROM graveyard;
  `);
}

/**
 * Rebuilds every purely aggregate table. Runs inside a single transaction so a
 * failure part-way through leaves the previous analytics intact rather than a
 * half-populated archive.
 */
export function buildAggregates(db: Db, options: AggregateOptions): void {
  const q = qualifyingExpr(options.qualifyingPlayMs);
  const filter = eventFilter(options.includePrivateSessions);
  const recentCutoff = options.now - LOST_FAVORITE_RECENT_WINDOW_DAYS * MS_PER_DAY;

  const run = db.transaction(() => {
    clearDerived(db);

    db.exec(`
      INSERT INTO track_stats (
        track_id, plays, q_plays, short_plays, skips, ms_played,
        first_ts, last_ts, distinct_days, active_months, recent_plays
      )
      SELECT
        track_id,
        COUNT(*),
        SUM(CASE WHEN ${q} THEN 1 ELSE 0 END),
        SUM(CASE WHEN ${q} THEN 0 ELSE 1 END),
        SUM(CASE WHEN ${SKIP_EXPR} THEN 1 ELSE 0 END),
        SUM(ms_played),
        MIN(ts),
        MAX(ts),
        COUNT(DISTINCT local_date),
        COUNT(DISTINCT ym),
        SUM(CASE WHEN ts >= ${recentCutoff} AND ${q} THEN 1 ELSE 0 END)
      FROM playback_events
      WHERE ${filter}
      GROUP BY track_id;
    `);

    db.exec(`
      INSERT INTO artist_stats (
        artist_id, plays, q_plays, short_plays, skips, ms_played,
        first_ts, last_ts, track_count, album_count, distinct_days, recent_plays,
        night_plays
      )
      SELECT
        artist_id,
        COUNT(*),
        SUM(CASE WHEN ${q} THEN 1 ELSE 0 END),
        SUM(CASE WHEN ${q} THEN 0 ELSE 1 END),
        SUM(CASE WHEN ${SKIP_EXPR} THEN 1 ELSE 0 END),
        SUM(ms_played),
        MIN(ts),
        MAX(ts),
        COUNT(DISTINCT track_id),
        COUNT(DISTINCT album_id),
        COUNT(DISTINCT local_date),
        SUM(CASE WHEN ts >= ${recentCutoff} AND ${q} THEN 1 ELSE 0 END),
        SUM(CASE WHEN hour >= 22 OR hour < 5 THEN 1 ELSE 0 END)
      FROM playback_events
      WHERE ${filter}
      GROUP BY artist_id;
    `);

    db.exec(`
      INSERT INTO album_stats (
        album_id, plays, q_plays, skips, ms_played, first_ts, last_ts, track_count, recent_plays
      )
      SELECT
        album_id,
        COUNT(*),
        SUM(CASE WHEN ${q} THEN 1 ELSE 0 END),
        SUM(CASE WHEN ${SKIP_EXPR} THEN 1 ELSE 0 END),
        SUM(ms_played),
        MIN(ts),
        MAX(ts),
        COUNT(DISTINCT track_id),
        SUM(CASE WHEN ts >= ${recentCutoff} AND ${q} THEN 1 ELSE 0 END)
      FROM playback_events
      WHERE ${filter} AND album_id IS NOT NULL
      GROUP BY album_id;
    `);

    db.exec(`
      INSERT INTO monthly_track_stats (track_id, ym, plays, q_plays, ms_played)
      SELECT track_id, ym, COUNT(*), SUM(CASE WHEN ${q} THEN 1 ELSE 0 END), SUM(ms_played)
      FROM playback_events
      WHERE ${filter}
      GROUP BY track_id, ym;
    `);

    db.exec(`
      INSERT INTO monthly_artist_stats (artist_id, ym, plays, q_plays, ms_played)
      SELECT artist_id, ym, COUNT(*), SUM(CASE WHEN ${q} THEN 1 ELSE 0 END), SUM(ms_played)
      FROM playback_events
      WHERE ${filter}
      GROUP BY artist_id, ym;
    `);

    db.exec(`
      INSERT INTO daily_stats (
        local_date, plays, q_plays, ms_played, unique_tracks, unique_artists, first_ts, last_ts
      )
      SELECT
        local_date,
        COUNT(*),
        SUM(CASE WHEN ${q} THEN 1 ELSE 0 END),
        SUM(ms_played),
        COUNT(DISTINCT track_id),
        COUNT(DISTINCT artist_id),
        MIN(ts),
        MAX(ts)
      FROM playback_events
      WHERE ${filter}
      GROUP BY local_date;
    `);

    db.exec(`
      INSERT INTO hourly_stats (hour, dow, plays, ms_played)
      SELECT hour, dow, COUNT(*), SUM(ms_played)
      FROM playback_events
      WHERE ${filter}
      GROUP BY hour, dow;
    `);

    db.exec(`
      INSERT INTO yearly_stats (year, plays, q_plays, ms_played, tracks, artists, albums, days)
      SELECT
        year,
        COUNT(*),
        SUM(CASE WHEN ${q} THEN 1 ELSE 0 END),
        SUM(ms_played),
        COUNT(DISTINCT track_id),
        COUNT(DISTINCT artist_id),
        COUNT(DISTINCT album_id),
        COUNT(DISTINCT local_date)
      FROM playback_events
      WHERE ${filter}
      GROUP BY year;
    `);

    // Peak month per track / artist / album, resolved with a window function.
    db.exec(`
      UPDATE track_stats
      SET peak_ym = r.ym, peak_ym_plays = r.q_plays
      FROM (
        SELECT track_id, ym, q_plays,
               ROW_NUMBER() OVER (PARTITION BY track_id ORDER BY q_plays DESC, plays DESC, ym ASC) AS rn
        FROM monthly_track_stats
      ) AS r
      WHERE r.track_id = track_stats.track_id AND r.rn = 1;
    `);

    db.exec(`
      UPDATE artist_stats
      SET peak_ym = r.ym
      FROM (
        SELECT artist_id, ym,
               ROW_NUMBER() OVER (PARTITION BY artist_id ORDER BY q_plays DESC, plays DESC, ym ASC) AS rn
        FROM monthly_artist_stats
      ) AS r
      WHERE r.artist_id = artist_stats.artist_id AND r.rn = 1;
    `);

    // Peak year, computed directly from events so albums are covered too.
    db.exec(`
      UPDATE track_stats
      SET peak_year = r.year
      FROM (
        SELECT track_id, year,
               ROW_NUMBER() OVER (PARTITION BY track_id ORDER BY n DESC, year ASC) AS rn
        FROM (
          SELECT track_id, year, SUM(CASE WHEN ${q} THEN 1 ELSE 0 END) AS n
          FROM playback_events WHERE ${filter} GROUP BY track_id, year
        )
      ) AS r
      WHERE r.track_id = track_stats.track_id AND r.rn = 1;
    `);

    db.exec(`
      UPDATE artist_stats
      SET peak_year = r.year
      FROM (
        SELECT artist_id, year,
               ROW_NUMBER() OVER (PARTITION BY artist_id ORDER BY n DESC, year ASC) AS rn
        FROM (
          SELECT artist_id, year, SUM(CASE WHEN ${q} THEN 1 ELSE 0 END) AS n
          FROM playback_events WHERE ${filter} GROUP BY artist_id, year
        )
      ) AS r
      WHERE r.artist_id = artist_stats.artist_id AND r.rn = 1;
    `);

    db.exec(`
      UPDATE album_stats
      SET peak_year = r.year, peak_ym = r.ym
      FROM (
        SELECT album_id, year, ym,
               ROW_NUMBER() OVER (PARTITION BY album_id ORDER BY n DESC, ym ASC) AS rn
        FROM (
          SELECT album_id, year, ym, SUM(CASE WHEN ${q} THEN 1 ELSE 0 END) AS n
          FROM playback_events WHERE ${filter} AND album_id IS NOT NULL GROUP BY album_id, ym
        )
      ) AS r
      WHERE r.album_id = album_stats.album_id AND r.rn = 1;
    `);

    /**
     * Album listening shape.
     *
     * `breadth` is the share of an album's tracks that received at least three
     * qualifying plays; `top3_share` is how much of the album's listening went to
     * its three biggest tracks. Together they distinguish "I lived inside this
     * record" from "I replayed the single".
     */
    db.exec(`
      UPDATE album_stats
      SET breadth = COALESCE(r.breadth, 0), top3_share = COALESCE(r.top3, 0)
      FROM (
        SELECT
          a.album_id,
          CAST(SUM(CASE WHEN a.q >= 3 THEN 1 ELSE 0 END) AS REAL) / MAX(COUNT(*), 1) AS breadth,
          CAST(SUM(CASE WHEN a.rn <= 3 THEN a.q ELSE 0 END) AS REAL) / MAX(SUM(a.q), 1) AS top3
        FROM (
          SELECT album_id, track_id,
                 SUM(CASE WHEN ${q} THEN 1 ELSE 0 END) AS q,
                 ROW_NUMBER() OVER (
                   PARTITION BY album_id
                   ORDER BY SUM(CASE WHEN ${q} THEN 1 ELSE 0 END) DESC
                 ) AS rn
          FROM playback_events
          WHERE ${filter} AND album_id IS NOT NULL
          GROUP BY album_id, track_id
        ) AS a
        GROUP BY a.album_id
      ) AS r
      WHERE r.album_id = album_stats.album_id;
    `);

    /**
     * A track's canonical album is the one it was most often played from —
     * exports frequently attribute the same song to a single, a deluxe edition
     * and a compilation.
     */
    db.exec(`
      UPDATE tracks
      SET album_id = r.album_id
      FROM (
        SELECT track_id, album_id,
               ROW_NUMBER() OVER (PARTITION BY track_id ORDER BY n DESC, album_id ASC) AS rn
        FROM (
          SELECT track_id, album_id, COUNT(*) AS n
          FROM playback_events
          WHERE album_id IS NOT NULL
          GROUP BY track_id, album_id
        )
      ) AS r
      WHERE r.track_id = tracks.id AND r.rn = 1;
    `);
  });

  run();
}

/** Rebuilds the FTS index from the current entity tables. */
export function buildSearchIndex(db: Db): void {
  const run = db.transaction(() => {
    db.exec('DELETE FROM search_index;');
    db.exec(`
      INSERT INTO search_index (title, subtitle, kind, entity_id)
      SELECT t.name, ar.name, 'track', t.id
      FROM tracks t JOIN artists ar ON ar.id = t.artist_id;
    `);
    db.exec(`
      INSERT INTO search_index (title, subtitle, kind, entity_id)
      SELECT name, '', 'artist', id FROM artists;
    `);
    db.exec(`
      INSERT INTO search_index (title, subtitle, kind, entity_id)
      SELECT al.name, ar.name, 'album', al.id
      FROM albums al JOIN artists ar ON ar.id = al.artist_id;
    `);
    db.exec(`
      INSERT INTO search_index (title, subtitle, kind, entity_id)
      SELECT COALESCE(custom_title, auto_title), start_ym || ' - ' || end_ym, 'era', id FROM eras;
    `);
    db.exec(`
      INSERT INTO search_index (title, subtitle, kind, entity_id)
      SELECT name, '', 'tag', id FROM tags;
    `);
    db.exec(`
      INSERT INTO search_index (title, subtitle, kind, entity_id)
      SELECT name, COALESCE(description, ''), 'collection', id FROM smart_collections;
    `);
    db.exec("INSERT INTO search_index(search_index) VALUES('optimize');");
  });
  run();
}
