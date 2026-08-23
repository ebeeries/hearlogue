import type { Db } from '../types';
import type { DayDetail, DailyPoint, HourBucket, ListeningSession, SessionDetail } from '@shared/types/domain';
import { qualifyingMs } from './context';
import { notFound } from '../../utils/errors';

/**
 * Calendar heatmap, day detail, and listening sessions.
 */

export type HeatmapMetric = 'msPlayed' | 'plays' | 'uniqueTracks';

export interface HeatmapResult {
  days: { date: string; value: number; plays: number; msPlayed: number }[];
  from: string | null;
  to: string | null;
  max: number;
  metric: HeatmapMetric;
  totalDays: number;
}

const METRIC_COLUMN: Record<HeatmapMetric, string> = {
  msPlayed: 'ms_played',
  plays: 'plays',
  uniqueTracks: 'unique_tracks',
};

export function heatmap(
  db: Db,
  from: string | null,
  to: string | null,
  metric: HeatmapMetric,
): HeatmapResult {
  const bounds = db
    .prepare('SELECT MIN(local_date) AS lo, MAX(local_date) AS hi FROM daily_stats')
    .get() as { lo: string | null; hi: string | null };

  const start = from ?? bounds.lo;
  const end = to ?? bounds.hi;
  if (!start || !end) {
    return { days: [], from: null, to: null, max: 0, metric, totalDays: 0 };
  }

  const rows = db
    .prepare(
      `SELECT local_date AS date, ${METRIC_COLUMN[metric]} AS value, plays, ms_played AS msPlayed
       FROM daily_stats WHERE local_date >= @start AND local_date <= @end
       ORDER BY local_date ASC`,
    )
    .all({ start, end }) as HeatmapResult['days'];

  let max = 0;
  for (const row of rows) if (row.value > max) max = row.value;

  return { days: rows, from: start, to: end, max, metric, totalDays: rows.length };
}

export function dailyPoints(db: Db, from: string, to: string): DailyPoint[] {
  return db
    .prepare(
      `SELECT local_date AS date, plays, q_plays AS qualifyingPlays,
              ms_played AS msPlayed, unique_tracks AS uniqueTracks
       FROM daily_stats WHERE local_date >= ? AND local_date <= ? ORDER BY local_date ASC`,
    )
    .all(from, to) as DailyPoint[];
}

const SESSION_SELECT = `
  SELECT
    s.id                    AS id,
    s.start_ts              AS startTs,
    s.end_ts                AS endTs,
    s.duration_ms           AS durationMs,
    s.ms_played             AS msPlayed,
    s.events                AS events,
    s.q_plays               AS qualifyingPlays,
    s.unique_tracks         AS uniqueTracks,
    s.unique_artists        AS uniqueArtists,
    s.top_artist_id         AS topArtistId,
    ar.name                 AS topArtist,
    s.top_track_id          AS topTrackId,
    t.name                  AS topTrack,
    s.max_repeats           AS maxTrackRepeats,
    s.diversity             AS diversity
  FROM sessions s
  LEFT JOIN artists ar ON ar.id = s.top_artist_id
  LEFT JOIN tracks t ON t.id = s.top_track_id
`;

export function dayDetail(db: Db, date: string): DayDetail {
  const stats = db.prepare('SELECT * FROM daily_stats WHERE local_date = ?').get(date) as
    | {
        local_date: string;
        plays: number;
        q_plays: number;
        ms_played: number;
        unique_tracks: number;
        unique_artists: number;
        first_ts: number | null;
        last_ts: number | null;
      }
    | undefined;
  if (!stats) throw notFound(`day:${date}`);

  const hourRows = db
    .prepare(
      `SELECT hour, COUNT(*) AS plays, SUM(ms_played) AS msPlayed
       FROM playback_events WHERE local_date = ? GROUP BY hour`,
    )
    .all(date) as HourBucket[];
  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, plays: 0, msPlayed: 0 }));
  for (const row of hourRows) hourly[row.hour] = row;

  const topArtist = db
    .prepare(
      `SELECT a.id, a.name, COUNT(*) AS plays
       FROM playback_events e JOIN artists a ON a.id = e.artist_id
       WHERE e.local_date = ? GROUP BY a.id ORDER BY plays DESC LIMIT 1`,
    )
    .get(date) as DayDetail['topArtist'];

  const topTracks = db
    .prepare(
      `SELECT t.id, t.name, ar.name AS artist, COUNT(*) AS plays, SUM(e.ms_played) AS msPlayed
       FROM playback_events e
       JOIN tracks t ON t.id = e.track_id
       JOIN artists ar ON ar.id = t.artist_id
       WHERE e.local_date = ? GROUP BY t.id ORDER BY plays DESC, msPlayed DESC LIMIT 20`,
    )
    .all(date) as DayDetail['topTracks'];

  const sessions = db
    .prepare(`${SESSION_SELECT} WHERE s.local_date = ? ORDER BY s.start_ts ASC`)
    .all(date) as ListeningSession[];

  return {
    date,
    msPlayed: stats.ms_played,
    events: stats.plays,
    qualifyingPlays: stats.q_plays,
    uniqueTracks: stats.unique_tracks,
    uniqueArtists: stats.unique_artists,
    firstTs: stats.first_ts,
    lastTs: stats.last_ts,
    topArtist: topArtist ?? null,
    topTrack: topTracks[0]
      ? {
          id: topTracks[0].id,
          name: topTracks[0].name,
          artist: topTracks[0].artist,
          plays: topTracks[0].plays,
        }
      : null,
    hourly,
    topTracks,
    sessions,
  };
}

export type SessionSort = 'recent' | 'longest' | 'mostDiverse' | 'mostRepetitive' | 'mostTracks';

const SESSION_ORDER: Record<SessionSort, string> = {
  recent: 's.start_ts DESC',
  longest: 's.ms_played DESC',
  mostDiverse: 's.diversity DESC, s.unique_artists DESC',
  mostRepetitive: 's.max_repeats DESC, s.events DESC',
  mostTracks: 's.events DESC',
};

export function listSessions(
  db: Db,
  sort: SessionSort,
  offset: number,
  limit: number,
): { items: ListeningSession[]; total: number; offset: number; limit: number } {
  // Sorting by "most diverse" or "most repetitive" is meaningless for a
  // two-track session, so those views require a session with some substance.
  const minEvents = sort === 'mostDiverse' || sort === 'mostRepetitive' ? 6 : 2;

  const items = db
    .prepare(
      `${SESSION_SELECT} WHERE s.events >= @minEvents
       ORDER BY ${SESSION_ORDER[sort]} LIMIT @limit OFFSET @offset`,
    )
    .all({ limit, offset, minEvents }) as ListeningSession[];

  const total = (
    db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE events >= ?').get(minEvents) as {
      n: number;
    }
  ).n;

  return { items, total, offset, limit };
}

export function sessionDetail(db: Db, id: number): SessionDetail {
  const session = db.prepare(`${SESSION_SELECT} WHERE s.id = ?`).get(id) as
    | ListeningSession
    | undefined;
  if (!session) throw notFound(`session:${id}`);

  const events = db
    .prepare(
      `SELECT e.ts, e.track_id AS trackId, t.name AS track, e.artist_id AS artistId,
              ar.name AS artist, e.ms_played AS msPlayed,
              CASE WHEN e.skipped = 1 OR (e.ms_played < 20000 AND e.reason_end IN ('fwdbtn','backbtn'))
                   THEN 1 ELSE 0 END AS skippedRaw
       FROM playback_events e
       JOIN tracks t ON t.id = e.track_id
       JOIN artists ar ON ar.id = e.artist_id
       WHERE e.ts >= ? AND e.ts <= ?
       ORDER BY e.ts ASC`,
    )
    .all(session.startTs, session.endTs) as (SessionDetail['events_list'][number] & {
    skippedRaw: number;
  })[];

  return {
    ...session,
    events_list: events.map(({ skippedRaw, ...rest }) => ({ ...rest, skipped: skippedRaw === 1 })),
  };
}

export interface SessionStats {
  total: number;
  averageEvents: number;
  averageMs: number;
  longest: ListeningSession | null;
  mostDiverse: ListeningSession | null;
  mostRepetitive: ListeningSession | null;
}

export function sessionStats(db: Db): SessionStats {
  const summary = db
    .prepare(
      'SELECT COUNT(*) AS total, AVG(events) AS avgEvents, AVG(ms_played) AS avgMs FROM sessions',
    )
    .get() as { total: number; avgEvents: number | null; avgMs: number | null };

  const one = (order: string, minEvents = 2): ListeningSession | null =>
    (db
      .prepare(`${SESSION_SELECT} WHERE s.events >= ${minEvents} ORDER BY ${order} LIMIT 1`)
      .get() as ListeningSession) ?? null;

  return {
    total: summary.total,
    averageEvents: summary.avgEvents ?? 0,
    averageMs: summary.avgMs ?? 0,
    longest: one('s.ms_played DESC'),
    mostDiverse: one('s.diversity DESC, s.unique_artists DESC', 6),
    mostRepetitive: one('s.max_repeats DESC, s.events DESC', 6),
  };
}

/** Days with any listening, used to bound the calendar UI. */
export function calendarBounds(db: Db): { from: string | null; to: string | null } {
  const row = db
    .prepare('SELECT MIN(local_date) AS lo, MAX(local_date) AS hi FROM daily_stats')
    .get() as { lo: string | null; hi: string | null };
  return { from: row.lo, to: row.hi };
}

export { qualifyingMs };
