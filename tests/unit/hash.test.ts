import { describe, it, expect } from 'vitest';
import { hash64, nameKey, eventFingerprint, unitHash, slugify } from '@shared/utils/hash';
import { generateDemoEvents } from '@main/services/demo-generator';

/**
 * Hashing tests.
 *
 * Fingerprints are effectively an on-disk format: if they change, every stored
 * event stops matching its own re-import and a second import of the same file
 * would duplicate the entire archive. These tests pin the behaviour that makes
 * idempotent imports possible.
 */

describe('hash64', () => {
  it('is deterministic', () => {
    expect(hash64('hearlogue')).toBe(hash64('hearlogue'));
  });

  it('separates similar inputs', () => {
    expect(hash64('a')).not.toBe(hash64('b'));
    expect(hash64('track 1')).not.toBe(hash64('track 2'));
    expect(hash64('')).not.toBe(hash64(' '));
  });

  it('stays inside the signed 64-bit range SQLite can store', () => {
    const min = -(2n ** 63n);
    const max = 2n ** 63n - 1n;
    for (let i = 0; i < 5000; i++) {
      const value = hash64(`sample-${i}-${'x'.repeat(i % 40)}`);
      expect(value).toBeGreaterThanOrEqual(min);
      expect(value).toBeLessThanOrEqual(max);
    }
  });

  it('spreads well enough for a large archive', () => {
    const seen = new Set<bigint>();
    for (let i = 0; i < 200_000; i++) seen.add(hash64(`event-${i}`));
    expect(seen.size).toBe(200_000);
  });
});

describe('nameKey', () => {
  it('folds case, whitespace and punctuation variants together', () => {
    expect(nameKey('  Coastal   Roads ')).toBe(nameKey('coastal roads'));
    expect(nameKey('Don’t Look Back')).toBe(nameKey("Don't Look Back"));
    expect(nameKey('Café del Mar')).toBe(nameKey('Cafe del Mar'));
    expect(nameKey('A – B')).toBe(nameKey('A - B'));
  });

  it('keeps genuinely different titles apart', () => {
    // A remaster is a different listening story, and stays a different track.
    expect(nameKey('Weathervane')).not.toBe(nameKey('Weathervane - 2011 Remaster'));
    expect(nameKey('Interval')).not.toBe(nameKey('Intervals'));
  });

  it('handles empty and symbol-only names without throwing', () => {
    expect(nameKey('')).toBe('');
    expect(nameKey('!!!')).toBe('!!!');
  });
});

describe('eventFingerprint', () => {
  const base = {
    ts: Date.UTC(2019, 2, 14, 21, 7, 33),
    trackKey: 'counting blocks',
    artistKey: 'nocturne bell',
    msPlayed: 214_000,
    platform: 'windows',
    reasonEnd: 'trackdone',
  };

  it('is stable for the same event', () => {
    expect(eventFingerprint(base)).toBe(eventFingerprint({ ...base }));
  });

  it('changes when any identifying field changes', () => {
    const fields: (keyof typeof base)[] = [
      'ts',
      'trackKey',
      'artistKey',
      'msPlayed',
      'platform',
      'reasonEnd',
    ];
    for (const field of fields) {
      const mutated = { ...base } as Record<string, unknown>;
      mutated[field] = typeof base[field] === 'number' ? (base[field] as number) + 1 : 'different';
      expect(eventFingerprint(mutated as typeof base)).not.toBe(eventFingerprint(base));
    }
  });

  it('treats a missing platform or reason as its own value, not as a wildcard', () => {
    expect(eventFingerprint({ ...base, platform: null })).not.toBe(eventFingerprint(base));
    expect(eventFingerprint({ ...base, reasonEnd: null })).not.toBe(eventFingerprint(base));
  });

  it('distinguishes two plays of one track that share a second', () => {
    // The same track twice in one second is essentially impossible, but two
    // different dwell times must never collapse into one row.
    const first = eventFingerprint(base);
    const second = eventFingerprint({ ...base, msPlayed: 214_001 });
    expect(first).not.toBe(second);
  });

  it('produces no collisions across a full synthetic archive', () => {
    const dataset = generateDemoEvents({ seed: 7, intensity: 300, now: Date.UTC(2026, 0, 1) });
    const fingerprints = new Set<bigint>();
    const identities = new Set<string>();

    for (const event of dataset.events) {
      const identity = [
        event.ts,
        nameKey(event.artistName),
        nameKey(event.trackName),
        event.msPlayed,
        event.platform ?? '',
        event.reasonEnd ?? '',
      ].join('|');
      identities.add(identity);
      fingerprints.add(
        eventFingerprint({
          ts: event.ts,
          trackKey: nameKey(event.trackName),
          artistKey: nameKey(event.artistName),
          msPlayed: event.msPlayed,
          platform: event.platform,
          reasonEnd: event.reasonEnd,
        }),
      );
    }

    expect(dataset.events.length).toBeGreaterThan(20_000);
    // One fingerprint per distinct event identity — no more, no fewer.
    expect(fingerprints.size).toBe(identities.size);
  });
});

describe('unitHash', () => {
  it('returns a stable value inside 0..1', () => {
    for (const input of ['2026-08-23', 'Nocturne Bell', '']) {
      const value = unitHash(input);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      expect(unitHash(input)).toBe(value);
    }
  });

  it('varies with the salt, so one string can drive several choices', () => {
    expect(unitHash('same', 1)).not.toBe(unitHash('same', 2));
  });
});

describe('slugify', () => {
  it('produces url-safe slugs', () => {
    expect(slugify('All-Time Favourite!')).toBe('all-time-favourite');
    expect(slugify('  Night   Driving  ')).toBe('night-driving');
    expect(slugify('Café')).toBe('cafe');
  });

  it('never returns an empty slug', () => {
    expect(slugify('!!!')).toBe('tag');
    expect(slugify('')).toBe('tag');
  });
});
