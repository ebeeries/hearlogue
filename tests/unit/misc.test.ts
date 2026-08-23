import { describe, it, expect } from 'vitest';
import { eraTitle } from '@main/analytics/eras';
import { toMatchExpression } from '@main/database/repositories/search';
import { compileRules } from '@main/database/repositories/collections';
import { diversifyByArtist } from '@main/database/repositories/discovery';
import { isAllowedExternalUrl, spotifyUriToUrl } from '@main/services/external';
import {
  monthRange,
  monthSpan,
  localParts,
  startOfMonthTs,
  endOfMonthTs,
  addDays,
} from '@shared/utils/time';
import {
  formatDuration,
  formatDurationShort,
  formatSilence,
  truncate,
  ordinal,
} from '@renderer/lib/format';

/**
 * Assorted pure-logic tests: era naming, search query building, rule
 * compilation, result diversification, URL allowlisting, calendar arithmetic
 * and presentation formatting.
 */

describe('eraTitle', () => {
  const artists = (shares: number[]): { name: string; msPlayed: number }[] =>
    shares.map((share, index) => ({ name: `Artist ${index + 1}`, msPlayed: share * 1000 }));

  it('names an era after a clearly dominant artist', () => {
    expect(eraTitle(artists([0.6, 0.1, 0.05]), 750, 12, '2018-01', '2018-12')).toBe(
      'The Artist 1 Era',
    );
  });

  it('names an era after two artists when they shared it', () => {
    expect(eraTitle(artists([0.35, 0.3]), 650, 24, '2018-01', '2019-12')).toBe(
      'The Artist 1 / Artist 2 Years',
    );
  });

  it('picks a suffix that fits the length', () => {
    expect(eraTitle(artists([0.6]), 600, 4, '2018-01', '2018-04')).toContain('Period');
    expect(eraTitle(artists([0.6]), 600, 12, '2018-01', '2018-12')).toContain('Era');
    expect(eraTitle(artists([0.6]), 600, 30, '2018-01', '2020-06')).toContain('Years');
  });

  it('does not stutter on artist names that begin with an article', () => {
    const title = eraTitle(
      [{ name: 'The Harbour Lights', msPlayed: 600 }],
      1000,
      20,
      '2015-01',
      '2016-08',
    );
    expect(title).toBe('The Harbour Lights Years');
    expect(title).not.toContain('The The');
  });

  it('falls back to the date range when nothing dominates', () => {
    const flat = artists([0.09, 0.08, 0.08, 0.08]);
    expect(eraTitle(flat, 1000, 12, '2020-01', '2020-12')).toBe('The 2020 Stretch');
    expect(eraTitle(flat, 1000, 24, '2020-01', '2021-12')).toBe('The 2020–2021 Stretch');
  });

  it('never invents a genre', () => {
    const title = eraTitle(artists([0.7]), 700, 12, '2018-01', '2018-12');
    for (const genre of ['indie', 'rock', 'jazz', 'pop', 'hip hop', 'electronic']) {
      expect(title.toLowerCase()).not.toContain(genre);
    }
  });

  it('handles an era with no artists at all', () => {
    expect(eraTitle([], 0, 6, '2019-01', '2019-06')).toBe('The 2019 Stretch');
  });
});

describe('search query building', () => {
  it('quotes every token so punctuation cannot become FTS syntax', () => {
    expect(toMatchExpression('nocturne bell')).toBe('"nocturne" AND "bell"*');
    expect(toMatchExpression('AC/DC')).toBe('"ac" AND "dc"*');
    // The tokenizer discards '&' entirely, so the query must too.
    expect(toMatchExpression('Alder & Ash')).toBe('"alder" AND "ash"*');
    expect(toMatchExpression("O'Brien")).toBe('"o" AND "brien"*');
    expect(toMatchExpression('Florence + the Machine')).toBe(
      '"florence" AND "the" AND "machine"*',
    );
  });

  it('neutralises FTS operators typed as text', () => {
    // Unquoted, these would be parsed as operators and could error the query.
    for (const query of ['NEAR', 'AND OR NOT', 'a*b', '"unclosed', '(paren']) {
      const expression = toMatchExpression(query);
      if (expression === null) continue;
      expect(expression).not.toMatch(/(^|\s)(AND|OR|NOT|NEAR)(\s|$)(?!")/);
      expect(expression.split('"').length % 2).toBe(1);
    }
  });

  it('makes the last token a prefix so search feels live', () => {
    expect(toMatchExpression('noct')).toBe('"noct"*');
  });

  it('returns null when there is nothing to match', () => {
    expect(toMatchExpression('')).toBeNull();
    expect(toMatchExpression('   ')).toBeNull();
    expect(toMatchExpression('***')).toBeNull();
  });
});

describe('smart collection rule compilation', () => {
  const now = Date.UTC(2026, 0, 1);

  it('binds user values instead of interpolating them', () => {
    const compiled = compileRules(
      [{ field: 'artist', operator: 'contains', value: "'; DROP TABLE tracks; --" }],
      'all',
      now,
    );
    expect(compiled.where).not.toContain('DROP TABLE');
    expect(Object.values(compiled.params)).toContain("%'; DROP TABLE tracks; --%");
  });

  it('joins rules with the chosen mode', () => {
    const rules = [
      { field: 'plays' as const, operator: 'gt' as const, value: '30' },
      { field: 'skipRate' as const, operator: 'lt' as const, value: '20' },
    ];
    expect(compileRules(rules, 'all', now).where).toContain(' AND ');
    expect(compileRules(rules, 'any', now).where).toContain(' OR ');
  });

  it('supports between, booleans and text negation', () => {
    const between = compileRules(
      [{ field: 'firstHeardYear', operator: 'between', value: '2010', value2: '2019' }],
      'all',
      now,
    );
    expect(between.where).toContain('BETWEEN');
    expect(between.params.r0a).toBe(2010);
    expect(between.params.r0b).toBe(2019);

    expect(compileRules([{ field: 'favorite', operator: 'isTrue', value: '' }], 'all', now).where).toContain('= 1');
    expect(compileRules([{ field: 'retired', operator: 'isFalse', value: '' }], 'all', now).where).toContain('= 0');
    expect(
      compileRules([{ field: 'album', operator: 'notContains', value: 'Live' }], 'all', now).where,
    ).toContain('NOT LIKE');
  });

  it('coerces non-numeric input rather than emitting broken SQL', () => {
    const compiled = compileRules([{ field: 'plays', operator: 'gt', value: 'abc' }], 'all', now);
    expect(compiled.params.r0).toBe(0);
  });

  it('matches everything when there are no rules', () => {
    expect(compileRules([], 'all', now).where).toBe('1=1');
  });

  it('rejects an unknown field', () => {
    expect(() =>
      compileRules([{ field: 'nonsense' as never, operator: 'gt', value: '1' }], 'all', now),
    ).toThrow();
  });

  it('flags when a tag join is needed', () => {
    expect(compileRules([{ field: 'tag', operator: 'contains', value: 'Love' }], 'all', now).needsTags).toBe(true);
    expect(compileRules([{ field: 'plays', operator: 'gt', value: '1' }], 'all', now).needsTags).toBe(false);
  });
});

describe('result diversification', () => {
  it('caps how many entries one artist can take before the rest', () => {
    const items = [
      { artistId: 1, id: 'a' },
      { artistId: 1, id: 'b' },
      { artistId: 1, id: 'c' },
      { artistId: 2, id: 'd' },
      { artistId: 1, id: 'e' },
      { artistId: 3, id: 'f' },
    ];
    const result = diversifyByArtist(items, 2);
    expect(result.slice(0, 4).map((item) => item.id)).toEqual(['a', 'b', 'd', 'f']);
  });

  it('keeps every item — nothing is silently dropped', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ artistId: 1, id: i }));
    const result = diversifyByArtist(items, 2);
    expect(result).toHaveLength(30);
    expect(new Set(result.map((item) => item.id)).size).toBe(30);
  });

  it('leaves an already diverse list in its original order', () => {
    const items = [{ artistId: 1 }, { artistId: 2 }, { artistId: 3 }];
    expect(diversifyByArtist(items, 2)).toEqual(items);
  });
});

describe('external URL allowlist', () => {
  it('permits only exact Spotify origins over https', () => {
    expect(isAllowedExternalUrl('https://open.spotify.com/track/abc')).toBe(true);
    expect(isAllowedExternalUrl('https://www.spotify.com/account/privacy/')).toBe(true);
  });

  it('rejects lookalike hosts, other schemes and rubbish', () => {
    const blocked = [
      'https://open.spotify.com.evil.example/track/abc',
      'https://evil.example/open.spotify.com',
      'http://open.spotify.com/track/abc',
      'file:///C:/Windows/System32',
      'javascript:alert(1)',
      'data:text/html,<script>',
      'not a url',
      '',
    ];
    for (const url of blocked) {
      expect(isAllowedExternalUrl(url), url).toBe(false);
    }
  });

  it('converts a track URI into an allowlisted link', () => {
    expect(spotifyUriToUrl('spotify:track:4cOdK2wGLETKBW3PvgPWqT')).toBe(
      'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
    );
    expect(isAllowedExternalUrl(spotifyUriToUrl('spotify:album:abc123')!)).toBe(true);
  });

  it('refuses to convert anything that is not a Spotify entity URI', () => {
    expect(spotifyUriToUrl('spotify:episode:abc')).toBeNull();
    expect(spotifyUriToUrl('spotify:track:../../etc')).toBeNull();
    expect(spotifyUriToUrl('spotify:track:')).toBeNull();
    expect(spotifyUriToUrl('nonsense')).toBeNull();
  });
});

describe('calendar arithmetic', () => {
  it('enumerates months inclusively across a year boundary', () => {
    expect(monthRange('2019-11', '2020-02')).toEqual(['2019-11', '2019-12', '2020-01', '2020-02']);
    expect(monthRange('2020-05', '2020-05')).toEqual(['2020-05']);
  });

  it('counts month spans inclusively', () => {
    expect(monthSpan('2020-01', '2020-01')).toBe(1);
    expect(monthSpan('2019-11', '2020-02')).toBe(4);
  });

  it('derives local calendar parts', () => {
    const parts = localParts(new Date(2019, 2, 14, 23, 45).getTime());
    expect(parts.date).toBe('2019-03-14');
    expect(parts.ym).toBe('2019-03');
    expect(parts.year).toBe(2019);
    expect(parts.hour).toBe(23);
  });

  it('brackets a month exactly', () => {
    const start = startOfMonthTs('2020-02');
    const end = endOfMonthTs('2020-02');
    expect(localParts(start).date).toBe('2020-02-01');
    // 2020 was a leap year; the bracket must reflect that, not assume 28 days.
    expect(localParts(end).date).toBe('2020-02-29');
  });

  it('adds days across a month boundary', () => {
    expect(addDays('2020-02-27', 3)).toBe('2020-03-01');
    expect(addDays('2020-01-01', -1)).toBe('2019-12-31');
  });
});

describe('presentation formatting', () => {
  it('scales durations to a readable unit', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(45 * 60_000)).toBe('45m');
    expect(formatDuration(90 * 60_000)).toBe('1h 30m');
    expect(formatDuration(3 * 3_600_000)).toBe('3h');
    expect(formatDuration(50 * 3_600_000)).toBe('2d 2h');
  });

  it('keeps axis labels to a single unit', () => {
    expect(formatDurationShort(45 * 60_000)).toBe('45m');
    expect(formatDurationShort(50 * 3_600_000)).toBe('2d');
    expect(formatDurationShort(0)).toBe('0');
  });

  it('describes a silence the way a person would', () => {
    const t = (key: string, values?: Record<string, string | number>): string => {
      const templates: Record<string, string> = {
        'common.today': 'today',
        'time.day': '1 day',
        'time.days': '{count} days',
        'time.month': '1 month',
        'time.months': '{count} months',
        'time.year': '1 year',
        'time.years': '{count} years',
      };
      return (templates[key] ?? key).replace('{count}', String(values?.count ?? ''));
    };

    expect(formatSilence(0, t)).toBe('today');
    expect(formatSilence(1, t)).toBe('1 day');
    expect(formatSilence(12, t)).toBe('12 days');
    expect(formatSilence(90, t)).toBe('3 months');
    expect(formatSilence(365, t)).toBe('1 year');
    expect(formatSilence(365 * 6, t)).toBe('6 years');
  });

  it('truncates on a word boundary', () => {
    expect(truncate('short', 20)).toBe('short');
    expect(truncate('a considerably longer title than fits', 20)).toBe('a considerably…');
  });

  it('formats ordinals, including the teens', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '101st',
    ]);
  });
});
