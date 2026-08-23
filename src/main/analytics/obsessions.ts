import type { Db } from '../database/types';
import {
  buildCsr,
  ensureBuffer,
  entityCount,
  fillTimestamps,
  makeScratch,
  FLAG_QUALIFYING,
  type Csr,
  type EventColumns,
} from './sequences';
import { obsessionIntensity, peakWindow, daysToNthPlay } from './scoring';
import {
  OBSESSION_MIN_TRACK_PLAYS,
  OBSESSION_MIN_ARTIST_PLAYS,
  OBSESSION_MIN_ALBUM_PLAYS,
  OBSESSION_PRIMARY_WINDOW_DAYS,
} from '@shared/constants/analytics';
import { MS_PER_DAY, localParts } from '@shared/utils/time';
import type { EntityKind } from '@shared/types/common';
import type { Scratch } from './sequences';

/**
 * The Obsession Engine.
 *
 * An obsession is a short stretch where one song, artist or record took over.
 * Rather than guessing at a single definition, each candidate is measured across
 * several windows and described by what actually happened: how many plays landed
 * in the densest stretch, what share of the entire relationship that was, and
 * whether anything survived afterwards.
 *
 * Nothing here is speculative. Every number shown in the UI is a count of real
 * playback events inside a real date range.
 */

const MIN_PLAYS: Record<EntityKind, number> = {
  track: OBSESSION_MIN_TRACK_PLAYS,
  artist: OBSESSION_MIN_ARTIST_PLAYS,
  album: OBSESSION_MIN_ALBUM_PLAYS,
};

/** How many consecutive months held at least a fifth of the peak month's plays. */
function longestMonthlyRun(timestamps: Scratch, count: number): number {
  if (count === 0) return 0;
  const perMonth = new Map<string, number>();
  for (let i = 0; i < count; i++) {
    const ym = localParts(timestamps[i]).ym;
    perMonth.set(ym, (perMonth.get(ym) ?? 0) + 1);
  }
  const months = [...perMonth.keys()].sort();
  const peak = Math.max(...perMonth.values());
  const floor = Math.max(2, Math.ceil(peak * 0.2));

  let best = 0;
  let run = 0;
  let previous: string | null = null;
  for (const ym of months) {
    const plays = perMonth.get(ym) ?? 0;
    const consecutive = previous !== null && isNextMonth(previous, ym);
    if (plays >= floor) {
      run = consecutive ? run + 1 : 1;
      if (run > best) best = run;
    } else {
      run = 0;
    }
    previous = ym;
  }
  return best;
}

function isNextMonth(previous: string, current: string): boolean {
  const py = Number(previous.slice(0, 4));
  const pm = Number(previous.slice(5, 7));
  const cy = Number(current.slice(0, 4));
  const cm = Number(current.slice(5, 7));
  return (cy - py) * 12 + (cm - pm) === 1;
}

interface Candidate {
  kind: EntityKind;
  entityId: number;
  lifetimePlays: number;
}

function collectCandidates(db: Db, kind: EntityKind): Candidate[] {
  const min = MIN_PLAYS[kind];
  const table = kind === 'track' ? 'track_stats' : kind === 'artist' ? 'artist_stats' : 'album_stats';
  const idColumn = kind === 'track' ? 'track_id' : kind === 'artist' ? 'artist_id' : 'album_id';
  const rows = db
    .prepare(`SELECT ${idColumn} AS id, q_plays FROM ${table} WHERE q_plays >= ?`)
    .all(min) as { id: number; q_plays: number }[];
  return rows.map((r) => ({ kind, entityId: r.id, lifetimePlays: r.q_plays }));
}

function csrFor(kind: EntityKind, columns: EventColumns): Csr {
  const ids =
    kind === 'track' ? columns.trackId : kind === 'artist' ? columns.artistId : columns.albumId;
  const maxId =
    kind === 'track'
      ? columns.maxTrackId
      : kind === 'artist'
        ? columns.maxArtistId
        : columns.maxAlbumId;
  return buildCsr(ids, columns.n, maxId, (i) => (columns.flags[i] & FLAG_QUALIFYING) !== 0);
}

export interface ObsessionBuildResult {
  tracks: number;
  artists: number;
  albums: number;
}

export function buildObsessions(db: Db, columns: EventColumns): ObsessionBuildResult {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO obsessions (
      kind, entity_id, window_days, window_start, window_end, window_plays, lifetime_plays,
      share, plays_per_day, plays_after, after_share, intensity, days_to_50, days_to_100,
      longest_run, peak_week
    ) VALUES (
      @kind, @entityId, @windowDays, @windowStart, @windowEnd, @windowPlays, @lifetimePlays,
      @share, @playsPerDay, @playsAfter, @afterShare, @intensity, @daysTo50, @daysTo100,
      @longestRun, @peakWeek
    )
  `);

  const result: ObsessionBuildResult = { tracks: 0, artists: 0, albums: 0 };
  const primaryWindowMs = OBSESSION_PRIMARY_WINDOW_DAYS * MS_PER_DAY;
  const weekMs = 7 * MS_PER_DAY;
  let buffer = makeScratch(4096);

  for (const kind of ['track', 'artist', 'album'] as EntityKind[]) {
    const csr = csrFor(kind, columns);
    const candidates = collectCandidates(db, kind);

    const run = db.transaction(() => {
      for (const candidate of candidates) {
        const count = entityCount(csr, candidate.entityId);
        if (count < MIN_PLAYS[kind]) continue;

        buffer = ensureBuffer(buffer, count);
        fillTimestamps(csr, columns, candidate.entityId, buffer);

        const primary = peakWindow(buffer, 0, count, primaryWindowMs);
        if (primary.count < 5) continue;

        const week = peakWindow(buffer, 0, count, weekMs);

        // Everything that happened once the peak stretch was over.
        let playsAfter = 0;
        for (let i = count - 1; i >= 0; i--) {
          if (buffer[i] > primary.to) playsAfter += 1;
          else break;
        }

        const share = primary.count / count;
        const spanDays = Math.max(1, (primary.to - primary.from) / MS_PER_DAY);
        const intensity = obsessionIntensity({
          windowPlays: primary.count,
          lifetimePlays: count,
          windowDays: OBSESSION_PRIMARY_WINDOW_DAYS,
          playsAfter,
        });

        insert.run({
          kind,
          entityId: candidate.entityId,
          windowDays: OBSESSION_PRIMARY_WINDOW_DAYS,
          windowStart: primary.from,
          windowEnd: primary.to,
          windowPlays: primary.count,
          lifetimePlays: count,
          share,
          playsPerDay: primary.count / spanDays,
          playsAfter,
          afterShare: count > 0 ? playsAfter / count : 0,
          intensity,
          daysTo50: daysToNthPlay(buffer, 0, count, 50),
          daysTo100: daysToNthPlay(buffer, 0, count, 100),
          longestRun: longestMonthlyRun(buffer, count),
          peakWeek: week.count,
        });

        if (kind === 'track') result.tracks += 1;
        else if (kind === 'artist') result.artists += 1;
        else result.albums += 1;
      }
    });

    run();
  }

  return result;
}
