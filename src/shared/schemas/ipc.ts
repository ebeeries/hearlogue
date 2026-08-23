import { z } from 'zod';
import { MAX_PAGE_SIZE } from '../constants/analytics';

/**
 * Every IPC payload crossing the contextBridge is validated in the main process
 * against one of these schemas before it reaches a repository. The renderer is
 * treated as untrusted input.
 */

export const EmptySchema = z.object({}).strict().optional().default({});

export const IdSchema = z.object({ id: z.number().int().positive() }).strict();

export const PaginationSchema = z.object({
  offset: z.number().int().min(0).max(5_000_000).default(0),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(50),
});

export const EntityKindSchema = z.enum(['track', 'artist', 'album']);
export const NoteEntityKindSchema = z.enum(['track', 'artist', 'album', 'era']);

export const LostFavoritesQuerySchema = z
  .object({
    filter: z
      .enum([
        'all',
        'deepCuts',
        'oldFavorites',
        'forgottenArtists',
        'forgottenAlbums',
        'years3',
        'years5',
        'years10',
      ])
      .default('all'),
    offset: z.number().int().min(0).max(100_000).default(0),
    limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(40),
    diversify: z.boolean().default(true),
    search: z.string().max(200).optional(),
  })
  .strict();

export const RewindYearSchema = z.object({ year: z.number().int().min(1900).max(2200) }).strict();

export const RewindMonthSchema = z
  .object({ ym: z.string().regex(/^\d{4}-\d{2}$/) })
  .strict();

export const DayQuerySchema = z
  .object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
  .strict();

export const HeatmapQuerySchema = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
    metric: z.enum(['msPlayed', 'plays', 'uniqueTracks']).default('msPlayed'),
  })
  .strict();

export const GraveyardQuerySchema = z
  .object({
    kind: EntityKindSchema.default('track'),
    offset: z.number().int().min(0).max(100_000).default(0),
    limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(40),
    minDaysMissing: z.number().int().min(0).max(20000).nullable().default(null),
  })
  .strict();

export const ObsessionsQuerySchema = z
  .object({ limit: z.number().int().min(1).max(60).default(12) })
  .strict();

export const SearchQuerySchema = z
  .object({
    query: z.string().max(200).default(''),
    limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(40),
    offset: z.number().int().min(0).max(100_000).default(0),
    filters: z
      .object({
        kinds: z
          .array(z.enum(['track', 'artist', 'album', 'era', 'tag', 'collection']))
          .optional(),
        year: z.number().int().min(1900).max(2200).nullable().optional(),
        firstHeardFrom: z.number().int().min(1900).max(2200).nullable().optional(),
        firstHeardTo: z.number().int().min(1900).max(2200).nullable().optional(),
        lastHeardFrom: z.number().int().min(1900).max(2200).nullable().optional(),
        lastHeardTo: z.number().int().min(1900).max(2200).nullable().optional(),
        minPlays: z.number().int().min(0).max(1_000_000).nullable().optional(),
        artistId: z.number().int().positive().nullable().optional(),
        tagId: z.number().int().positive().nullable().optional(),
        minLostFavoriteScore: z.number().min(0).max(100).nullable().optional(),
        status: z.enum(['any', 'favorite', 'retired', 'dormant', 'active']).optional(),
      })
      .strict()
      .default({}),
  })
  .strict();

export const LibraryTracksQuerySchema = z
  .object({
    tagId: z.number().int().positive().nullable().default(null),
    search: z.string().max(200).default(''),
    sort: z
      .enum(['plays', 'msPlayed', 'recent', 'name', 'artist', 'lostFavorite'])
      .default('plays'),
    direction: z.enum(['asc', 'desc']).default('desc'),
    offset: z.number().int().min(0).max(1_000_000).default(0),
    limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(60),
    status: z.enum(['any', 'favorite', 'retired', 'tagged', 'untagged']).default('any'),
  })
  .strict();

export const TagCreateSchema = z
  .object({
    name: z.string().min(1).max(48),
    icon: z.string().min(1).max(40).default('Tag'),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default('#D6B06A'),
  })
  .strict();

export const TagUpdateSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string().min(1).max(48).optional(),
    icon: z.string().min(1).max(40).optional(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
  })
  .strict();

export const TagAssignSchema = z
  .object({
    trackId: z.number().int().positive(),
    tagId: z.number().int().positive(),
  })
  .strict();

export const NoteSetSchema = z
  .object({
    entityType: NoteEntityKindSchema,
    entityId: z.number().int().positive(),
    body: z.string().max(8000),
  })
  .strict();

export const NoteGetSchema = z
  .object({
    entityType: NoteEntityKindSchema,
    entityId: z.number().int().positive(),
  })
  .strict();

export const TrackFlagsSchema = z
  .object({
    trackId: z.number().int().positive(),
    favorite: z.boolean().optional(),
    retired: z.boolean().optional(),
  })
  .strict();

export const SmartRuleSchema = z.object({
  field: z.enum([
    'plays',
    'qualifyingPlays',
    'msPlayed',
    'firstHeardYear',
    'lastHeardYear',
    'daysSinceLastPlay',
    'lostFavoriteScore',
    'peakYear',
    'skipRate',
    'artist',
    'album',
    'tag',
    'favorite',
    'retired',
  ]),
  operator: z.enum([
    'gt',
    'gte',
    'lt',
    'lte',
    'eq',
    'neq',
    'contains',
    'notContains',
    'between',
    'isTrue',
    'isFalse',
  ]),
  value: z.string().max(200).default(''),
  value2: z.string().max(200).nullable().optional(),
});

export const SmartCollectionSaveSchema = z
  .object({
    id: z.number().int().positive().nullable().default(null),
    name: z.string().min(1).max(80),
    description: z.string().max(400).nullable().default(null),
    icon: z.string().min(1).max(40).default('Sparkles'),
    matchMode: z.enum(['all', 'any']).default('all'),
    pinned: z.boolean().default(false),
    rules: z.array(SmartRuleSchema).min(1).max(20),
  })
  .strict();

export const SmartCollectionPreviewSchema = z
  .object({
    matchMode: z.enum(['all', 'any']).default('all'),
    rules: z.array(SmartRuleSchema).max(20),
    limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(40),
    offset: z.number().int().min(0).max(100_000).default(0),
  })
  .strict();

export const EraUpdateSchema = z
  .object({
    id: z.number().int().positive(),
    customTitle: z.string().max(120).nullable().optional(),
  })
  .strict();

export const ImportStartSchema = z
  .object({
    paths: z.array(z.string().min(1).max(4096)).min(1).max(2000),
  })
  .strict();

export const SettingsPatchSchema = z
  .object({
    language: z.enum(['en', 'el']).optional(),
    startupBehavior: z.enum(['archive', 'lastVisited', 'rewind']).optional(),
    sidebarCollapsed: z.boolean().optional(),
    density: z.enum(['comfortable', 'compact']).optional(),
    reducedMotion: z.boolean().optional(),
    qualifyingPlayMs: z.number().int().min(0).max(600_000).optional(),
    sessionGapMinutes: z.number().int().min(1).max(720).optional(),
    includePrivateSessions: z.boolean().optional(),
    dormancyDays: z.number().int().min(30).max(7300).optional(),
    lastRoute: z.string().max(400).optional(),
    onboardingComplete: z.boolean().optional(),
    analyticsAutoRebuild: z.boolean().optional(),
  })
  .strict();

export const OpenExternalSchema = z.object({ url: z.string().max(2048) }).strict();

export const SessionsQuerySchema = z
  .object({
    sort: z
      .enum(['recent', 'longest', 'mostDiverse', 'mostRepetitive', 'mostTracks'])
      .default('longest'),
    offset: z.number().int().min(0).max(1_000_000).default(0),
    limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(40),
  })
  .strict();

export const OnThisDaySchema = z
  .object({
    month: z.number().int().min(1).max(12).nullable().default(null),
    day: z.number().int().min(1).max(31).nullable().default(null),
  })
  .strict();

export const ShareCardSchema = z
  .object({
    dataUrl: z.string().max(40_000_000),
    suggestedName: z.string().min(1).max(120),
  })
  .strict();

export const RestoreSchema = z.object({ path: z.string().min(1).max(4096) }).strict();

export const TopListQuerySchema = z
  .object({
    kind: EntityKindSchema.default('track'),
    year: z.number().int().min(1900).max(2200).nullable().default(null),
    offset: z.number().int().min(0).max(1_000_000).default(0),
    limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(50),
  })
  .strict();
