import {
  LOST_FAVORITE_WEIGHTS,
  LOST_FAVORITE_MIN_QUALIFYING_PLAYS,
  LOST_FAVORITE_MIN_LISTENING_MS,
  LOST_FAVORITE_MAX_RECENT_SHARE,
  GRAVEYARD_MIN_PLAYS,
} from '@shared/constants/analytics';
import { MS_PER_DAY } from '@shared/utils/time';
import type { LostFavoriteDimensions } from '@shared/types/domain';

/**
 * Pure scoring mathematics.
 *
 * Every function here is deterministic and dependency-free so the meaning of a
 * score can be pinned down in tests rather than inferred from a query plan. The
 * prose counterpart lives in docs/analytics.md.
 */

/**
 * Clamps to 0..1.
 *
 * `Infinity` clamps to 1, not 0: a ratio that overflows means "as far above the
 * ceiling as it gets", and treating it as zero would score the most extreme
 * input as the least extreme one. Only `NaN` — a genuine absence of an answer —
 * collapses to 0.
 */
export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Maps a count onto 0..1 on a logarithmic curve between `lo` and `hi`.
 *
 * Play counts are heavily long-tailed — the difference between 5 and 20 plays
 * says far more about attachment than the difference between 300 and 315 — so
 * every count-like input is compressed this way rather than scaled linearly.
 */
export function logScale(value: number, lo: number, hi: number): number {
  if (hi <= lo) return 0;
  const v = Math.max(0, value);
  const num = Math.log1p(v) - Math.log1p(lo);
  const den = Math.log1p(hi) - Math.log1p(lo);
  return clamp01(num / den);
}

/**
 * Dormancy curve: how strongly a silence of `days` should register.
 *
 * Saturating rather than linear — the gap between 6 months and 2 years is
 * emotionally large, the gap between 8 and 9 years much less so.
 */
export function dormancyCurve(days: number, saturateDays = 365 * 8): number {
  if (days <= 0) return 0;
  return clamp01(Math.log1p(days / 30) / Math.log1p(saturateDays / 30));
}

export interface LostFavoriteInput {
  qualifyingPlays: number;
  plays: number;
  msPlayed: number;
  skips: number;
  firstTs: number | null;
  lastTs: number | null;
  distinctDays: number;
  activeMonths: number;
  /** Highest number of qualifying plays inside any 90-day window. */
  peakWindowPlays: number;
  /** Qualifying plays inside the recent window (see LOST_FAVORITE_RECENT_WINDOW_DAYS). */
  recentPlays: number;
  now: number;
  dormancyDays: number;
}

export interface LostFavoriteResult {
  score: number;
  dimensions: LostFavoriteDimensions;
  daysSinceLastPlay: number;
  /** Populated when a gate rejected the track; useful in tests and diagnostics. */
  rejectedBy: string | null;
}

const ZERO_DIMENSIONS: LostFavoriteDimensions = {
  historicalAffinity: 0,
  dormancy: 0,
  peakIntensity: 0,
  engagementQuality: 0,
  historicalConsistency: 0,
};

/**
 * The Lost Favorite Score, 0–100.
 *
 * A Lost Favorite is a song that genuinely mattered and then went quiet. The
 * gates below are what stop the list filling up with noise: a track played twice
 * in 2014 is not a lost favorite, it is a track you never liked. Likewise a
 * track that has quietly returned to rotation is not lost, however long the gap
 * before it was.
 */
export function lostFavoriteScore(input: LostFavoriteInput): LostFavoriteResult {
  const { qualifyingPlays, plays, msPlayed, skips, lastTs, now, dormancyDays } = input;

  const daysSinceLastPlay = lastTs === null ? 0 : Math.floor((now - lastTs) / MS_PER_DAY);

  const gate = (reason: string): LostFavoriteResult => ({
    score: 0,
    dimensions: ZERO_DIMENSIONS,
    daysSinceLastPlay,
    rejectedBy: reason,
  });

  if (lastTs === null) return gate('never-played');
  if (qualifyingPlays < LOST_FAVORITE_MIN_QUALIFYING_PLAYS) return gate('too-few-plays');
  if (msPlayed < LOST_FAVORITE_MIN_LISTENING_MS) return gate('too-little-time');
  if (daysSinceLastPlay < dormancyDays) return gate('not-dormant');
  if (qualifyingPlays > 0 && input.recentPlays / qualifyingPlays > LOST_FAVORITE_MAX_RECENT_SHARE) {
    return gate('already-returned');
  }

  const minutes = msPlayed / 60_000;
  const historicalAffinity = clamp01(
    0.6 * logScale(qualifyingPlays, 5, 400) + 0.4 * logScale(minutes, 15, 1200),
  );

  const dormancy = dormancyCurve(daysSinceLastPlay);

  const concentration = qualifyingPlays > 0 ? input.peakWindowPlays / qualifyingPlays : 0;
  const peakIntensity = clamp01(
    0.55 * logScale(input.peakWindowPlays, 3, 120) + 0.45 * clamp01(concentration),
  );

  const skipRate = plays > 0 ? clamp01(skips / plays) : 0;
  const qualifyingRatio = plays > 0 ? clamp01(qualifyingPlays / plays) : 0;
  const engagementQuality = clamp01(0.6 * (1 - skipRate) + 0.4 * qualifyingRatio);

  const historicalConsistency = clamp01(
    0.5 * logScale(input.activeMonths, 1, 36) + 0.5 * logScale(input.distinctDays, 2, 150),
  );

  const dimensions: LostFavoriteDimensions = {
    historicalAffinity,
    dormancy,
    peakIntensity,
    engagementQuality,
    historicalConsistency,
  };

  const score =
    100 *
    (LOST_FAVORITE_WEIGHTS.historicalAffinity * historicalAffinity +
      LOST_FAVORITE_WEIGHTS.dormancy * dormancy +
      LOST_FAVORITE_WEIGHTS.peakIntensity * peakIntensity +
      LOST_FAVORITE_WEIGHTS.engagementQuality * engagementQuality +
      LOST_FAVORITE_WEIGHTS.historicalConsistency * historicalConsistency);

  return {
    score: Math.round(score * 10) / 10,
    dimensions,
    daysSinceLastPlay,
    rejectedBy: null,
  };
}

export interface ObsessionIntensityInput {
  windowPlays: number;
  lifetimePlays: number;
  windowDays: number;
  playsAfter: number;
}

/**
 * How hard did this thing take hold?
 *
 * Balances three things a listener would actually recognise: what share of the
 * whole relationship happened in that window, how many plays it was in absolute
 * terms, and how dense they were day to day.
 */
export function obsessionIntensity(input: ObsessionIntensityInput): number {
  const share = input.lifetimePlays > 0 ? clamp01(input.windowPlays / input.lifetimePlays) : 0;
  const volume = logScale(input.windowPlays, 5, 150);
  const density = clamp01(input.windowPlays / Math.max(1, input.windowDays) / 6);
  return Math.round(100 * (0.42 * share + 0.36 * volume + 0.22 * density) * 10) / 10;
}

export interface GraveyardScoreInput {
  kind: 'track' | 'artist' | 'album';
  historicalPlays: number;
  daysMissing: number;
  rankAtPeak: number | null;
}

/**
 * Graveyard ranking.
 *
 * Weighted towards things that were once genuinely central — a top-10 artist of
 * some year that has not been played since carries more weight than a long tail
 * item with the same absolute play count.
 */
export function graveyardScore(input: GraveyardScoreInput): number {
  const floor = GRAVEYARD_MIN_PLAYS[input.kind];
  const magnitude = logScale(input.historicalPlays, floor, floor * 12);
  const silence = dormancyCurve(input.daysMissing);
  const prominence =
    input.rankAtPeak === null ? 0.35 : clamp01(1 - Math.log1p(input.rankAtPeak - 1) / Math.log1p(50));
  return Math.round(100 * (0.46 * magnitude + 0.36 * silence + 0.18 * prominence) * 10) / 10;
}

/**
 * Cosine similarity between two sparse artist-listening vectors.
 *
 * Era detection compares months by *who* was being listened to, not how much, so
 * vectors are compared by direction. Two months dominated by the same three
 * artists are similar even if one had three times the listening time.
 */
export function cosineSimilarity(a: Map<number, number>, b: Map<number, number>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const [key, value] of small) {
    const other = large.get(key);
    if (other !== undefined) dot += value * other;
  }
  for (const value of a.values()) normA += value * value;
  for (const value of b.values()) normB += value * value;
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Adds `source` into `target` in place. Used to aggregate a window of months. */
export function accumulateVector(target: Map<number, number>, source: Map<number, number>): void {
  for (const [key, value] of source) {
    target.set(key, (target.get(key) ?? 0) + value);
  }
}

/**
 * Shannon-entropy based diversity, normalised to 0..1.
 *
 * Used to tell a session where one album played end to end from a session that
 * wandered across twenty artists.
 */
export function normalizedEntropy(counts: number[]): number {
  const total = counts.reduce((sum, c) => sum + c, 0);
  if (total <= 0 || counts.length <= 1) return 0;
  let entropy = 0;
  for (const count of counts) {
    if (count <= 0) continue;
    const p = count / total;
    entropy -= p * Math.log(p);
  }
  return clamp01(entropy / Math.log(counts.length));
}

/**
 * Maximum number of entries inside any window of `windowMs`, given ascending
 * timestamps. Returns the count and the window bounds that achieved it.
 */
export function peakWindow(
  timestamps: ArrayLike<number>,
  start: number,
  end: number,
  windowMs: number,
): { count: number; from: number; to: number } {
  let best = 0;
  let bestFrom = start < end ? timestamps[start] : 0;
  let bestTo = bestFrom;
  let left = start;
  for (let right = start; right < end; right++) {
    while (timestamps[right] - timestamps[left] > windowMs) left += 1;
    const count = right - left + 1;
    if (count > best) {
      best = count;
      bestFrom = timestamps[left];
      bestTo = timestamps[right];
    }
  }
  return { count: best, from: bestFrom, to: bestTo };
}

/**
 * Days elapsed between the first play and the `n`th play, or null if the entity
 * never reached `n` plays.
 */
export function daysToNthPlay(
  timestamps: ArrayLike<number>,
  start: number,
  end: number,
  n: number,
): number | null {
  const available = end - start;
  if (available < n) return null;
  const first = timestamps[start];
  const nth = timestamps[start + n - 1];
  return Math.max(0, Math.floor((nth - first) / MS_PER_DAY));
}

/** The longest silence inside a sequence of ascending timestamps. */
export function longestGap(
  timestamps: ArrayLike<number>,
  start: number,
  end: number,
): { days: number; from: number | null; to: number | null } {
  let best = 0;
  let from: number | null = null;
  let to: number | null = null;
  for (let i = start + 1; i < end; i++) {
    const gap = timestamps[i] - timestamps[i - 1];
    if (gap > best) {
      best = gap;
      from = timestamps[i - 1];
      to = timestamps[i];
    }
  }
  return { days: Math.floor(best / MS_PER_DAY), from, to };
}
