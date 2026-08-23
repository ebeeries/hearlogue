import type { Db } from '../types';
import { TRACK_SUMMARY } from './projections';
import { topTracks, topArtists, topAlbums } from './archive';
import { obsessionInYear } from './obsessions';
import { qualifyingMs } from './context';
import type {
  RewindYear,
  RewindMonth,
  MonthlyPoint,
  DailyPoint,
  HourBucket,
  TrackSummary,
} from '@shared/types/domain';
import { MS_PER_DAY } from '@shared/utils/time';
import { notFound } from '../../utils/errors';

/**
 * Rewind — revisiting a year or a month as it was lived.
 *
 * The year view leans on two things the app knows and a listener does not: what
 * was heard for the first time that year, and what was loved that year and never
 * heard again.
 */

export function availableYears(db: Db): number[] {
  return db.prepare('SELECT year FROM yearly_stats ORDER BY year ASC').pluck().all() as number[];
}

export function availableMonths(db: Db): string[] {
  return db
    .prepare('SELECT DISTINCT ym FROM monthly_artist_stats ORDER BY ym ASC')
    .pluck()
    .all() as string[];
}

function hourlyForRange(db: Db, from: number, to: number): HourBucket[] {
  const rows = db
    .prepare(
      `SELECT hour, COUNT(*) AS plays, SUM(ms_played) AS msPlayed
       FROM playback_events WHERE ts >= ? AND ts <= ? GROUP BY hour`,
    )
    .all(from, to) as HourBucket[];
  const out = Array.from({ length: 24 }, (_, hour) => ({ hour, plays: 0, msPlayed: 0 }));
  for (const row of rows) out[row.hour] = row;
  return out;
}

export function rewindYear(db: Db, year: number, now: number): RewindYear {
  const stats = db.prepare('SELECT * FROM yearly_stats WHERE year = ?').get(year) as
    | {
        year: number;
        plays: number;
        q_plays: number;
        ms_played: number;
        tracks: number;
        artists: number;
        albums: number;
      }
    | undefined;
  if (!stats) throw notFound(`year:${year}`);

  const from = new Date(year, 0, 1).getTime();
  const to = new Date(year + 1, 0, 1).getTime() - 1;

  const monthly = db
    .prepare(
      `SELECT ym,
              SUM(plays) AS plays,
              SUM(q_plays) AS qualifyingPlays,
              SUM(ms_played) AS msPlayed
       FROM monthly_artist_stats WHERE ym LIKE @like GROUP BY ym ORDER BY ym ASC`,
    )
    .all({ like: `${year}-%` }) as MonthlyPoint[];

  const mostActiveMonth =
    monthly.length > 0
      ? monthly.reduce((best, point) => (point.msPlayed > best.msPlayed ? point : best))
      : null;

  const mostActiveDay = db
    .prepare(
      `SELECT local_date AS date, plays, ms_played AS msPlayed
       FROM daily_stats WHERE local_date LIKE ? ORDER BY ms_played DESC LIMIT 1`,
    )
    .get(`${year}-%`) as { date: string; plays: number; msPlayed: number } | undefined;

  // Artists and tracks whose very first play landed in this year.
  const firstHeardArtists = db
    .prepare(
      `SELECT a.id, a.name, s.first_ts AS ts, s.q_plays AS plays
       FROM artist_stats s JOIN artists a ON a.id = s.artist_id
       WHERE s.first_ts >= @from AND s.first_ts <= @to
       ORDER BY s.q_plays DESC LIMIT 12`,
    )
    .all({ from, to }) as { id: number; name: string; ts: number; plays: number }[];

  const firstHeardTracks = db
    .prepare(
      `SELECT t.id, t.name, ar.name AS artist, s.first_ts AS ts, s.q_plays AS plays
       FROM track_stats s
       JOIN tracks t ON t.id = s.track_id
       JOIN artists ar ON ar.id = t.artist_id
       WHERE s.first_ts >= @from AND s.first_ts <= @to
       ORDER BY s.q_plays DESC LIMIT 12`,
    )
    .all({ from, to }) as { id: number; name: string; artist: string; ts: number; plays: number }[];

  /**
   * Tracks that were significant in this year and were never heard again — the
   * emotional core of Rewind. "Significant" means a real number of plays inside
   * the year, and "never again" means the last play in the archive falls inside
   * it too.
   */
  const vanished = db
    .prepare(
      `${TRACK_SUMMARY}
       JOIN (
         SELECT track_id, SUM(q_plays) AS yq
         FROM monthly_track_stats WHERE ym LIKE @like GROUP BY track_id
       ) y ON y.track_id = t.id
       WHERE y.yq >= 10 AND ts.last_ts <= @to AND ts.last_ts >= @from
         AND @now - ts.last_ts >= @dormant
       ORDER BY y.yq DESC LIMIT 12`,
    )
    .all({ like: `${year}-%`, from, to, now, dormant: 365 * MS_PER_DAY }) as TrackSummary[];

  const hourly = hourlyForRange(db, from, to);
  const totalPlays = hourly.reduce((sum, h) => sum + h.plays, 0);
  const lateNight = hourly
    .filter((h) => h.hour >= 22 || h.hour < 5)
    .reduce((sum, h) => sum + h.plays, 0);

  const previousStats = db.prepare('SELECT * FROM yearly_stats WHERE year = ?').get(year - 1) as
    | { year: number; plays: number; ms_played: number }
    | undefined;

  return {
    year,
    streams: stats.plays,
    qualifyingPlays: stats.q_plays,
    msPlayed: stats.ms_played,
    tracks: stats.tracks,
    artists: stats.artists,
    albums: stats.albums,
    topTracks: topTracks(db, 12, 0, year),
    topArtists: topArtists(db, 12, 0, year),
    topAlbums: topAlbums(db, 8, 0, year),
    firstHeardArtists,
    firstHeardTracks,
    biggestObsession: obsessionInYear(db, year),
    mostActiveMonth: mostActiveMonth
      ? { ym: mostActiveMonth.ym, plays: mostActiveMonth.plays, msPlayed: mostActiveMonth.msPlayed }
      : null,
    mostActiveDay: mostActiveDay ?? null,
    lateNightShare: totalPlays > 0 ? lateNight / totalPlays : 0,
    hourly,
    monthly,
    vanished,
    previous: previousStats
      ? { year: previousStats.year, streams: previousStats.plays, msPlayed: previousStats.ms_played }
      : null,
  };
}

export function rewindMonth(db: Db, ym: string): RewindMonth {
  const minMs = qualifyingMs(db);
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS streams,
              SUM(CASE WHEN ms_played >= @minMs THEN 1 ELSE 0 END) AS qualifyingPlays,
              SUM(ms_played) AS msPlayed,
              COUNT(DISTINCT track_id) AS tracks,
              COUNT(DISTINCT artist_id) AS artists
       FROM playback_events WHERE ym = @ym`,
    )
    .get({ ym, minMs }) as {
    streams: number;
    qualifyingPlays: number | null;
    msPlayed: number | null;
    tracks: number;
    artists: number;
  };

  if (totals.streams === 0) throw notFound(`month:${ym}`);

  const monthTop = db
    .prepare(
      `${TRACK_SUMMARY}
       JOIN monthly_track_stats m ON m.track_id = t.id AND m.ym = @ym
       ORDER BY m.q_plays DESC, m.ms_played DESC LIMIT 12`,
    )
    .all({ ym }) as TrackSummary[];

  const monthArtists = db
    .prepare(
      `SELECT a.id, a.name, a.uri,
              m.plays AS plays, m.q_plays AS qualifyingPlays, m.ms_played AS msPlayed,
              COALESCE(s.track_count, 0) AS trackCount, s.first_ts AS firstTs, s.last_ts AS lastTs
       FROM monthly_artist_stats m
       JOIN artists a ON a.id = m.artist_id
       LEFT JOIN artist_stats s ON s.artist_id = a.id
       WHERE m.ym = @ym ORDER BY m.ms_played DESC LIMIT 12`,
    )
    .all({ ym }) as RewindMonth['topArtists'];

  const daily = db
    .prepare(
      `SELECT local_date AS date, plays, q_plays AS qualifyingPlays,
              ms_played AS msPlayed, unique_tracks AS uniqueTracks
       FROM daily_stats WHERE local_date LIKE @like ORDER BY local_date ASC`,
    )
    .all({ like: `${ym}-%` }) as DailyPoint[];

  const monthStart = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1).getTime();
  const monthEnd = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 1).getTime() - 1;

  const newArtists = db
    .prepare(
      `SELECT a.id, a.name, s.q_plays AS plays
       FROM artist_stats s JOIN artists a ON a.id = s.artist_id
       WHERE s.first_ts >= @from AND s.first_ts <= @to
       ORDER BY s.q_plays DESC LIMIT 10`,
    )
    .all({ from: monthStart, to: monthEnd }) as { id: number; name: string; plays: number }[];

  return {
    ym,
    streams: totals.streams,
    qualifyingPlays: totals.qualifyingPlays ?? 0,
    msPlayed: totals.msPlayed ?? 0,
    tracks: totals.tracks,
    artists: totals.artists,
    topTracks: monthTop,
    topArtists: monthArtists,
    daily,
    newArtists,
  };
}

/** A month chosen at random from the months that actually contain listening. */
export function randomMonth(db: Db, seed: number): string | null {
  const months = availableMonths(db).filter((ym) => {
    const row = db
      .prepare('SELECT SUM(q_plays) AS n FROM monthly_artist_stats WHERE ym = ?')
      .get(ym) as { n: number | null };
    return (row.n ?? 0) >= 20;
  });
  if (months.length === 0) return null;
  return months[Math.abs(seed) % months.length];
}
