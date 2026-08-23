import type { Db } from '../database/types';
import { cosineSimilarity, accumulateVector } from './scoring';
import {
  ERA_MIN_MONTHS,
  ERA_WINDOW_MONTHS,
  ERA_CHANGE_THRESHOLD,
  ERA_MERGE_SIMILARITY,
  ERA_MIN_MONTH_PLAYS,
  ERA_VECTOR_TOP_ARTISTS,
} from '@shared/constants/analytics';
import { monthRange, startOfMonthTs, endOfMonthTs, monthSpan } from '@shared/utils/time';

/**
 * Era segmentation.
 *
 * A listening life does not change month to month; it changes in stretches. The
 * algorithm represents each month as the distribution of listening time across
 * artists, then looks for the points where that distribution genuinely shifts
 * and stays shifted.
 *
 * Why this shape:
 *  - Months are compared by *direction* (cosine similarity), not magnitude, so a
 *    quiet month and a heavy month spent on the same artists count as the same
 *    era rather than as a change.
 *  - Boundaries are scored against a window of months on either side, not against
 *    the single adjacent month. One unusual week does not start an era.
 *  - Short segments are folded back into whichever neighbour they resemble more,
 *    unless the shift into them was unusually strong.
 *  - Adjacent segments that end up similar anyway are merged.
 *
 * No genre labels are invented, because the export contains no genre data. Eras
 * are named after who was actually being listened to.
 */

interface MonthVector {
  ym: string;
  plays: number;
  msPlayed: number;
  vector: Map<number, number>;
}

interface Segment {
  startIndex: number;
  endIndex: number;
  changeStrength: number;
}

const ACCENTS = ['brass', 'sage', 'haze', 'clay', 'plum'] as const;

function loadMonthVectors(db: Db): MonthVector[] {
  const rows = db
    .prepare(
      `SELECT ym, artist_id, q_plays, ms_played
       FROM monthly_artist_stats
       ORDER BY ym ASC, ms_played DESC`,
    )
    .all() as { ym: string; artist_id: number; q_plays: number; ms_played: number }[];

  const byMonth = new Map<string, MonthVector>();
  const seenPerMonth = new Map<string, number>();

  for (const row of rows) {
    let entry = byMonth.get(row.ym);
    if (!entry) {
      entry = { ym: row.ym, plays: 0, msPlayed: 0, vector: new Map() };
      byMonth.set(row.ym, entry);
      seenPerMonth.set(row.ym, 0);
    }
    entry.plays += row.q_plays;
    entry.msPlayed += row.ms_played;

    // Only the strongest artists shape a month's identity; the long tail is noise.
    const seen = seenPerMonth.get(row.ym) ?? 0;
    if (seen < ERA_VECTOR_TOP_ARTISTS && row.ms_played > 0) {
      // Square-root weighting keeps one enormous month from swamping direction.
      entry.vector.set(row.artist_id, Math.sqrt(row.ms_played));
      seenPerMonth.set(row.ym, seen + 1);
    }
  }

  const months = [...byMonth.keys()].sort();
  if (months.length === 0) return [];

  // Fill calendar gaps so a silent stretch reads as a gap, not as continuity.
  const full = monthRange(months[0], months[months.length - 1]);
  return full.map(
    (ym) => byMonth.get(ym) ?? { ym, plays: 0, msPlayed: 0, vector: new Map<number, number>() },
  );
}

function windowVector(months: MonthVector[], from: number, to: number): Map<number, number> {
  const acc = new Map<number, number>();
  for (let i = Math.max(0, from); i < Math.min(months.length, to); i++) {
    accumulateVector(acc, months[i].vector);
  }
  return acc;
}

/**
 * Distance at each potential boundary: 1 minus the similarity between the window
 * of months before it and the window after it.
 */
function boundaryDistances(months: MonthVector[]): number[] {
  const distances = new Array<number>(months.length).fill(0);
  for (let i = 1; i < months.length; i++) {
    const before = windowVector(months, i - ERA_WINDOW_MONTHS, i);
    const after = windowVector(months, i, i + ERA_WINDOW_MONTHS);
    if (before.size === 0 || after.size === 0) {
      // A boundary against silence is a real boundary, but a weak one.
      distances[i] = before.size === after.size ? 0 : 0.5;
      continue;
    }
    distances[i] = 1 - cosineSimilarity(before, after);
  }
  return distances;
}

function detectChangePoints(months: MonthVector[], distances: number[]): number[] {
  const points: number[] = [];
  for (let i = 1; i < months.length; i++) {
    const d = distances[i];
    if (d < ERA_CHANGE_THRESHOLD) continue;
    // Keep only local maxima so one shift produces one boundary, not three.
    const prev = i > 1 ? distances[i - 1] : 0;
    const next = i + 1 < distances.length ? distances[i + 1] : 0;
    if (d >= prev && d >= next) points.push(i);
  }
  return points;
}

function buildSegments(months: MonthVector[], changePoints: number[], distances: number[]): Segment[] {
  const segments: Segment[] = [];
  let start = 0;
  for (const point of changePoints) {
    if (point <= start) continue;
    segments.push({ startIndex: start, endIndex: point - 1, changeStrength: distances[start] ?? 0 });
    start = point;
  }
  segments.push({
    startIndex: start,
    endIndex: months.length - 1,
    changeStrength: distances[start] ?? 0,
  });
  return segments;
}

function segmentVector(months: MonthVector[], segment: Segment): Map<number, number> {
  return windowVector(months, segment.startIndex, segment.endIndex + 1);
}

function segmentPlays(months: MonthVector[], segment: Segment): number {
  let total = 0;
  for (let i = segment.startIndex; i <= segment.endIndex; i++) total += months[i].plays;
  return total;
}

/** Folds segments that are too short into the neighbour they most resemble. */
function mergeShortSegments(months: MonthVector[], segments: Segment[]): Segment[] {
  if (segments.length <= 1) return segments;
  const result = [...segments];

  let changed = true;
  while (changed && result.length > 1) {
    changed = false;
    for (let i = 0; i < result.length; i++) {
      const segment = result[i];
      const length = segment.endIndex - segment.startIndex + 1;
      // A very strong shift earns the right to be brief.
      if (length >= ERA_MIN_MONTHS || segment.changeStrength >= 0.68) continue;

      const vector = segmentVector(months, segment);
      const prev = i > 0 ? result[i - 1] : null;
      const next = i < result.length - 1 ? result[i + 1] : null;
      if (!prev && !next) break;

      const prevScore = prev ? cosineSimilarity(vector, segmentVector(months, prev)) : -1;
      const nextScore = next ? cosineSimilarity(vector, segmentVector(months, next)) : -1;

      if (prev && prevScore >= nextScore) {
        prev.endIndex = segment.endIndex;
        result.splice(i, 1);
      } else if (next) {
        next.startIndex = segment.startIndex;
        next.changeStrength = Math.max(next.changeStrength, segment.changeStrength);
        result.splice(i, 1);
      } else if (prev) {
        prev.endIndex = segment.endIndex;
        result.splice(i, 1);
      }
      changed = true;
      break;
    }
  }

  return result;
}

/** Merges neighbouring segments that turned out to be the same era after all. */
function mergeSimilarNeighbours(months: MonthVector[], segments: Segment[]): Segment[] {
  const result = [...segments];
  let changed = true;
  while (changed && result.length > 1) {
    changed = false;
    for (let i = 0; i < result.length - 1; i++) {
      const a = segmentVector(months, result[i]);
      const b = segmentVector(months, result[i + 1]);
      if (a.size === 0 || b.size === 0) continue;
      if (cosineSimilarity(a, b) >= ERA_MERGE_SIMILARITY) {
        result[i].endIndex = result[i + 1].endIndex;
        result.splice(i + 1, 1);
        changed = true;
        break;
      }
    }
  }
  return result;
}

/** Trims leading and trailing months that carry essentially no listening. */
function trimQuietEdges(months: MonthVector[], segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const segment of segments) {
    let { startIndex, endIndex } = segment;
    while (startIndex <= endIndex && months[startIndex].plays < ERA_MIN_MONTH_PLAYS) startIndex += 1;
    while (endIndex >= startIndex && months[endIndex].plays < ERA_MIN_MONTH_PLAYS) endIndex -= 1;
    if (startIndex > endIndex) continue;
    out.push({ ...segment, startIndex, endIndex });
  }
  return out;
}

/**
 * Artist names carry their own articles ("The Harbour Lights"), which would
 * otherwise produce "The The Harbour Lights Years".
 */
function titleName(name: string): string {
  return name.replace(/^(the|a|an)\s+/i, '').trim() || name;
}

export function eraTitle(
  topArtists: { name: string; msPlayed: number }[],
  totalMs: number,
  months: number,
  startYm: string,
  endYm: string,
): string {
  const suffix = months <= 5 ? 'Period' : months <= 17 ? 'Era' : 'Years';
  const first = topArtists[0];
  const second = topArtists[1];

  if (first && totalMs > 0) {
    const firstShare = first.msPlayed / totalMs;
    const secondShare = second ? second.msPlayed / totalMs : 0;
    if (firstShare >= 0.24) {
      if (second && secondShare >= 0.13 && secondShare / firstShare >= 0.55) {
        return `The ${titleName(first.name)} / ${titleName(second.name)} ${suffix}`;
      }
      return `The ${titleName(first.name)} ${suffix}`;
    }
    if (second && firstShare + secondShare >= 0.3) {
      return `The ${titleName(first.name)} / ${titleName(second.name)} ${suffix}`;
    }
  }

  const startYear = startYm.slice(0, 4);
  const endYear = endYm.slice(0, 4);
  return startYear === endYear
    ? `The ${startYear} Stretch`
    : `The ${startYear}–${endYear} Stretch`;
}

export interface EraBuildResult {
  count: number;
  reason: 'ok' | 'not-enough-months' | 'no-data';
}

export function buildEras(db: Db): EraBuildResult {
  const months = loadMonthVectors(db);

  const run = db.transaction((segments: Segment[], source: MonthVector[]) => {
    db.exec('DELETE FROM era_artists; DELETE FROM era_tracks; DELETE FROM eras;');

    const insertEra = db.prepare(`
      INSERT INTO eras (
        position, start_ym, end_ym, start_ts, end_ts, months, auto_title,
        streams, q_plays, ms_played, new_artists, change_strength, accent
      ) VALUES (
        @position, @startYm, @endYm, @startTs, @endTs, @months, @autoTitle,
        @streams, @qPlays, @msPlayed, @newArtists, @changeStrength, @accent
      )
    `);
    const insertEraArtist = db.prepare(
      'INSERT INTO era_artists (era_id, artist_id, plays, ms_played, rank) VALUES (?, ?, ?, ?, ?)',
    );
    const insertEraTrack = db.prepare(
      'INSERT INTO era_tracks (era_id, track_id, plays, rank) VALUES (?, ?, ?, ?)',
    );

    const artistTotals = db.prepare(`
      SELECT ma.artist_id AS id, a.name AS name,
             SUM(ma.q_plays) AS plays, SUM(ma.ms_played) AS ms
      FROM monthly_artist_stats ma
      JOIN artists a ON a.id = ma.artist_id
      WHERE ma.ym >= ? AND ma.ym <= ?
      GROUP BY ma.artist_id
      ORDER BY ms DESC
      LIMIT 8
    `);

    const trackTotals = db.prepare(`
      SELECT mt.track_id AS id, SUM(mt.q_plays) AS plays
      FROM monthly_track_stats mt
      WHERE mt.ym >= ? AND mt.ym <= ?
      GROUP BY mt.track_id
      ORDER BY plays DESC
      LIMIT 8
    `);

    const totalsFor = db.prepare(`
      SELECT COALESCE(SUM(plays), 0) AS streams,
             COALESCE(SUM(q_plays), 0) AS q_plays,
             COALESCE(SUM(ms_played), 0) AS ms_played
      FROM monthly_artist_stats
      WHERE ym >= ? AND ym <= ?
    `);

    const newArtistsFor = db.prepare(`
      SELECT COUNT(*) AS n FROM artist_stats
      WHERE first_ts >= ? AND first_ts <= ?
    `);

    let position = 0;
    for (const segment of segments) {
      const startYm = source[segment.startIndex].ym;
      const endYm = source[segment.endIndex].ym;
      const startTs = startOfMonthTs(startYm);
      const endTs = endOfMonthTs(endYm);

      const totals = totalsFor.get(startYm, endYm) as {
        streams: number;
        q_plays: number;
        ms_played: number;
      };

      const artists = artistTotals.all(startYm, endYm) as {
        id: number;
        name: string;
        plays: number;
        ms: number;
      }[];

      const title = eraTitle(
        artists.map((a) => ({ name: a.name, msPlayed: a.ms })),
        totals.ms_played,
        monthSpan(startYm, endYm),
        startYm,
        endYm,
      );

      const newArtists = (newArtistsFor.get(startTs, endTs) as { n: number }).n;

      const info = insertEra.run({
        position,
        startYm,
        endYm,
        startTs,
        endTs,
        months: monthSpan(startYm, endYm),
        autoTitle: title,
        streams: totals.streams,
        qPlays: totals.q_plays,
        msPlayed: totals.ms_played,
        newArtists,
        changeStrength: Math.round(segment.changeStrength * 1000) / 1000,
        accent: ACCENTS[position % ACCENTS.length],
      });

      const eraId = Number(info.lastInsertRowid);
      artists.forEach((artist, index) => {
        insertEraArtist.run(eraId, artist.id, artist.plays, artist.ms, index + 1);
      });
      (trackTotals.all(startYm, endYm) as { id: number; plays: number }[]).forEach(
        (track, index) => {
          insertEraTrack.run(eraId, track.id, track.plays, index + 1);
        },
      );

      position += 1;
    }
  });

  if (months.length === 0) {
    run([], months);
    return { count: 0, reason: 'no-data' };
  }

  const activeMonths = months.filter((m) => m.plays >= ERA_MIN_MONTH_PLAYS).length;
  if (activeMonths < ERA_MIN_MONTHS * 2) {
    run([], months);
    return { count: 0, reason: 'not-enough-months' };
  }

  const distances = boundaryDistances(months);
  const changePoints = detectChangePoints(months, distances);
  let segments = buildSegments(months, changePoints, distances);
  segments = mergeShortSegments(months, segments);
  segments = mergeSimilarNeighbours(months, segments);
  segments = trimQuietEdges(months, segments);
  segments = segments.filter((s) => segmentPlays(months, s) >= ERA_MIN_MONTH_PLAYS);

  run(segments, months);
  return { count: segments.length, reason: 'ok' };
}
