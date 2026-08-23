import type { Db } from '../database/types';
import { qualifyingExpr, SKIP_EXPR, eventFilter, type AggregateOptions } from './aggregates';

/**
 * The columnar view of a listening history.
 *
 * A million playback events cannot be walked as a million JavaScript objects
 * without the garbage collector dominating the run, so the whole archive is
 * loaded once into typed arrays and every sequential question is answered
 * against that. Loading is a single ordered scan; each subsequent analysis is a
 * linear pass over memory.
 */

export interface EventColumns {
  n: number;
  ts: Float64Array;
  trackId: Int32Array;
  artistId: Int32Array;
  /** 0 stands for "no album", since Int32Array cannot hold null. */
  albumId: Int32Array;
  msPlayed: Int32Array;
  /** bit 0 = qualifying play, bit 1 = skip. */
  flags: Uint8Array;
  maxTrackId: number;
  maxArtistId: number;
  maxAlbumId: number;
}

export const FLAG_QUALIFYING = 1;
export const FLAG_SKIP = 2;

/** Loads every playback event, ascending by timestamp, into columnar form. */
export function loadEvents(db: Db, options: AggregateOptions): EventColumns {
  const q = qualifyingExpr(options.qualifyingPlayMs);
  const filter = eventFilter(options.includePrivateSessions);

  const countRow = db
    .prepare(`SELECT COUNT(*) AS n FROM playback_events WHERE ${filter}`)
    .get() as { n: number };
  const n = countRow.n;

  const columns: EventColumns = {
    n,
    ts: new Float64Array(n),
    trackId: new Int32Array(n),
    artistId: new Int32Array(n),
    albumId: new Int32Array(n),
    msPlayed: new Int32Array(n),
    flags: new Uint8Array(n),
    maxTrackId: 0,
    maxArtistId: 0,
    maxAlbumId: 0,
  };

  if (n === 0) return columns;

  const stmt = db
    .prepare(
      `SELECT ts, track_id, artist_id, COALESCE(album_id, 0) AS album_id, ms_played,
              (${q}) AS is_q, (${SKIP_EXPR}) AS is_skip
       FROM playback_events
       WHERE ${filter}
       ORDER BY ts ASC, id ASC`,
    )
    .raw(true);

  let i = 0;
  for (const row of stmt.iterate() as Iterable<number[]>) {
    if (i >= n) break;
    columns.ts[i] = row[0];
    const t = row[1];
    const a = row[2];
    const al = row[3];
    columns.trackId[i] = t;
    columns.artistId[i] = a;
    columns.albumId[i] = al;
    columns.msPlayed[i] = row[4];
    columns.flags[i] = (row[5] ? FLAG_QUALIFYING : 0) | (row[6] ? FLAG_SKIP : 0);
    if (t > columns.maxTrackId) columns.maxTrackId = t;
    if (a > columns.maxArtistId) columns.maxArtistId = a;
    if (al > columns.maxAlbumId) columns.maxAlbumId = al;
    i += 1;
  }
  columns.n = i;
  return columns;
}

/**
 * Compressed sparse row grouping: for each entity id, the list of event indices
 * belonging to it. Because the source is already ordered by timestamp, each
 * bucket comes out ascending in time for free.
 */
export interface Csr {
  offsets: Int32Array;
  items: Int32Array;
  maxId: number;
}

export function buildCsr(
  ids: Int32Array,
  n: number,
  maxId: number,
  include: (index: number) => boolean,
): Csr {
  const counts = new Int32Array(maxId + 2);
  for (let i = 0; i < n; i++) {
    const id = ids[i];
    if (id <= 0 || !include(i)) continue;
    counts[id + 1] += 1;
  }
  for (let id = 1; id <= maxId + 1; id++) counts[id] += counts[id - 1];
  const offsets = counts;
  const total = offsets[maxId + 1];
  const items = new Int32Array(total);
  const cursor = new Int32Array(maxId + 2);
  cursor.set(offsets);
  for (let i = 0; i < n; i++) {
    const id = ids[i];
    if (id <= 0 || !include(i)) continue;
    items[cursor[id]] = i;
    cursor[id] += 1;
  }
  return { offsets, items, maxId };
}

/**
 * Extracts an entity's qualifying-play timestamps into a reusable scratch
 * buffer. Returns the number of entries written.
 */
export function fillTimestamps(
  csr: Csr,
  columns: EventColumns,
  id: number,
  out: Float64Array,
): number {
  const start = csr.offsets[id];
  const end = csr.offsets[id + 1];
  const count = Math.min(end - start, out.length);
  for (let i = 0; i < count; i++) {
    out[i] = columns.ts[csr.items[start + i]];
  }
  return count;
}

export function entityCount(csr: Csr, id: number): number {
  return csr.offsets[id + 1] - csr.offsets[id];
}

/**
 * Reusable scratch space for per-entity timestamp extraction.
 *
 * The analytics passes touch hundreds of thousands of entities; allocating a
 * fresh array for each would put more pressure on the collector than the work
 * itself. One buffer is grown to fit the largest entity and reused throughout.
 */
export type Scratch = Float64Array;

export function makeScratch(size: number): Scratch {
  return new Float64Array(size);
}

/** Grows a scratch buffer to at least `size`, reusing it when already big enough. */
export function ensureBuffer(buffer: Scratch, size: number): Scratch {
  if (buffer.length >= size) return buffer;
  let next = Math.max(1024, buffer.length);
  while (next < size) next *= 2;
  return makeScratch(next);
}
