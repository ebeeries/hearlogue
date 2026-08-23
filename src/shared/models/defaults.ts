import {
  DEFAULT_QUALIFYING_PLAY_MS,
  DEFAULT_SESSION_GAP_MINUTES,
  DEFAULT_DORMANCY_DAYS,
} from '../constants/analytics';
import type { AppSettings } from '../types/domain';

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'en',
  startupBehavior: 'archive',
  sidebarCollapsed: false,
  density: 'comfortable',
  reducedMotion: false,
  qualifyingPlayMs: DEFAULT_QUALIFYING_PLAY_MS,
  sessionGapMinutes: DEFAULT_SESSION_GAP_MINUTES,
  includePrivateSessions: true,
  dormancyDays: DEFAULT_DORMANCY_DAYS,
  lastRoute: '/archive',
  onboardingComplete: false,
  demoMode: false,
  analyticsAutoRebuild: true,
};

/** Tags every archive starts with. Users may rename, recolour or delete them. */
export const BUILTIN_TAGS = [
  { name: 'Love', slug: 'love', icon: 'Heart', color: '#B4685E' },
  { name: 'All-Time Favourite', slug: 'all-time-favourite', icon: 'Star', color: '#D6B06A' },
  { name: 'Nostalgia', slug: 'nostalgia', icon: 'Hourglass', color: '#96768F' },
  { name: 'Night', slug: 'night', icon: 'Moon', color: '#7C8BA3' },
  { name: 'Workout', slug: 'workout', icon: 'Flame', color: '#C08F72' },
  { name: 'Driving', slug: 'driving', icon: 'Car', color: '#8CA595' },
  { name: 'Production Reference', slug: 'production-reference', icon: 'SlidersHorizontal', color: '#7E9384' },
  { name: 'Retired', slug: 'retired', icon: 'Archive', color: '#6E6961' },
] as const;

/** Colours offered in the tag editor — all drawn from the app palette. */
export const TAG_COLORS = [
  '#D6B06A',
  '#B4685E',
  '#96768F',
  '#7C8BA3',
  '#8CA595',
  '#C08F72',
  '#7E9384',
  '#A47F3C',
  '#918B7E',
] as const;

export const TAG_ICONS = [
  'Tag',
  'Heart',
  'Star',
  'Moon',
  'Sun',
  'Flame',
  'Car',
  'Hourglass',
  'Archive',
  'Bookmark',
  'Coffee',
  'Headphones',
  'Music',
  'Sparkles',
  'Compass',
  'Feather',
  'Mountain',
  'Waves',
  'SlidersHorizontal',
  'Snowflake',
] as const;

/** Smart Collections created for every new archive. */
export const STARTER_COLLECTIONS = [
  {
    name: 'Lost Classics',
    description: 'Heavily played, rarely skipped, and silent for years.',
    icon: 'Gem',
    matchMode: 'all' as const,
    pinned: true,
    rules: [
      { field: 'plays' as const, operator: 'gt' as const, value: '30' },
      { field: 'daysSinceLastPlay' as const, operator: 'gt' as const, value: '1095' },
      { field: 'skipRate' as const, operator: 'lt' as const, value: '20' },
    ],
  },
  {
    name: 'Forgotten 2010s',
    description: 'Discovered between 2010 and 2019, untouched since 2023.',
    icon: 'Hourglass',
    matchMode: 'all' as const,
    pinned: true,
    rules: [
      { field: 'firstHeardYear' as const, operator: 'between' as const, value: '2010', value2: '2019' },
      { field: 'lastHeardYear' as const, operator: 'lt' as const, value: '2023' },
      { field: 'plays' as const, operator: 'gte' as const, value: '10' },
    ],
  },
  {
    name: 'Still Standing',
    description: 'Songs that have never left your rotation.',
    icon: 'Anchor',
    matchMode: 'all' as const,
    pinned: false,
    rules: [
      { field: 'plays' as const, operator: 'gte' as const, value: '25' },
      { field: 'daysSinceLastPlay' as const, operator: 'lt' as const, value: '120' },
    ],
  },
];
