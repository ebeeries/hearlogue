import type { Db } from '../types';
import { TRACK_SUMMARY, ARTIST_SUMMARY, ALBUM_SUMMARY } from './projections';
import type {
  LifetimeStats,
  RediscoveryCard,
  OnThisDayEntry,
  RecordEntry,
  ClockStats,
  TrackSummary,
  ArtistSummary,
  AlbumSummary,
  YearlyPoint,
} from '@shared/types/domain';
import { DAYPARTS, LOST_FAVORITE_MIN_SCORE } from '@shared/constants/analytics';
import { MS_PER_DAY, localParts } from '@shared/utils/time';
import { unitHash } from '@shared/utils/hash';

/**
 * Queries backing the Archive home screen — the lifetime picture, the daily
 * rediscovery, "On This Day", and the records board.
 */

export function lifetimeStats(db: Db): LifetimeStats {
  const row = db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM playback_events)                  AS streams,
        (SELECT COALESCE(SUM(q_plays), 0) FROM track_stats)     AS qualifyingPlays,
        (SELECT COALESCE(SUM(ms_played), 0) FROM track_stats)   AS msPlayed,
        (SELECT COALESCE(SUM(skips), 0) FROM track_stats)       AS skips,
        (SELECT COUNT(*) FROM tracks)                           AS tracks,
        (SELECT COUNT(*) FROM artists)                          AS artists,
        (SELECT COUNT(*) FROM albums)                           AS albums,
        (SELECT COUNT(*) FROM daily_stats)                      AS activeDays,
        (SELECT MIN(ts) FROM playback_events)                   AS firstTs,
        (SELECT MAX(ts) FROM playback_events)                   AS lastTs,
        (SELECT COUNT(*) FROM yearly_stats)                     AS years`,
    )
    .get() as {
    streams: number;
    qualifyingPlays: number;
    msPlayed: number;
    skips: number;
    tracks: number;
    artists: number;
    albums: number;
    activeDays: number;
    firstTs: number | null;
    lastTs: number | null;
    years: number;
  };

  return {
    streams: row.streams,
    qualifyingPlays: row.qualifyingPlays,
    msPlayed: row.msPlayed,
    tracks: row.tracks,
    artists: row.artists,
    albums: row.albums,
    years: row.years,
    firstTs: row.firstTs,
    lastTs: row.lastTs,
    activeDays: row.activeDays,
    skipRate: row.streams > 0 ? row.skips / row.streams : 0,
  };
}

export function yearlyPoints(db: Db): YearlyPoint[] {
  return db
    .prepare(
      `SELECT year, plays, q_plays AS qualifyingPlays, ms_played AS msPlayed,
              tracks, artists, albums
       FROM yearly_stats ORDER BY year ASC`,
    )
    .all() as YearlyPoint[];
}

/**
 * The daily rediscovery.
 *
 * Picks from the strongest Lost Favorites, but rotates deterministically by day
 * so the same card is shown all day and a different one appears tomorrow —
 * without storing per-day state or repeating the same track two days running.
 */
export function rediscovery(db: Db, now: number, salt = 0): RediscoveryCard | null {
  const candidates = db
    .prepare(
      `${TRACK_SUMMARY}
       WHERE ts.lost_score >= @minScore
       ORDER BY ts.lost_score DESC
       LIMIT 60`,
    )
    .all({ minScore: LOST_FAVORITE_MIN_SCORE }) as TrackSummary[];

  if (candidates.length === 0) return null;

  const dayKey = localParts(now).date;
  const index = Math.floor(unitHash(dayKey, salt) * candidates.length) % candidates.length;
  const track = candidates[index];

  const extra = db
    .prepare('SELECT lost_score AS score, peak_year AS peakYear FROM track_stats WHERE track_id = ?')
    .get(track.id) as { score: number; peakYear: number | null } | undefined;

  const daysSinceLastPlay =
    track.lastTs === null ? 0 : Math.floor((now - track.lastTs) / MS_PER_DAY);

  const years = Math.floor(daysSinceLastPlay / 365);
  const reasonKey =
    years >= 5
      ? 'rediscovery.reason.longGone'
      : years >= 2
        ? 'rediscovery.reason.yearsAway'
        : 'rediscovery.reason.dormant';

  return {
    track,
    score: extra?.score ?? 0,
    daysSinceLastPlay,
    peakYear: extra?.peakYear ?? null,
    headlineKey: 'archive.rediscovery.headline',
    reasonKey,
    reasonValues: {
      plays: track.qualifyingPlays,
      years,
      days: daysSinceLastPlay,
      peakYear: extra?.peakYear ?? 0,
    },
  };
}

/** Every prior year's listening on the same calendar day. */
export function onThisDay(db: Db, now: number, month?: number | null, day?: number | null): OnThisDayEntry[] {
  const parts = localParts(now);
  const m = month ?? parts.month;
  const d = day ?? parts.day;
  const suffix = `-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  const days = db
    .prepare(
      `SELECT local_date AS date, plays AS events, ms_played AS msPlayed, q_plays AS qualifyingPlays
       FROM daily_stats
       WHERE local_date LIKE '%' || @suffix
       ORDER BY local_date DESC`,
    )
    .all({ suffix }) as {
    date: string;
    events: number;
    msPlayed: number;
    qualifyingPlays: number;
  }[];

  const topArtistStmt = db.prepare(
    `SELECT a.id, a.name, COUNT(*) AS plays
     FROM playback_events e JOIN artists a ON a.id = e.artist_id
     WHERE e.local_date = ? GROUP BY a.id ORDER BY plays DESC LIMIT 1`,
  );
  const topTrackStmt = db.prepare(
    `SELECT t.id, t.name, ar.name AS artist, COUNT(*) AS plays
     FROM playback_events e
     JOIN tracks t ON t.id = e.track_id
     JOIN artists ar ON ar.id = t.artist_id
     WHERE e.local_date = ? GROUP BY t.id ORDER BY plays DESC LIMIT 1`,
  );

  return days
    .filter((entry) => entry.date !== parts.date)
    .map((entry) => ({
      year: Number(entry.date.slice(0, 4)),
      date: entry.date,
      events: entry.events,
      msPlayed: entry.msPlayed,
      qualifyingPlays: entry.qualifyingPlays,
      topArtist: (topArtistStmt.get(entry.date) as OnThisDayEntry['topArtist']) ?? null,
      topTrack: (topTrackStmt.get(entry.date) as OnThisDayEntry['topTrack']) ?? null,
    }));
}

export function clockStats(db: Db): ClockStats {
  const rows = db
    .prepare('SELECT hour, dow, plays, ms_played AS msPlayed FROM hourly_stats')
    .all() as { hour: number; dow: number; plays: number; msPlayed: number }[];

  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, plays: 0, msPlayed: 0 }));
  const byDow = Array.from({ length: 7 }, (_, dow) => ({ dow, plays: 0, msPlayed: 0 }));
  const weekday = { plays: 0, msPlayed: 0 };
  const weekend = { plays: 0, msPlayed: 0 };
  let totalPlays = 0;
  let afterMidnight = 0;

  for (const row of rows) {
    hourly[row.hour].plays += row.plays;
    hourly[row.hour].msPlayed += row.msPlayed;
    byDow[row.dow].plays += row.plays;
    byDow[row.dow].msPlayed += row.msPlayed;
    const bucket = row.dow === 0 || row.dow === 6 ? weekend : weekday;
    bucket.plays += row.plays;
    bucket.msPlayed += row.msPlayed;
    totalPlays += row.plays;
    if (row.hour >= 0 && row.hour < 5) afterMidnight += row.plays;
  }

  let peakHour = 0;
  for (let h = 1; h < 24; h++) {
    if (hourly[h].plays > hourly[peakHour].plays) peakHour = h;
  }

  const dayparts = DAYPARTS.map((part) => {
    let plays = 0;
    let msPlayed = 0;
    for (let h = part.from; h < part.to; h++) {
      plays += hourly[h].plays;
      msPlayed += hourly[h].msPlayed;
    }
    return { key: part.key, plays, msPlayed, share: totalPlays > 0 ? plays / totalPlays : 0 };
  });

  return {
    hourly,
    peakHour,
    dayparts,
    weekday,
    weekend,
    afterMidnightShare: totalPlays > 0 ? afterMidnight / totalPlays : 0,
    byDow,
  };
}

export function topTracks(db: Db, limit: number, offset = 0, year: number | null = null): TrackSummary[] {
  if (year === null) {
    return db
      .prepare(`${TRACK_SUMMARY} WHERE ts.q_plays > 0 ORDER BY ts.q_plays DESC, ts.ms_played DESC LIMIT @limit OFFSET @offset`)
      .all({ limit, offset }) as TrackSummary[];
  }
  return db
    .prepare(
      `${TRACK_SUMMARY}
       JOIN (
         SELECT track_id, SUM(q_plays) AS yq
         FROM monthly_track_stats WHERE ym LIKE @yearLike GROUP BY track_id
       ) y ON y.track_id = t.id
       ORDER BY y.yq DESC LIMIT @limit OFFSET @offset`,
    )
    .all({ limit, offset, yearLike: `${year}-%` }) as TrackSummary[];
}

export function topArtists(db: Db, limit: number, offset = 0, year: number | null = null): ArtistSummary[] {
  if (year === null) {
    return db
      .prepare(`${ARTIST_SUMMARY} WHERE s.q_plays > 0 ORDER BY s.ms_played DESC LIMIT @limit OFFSET @offset`)
      .all({ limit, offset }) as ArtistSummary[];
  }
  return db
    .prepare(
      `${ARTIST_SUMMARY}
       JOIN (
         SELECT artist_id, SUM(q_plays) AS yq, SUM(ms_played) AS yms
         FROM monthly_artist_stats WHERE ym LIKE @yearLike GROUP BY artist_id
       ) y ON y.artist_id = a.id
       ORDER BY y.yms DESC LIMIT @limit OFFSET @offset`,
    )
    .all({ limit, offset, yearLike: `${year}-%` }) as ArtistSummary[];
}

export function topAlbums(db: Db, limit: number, offset = 0, year: number | null = null): AlbumSummary[] {
  if (year === null) {
    return db
      .prepare(`${ALBUM_SUMMARY} WHERE s.q_plays > 0 ORDER BY s.ms_played DESC LIMIT @limit OFFSET @offset`)
      .all({ limit, offset }) as AlbumSummary[];
  }
  return db
    .prepare(
      `${ALBUM_SUMMARY}
       JOIN (
         SELECT album_id, SUM(CASE WHEN ms_played >= 0 THEN 1 ELSE 0 END) AS n, SUM(ms_played) AS yms
         FROM playback_events WHERE year = @year AND album_id IS NOT NULL GROUP BY album_id
       ) y ON y.album_id = al.id
       ORDER BY y.yms DESC LIMIT @limit OFFSET @offset`,
    )
    .all({ limit, offset, year }) as AlbumSummary[];
}

/**
 * The records board.
 *
 * Everything here is a superlative drawn straight from the derived tables — no
 * estimates, no interpolation. Entries with no data are omitted rather than
 * shown as zero.
 */
export function records(db: Db, now: number): RecordEntry[] {
  const out: RecordEntry[] = [];

  const mostPlayedTrack = db
    .prepare(
      `SELECT t.id, t.name, ar.name AS artist, ts.q_plays AS plays, ts.ms_played AS ms
       FROM track_stats ts JOIN tracks t ON t.id = ts.track_id JOIN artists ar ON ar.id = t.artist_id
       ORDER BY ts.q_plays DESC LIMIT 1`,
    )
    .get() as { id: number; name: string; artist: string; plays: number; ms: number } | undefined;
  if (mostPlayedTrack) {
    out.push({
      key: 'records.mostPlayedTrack',
      values: { plays: mostPlayedTrack.plays, minutes: Math.round(mostPlayedTrack.ms / 60000) },
      entity: {
        kind: 'track',
        id: mostPlayedTrack.id,
        name: mostPlayedTrack.name,
        secondary: mostPlayedTrack.artist,
      },
    });
  }

  const mostPlayedArtist = db
    .prepare(
      `SELECT a.id, a.name, s.q_plays AS plays, s.ms_played AS ms
       FROM artist_stats s JOIN artists a ON a.id = s.artist_id
       ORDER BY s.ms_played DESC LIMIT 1`,
    )
    .get() as { id: number; name: string; plays: number; ms: number } | undefined;
  if (mostPlayedArtist) {
    out.push({
      key: 'records.mostPlayedArtist',
      values: { plays: mostPlayedArtist.plays, hours: Math.round(mostPlayedArtist.ms / 3600000) },
      entity: { kind: 'artist', id: mostPlayedArtist.id, name: mostPlayedArtist.name, secondary: null },
    });
  }

  const mostPlayedAlbum = db
    .prepare(
      `SELECT al.id, al.name, ar.name AS artist, s.q_plays AS plays
       FROM album_stats s JOIN albums al ON al.id = s.album_id JOIN artists ar ON ar.id = al.artist_id
       ORDER BY s.ms_played DESC LIMIT 1`,
    )
    .get() as { id: number; name: string; artist: string; plays: number } | undefined;
  if (mostPlayedAlbum) {
    out.push({
      key: 'records.mostPlayedAlbum',
      values: { plays: mostPlayedAlbum.plays },
      entity: {
        kind: 'album',
        id: mostPlayedAlbum.id,
        name: mostPlayedAlbum.name,
        secondary: mostPlayedAlbum.artist,
      },
    });
  }

  const longestDay = db
    .prepare(
      'SELECT local_date AS date, ms_played AS ms, plays FROM daily_stats ORDER BY ms_played DESC LIMIT 1',
    )
    .get() as { date: string; ms: number; plays: number } | undefined;
  if (longestDay) {
    out.push({
      key: 'records.longestDay',
      values: { date: longestDay.date, hours: Math.round((longestDay.ms / 3600000) * 10) / 10 },
    });
  }

  const busiestDay = db
    .prepare('SELECT local_date AS date, plays FROM daily_stats ORDER BY plays DESC LIMIT 1')
    .get() as { date: string; plays: number } | undefined;
  if (busiestDay) {
    out.push({ key: 'records.mostStreamsInADay', values: { date: busiestDay.date, plays: busiestDay.plays } });
  }

  const streak = longestStreak(db);
  if (streak.length > 0) {
    out.push({
      key: 'records.longestStreak',
      values: { days: streak.length, from: streak.from ?? '', to: streak.to ?? '' },
    });
  }

  const fastest50 = db
    .prepare(
      `SELECT t.id, t.name, ar.name AS artist, o.days_to_50 AS days
       FROM obsessions o JOIN tracks t ON t.id = o.entity_id JOIN artists ar ON ar.id = t.artist_id
       WHERE o.kind = 'track' AND o.days_to_50 IS NOT NULL
       ORDER BY o.days_to_50 ASC LIMIT 1`,
    )
    .get() as { id: number; name: string; artist: string; days: number } | undefined;
  if (fastest50) {
    out.push({
      key: 'records.fastestFifty',
      values: { days: fastest50.days },
      entity: { kind: 'track', id: fastest50.id, name: fastest50.name, secondary: fastest50.artist },
    });
  }

  const fastest100 = db
    .prepare(
      `SELECT t.id, t.name, ar.name AS artist, o.days_to_100 AS days
       FROM obsessions o JOIN tracks t ON t.id = o.entity_id JOIN artists ar ON ar.id = t.artist_id
       WHERE o.kind = 'track' AND o.days_to_100 IS NOT NULL
       ORDER BY o.days_to_100 ASC LIMIT 1`,
    )
    .get() as { id: number; name: string; artist: string; days: number } | undefined;
  if (fastest100) {
    out.push({
      key: 'records.fastestHundred',
      values: { days: fastest100.days },
      entity: { kind: 'track', id: fastest100.id, name: fastest100.name, secondary: fastest100.artist },
    });
  }

  const biggestComeback = db
    .prepare(
      `SELECT t.id, t.name, ar.name AS artist, ts.longest_gap_days AS gap, ts.q_plays AS plays
       FROM track_stats ts JOIN tracks t ON t.id = ts.track_id JOIN artists ar ON ar.id = t.artist_id
       WHERE ts.longest_gap_days >= 180 AND ts.q_plays >= 15
       ORDER BY ts.longest_gap_days DESC LIMIT 1`,
    )
    .get() as { id: number; name: string; artist: string; gap: number; plays: number } | undefined;
  if (biggestComeback) {
    out.push({
      key: 'records.biggestComeback',
      values: { days: biggestComeback.gap, plays: biggestComeback.plays },
      entity: {
        kind: 'track',
        id: biggestComeback.id,
        name: biggestComeback.name,
        secondary: biggestComeback.artist,
      },
    });
  }

  const longestLost = db
    .prepare(
      `SELECT t.id, t.name, ar.name AS artist, ts.last_ts AS lastTs, ts.q_plays AS plays
       FROM track_stats ts JOIN tracks t ON t.id = ts.track_id JOIN artists ar ON ar.id = t.artist_id
       WHERE ts.lost_score > 0 ORDER BY ts.last_ts ASC LIMIT 1`,
    )
    .get() as { id: number; name: string; artist: string; lastTs: number; plays: number } | undefined;
  if (longestLost) {
    out.push({
      key: 'records.longestLost',
      values: {
        days: Math.floor((now - longestLost.lastTs) / MS_PER_DAY),
        plays: longestLost.plays,
      },
      entity: {
        kind: 'track',
        id: longestLost.id,
        name: longestLost.name,
        secondary: longestLost.artist,
      },
      ts: longestLost.lastTs,
    });
  }

  const topObsession = db
    .prepare(
      `SELECT t.id, t.name, ar.name AS artist, o.window_plays AS plays, o.window_start AS startTs
       FROM obsessions o JOIN tracks t ON t.id = o.entity_id JOIN artists ar ON ar.id = t.artist_id
       WHERE o.kind = 'track' ORDER BY o.intensity DESC LIMIT 1`,
    )
    .get() as { id: number; name: string; artist: string; plays: number; startTs: number } | undefined;
  if (topObsession) {
    out.push({
      key: 'records.biggestObsession',
      values: { plays: topObsession.plays },
      entity: {
        kind: 'track',
        id: topObsession.id,
        name: topObsession.name,
        secondary: topObsession.artist,
      },
      ts: topObsession.startTs,
    });
  }

  const busiestYear = db
    .prepare('SELECT year, plays, ms_played AS ms FROM yearly_stats ORDER BY ms_played DESC LIMIT 1')
    .get() as { year: number; plays: number; ms: number } | undefined;
  if (busiestYear) {
    out.push({
      key: 'records.mostActiveYear',
      values: {
        year: busiestYear.year,
        plays: busiestYear.plays,
        hours: Math.round(busiestYear.ms / 3600000),
      },
    });
  }

  const longestSession = db
    .prepare(
      `SELECT s.id, s.ms_played AS ms, s.events, s.start_ts AS startTs, t.name AS track, ar.name AS artist
       FROM sessions s
       LEFT JOIN tracks t ON t.id = s.top_track_id
       LEFT JOIN artists ar ON ar.id = s.top_artist_id
       ORDER BY s.ms_played DESC LIMIT 1`,
    )
    .get() as
    | { id: number; ms: number; events: number; startTs: number; track: string | null; artist: string | null }
    | undefined;
  if (longestSession) {
    out.push({
      key: 'records.longestSession',
      values: {
        hours: Math.round((longestSession.ms / 3600000) * 10) / 10,
        tracks: longestSession.events,
      },
      ts: longestSession.startTs,
    });
  }

  return out;
}

/** Longest run of consecutive days with any listening. */
export function longestStreak(db: Db): { length: number; from: string | null; to: string | null } {
  const dates = db
    .prepare('SELECT local_date FROM daily_stats ORDER BY local_date ASC')
    .pluck()
    .all() as string[];

  let best = 0;
  let bestFrom: string | null = null;
  let bestTo: string | null = null;
  let run = 0;
  let runFrom: string | null = null;
  let previousTs = 0;

  for (const date of dates) {
    const ts = Date.parse(`${date}T00:00:00Z`);
    if (run > 0 && ts - previousTs === MS_PER_DAY) {
      run += 1;
    } else {
      run = 1;
      runFrom = date;
    }
    if (run > best) {
      best = run;
      bestFrom = runFrom;
      bestTo = date;
    }
    previousTs = ts;
  }

  return { length: best, from: bestFrom, to: bestTo };
}
