/**
 * Feature entitlements.
 *
 * HEARLOGUE ships every feature unlocked today. This module exists so that a
 * future one-time purchase can be introduced by changing a single resolver
 * rather than by threading conditionals through the UI. Screens ask
 * `useEntitlement(FEATURES.eras)` and never look at a purchase receipt directly.
 */

export const FEATURES = {
  import: 'import',
  archive: 'archive',
  basicStats: 'basicStats',
  basicSearch: 'basicSearch',
  trackDetail: 'trackDetail',
  artistDetail: 'artistDetail',
  albumDetail: 'albumDetail',
  calendar: 'calendar',
  library: 'library',
  notes: 'notes',

  lostFavorites: 'lostFavorites',
  rewind: 'rewind',
  eras: 'eras',
  obsessions: 'obsessions',
  graveyard: 'graveyard',
  smartCollections: 'smartCollections',
  shareCards: 'shareCards',
  advancedFilters: 'advancedFilters',
  backup: 'backup',
  sessions: 'sessions',
  records: 'records',
} as const;

export type FeatureKey = (typeof FEATURES)[keyof typeof FEATURES];

export const FREE_FEATURES: FeatureKey[] = [
  FEATURES.import,
  FEATURES.archive,
  FEATURES.basicStats,
  FEATURES.basicSearch,
  FEATURES.trackDetail,
  FEATURES.artistDetail,
  FEATURES.albumDetail,
  FEATURES.calendar,
  FEATURES.library,
  FEATURES.notes,
];

export const PRO_FEATURES: FeatureKey[] = [
  FEATURES.lostFavorites,
  FEATURES.rewind,
  FEATURES.eras,
  FEATURES.obsessions,
  FEATURES.graveyard,
  FEATURES.smartCollections,
  FEATURES.shareCards,
  FEATURES.advancedFilters,
  FEATURES.backup,
  FEATURES.sessions,
  FEATURES.records,
];

export const ALL_FEATURES: FeatureKey[] = [...FREE_FEATURES, ...PRO_FEATURES];
