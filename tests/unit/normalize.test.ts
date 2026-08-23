import { describe, it, expect } from 'vitest';
import {
  normalizeRecord,
  normalizeRecordStrict,
  normalizePlatform,
  looksLikeStreamingHistory,
} from '@main/import/parsers/normalize';
import { generateDemoEvents, toSpotifyExportJson } from '@main/services/demo-generator';
import { parseTimestamp } from '@shared/utils/time';

/**
 * Parser tests.
 *
 * The import path is the one place where HEARLOGUE meets data it did not create,
 * so the emphasis here is on the awkward cases: formats Spotify has retired,
 * fields it sometimes omits, rows that are not music at all, and values that
 * should never reach the database.
 */

const EXTENDED = {
  ts: '2019-03-14T21:07:33Z',
  platform: 'Windows 10 (10.0.19045; x64; AppX)',
  ms_played: 214_000,
  conn_country: 'GB',
  master_metadata_track_name: 'Counting Blocks',
  master_metadata_album_artist_name: 'Nocturne Bell',
  master_metadata_album_album_name: 'Streetlight Arithmetic',
  spotify_track_uri: 'spotify:track:4cOdK2wGLETKBW3PvgPWqT',
  reason_start: 'clickrow',
  reason_end: 'trackdone',
  shuffle: false,
  skipped: false,
  offline: false,
  incognito_mode: false,
};

describe('timestamp parsing', () => {
  it('reads the modern ISO form', () => {
    expect(parseTimestamp('2019-03-14T21:07:33Z')).toBe(Date.UTC(2019, 2, 14, 21, 7, 33));
  });

  it('reads the legacy space-separated form as UTC', () => {
    // Legacy StreamingHistory files carry no timezone marker but are UTC.
    expect(parseTimestamp('2019-03-14 21:07')).toBe(Date.UTC(2019, 2, 14, 21, 7));
  });

  it('promotes second-resolution numbers to milliseconds', () => {
    expect(parseTimestamp(1_552_597_653)).toBe(1_552_597_653_000);
    expect(parseTimestamp(1_552_597_653_000)).toBe(1_552_597_653_000);
  });

  it('returns NaN for anything unparseable', () => {
    for (const value of ['', 'yesterday', null, undefined, {}, []]) {
      expect(Number.isNaN(parseTimestamp(value))).toBe(true);
    }
  });
});

describe('normalizeRecord', () => {
  it('reads a complete extended record', () => {
    const { event } = normalizeRecord(EXTENDED);
    expect(event).not.toBeNull();
    expect(event!.trackName).toBe('Counting Blocks');
    expect(event!.artistName).toBe('Nocturne Bell');
    expect(event!.albumName).toBe('Streetlight Arithmetic');
    expect(event!.msPlayed).toBe(214_000);
    expect(event!.uri).toBe('spotify:track:4cOdK2wGLETKBW3PvgPWqT');
    expect(event!.country).toBe('GB');
    expect(event!.reasonEnd).toBe('trackdone');
  });

  it('reads a legacy StreamingHistory record', () => {
    const { event } = normalizeRecord({
      endTime: '2016-07-02 18:22',
      artistName: 'The Harbour Lights',
      trackName: 'Ferry Song',
      msPlayed: 187_000,
    });
    expect(event).not.toBeNull();
    expect(event!.artistName).toBe('The Harbour Lights');
    expect(event!.albumName).toBeNull();
    expect(event!.uri).toBeNull();
    expect(event!.msPlayed).toBe(187_000);
  });

  it('never carries identifying fields into the normalised event', () => {
    const { event } = normalizeRecord({
      ...EXTENDED,
      ip_addr_decrypted: '203.0.113.42',
      user_agent_decrypted: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      username: 'someone',
    });
    const serialised = JSON.stringify(event);
    expect(serialised).not.toContain('203.0.113.42');
    expect(serialised).not.toContain('Mozilla');
    expect(serialised).not.toContain('someone');
    expect(Object.keys(event!).sort()).toEqual(
      [
        'albumName',
        'artistName',
        'country',
        'incognito',
        'msPlayed',
        'offline',
        'platform',
        'reasonEnd',
        'reasonStart',
        'shuffle',
        'skipped',
        'trackName',
        'ts',
        'uri',
      ].sort(),
    );
  });

  it('rejects podcast and audiobook rows', () => {
    expect(
      normalizeRecord({
        ts: '2021-01-01T00:00:00Z',
        episode_name: 'Episode 12',
        spotify_episode_uri: 'spotify:episode:abc',
        ms_played: 900_000,
      }).reason,
    ).toBe('podcast');

    expect(
      normalizeRecord({
        ts: '2021-01-01T00:00:00Z',
        audiobook_title: 'A Long Book',
        ms_played: 900_000,
      }).reason,
    ).toBe('audiobook');
  });

  it('rejects rows missing the fields it cannot work without', () => {
    expect(normalizeRecord({ ...EXTENDED, ts: undefined }).reason).toBe('missing-timestamp');
    expect(normalizeRecord({ ...EXTENDED, ts: 'nonsense' }).reason).toBe('invalid-timestamp');
    expect(
      normalizeRecord({ ...EXTENDED, master_metadata_track_name: null }).reason,
    ).toBe('missing-track');
    expect(
      normalizeRecord({ ...EXTENDED, master_metadata_album_artist_name: '   ' }).reason,
    ).toBe('missing-artist');
    expect(normalizeRecord('not an object').reason).toBe('not-an-object');
    expect(normalizeRecord(null).reason).toBe('not-an-object');
  });

  it('honours the private-session preference', () => {
    const record = { ...EXTENDED, incognito_mode: true };
    expect(normalizeRecord(record, true).event).not.toBeNull();
    expect(normalizeRecord(record, false).reason).toBe('incognito-excluded');
  });

  it('survives unknown fields and unexpected types', () => {
    const { event } = normalizeRecord({
      ...EXTENDED,
      some_future_field: { nested: true },
      shuffle: 'true',
      skipped: 'false',
      ms_played: '214000',
    });
    expect(event).not.toBeNull();
    expect(event!.shuffle).toBe(true);
    expect(event!.skipped).toBe(false);
    expect(event!.msPlayed).toBe(214_000);
  });

  it('clamps absurd dwell times and negative values', () => {
    expect(normalizeRecord({ ...EXTENDED, ms_played: -50 }).event!.msPlayed).toBe(0);
    expect(normalizeRecord({ ...EXTENDED, ms_played: 999_999_999 }).event!.msPlayed).toBe(
      24 * 3_600_000,
    );
  });

  it('drops a URI that is not a track URI', () => {
    expect(normalizeRecord({ ...EXTENDED, spotify_track_uri: 'spotify:episode:x' }).event!.uri).toBeNull();
    expect(normalizeRecord({ ...EXTENDED, spotify_track_uri: '' }).event!.uri).toBeNull();
  });
});

describe('platform normalisation', () => {
  it('reduces device strings to a coarse family', () => {
    expect(normalizePlatform('Windows 10 (10.0.19045; x64; AppX)')).toBe('windows');
    expect(normalizePlatform('android')).toBe('android');
    expect(normalizePlatform('iOS 15.1 (iPhone13,2)')).toBe('ios');
    expect(normalizePlatform('OS X 10.15.7 [x86 8]')).toBe('macos');
    expect(normalizePlatform('WebPlayer (Chrome/119)')).toBe('web');
    expect(normalizePlatform('Partner sonos_speaker')).toBe('partner');
    expect(normalizePlatform('something else entirely')).toBe('other');
    expect(normalizePlatform(null)).toBeNull();
  });

  it('does not retain the original device fingerprint', () => {
    // The exact build number identifies a machine; the family does not.
    expect(normalizePlatform('Windows 10 (10.0.19045; x64; AppX)')).not.toContain('19045');
  });
});

describe('fast path and schema path agree', () => {
  it('produces identical results across a large realistic sample', () => {
    const dataset = generateDemoEvents({ seed: 99, intensity: 60, now: Date.UTC(2026, 0, 1) });
    const raw = toSpotifyExportJson(dataset.events.slice(0, 4000));

    let compared = 0;
    for (const record of raw) {
      const fast = normalizeRecord(record);
      const strict = normalizeRecordStrict(record);
      expect(strict.event).toEqual(fast.event);
      expect(strict.reason).toEqual(fast.reason);
      compared += 1;
    }
    expect(compared).toBeGreaterThan(1000);
  });

  it('agrees on malformed input too', () => {
    const cases: unknown[] = [
      null,
      42,
      'text',
      [],
      {},
      { ts: '2020-01-01T00:00:00Z' },
      { endTime: '2020-01-01 00:00', artistName: 'A' },
      { ts: 'bad', master_metadata_track_name: 'T', master_metadata_album_artist_name: 'A' },
    ];
    for (const value of cases) {
      expect(normalizeRecordStrict(value).event).toEqual(normalizeRecord(value).event);
    }
  });
});

describe('looksLikeStreamingHistory', () => {
  it('accepts both export generations', () => {
    expect(looksLikeStreamingHistory([EXTENDED, EXTENDED])).toBe(true);
    expect(
      looksLikeStreamingHistory([
        { endTime: '2016-07-02 18:22', artistName: 'A', trackName: 'B', msPlayed: 1 },
      ]),
    ).toBe(true);
  });

  it('rejects the other JSON files in a Spotify export', () => {
    expect(looksLikeStreamingHistory({ username: 'someone', email: 'x@y.z' })).toBe(false);
    expect(looksLikeStreamingHistory([])).toBe(false);
    expect(looksLikeStreamingHistory([{ playlistName: 'Chill', items: [] }])).toBe(false);
    expect(looksLikeStreamingHistory(null)).toBe(false);
  });
});
