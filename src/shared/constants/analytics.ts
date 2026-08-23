/**
 * Every threshold that shapes HEARLOGUE's interpretation of a listening history
 * lives here. These are deliberately explicit: the Spotify export does not carry
 * track durations, so the app never claims completion percentages it cannot know.
 * Instead it reasons about play counts, dwell time and behavioural signals.
 *
 * See docs/analytics.md for the prose definitions that accompany these numbers.
 */

/** A play only "counts" once it has been listened to for at least this long. */
export const DEFAULT_QUALIFYING_PLAY_MS = 30_000;

/** Anything under the qualifying threshold is a Short Play. */
export const SHORT_PLAY_MAX_MS = DEFAULT_QUALIFYING_PLAY_MS;

/**
 * A playback event counts as a Skip when Spotify flagged it, or when the listener
 * moved on very quickly by their own hand.
 */
export const SKIP_MAX_MS = 20_000;
export const SKIP_REASONS = ['fwdbtn', 'backbtn', 'endplay', 'remote'] as const;

/** Minutes of silence that separate one listening session from the next. */
export const DEFAULT_SESSION_GAP_MINUTES = 30;

/** A track is Dormant once this many days have passed since its last play. */
export const DEFAULT_DORMANCY_DAYS = 365;

/** Windows used by the obsession engine, in days. */
export const OBSESSION_WINDOWS_DAYS = [7, 30, 60, 90] as const;
export const OBSESSION_PRIMARY_WINDOW_DAYS = 30;

/** Minimum lifetime qualifying plays before an entity can be an obsession. */
export const OBSESSION_MIN_TRACK_PLAYS = 20;
export const OBSESSION_MIN_ARTIST_PLAYS = 60;
export const OBSESSION_MIN_ALBUM_PLAYS = 30;

/** Share of lifetime plays inside the peak window that marks a true fixation. */
export const OBSESSION_STRONG_SHARE = 0.5;
export const ONE_HIT_OBSESSION_SHARE = 0.6;
export const ONE_HIT_OBSESSION_MAX_AFTER_SHARE = 0.12;

/** Lost Favorite gates. A track played twice in 2014 is not a lost favorite. */
export const LOST_FAVORITE_MIN_QUALIFYING_PLAYS = 8;
export const LOST_FAVORITE_MIN_LISTENING_MS = 20 * 60_000;
export const LOST_FAVORITE_RECENT_WINDOW_DAYS = 180;
/** If more than this share of lifetime plays happened recently, it came back. */
export const LOST_FAVORITE_MAX_RECENT_SHARE = 0.05;
export const LOST_FAVORITE_MIN_SCORE = 30;

/** Weighting of the five Lost Favorite dimensions. Must sum to 1. */
export const LOST_FAVORITE_WEIGHTS = {
  historicalAffinity: 0.3,
  dormancy: 0.26,
  peakIntensity: 0.17,
  engagementQuality: 0.13,
  historicalConsistency: 0.14,
} as const;

/** No more than this many entries from a single artist in a Lost Favorites page. */
export const LOST_FAVORITE_ARTIST_DIVERSITY_CAP = 2;

/** Graveyard gates per entity kind. */
export const GRAVEYARD_MIN_PLAYS = { track: 25, artist: 60, album: 30 } as const;
export const GRAVEYARD_MIN_DAYS_MISSING = 365 * 2;
export const GRAVEYARD_MAX_RECENT_PLAYS = 2;

/** Era segmentation. */
export const ERA_MIN_MONTHS = 3;
export const ERA_WINDOW_MONTHS = 3;
/** Cosine distance above which a month boundary is a candidate era change. */
export const ERA_CHANGE_THRESHOLD = 0.42;
/** Segments more similar than this get merged back together. */
export const ERA_MERGE_SIMILARITY = 0.78;
/** Months with fewer plays than this are treated as gaps, not eras. */
export const ERA_MIN_MONTH_PLAYS = 10;
export const ERA_VECTOR_TOP_ARTISTS = 40;

/** Comeback detection: a return only counts if it was sustained. */
export const COMEBACK_MIN_GAP_DAYS = 180;
export const COMEBACK_MIN_PLAYS_AFTER = 5;
export const COMEBACK_WINDOW_AFTER_DAYS = 90;

/** Milestone thresholds surfaced on detail pages. */
export const MILESTONE_PLAY_COUNTS = [1, 10, 25, 50, 100, 250, 500, 1000] as const;

/** Listening-clock buckets. */
export const DAYPARTS = [
  { key: 'lateNight', from: 0, to: 5 },
  { key: 'morning', from: 5, to: 12 },
  { key: 'afternoon', from: 12, to: 17 },
  { key: 'evening', from: 17, to: 22 },
  { key: 'night', from: 22, to: 24 },
] as const;

export type DaypartKey = (typeof DAYPARTS)[number]['key'];

/** Page sizes used across list surfaces. */
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 500;

/** Import tuning. */
export const IMPORT_INSERT_BATCH = 2_000;
export const IMPORT_PROGRESS_INTERVAL_MS = 120;
