import { describe, it, expect } from 'vitest';
import {
  clamp01,
  logScale,
  dormancyCurve,
  lostFavoriteScore,
  obsessionIntensity,
  graveyardScore,
  cosineSimilarity,
  normalizedEntropy,
  peakWindow,
  daysToNthPlay,
  longestGap,
  type LostFavoriteInput,
} from '@main/analytics/scoring';
import { MS_PER_DAY } from '@shared/utils/time';
import { LOST_FAVORITE_WEIGHTS } from '@shared/constants/analytics';

const NOW = Date.UTC(2026, 0, 1);
const DAY = MS_PER_DAY;

/** A track that should comfortably qualify, used as the baseline to perturb. */
function baseline(overrides: Partial<LostFavoriteInput> = {}): LostFavoriteInput {
  return {
    qualifyingPlays: 120,
    plays: 140,
    msPlayed: 120 * 210_000,
    skips: 12,
    firstTs: NOW - 2200 * DAY,
    lastTs: NOW - 1500 * DAY,
    distinctDays: 70,
    activeMonths: 14,
    peakWindowPlays: 48,
    recentPlays: 0,
    now: NOW,
    dormancyDays: 365,
    ...overrides,
  };
}

describe('curve helpers', () => {
  it('clamps to the unit interval and tolerates rubbish', () => {
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(0.42)).toBeCloseTo(0.42);
    expect(clamp01(7)).toBe(1);
    expect(clamp01(NaN)).toBe(0);
    expect(clamp01(Infinity)).toBe(1);
  });

  it('compresses counts logarithmically and stays monotonic', () => {
    expect(logScale(5, 5, 400)).toBe(0);
    expect(logScale(400, 5, 400)).toBe(1);
    expect(logScale(1000, 5, 400)).toBe(1);
    // The gap between 5 and 20 plays should register more than 300 to 315.
    const early = logScale(20, 5, 400) - logScale(5, 5, 400);
    const late = logScale(315, 5, 400) - logScale(300, 5, 400);
    expect(early).toBeGreaterThan(late * 5);
  });

  it('saturates dormancy rather than growing without bound', () => {
    expect(dormancyCurve(0)).toBe(0);
    expect(dormancyCurve(365)).toBeGreaterThan(0.4);
    expect(dormancyCurve(365)).toBeLessThan(0.7);
    expect(dormancyCurve(365 * 3)).toBeGreaterThan(dormancyCurve(365));
    expect(dormancyCurve(365 * 20)).toBe(1);
  });

  it('gives each further day of silence diminishing weight', () => {
    // Six months of new silence early on should move the needle more per day
    // than the same six months added to a silence that is already five years old.
    const earlyPerDay = (dormancyCurve(365) - dormancyCurve(180)) / 185;
    const latePerDay = (dormancyCurve(365 * 6) - dormancyCurve(365 * 5)) / 365;
    expect(earlyPerDay).toBeGreaterThan(latePerDay);
  });
});

describe('lostFavoriteScore', () => {
  it('scores a genuine lost favorite highly', () => {
    const result = lostFavoriteScore(baseline());
    expect(result.rejectedBy).toBeNull();
    expect(result.score).toBeGreaterThan(60);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.daysSinceLastPlay).toBe(1500);
  });

  it('rejects a track that was never really played', () => {
    // The whole point of the gates: two plays in 2014 is not a lost favorite.
    const result = lostFavoriteScore(baseline({ qualifyingPlays: 2, plays: 3, msPlayed: 400_000 }));
    expect(result.score).toBe(0);
    expect(result.rejectedBy).toBe('too-few-plays');
  });

  it('rejects a track with plays but almost no listening time', () => {
    const result = lostFavoriteScore(baseline({ msPlayed: 60_000 }));
    expect(result.rejectedBy).toBe('too-little-time');
  });

  it('rejects a track that is not dormant yet', () => {
    const result = lostFavoriteScore(baseline({ lastTs: NOW - 100 * DAY }));
    expect(result.rejectedBy).toBe('not-dormant');
    expect(result.score).toBe(0);
  });

  it('rejects a track that has quietly come back', () => {
    const result = lostFavoriteScore(baseline({ recentPlays: 30 }));
    expect(result.rejectedBy).toBe('already-returned');
  });

  it('rejects a track that was never played at all', () => {
    expect(lostFavoriteScore(baseline({ lastTs: null })).rejectedBy).toBe('never-played');
  });

  it('respects a custom dormancy threshold', () => {
    const input = baseline({ lastTs: NOW - 400 * DAY });
    expect(lostFavoriteScore({ ...input, dormancyDays: 365 }).rejectedBy).toBeNull();
    expect(lostFavoriteScore({ ...input, dormancyDays: 730 }).rejectedBy).toBe('not-dormant');
  });

  it('rises with a longer silence, all else equal', () => {
    const near = lostFavoriteScore(baseline({ lastTs: NOW - 400 * DAY }));
    const far = lostFavoriteScore(baseline({ lastTs: NOW - 2500 * DAY }));
    expect(far.score).toBeGreaterThan(near.score);
    expect(far.dimensions.dormancy).toBeGreaterThan(near.dimensions.dormancy);
  });

  it('penalises heavy skipping', () => {
    const loved = lostFavoriteScore(baseline({ skips: 5 }));
    const skipped = lostFavoriteScore(baseline({ plays: 400, skips: 280 }));
    expect(loved.dimensions.engagementQuality).toBeGreaterThan(
      skipped.dimensions.engagementQuality,
    );
  });

  it('rewards concentrated intensity over a flat trickle', () => {
    const intense = lostFavoriteScore(baseline({ peakWindowPlays: 100 }));
    const diffuse = lostFavoriteScore(baseline({ peakWindowPlays: 6 }));
    expect(intense.dimensions.peakIntensity).toBeGreaterThan(diffuse.dimensions.peakIntensity);
  });

  it('keeps every dimension inside 0..1 and the score inside 0..100', () => {
    const extremes: Partial<LostFavoriteInput>[] = [
      {},
      { qualifyingPlays: 100_000, msPlayed: 1e12, distinctDays: 9999, activeMonths: 500 },
      { plays: 8, qualifyingPlays: 8, skips: 8 },
      { peakWindowPlays: 100_000 },
      { lastTs: NOW - 365 * 40 * DAY },
    ];
    for (const overrides of extremes) {
      const result = lostFavoriteScore(baseline(overrides));
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      for (const value of Object.values(result.dimensions)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it('weights sum to one, so a perfect track could reach 100', () => {
    const total = Object.values(LOST_FAVORITE_WEIGHTS).reduce((sum, w) => sum + w, 0);
    expect(total).toBeCloseTo(1, 10);
  });
});

describe('obsessionIntensity', () => {
  it('rates a total takeover above a long slow burn', () => {
    const takeover = obsessionIntensity({
      windowPlays: 120,
      lifetimePlays: 140,
      windowDays: 30,
      playsAfter: 5,
    });
    const slowBurn = obsessionIntensity({
      windowPlays: 25,
      lifetimePlays: 600,
      windowDays: 30,
      playsAfter: 500,
    });
    expect(takeover).toBeGreaterThan(slowBurn);
  });

  it('stays within 0..100', () => {
    expect(
      obsessionIntensity({ windowPlays: 0, lifetimePlays: 0, windowDays: 30, playsAfter: 0 }),
    ).toBe(0);
    expect(
      obsessionIntensity({ windowPlays: 5000, lifetimePlays: 5000, windowDays: 1, playsAfter: 0 }),
    ).toBeLessThanOrEqual(100);
  });
});

describe('graveyardScore', () => {
  it('ranks a former number one above a long-tail item with the same plays', () => {
    const headline = graveyardScore({
      kind: 'artist',
      historicalPlays: 800,
      daysMissing: 1400,
      rankAtPeak: 1,
    });
    const obscure = graveyardScore({
      kind: 'artist',
      historicalPlays: 800,
      daysMissing: 1400,
      rankAtPeak: 90,
    });
    expect(headline).toBeGreaterThan(obscure);
  });

  it('rises with both magnitude and silence', () => {
    const base = { kind: 'track' as const, rankAtPeak: 5 };
    expect(graveyardScore({ ...base, historicalPlays: 400, daysMissing: 800 })).toBeGreaterThan(
      graveyardScore({ ...base, historicalPlays: 30, daysMissing: 800 }),
    );
    expect(graveyardScore({ ...base, historicalPlays: 400, daysMissing: 3000 })).toBeGreaterThan(
      graveyardScore({ ...base, historicalPlays: 400, daysMissing: 800 }),
    );
  });

  it('handles a missing rank without collapsing', () => {
    const score = graveyardScore({
      kind: 'album',
      historicalPlays: 200,
      daysMissing: 900,
      rankAtPeak: null,
    });
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

describe('cosineSimilarity', () => {
  const vector = (entries: [number, number][]): Map<number, number> => new Map(entries);

  it('is 1 for the same direction regardless of magnitude', () => {
    const a = vector([
      [1, 3],
      [2, 4],
    ]);
    const b = vector([
      [1, 30],
      [2, 40],
    ]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 6);
  });

  it('is 0 for disjoint listening', () => {
    expect(
      cosineSimilarity(vector([[1, 5]]), vector([[9, 5]])),
    ).toBe(0);
  });

  it('is partial for overlapping listening', () => {
    const similarity = cosineSimilarity(
      vector([
        [1, 5],
        [2, 5],
      ]),
      vector([
        [2, 5],
        [3, 5],
      ]),
    );
    expect(similarity).toBeGreaterThan(0.4);
    expect(similarity).toBeLessThan(0.6);
  });

  it('treats an empty month as dissimilar to everything', () => {
    expect(cosineSimilarity(new Map(), vector([[1, 1]]))).toBe(0);
  });
});

describe('normalizedEntropy', () => {
  it('is 0 when one thing dominates completely', () => {
    expect(normalizedEntropy([10])).toBe(0);
    expect(normalizedEntropy([100, 0, 0, 0])).toBe(0);
  });

  it('is 1 when everything is played equally', () => {
    expect(normalizedEntropy([5, 5, 5, 5])).toBeCloseTo(1, 6);
  });

  it('sits in between for a lopsided mix', () => {
    const value = normalizedEntropy([50, 5, 3, 2]);
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(0.8);
  });

  it('returns 0 for no data', () => {
    expect(normalizedEntropy([])).toBe(0);
    expect(normalizedEntropy([0, 0])).toBe(0);
  });
});

describe('sequence helpers', () => {
  const day = (n: number): number => NOW - (400 - n) * DAY;

  it('finds the densest window and its bounds', () => {
    // Three plays in one week, then a long tail.
    const timestamps = [day(0), day(1), day(2), day(3), day(200), day(300)];
    const result = peakWindow(timestamps, 0, timestamps.length, 7 * DAY);
    expect(result.count).toBe(4);
    expect(result.from).toBe(day(0));
    expect(result.to).toBe(day(3));
  });

  it('returns zero for an empty range', () => {
    expect(peakWindow([], 0, 0, DAY).count).toBe(0);
  });

  it('measures how long an entity took to reach N plays', () => {
    const timestamps = Array.from({ length: 60 }, (_, i) => day(i * 2));
    expect(daysToNthPlay(timestamps, 0, timestamps.length, 50)).toBe(98);
    expect(daysToNthPlay(timestamps, 0, timestamps.length, 100)).toBeNull();
    expect(daysToNthPlay(timestamps, 0, timestamps.length, 1)).toBe(0);
  });

  it('finds the longest silence and where it fell', () => {
    const timestamps = [day(0), day(5), day(300), day(305)];
    const gap = longestGap(timestamps, 0, timestamps.length);
    expect(gap.days).toBe(295);
    expect(gap.from).toBe(day(5));
    expect(gap.to).toBe(day(300));
  });

  it('reports no gap for a single play', () => {
    const gap = longestGap([day(0)], 0, 1);
    expect(gap.days).toBe(0);
    expect(gap.from).toBeNull();
  });
});
