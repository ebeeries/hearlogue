import type { Db } from '../database/types';
import type { EventColumns } from './sequences';
import { FLAG_QUALIFYING } from './sequences';
import { normalizedEntropy } from './scoring';
import { localParts, MS_PER_MINUTE } from '@shared/utils/time';

/**
 * Listening sessions.
 *
 * The export has no notion of a "session", so one is derived: a run of playback
 * separated from the next by more than the inactivity threshold (30 minutes by
 * default, adjustable in Settings). Session boundaries are recomputed whenever
 * that setting changes.
 *
 * Each session records what it actually was — how long, how many songs, how many
 * repeats of the same track, and how varied it was — which is what makes
 * "longest session" and "most repetitive session" answerable.
 */

export interface SessionBuildResult {
  count: number;
  longestMs: number;
}

export function buildSessions(
  db: Db,
  columns: EventColumns,
  sessionGapMinutes: number,
): SessionBuildResult {
  db.exec('DELETE FROM sessions;');
  if (columns.n === 0) return { count: 0, longestMs: 0 };

  const gapMs = Math.max(1, sessionGapMinutes) * MS_PER_MINUTE;

  const insert = db.prepare(`
    INSERT INTO sessions (
      start_ts, end_ts, duration_ms, ms_played, events, q_plays, unique_tracks, unique_artists,
      top_artist_id, top_track_id, max_repeats, diversity, local_date
    ) VALUES (
      @startTs, @endTs, @durationMs, @msPlayed, @events, @qPlays, @uniqueTracks, @uniqueArtists,
      @topArtistId, @topTrackId, @maxRepeats, @diversity, @localDate
    )
  `);

  let count = 0;
  let longestMs = 0;

  const flushRange = (from: number, to: number): void => {
    const trackCounts = new Map<number, number>();
    const artistCounts = new Map<number, number>();
    let msPlayed = 0;
    let qPlays = 0;

    for (let i = from; i < to; i++) {
      msPlayed += columns.msPlayed[i];
      if (columns.flags[i] & FLAG_QUALIFYING) qPlays += 1;
      const t = columns.trackId[i];
      const a = columns.artistId[i];
      trackCounts.set(t, (trackCounts.get(t) ?? 0) + 1);
      artistCounts.set(a, (artistCounts.get(a) ?? 0) + 1);
    }

    let topTrackId: number | null = null;
    let maxRepeats = 0;
    for (const [id, n] of trackCounts) {
      if (n > maxRepeats) {
        maxRepeats = n;
        topTrackId = id;
      }
    }
    let topArtistId: number | null = null;
    let topArtistPlays = 0;
    for (const [id, n] of artistCounts) {
      if (n > topArtistPlays) {
        topArtistPlays = n;
        topArtistId = id;
      }
    }

    const startTs = columns.ts[from];
    const endTs = columns.ts[to - 1];
    const durationMs = Math.max(endTs - startTs, msPlayed);

    insert.run({
      startTs,
      endTs,
      durationMs,
      msPlayed,
      events: to - from,
      qPlays,
      uniqueTracks: trackCounts.size,
      uniqueArtists: artistCounts.size,
      topArtistId,
      topTrackId,
      maxRepeats,
      diversity: normalizedEntropy([...artistCounts.values()]),
      localDate: localParts(startTs).date,
    });

    count += 1;
    if (msPlayed > longestMs) longestMs = msPlayed;
  };

  const run = db.transaction(() => {
    let sessionStart = 0;
    for (let i = 1; i < columns.n; i++) {
      if (columns.ts[i] - columns.ts[i - 1] > gapMs) {
        flushRange(sessionStart, i);
        sessionStart = i;
      }
    }
    flushRange(sessionStart, columns.n);
  });

  run();

  return { count, longestMs };
}
