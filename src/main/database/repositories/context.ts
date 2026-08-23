import type { Db } from '../types';
import { DEFAULT_QUALIFYING_PLAY_MS } from '@shared/constants/analytics';

/**
 * Read-side access to the thresholds the current analytics were built with.
 *
 * Queries must classify a play exactly the way the rebuild did, otherwise a
 * detail page and its own summary card would disagree. The rebuild records the
 * settings it used; everything on the read path asks here rather than assuming a
 * constant.
 */

interface CachedSettings {
  qualifyingPlayMs: number;
  includePrivateSessions: boolean;
  sessionGapMinutes: number;
  dormancyDays: number;
}

const cache = new WeakMap<object, { raw: string | null; value: CachedSettings }>();

const FALLBACK: CachedSettings = {
  qualifyingPlayMs: DEFAULT_QUALIFYING_PLAY_MS,
  includePrivateSessions: true,
  sessionGapMinutes: 30,
  dormancyDays: 365,
};

export function analyticsSettings(db: Db): CachedSettings {
  let raw: string | null = null;
  try {
    const row = db
      .prepare("SELECT value FROM app_metadata WHERE key = 'analytics_settings'")
      .get() as { value: string } | undefined;
    raw = row?.value ?? null;
  } catch {
    return FALLBACK;
  }

  const cached = cache.get(db as unknown as object);
  if (cached && cached.raw === raw) return cached.value;

  let value = FALLBACK;
  if (raw) {
    try {
      value = { ...FALLBACK, ...(JSON.parse(raw) as Partial<CachedSettings>) };
    } catch {
      value = FALLBACK;
    }
  }
  cache.set(db as unknown as object, { raw, value });
  return value;
}

export function qualifyingMs(db: Db): number {
  return analyticsSettings(db).qualifyingPlayMs;
}
