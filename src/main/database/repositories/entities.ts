import type { Db } from '../types';
import { TRACK_SUMMARY, ARTIST_SUMMARY, ALBUM_SUMMARY } from './projections';
import type {
  TrackSummary,
  ArtistSummary,
  AlbumSummary,
  TrackDetail,
  ArtistDetail,
  AlbumDetail,
  MonthlyPoint,
  YearlyPoint,
  Milestone,
  HourBucket,
  Insight,
  ComebackInfo,
  ObsessionItem,
  LostFavoriteDimensions,
} from '@shared/types/domain';
import { MILESTONE_PLAY_COUNTS, COMEBACK_MIN_GAP_DAYS, COMEBACK_MIN_PLAYS_AFTER, COMEBACK_WINDOW_AFTER_DAYS } from '@shared/constants/analytics';
import { MS_PER_DAY } from '@shared/utils/time';
import { notFound } from '../../utils/errors';
import { getNote } from './library';
import { obsessionForEntity } from './obsessions';
import { qualifyingMs } from './context';

/**
 * Detail pages.
 *
 * Every figure on a detail page is a count or a timestamp taken from the
 * archive. Where the app makes a claim in words ("82% of your lifetime plays
 * happened between 2018 and 2020"), the sentence is assembled from those same
 * numbers rather than generated — see `artistInsights` below.
 */

export function getTrack(db: Db, id: number): TrackSummary | null {
  return (db.prepare(`${TRACK_SUMMARY} WHERE t.id = ?`).get(id) as TrackSummary) ?? null;
}

export function getArtist(db: Db, id: number): ArtistSummary | null {
  return (db.prepare(`${ARTIST_SUMMARY} WHERE a.id = ?`).get(id) as ArtistSummary) ?? null;
}

export function getAlbum(db: Db, id: number): AlbumSummary | null {
  return (db.prepare(`${ALBUM_SUMMARY} WHERE al.id = ?`).get(id) as AlbumSummary) ?? null;
}

function monthlyForTrack(db: Db, trackId: number): MonthlyPoint[] {
  return db
    .prepare(
      `SELECT ym, plays, q_plays AS qualifyingPlays, ms_played AS msPlayed
       FROM monthly_track_stats WHERE track_id = ? ORDER BY ym ASC`,
    )
    .all(trackId) as MonthlyPoint[];
}

/**
 * Yearly totals, rolled up from the monthly derived tables.
 *
 * Aggregating the raw events instead would mean scanning every play by that
 * entity — hundreds of thousands of rows for a favourite artist in a large
 * archive. The monthly tables hold at most a few hundred rows per entity and
 * carry exactly the same totals.
 */
function yearlyForEntity(db: Db, kind: 'track' | 'artist', id: number): YearlyPoint[] {
  const table = kind === 'track' ? 'monthly_track_stats' : 'monthly_artist_stats';
  const column = kind === 'track' ? 'track_id' : 'artist_id';

  return db
    .prepare(
      `SELECT CAST(substr(ym, 1, 4) AS INTEGER) AS year,
              SUM(plays)     AS plays,
              SUM(q_plays)   AS qualifyingPlays,
              SUM(ms_played) AS msPlayed,
              0 AS tracks, 0 AS artists, 0 AS albums
       FROM ${table} WHERE ${column} = ? GROUP BY year ORDER BY year ASC`,
    )
    .all(id) as YearlyPoint[];
}

function hourlyForEntity(db: Db, column: 'track_id' | 'artist_id' | 'album_id', id: number): HourBucket[] {
  const rows = db
    .prepare(
      `SELECT hour, COUNT(*) AS plays, SUM(ms_played) AS msPlayed
       FROM playback_events WHERE ${column} = ? GROUP BY hour`,
    )
    .all(id) as HourBucket[];
  const out = Array.from({ length: 24 }, (_, hour) => ({ hour, plays: 0, msPlayed: 0 }));
  for (const row of rows) out[row.hour] = row;
  return out;
}

/**
 * A track's comeback: the longest silence that was followed by a real return,
 * not by a single stray play.
 */
function detectComeback(db: Db, trackId: number, gapDays: number, gapTo: number | null): ComebackInfo | null {
  if (gapTo === null || gapDays < COMEBACK_MIN_GAP_DAYS) return null;
  const windowEnd = gapTo + COMEBACK_WINDOW_AFTER_DAYS * MS_PER_DAY;
  const after = db
    .prepare(
      'SELECT COUNT(*) AS n FROM playback_events WHERE track_id = ? AND ts >= ? AND ts <= ? AND ms_played >= ?',
    )
    .get(trackId, gapTo, windowEnd, qualifyingMs(db)) as { n: number };
  if (after.n < COMEBACK_MIN_PLAYS_AFTER) return null;
  return {
    gapDays,
    gapFrom: gapTo - gapDays * MS_PER_DAY,
    gapTo,
    playsAfter: after.n,
  };
}

function trackMilestones(
  db: Db,
  trackId: number,
  stats: {
    first_ts: number | null;
    last_ts: number | null;
    peak_ym: string | null;
    peak_ym_plays: number;
    peak_year: number | null;
    longest_gap_days: number;
    longest_gap_from: number | null;
    longest_gap_to: number | null;
    q_plays: number;
  },
  comeback: ComebackInfo | null,
): Milestone[] {
  const milestones: Milestone[] = [];

  if (stats.first_ts !== null) {
    milestones.push({
      kind: 'first-heard',
      ts: stats.first_ts,
      labelKey: 'milestone.firstHeard',
      values: {},
    });
  }

  // Timestamps of the Nth qualifying play, for the thresholds actually reached.
  const targets = MILESTONE_PLAY_COUNTS.filter((n) => n > 1 && n <= stats.q_plays);
  if (targets.length > 0) {
    const timestamps = db
      .prepare(
        'SELECT ts FROM playback_events WHERE track_id = ? AND ms_played >= ? ORDER BY ts ASC',
      )
      .pluck()
      .all(trackId, qualifyingMs(db)) as number[];
    for (const n of targets) {
      const ts = timestamps[n - 1];
      if (ts === undefined) continue;
      milestones.push({
        kind: 'play-count',
        ts,
        labelKey: 'milestone.playCount',
        values: {
          count: n,
          days: stats.first_ts !== null ? Math.floor((ts - stats.first_ts) / MS_PER_DAY) : 0,
        },
      });
    }
  }

  if (stats.peak_ym) {
    const ts = Date.parse(`${stats.peak_ym}-01T00:00:00Z`);
    milestones.push({
      kind: 'peak-month',
      ts,
      labelKey: 'milestone.peakMonth',
      values: { ym: stats.peak_ym, plays: stats.peak_ym_plays },
    });
  }

  if (stats.longest_gap_days >= 90 && stats.longest_gap_from !== null) {
    milestones.push({
      kind: 'longest-absence',
      ts: stats.longest_gap_from,
      labelKey: 'milestone.longestAbsence',
      values: { days: stats.longest_gap_days },
    });
  }

  if (comeback) {
    milestones.push({
      kind: 'comeback',
      ts: comeback.gapTo,
      labelKey: 'milestone.comeback',
      values: { days: comeback.gapDays, plays: comeback.playsAfter },
    });
  }

  if (stats.last_ts !== null) {
    milestones.push({
      kind: 'last-heard',
      ts: stats.last_ts,
      labelKey: 'milestone.lastHeard',
      values: {},
    });
  }

  return milestones.sort((a, b) => a.ts - b.ts);
}

export function trackDetail(db: Db, id: number): TrackDetail {
  const track = getTrack(db, id);
  if (!track) throw notFound(`track:${id}`);

  const stats = db.prepare('SELECT * FROM track_stats WHERE track_id = ?').get(id) as
    | {
        short_plays: number;
        skips: number;
        peak_year: number | null;
        peak_ym: string | null;
        peak_ym_plays: number;
        longest_gap_days: number;
        longest_gap_from: number | null;
        longest_gap_to: number | null;
        distinct_days: number;
        active_months: number;
        lost_score: number;
        lost_dims: string | null;
        first_ts: number | null;
        last_ts: number | null;
        q_plays: number;
      }
    | undefined;

  const empty = {
    short_plays: 0,
    skips: 0,
    peak_year: null,
    peak_ym: null,
    peak_ym_plays: 0,
    longest_gap_days: 0,
    longest_gap_from: null,
    longest_gap_to: null,
    distinct_days: 0,
    active_months: 0,
    lost_score: 0,
    lost_dims: null,
    first_ts: null,
    last_ts: null,
    q_plays: 0,
  };
  const s = stats ?? empty;

  const comeback = detectComeback(db, id, s.longest_gap_days, s.longest_gap_to);

  const flags = (db.prepare('SELECT favorite, retired FROM track_flags WHERE track_id = ?').get(id) as
    | { favorite: number; retired: number }
    | undefined) ?? { favorite: 0, retired: 0 };

  const tags = db
    .prepare(
      `SELECT tg.id, tg.name, tg.slug, tg.icon, tg.color, tg.is_builtin AS isBuiltin
       FROM track_tags tt JOIN tags tg ON tg.id = tt.tag_id
       WHERE tt.track_id = ? ORDER BY tg.position ASC`,
    )
    .all(id) as { id: number; name: string; slug: string; icon: string; color: string; isBuiltin: number }[];

  return {
    track,
    shortPlays: s.short_plays,
    skips: s.skips,
    peakYear: s.peak_year,
    peakYm: s.peak_ym,
    peakYmPlays: s.peak_ym_plays,
    longestAbsenceDays: s.longest_gap_days,
    longestAbsenceFrom: s.longest_gap_from,
    longestAbsenceTo: s.longest_gap_to,
    distinctDays: s.distinct_days,
    activeMonths: s.active_months,
    lostFavoriteScore: s.lost_score > 0 ? s.lost_score : null,
    monthly: monthlyForTrack(db, id),
    yearly: yearlyForEntity(db, 'track', id),
    milestones: trackMilestones(db, id, s, comeback),
    hourly: hourlyForEntity(db, 'track_id', id),
    tags: tags.map((t) => ({ ...t, isBuiltin: t.isBuiltin === 1 })),
    note: getNote(db, 'track', id),
    flags: { favorite: flags.favorite === 1, retired: flags.retired === 1 },
    comeback,
    obsession: obsessionForEntity(db, 'track', id),
  };
}

/** Parsed Lost Favorite dimensions, when the track qualified. */
export function trackDimensions(db: Db, id: number): LostFavoriteDimensions | null {
  const row = db.prepare('SELECT lost_dims FROM track_stats WHERE track_id = ?').get(id) as
    | { lost_dims: string | null }
    | undefined;
  if (!row?.lost_dims) return null;
  try {
    return JSON.parse(row.lost_dims) as LostFavoriteDimensions;
  } catch {
    return null;
  }
}

/**
 * Deterministic artist insights.
 *
 * Each sentence is a template plus real numbers. Nothing is inferred about taste
 * or mood — the app only reports what the archive contains.
 */
function artistInsights(
  db: Db,
  artistId: number,
  stats: { q_plays: number; longest_gap_days: number; longest_gap_to: number | null; first_ts: number | null },
): Insight[] {
  const insights: Insight[] = [];

  if (stats.longest_gap_days >= 180 && stats.longest_gap_to !== null) {
    const after = db
      .prepare('SELECT COUNT(*) AS n FROM playback_events WHERE artist_id = ? AND ts >= ?')
      .get(artistId, stats.longest_gap_to) as { n: number };
    if (after.n >= 5) {
      insights.push({
        key: 'insight.artistReturn',
        values: { days: stats.longest_gap_days, plays: after.n },
        tone: 'warm',
      });
    } else {
      insights.push({
        key: 'insight.artistGap',
        values: { days: stats.longest_gap_days },
        tone: 'cool',
      });
    }
  }

  // The tightest span of years holding the majority of all listening. Rolled up
  // from the monthly table rather than scanning every play by this artist.
  const years = db
    .prepare(
      `SELECT CAST(substr(ym, 1, 4) AS INTEGER) AS year, SUM(plays) AS n
       FROM monthly_artist_stats WHERE artist_id = ? GROUP BY year ORDER BY year ASC`,
    )
    .all(artistId) as { year: number; n: number }[];
  if (years.length >= 2) {
    const total = years.reduce((sum, y) => sum + y.n, 0);
    let best = { from: years[0].year, to: years[0].year, share: 0, span: Infinity };
    for (let i = 0; i < years.length; i++) {
      let running = 0;
      for (let j = i; j < years.length; j++) {
        running += years[j].n;
        const share = running / total;
        const span = j - i + 1;
        if (share >= 0.7 && (span < best.span || (span === best.span && share > best.share))) {
          best = { from: years[i].year, to: years[j].year, share, span };
        }
      }
    }
    if (best.span <= Math.max(2, Math.ceil(years.length / 2)) && best.share > 0) {
      insights.push({
        key: best.from === best.to ? 'insight.concentratedYear' : 'insight.concentratedYears',
        values: {
          percent: Math.round(best.share * 100),
          from: best.from,
          to: best.to,
          year: best.from,
        },
      });
    }
  }

  // Precomputed during the analytics pass; see migration 003.
  const nightShare = db
    .prepare('SELECT night_plays AS night, plays AS total FROM artist_stats WHERE artist_id = ?')
    .get(artistId) as { night: number; total: number };
  if (nightShare.total >= 40 && nightShare.night / nightShare.total >= 0.4) {
    insights.push({
      key: 'insight.nightArtist',
      values: { percent: Math.round((nightShare.night / nightShare.total) * 100) },
    });
  }

  // Per-track totals already exist in track_stats; there is no need to count
  // the events again.
  const topTrackShare = db
    .prepare(
      `SELECT MAX(ts.plays) AS top, SUM(ts.plays) AS total
       FROM track_stats ts JOIN tracks t ON t.id = ts.track_id
       WHERE t.artist_id = ?`,
    )
    .get(artistId) as { top: number | null; total: number | null };
  if (topTrackShare.top && topTrackShare.total && topTrackShare.top / topTrackShare.total >= 0.3) {
    insights.push({
      key: 'insight.oneTrackDominant',
      values: { percent: Math.round((topTrackShare.top / topTrackShare.total) * 100) },
    });
  }

  return insights;
}

export function artistDetail(db: Db, id: number): ArtistDetail {
  const artist = getArtist(db, id);
  if (!artist) throw notFound(`artist:${id}`);

  const s = (db.prepare('SELECT * FROM artist_stats WHERE artist_id = ?').get(id) as
    | {
        plays: number;
        q_plays: number;
        short_plays: number;
        skips: number;
        album_count: number;
        peak_year: number | null;
        peak_ym: string | null;
        longest_gap_days: number;
        longest_gap_from: number | null;
        longest_gap_to: number | null;
        first_ts: number | null;
      }
    | undefined) ?? {
    plays: 0,
    q_plays: 0,
    short_plays: 0,
    skips: 0,
    album_count: 0,
    peak_year: null,
    peak_ym: null,
    longest_gap_days: 0,
    longest_gap_from: null,
    longest_gap_to: null,
    first_ts: null,
  };

  const topTracks = db
    .prepare(`${TRACK_SUMMARY} WHERE t.artist_id = ? ORDER BY ts.q_plays DESC, ts.ms_played DESC LIMIT 12`)
    .all(id) as TrackSummary[];

  const topAlbums = db
    .prepare(`${ALBUM_SUMMARY} WHERE al.artist_id = ? ORDER BY s.ms_played DESC LIMIT 8`)
    .all(id) as AlbumSummary[];

  const monthly = db
    .prepare(
      `SELECT ym, plays, q_plays AS qualifyingPlays, ms_played AS msPlayed
       FROM monthly_artist_stats WHERE artist_id = ? ORDER BY ym ASC`,
    )
    .all(id) as MonthlyPoint[];

  return {
    artist,
    events: s.plays,
    shortPlays: s.short_plays,
    skips: s.skips,
    albumCount: s.album_count,
    topTrack: topTracks[0] ?? null,
    topAlbum: topAlbums[0] ?? null,
    peakYear: s.peak_year,
    peakYm: s.peak_ym,
    longestAbsenceDays: s.longest_gap_days,
    longestAbsenceFrom: s.longest_gap_from,
    longestAbsenceTo: s.longest_gap_to,
    monthly,
    yearly: yearlyForEntity(db, 'artist', id),
    topTracks,
    topAlbums,
    insights: artistInsights(db, id, s),
    note: getNote(db, 'artist', id),
  };
}

export function albumDetail(db: Db, id: number): AlbumDetail {
  const album = getAlbum(db, id);
  if (!album) throw notFound(`album:${id}`);

  const s = (db.prepare('SELECT * FROM album_stats WHERE album_id = ?').get(id) as
    | { peak_year: number | null; peak_ym: string | null; breadth: number; top3_share: number }
    | undefined) ?? { peak_year: null, peak_ym: null, breadth: 0, top3_share: 0 };

  const topTracks = db
    .prepare(
      `${TRACK_SUMMARY}
       JOIN (
         SELECT track_id, COUNT(*) AS n, SUM(ms_played) AS ms
         FROM playback_events WHERE album_id = @albumId GROUP BY track_id
       ) e ON e.track_id = t.id
       ORDER BY e.n DESC LIMIT 25`,
    )
    .all({ albumId: id }) as TrackSummary[];

  const monthly = db
    .prepare(
      `SELECT ym,
              COUNT(*) AS plays,
              SUM(CASE WHEN ms_played >= @minMs THEN 1 ELSE 0 END) AS qualifyingPlays,
              SUM(ms_played) AS msPlayed
       FROM playback_events WHERE album_id = @id GROUP BY ym ORDER BY ym ASC`,
    )
    .all({ id, minMs: qualifyingMs(db) }) as MonthlyPoint[];

  return {
    album,
    tracksHeard: topTracks.length,
    topTracks,
    peakYm: s.peak_ym,
    peakYear: s.peak_year,
    monthly,
    breadth: s.breadth,
    concentrationTop3: s.top3_share,
    note: getNote(db, 'album', id),
  };
}

/** Obsession row for a specific entity, if one was detected. */
export type { ObsessionItem };
