import { app } from 'electron';
import { ALL_FEATURES, FREE_FEATURES } from '@shared/constants/features';
import type { EntitlementState } from '@shared/types/domain';

/**
 * Feature entitlements.
 *
 * HEARLOGUE is planned as a one-time purchase, with the rediscovery features
 * (Lost Favorites, Rewind, Eras, Obsessions, Graveyard, Smart Collections,
 * Share Cards, backup) forming the paid tier. No payment integration exists yet
 * and none is stubbed — this module is the single seam where one would attach.
 *
 * Today every build resolves to the full feature set. When a licence check is
 * added, only `resolve()` changes; the UI already asks
 * `useEntitlement(FEATURES.eras)` and knows nothing about receipts.
 */

export function resolveEntitlements(): EntitlementState {
  if (!app.isPackaged) {
    return { tier: 'pro', unlockedFeatures: [...ALL_FEATURES], source: 'development' };
  }

  // Until a purchase flow ships, packaged builds are also fully unlocked. The
  // free-tier list below is kept live so the gating path stays exercised rather
  // than rotting until the day it is switched on.
  const unlocked = [...ALL_FEATURES];
  return { tier: 'pro', unlockedFeatures: unlocked, source: 'purchase' };
}

/** The subset a free build would expose — retained for the eventual gating. */
export function freeEntitlements(): EntitlementState {
  return { tier: 'free', unlockedFeatures: [...FREE_FEATURES], source: 'purchase' };
}
