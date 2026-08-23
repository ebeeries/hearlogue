import {
  ExtendedStreamingRecordSchema,
  LegacyStreamingRecordSchema,
  type NormalizedEvent,
  type NormalizeOutcome,
  type RejectReason,
} from '@shared/schemas/spotify';
import { parseTimestamp } from '@shared/utils/time';

/**
 * Turning a raw Spotify export record into a HEARLOGUE playback event.
 *
 * Two paths exist on purpose:
 *
 *  - `normalizeRecord` is the hand-written fast path used by the importer. A
 *    million-event archive means a million calls, and running a Zod parse on each
 *    one costs seconds of wall clock for no additional safety in the common case.
 *  - `normalizeRecordStrict` runs the same record through the Zod schemas. It is
 *    the canonical definition of what the app accepts, is used for the diagnostic
 *    pass over rejected records, and `tests/unit/normalize.test.ts` asserts that
 *    the two agree on a large fixture so the fast path can never quietly drift.
 *
 * Privacy note: `ip_addr_decrypted`, `user_agent_decrypted` and `username` appear
 * in some exports. They are read by neither path — the normalised event has no
 * field to hold them, so they cannot reach SQL.
 */

/** URIs we recognise; anything else (episode, audiobook) is not music history. */
const TRACK_URI_PREFIX = 'spotify:track:';

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asBool(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 1) return true;
  if (value === 0) return false;
  return null;
}

function asMs(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.min(Math.round(value), 24 * 3_600_000);
  }
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return Math.min(Math.round(n), 24 * 3_600_000);
  }
  return 0;
}

/**
 * Platform strings in the export are long and machine-specific
 * ("Windows 10 (10.0.19045; x64; AppX)"). They are reduced to a coarse family so
 * the archive can say "you listened on your phone" without retaining a device
 * fingerprint.
 */
export function normalizePlatform(raw: unknown): string | null {
  const value = asString(raw);
  if (!value) return null;
  const v = value.toLowerCase();
  if (v.includes('android')) return 'android';
  if (v.includes('ios') || v.includes('iphone') || v.includes('ipad')) return 'ios';
  if (v.includes('windows')) return 'windows';
  if (v.includes('osx') || v.includes('os x') || v.includes('macos') || v.includes('darwin'))
    return 'macos';
  if (v.includes('linux') || v.includes('ubuntu')) return 'linux';
  if (v.includes('web') || v.includes('chrome') || v.includes('firefox') || v.includes('safari'))
    return 'web';
  if (v.includes('cast') || v.includes('chromecast')) return 'cast';
  if (v.includes('partner') || v.includes('sonos') || v.includes('tv') || v.includes('playstation'))
    return 'partner';
  return 'other';
}

function reject(reason: RejectReason): NormalizeOutcome {
  return { event: null, reason };
}

/**
 * Fast path. Returns the normalised event, or the reason the record was skipped.
 *
 * @param includePrivate when false, incognito-session events are excluded.
 */
export function normalizeRecord(raw: unknown, includePrivate = true): NormalizeOutcome {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return reject('not-an-object');
  }
  const r = raw as Record<string, unknown>;

  // Podcast and audiobook rows share the file with music in extended exports.
  if (r.spotify_episode_uri || r.episode_name || r.episode_show_name) return reject('podcast');
  if (r.audiobook_title || r.audiobook_chapter_title) return reject('audiobook');

  const rawTs = r.ts ?? r.endTime ?? r.offline_timestamp;
  if (rawTs === undefined || rawTs === null || rawTs === '') return reject('missing-timestamp');
  const ts = parseTimestamp(rawTs);
  if (!Number.isFinite(ts) || ts <= 0) return reject('invalid-timestamp');

  const trackName = asString(r.master_metadata_track_name ?? r.trackName);
  if (!trackName) return reject('missing-track');

  const artistName = asString(r.master_metadata_album_artist_name ?? r.artistName);
  if (!artistName) return reject('missing-artist');

  const incognito = asBool(r.incognito_mode);
  if (incognito === true && !includePrivate) return reject('incognito-excluded');

  const uriRaw = asString(r.spotify_track_uri);
  const uri = uriRaw && uriRaw.startsWith(TRACK_URI_PREFIX) ? uriRaw : null;

  const country = asString(r.conn_country);

  const event: NormalizedEvent = {
    ts,
    trackName,
    artistName,
    albumName: asString(r.master_metadata_album_album_name ?? r.albumName),
    uri,
    msPlayed: asMs(r.ms_played ?? r.msPlayed),
    platform: normalizePlatform(r.platform),
    country: country && country.length <= 4 ? country.toUpperCase() : null,
    reasonStart: asString(r.reason_start),
    reasonEnd: asString(r.reason_end),
    shuffle: asBool(r.shuffle),
    skipped: asBool(r.skipped),
    offline: asBool(r.offline),
    incognito,
  };

  return { event, reason: null };
}

/**
 * Schema-validated path. Slower, but authoritative — used by the tests and by
 * the importer's diagnostic pass so a malformed export can be described rather
 * than merely counted.
 */
export function normalizeRecordStrict(raw: unknown, includePrivate = true): NormalizeOutcome {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return reject('not-an-object');
  }

  const extended = ExtendedStreamingRecordSchema.safeParse(raw);
  if (extended.success) {
    return normalizeRecord(extended.data, includePrivate);
  }

  const legacy = LegacyStreamingRecordSchema.safeParse(raw);
  if (legacy.success) {
    return normalizeRecord(legacy.data, includePrivate);
  }

  const r = raw as Record<string, unknown>;
  if (r.ts === undefined && r.endTime === undefined) return reject('missing-timestamp');
  return reject('not-an-object');
}

/** Detects whether a parsed JSON payload looks like streaming history at all. */
export function looksLikeStreamingHistory(payload: unknown): boolean {
  if (!Array.isArray(payload) || payload.length === 0) return false;
  const sampleSize = Math.min(payload.length, 25);
  let hits = 0;
  for (let i = 0; i < sampleSize; i++) {
    const item = payload[i];
    if (item === null || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const hasTime = 'ts' in r || 'endTime' in r;
    const hasTrack =
      'master_metadata_track_name' in r ||
      'trackName' in r ||
      'spotify_track_uri' in r ||
      'episode_name' in r;
    if (hasTime && hasTrack) hits += 1;
  }
  return hits >= Math.max(1, Math.floor(sampleSize * 0.5));
}

/** Human-facing counts of why records were dropped, for the import report. */
export type RejectionTally = Partial<Record<RejectReason, number>>;

export function tallyRejection(tally: RejectionTally, reason: RejectReason): void {
  tally[reason] = (tally[reason] ?? 0) + 1;
}
