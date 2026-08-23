import type { Db } from '../types';
import type { ObsessionItem, ObsessionSections } from '@shared/types/domain';
import type { EntityKind } from '@shared/types/common';
import {
  ONE_HIT_OBSESSION_SHARE,
  ONE_HIT_OBSESSION_MAX_AFTER_SHARE,
  OBSESSION_STRONG_SHARE,
} from '@shared/constants/analytics';

/**
 * Reads from the pre-computed obsession table and arranges it into the sections
 * the Obsessions screen shows. All the work happened during the analytics
 * rebuild; this is presentation, not analysis.
 */

const SELECT = `
  SELECT
    o.kind                                  AS kind,
    o.entity_id                             AS entityId,
    CASE o.kind
      WHEN 'track'  THEN (SELECT t.name  FROM tracks  t  WHERE t.id  = o.entity_id)
      WHEN 'artist' THEN (SELECT a.name  FROM artists a  WHERE a.id  = o.entity_id)
      WHEN 'album'  THEN (SELECT al.name FROM albums  al WHERE al.id = o.entity_id)
    END                                     AS name,
    CASE o.kind
      WHEN 'track'  THEN (SELECT ar.name FROM tracks t JOIN artists ar ON ar.id = t.artist_id WHERE t.id = o.entity_id)
      WHEN 'album'  THEN (SELECT ar.name FROM albums al JOIN artists ar ON ar.id = al.artist_id WHERE al.id = o.entity_id)
      ELSE NULL
    END                                     AS secondary,
    /* Artists and albums resolve to their most-played track; see discovery.ts. */
    CASE o.kind
      WHEN 'track'  THEN (SELECT t.uri FROM tracks t WHERE t.id = o.entity_id)
      WHEN 'artist' THEN (
        SELECT t.uri FROM tracks t
        LEFT JOIN track_stats lts ON lts.track_id = t.id
        WHERE t.artist_id = o.entity_id AND t.uri IS NOT NULL
        ORDER BY COALESCE(lts.q_plays, 0) DESC LIMIT 1
      )
      WHEN 'album'  THEN (
        SELECT t.uri FROM tracks t
        LEFT JOIN track_stats lts ON lts.track_id = t.id
        WHERE t.album_id = o.entity_id AND t.uri IS NOT NULL
        ORDER BY COALESCE(lts.q_plays, 0) DESC LIMIT 1
      )
    END                                     AS uri,
    o.window_days                           AS windowDays,
    o.window_start                          AS windowStart,
    o.window_end                            AS windowEnd,
    o.window_plays                          AS windowPlays,
    o.lifetime_plays                        AS lifetimePlays,
    o.share                                 AS share,
    o.plays_per_day                         AS playsPerDay,
    o.plays_after                           AS playsAfter,
    o.after_share                           AS afterShare,
    o.intensity                             AS intensity,
    o.days_to_50                            AS daysToFifty,
    o.days_to_100                           AS daysToHundred,
    o.longest_run                           AS longestRunMonths,
    o.peak_week                             AS peakWeekPlays
  FROM obsessions o
`;

function query(db: Db, sql: string, params: Record<string, unknown> = {}): ObsessionItem[] {
  return db.prepare(`${SELECT} ${sql}`).all(params) as ObsessionItem[];
}

export function obsessionSections(db: Db, limit: number): ObsessionSections {
  return {
    // The sheer-volume list: what took the most plays in a single month.
    destroyed: query(
      db,
      `WHERE o.kind = 'track' ORDER BY o.window_plays DESC, o.intensity DESC LIMIT @limit`,
      { limit },
    ),

    artistBinges: query(
      db,
      `WHERE o.kind = 'artist' AND o.share >= @strong ORDER BY o.intensity DESC LIMIT @limit`,
      { limit, strong: OBSESSION_STRONG_SHARE * 0.6 },
    ),

    albumAddictions: query(
      db,
      `WHERE o.kind = 'album' ORDER BY o.intensity DESC LIMIT @limit`,
      { limit },
    ),

    // Burned bright, then nothing: most of the lifetime in one window and no return.
    oneHit: query(
      db,
      `WHERE o.kind = 'track' AND o.share >= @share AND o.after_share <= @after
       ORDER BY o.share DESC, o.window_plays DESC LIMIT @limit`,
      { limit, share: ONE_HIT_OBSESSION_SHARE, after: ONE_HIT_OBSESSION_MAX_AFTER_SHARE },
    ),

    fastestHundred: query(
      db,
      `WHERE o.kind = 'track' AND o.days_to_100 IS NOT NULL
       ORDER BY o.days_to_100 ASC LIMIT @limit`,
      { limit },
    ),

    mostIntenseWeek: query(
      db,
      `WHERE o.kind = 'track' ORDER BY o.peak_week DESC LIMIT @limit`,
      { limit },
    ),

    longest: query(
      db,
      `WHERE o.kind = 'track' AND o.longest_run >= 3 ORDER BY o.longest_run DESC, o.lifetime_plays DESC LIMIT @limit`,
      { limit },
    ),
  };
}

export function obsessionForEntity(db: Db, kind: EntityKind, entityId: number): ObsessionItem | null {
  const rows = query(db, `WHERE o.kind = @kind AND o.entity_id = @entityId LIMIT 1`, {
    kind,
    entityId,
  });
  return rows[0] ?? null;
}

/** The strongest obsession that peaked inside a given year — used by Rewind. */
export function obsessionInYear(db: Db, year: number): ObsessionItem | null {
  const from = new Date(year, 0, 1).getTime();
  const to = new Date(year + 1, 0, 1).getTime() - 1;
  const rows = query(
    db,
    `WHERE o.kind = 'track' AND o.window_start >= @from AND o.window_start <= @to
     ORDER BY o.intensity DESC LIMIT 1`,
    { from, to },
  );
  return rows[0] ?? null;
}

export function hasObsessions(db: Db): boolean {
  const row = db.prepare('SELECT COUNT(*) AS n FROM obsessions').get() as { n: number };
  return row.n > 0;
}
