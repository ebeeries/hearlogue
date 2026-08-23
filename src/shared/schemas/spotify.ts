import { z } from 'zod';

/**
 * Schemas for the shapes Spotify has shipped in its data exports over the years.
 *
 * These are intentionally permissive: every field except the ones we genuinely
 * cannot work without is optional and nullable, and unknown keys are stripped
 * rather than rejected. Spotify has changed this format several times and will
 * change it again; an unfamiliar key must never abort an import.
 */

const nullableString = z.string().nullish().catch(null);
const nullableBool = z.boolean().nullish().catch(null);

/**
 * Modern "Extended Streaming History" record (endsong_*.json /
 * Streaming_History_Audio_*.json).
 */
export const ExtendedStreamingRecordSchema = z
  .object({
    ts: z.string(),
    platform: nullableString,
    ms_played: z.number().nullish().catch(null),
    conn_country: nullableString,
    master_metadata_track_name: nullableString,
    master_metadata_album_artist_name: nullableString,
    master_metadata_album_album_name: nullableString,
    spotify_track_uri: nullableString,
    episode_name: nullableString,
    episode_show_name: nullableString,
    spotify_episode_uri: nullableString,
    audiobook_title: nullableString,
    reason_start: nullableString,
    reason_end: nullableString,
    shuffle: nullableBool,
    skipped: z.union([z.boolean(), z.string(), z.null()]).nullish().catch(null),
    offline: nullableBool,
    offline_timestamp: z.union([z.number(), z.string(), z.null()]).nullish().catch(null),
    incognito_mode: nullableBool,
    /** Present in some older extended exports; deliberately discarded. */
    ip_addr_decrypted: nullableString,
    user_agent_decrypted: nullableString,
    username: nullableString,
  })
  .passthrough();

export type ExtendedStreamingRecord = z.infer<typeof ExtendedStreamingRecordSchema>;

/** Legacy `StreamingHistory*.json` record (account data export). */
export const LegacyStreamingRecordSchema = z
  .object({
    endTime: z.string(),
    artistName: nullableString,
    trackName: nullableString,
    albumName: nullableString,
    msPlayed: z.number().nullish().catch(null),
  })
  .passthrough();

export type LegacyStreamingRecord = z.infer<typeof LegacyStreamingRecordSchema>;

export const AnyStreamingRecordSchema = z.union([
  ExtendedStreamingRecordSchema,
  LegacyStreamingRecordSchema,
]);

/**
 * A playback event after normalisation. This is the only shape HEARLOGUE
 * persists — note the deliberate absence of IP addresses, user agents and
 * account identifiers, which are dropped during normalisation and never written
 * to disk.
 */
export const NormalizedEventSchema = z.object({
  ts: z.number().int(),
  trackName: z.string().min(1),
  artistName: z.string().min(1),
  albumName: z.string().nullable(),
  uri: z.string().nullable(),
  msPlayed: z.number().int().nonnegative(),
  platform: z.string().nullable(),
  country: z.string().nullable(),
  reasonStart: z.string().nullable(),
  reasonEnd: z.string().nullable(),
  shuffle: z.boolean().nullable(),
  skipped: z.boolean().nullable(),
  offline: z.boolean().nullable(),
  incognito: z.boolean().nullable(),
});

export type NormalizedEvent = z.infer<typeof NormalizedEventSchema>;

/** Reasons a raw record can be rejected — surfaced in import diagnostics. */
export type RejectReason =
  | 'not-an-object'
  | 'missing-timestamp'
  | 'invalid-timestamp'
  | 'missing-track'
  | 'missing-artist'
  | 'podcast'
  | 'audiobook'
  | 'incognito-excluded';

export interface NormalizeOutcome {
  event: NormalizedEvent | null;
  reason: RejectReason | null;
}
