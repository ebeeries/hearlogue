import type { AppError, EntityKind } from './common';

export interface ArchiveState {
  hasArchive: boolean;
  isDemo: boolean;
  eventCount: number;
  trackCount: number;
  artistCount: number;
  albumCount: number;
  firstTs: number | null;
  lastTs: number | null;
  analyticsVersion: number;
  analyticsBuiltAt: number | null;
  analyticsStale: boolean;
  importRunning: boolean;
}

export interface LifetimeStats {
  streams: number;
  qualifyingPlays: number;
  msPlayed: number;
  tracks: number;
  artists: number;
  albums: number;
  years: number;
  firstTs: number | null;
  lastTs: number | null;
  activeDays: number;
  skipRate: number;
}

export interface TrackSummary {
  id: number;
  name: string;
  artistId: number;
  artist: string;
  albumId: number | null;
  album: string | null;
  uri: string | null;
  plays: number;
  qualifyingPlays: number;
  msPlayed: number;
  firstTs: number | null;
  lastTs: number | null;
  skipRate: number;
}

export interface ArtistSummary {
  id: number;
  name: string;
  plays: number;
  qualifyingPlays: number;
  msPlayed: number;
  trackCount: number;
  firstTs: number | null;
  lastTs: number | null;
  uri: string | null;
}

export interface AlbumSummary {
  id: number;
  name: string;
  artistId: number;
  artist: string;
  plays: number;
  qualifyingPlays: number;
  msPlayed: number;
  trackCount: number;
  firstTs: number | null;
  lastTs: number | null;
  uri: string | null;
}

export interface LostFavoriteDimensions {
  historicalAffinity: number;
  dormancy: number;
  peakIntensity: number;
  engagementQuality: number;
  historicalConsistency: number;
}

export interface LostFavorite extends TrackSummary {
  score: number;
  daysSinceLastPlay: number;
  dimensions: LostFavoriteDimensions;
  peakYear: number | null;
  peakWindowPlays: number;
  activeMonths: number;
}

export type LostFavoriteFilter =
  | 'all'
  | 'deepCuts'
  | 'oldFavorites'
  | 'forgottenArtists'
  | 'forgottenAlbums'
  | 'years3'
  | 'years5'
  | 'years10';

export interface RediscoveryCard {
  track: TrackSummary;
  score: number;
  daysSinceLastPlay: number;
  peakYear: number | null;
  headlineKey: string;
  reasonKey: string;
  reasonValues: Record<string, string | number>;
}

export interface MonthlyPoint {
  ym: string;
  plays: number;
  qualifyingPlays: number;
  msPlayed: number;
}

export interface YearlyPoint {
  year: number;
  plays: number;
  qualifyingPlays: number;
  msPlayed: number;
  tracks: number;
  artists: number;
  albums: number;
}

export interface DailyPoint {
  date: string;
  plays: number;
  qualifyingPlays: number;
  msPlayed: number;
  uniqueTracks: number;
}

export interface HourBucket {
  hour: number;
  plays: number;
  msPlayed: number;
}

export type MilestoneKind =
  | 'first-heard'
  | 'play-count'
  | 'peak-month'
  | 'peak-year'
  | 'longest-absence'
  | 'comeback'
  | 'last-heard';

export interface Milestone {
  kind: MilestoneKind;
  ts: number;
  labelKey: string;
  values: Record<string, string | number>;
}

export interface ComebackInfo {
  gapDays: number;
  gapFrom: number;
  gapTo: number;
  playsAfter: number;
}

export interface Insight {
  key: string;
  values: Record<string, string | number>;
  tone?: 'neutral' | 'warm' | 'cool';
}

export type NoteEntityKindWire = 'track' | 'artist' | 'album' | 'era';

export interface Note {
  id: number;
  entityType: NoteEntityKindWire;
  entityId: number;
  body: string;
  createdAt: number;
  updatedAt: number;
}

export interface Tag {
  id: number;
  name: string;
  slug: string;
  icon: string;
  color: string;
  isBuiltin: boolean;
  trackCount?: number;
}

export interface TrackFlags {
  favorite: boolean;
  retired: boolean;
}

export interface TrackDetail {
  track: TrackSummary;
  shortPlays: number;
  skips: number;
  peakYear: number | null;
  peakYm: string | null;
  peakYmPlays: number;
  longestAbsenceDays: number;
  longestAbsenceFrom: number | null;
  longestAbsenceTo: number | null;
  distinctDays: number;
  activeMonths: number;
  lostFavoriteScore: number | null;
  monthly: MonthlyPoint[];
  yearly: YearlyPoint[];
  milestones: Milestone[];
  hourly: HourBucket[];
  tags: Tag[];
  note: Note | null;
  flags: TrackFlags;
  comeback: ComebackInfo | null;
  obsession: ObsessionItem | null;
}

export interface ArtistDetail {
  artist: ArtistSummary;
  events: number;
  shortPlays: number;
  skips: number;
  albumCount: number;
  topTrack: TrackSummary | null;
  topAlbum: AlbumSummary | null;
  peakYear: number | null;
  peakYm: string | null;
  longestAbsenceDays: number;
  longestAbsenceFrom: number | null;
  longestAbsenceTo: number | null;
  monthly: MonthlyPoint[];
  yearly: YearlyPoint[];
  topTracks: TrackSummary[];
  topAlbums: AlbumSummary[];
  insights: Insight[];
  note: Note | null;
}

export interface AlbumDetail {
  album: AlbumSummary;
  tracksHeard: number;
  topTracks: TrackSummary[];
  peakYm: string | null;
  peakYear: number | null;
  monthly: MonthlyPoint[];
  /** 0..1 — how evenly listening was spread across the album's tracks. */
  breadth: number;
  concentrationTop3: number;
  note: Note | null;
}

export interface EraArtistRef {
  id: number;
  name: string;
  plays: number;
  msPlayed: number;
}

export interface EraTrackRef {
  id: number;
  name: string;
  artist: string;
  plays: number;
}

export interface Era {
  id: number;
  position: number;
  startYm: string;
  endYm: string;
  startTs: number;
  endTs: number;
  months: number;
  autoTitle: string;
  customTitle: string | null;
  title: string;
  streams: number;
  qualifyingPlays: number;
  msPlayed: number;
  topArtists: EraArtistRef[];
  topTracks: EraTrackRef[];
  newArtists: number;
  changeStrength: number;
  accent: string;
  note: Note | null;
}

export interface ObsessionItem {
  kind: EntityKind;
  entityId: number;
  name: string;
  secondary: string | null;
  uri: string | null;
  windowDays: number;
  windowStart: number;
  windowEnd: number;
  windowPlays: number;
  lifetimePlays: number;
  share: number;
  playsPerDay: number;
  playsAfter: number;
  afterShare: number;
  intensity: number;
  daysToFifty: number | null;
  daysToHundred: number | null;
  longestRunMonths: number;
  peakWeekPlays: number;
}

export interface ObsessionSections {
  destroyed: ObsessionItem[];
  artistBinges: ObsessionItem[];
  albumAddictions: ObsessionItem[];
  oneHit: ObsessionItem[];
  fastestHundred: ObsessionItem[];
  mostIntenseWeek: ObsessionItem[];
  longest: ObsessionItem[];
}

export interface GraveyardItem {
  kind: EntityKind;
  entityId: number;
  name: string;
  secondary: string | null;
  uri: string | null;
  peakYear: number | null;
  historicalPlays: number;
  msPlayed: number;
  lastTs: number;
  daysMissing: number;
  rankAtPeak: number | null;
  score: number;
}

export type RuleField =
  | 'plays'
  | 'qualifyingPlays'
  | 'msPlayed'
  | 'firstHeardYear'
  | 'lastHeardYear'
  | 'daysSinceLastPlay'
  | 'lostFavoriteScore'
  | 'peakYear'
  | 'skipRate'
  | 'artist'
  | 'album'
  | 'tag'
  | 'favorite'
  | 'retired';

export type RuleOperator =
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'eq'
  | 'neq'
  | 'contains'
  | 'notContains'
  | 'between'
  | 'isTrue'
  | 'isFalse';

export interface SmartRule {
  id?: number;
  field: RuleField;
  operator: RuleOperator;
  value: string;
  value2?: string | null;
  position?: number;
}

export interface SmartCollection {
  id: number;
  name: string;
  description: string | null;
  icon: string;
  matchMode: 'all' | 'any';
  rules: SmartRule[];
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  count?: number;
}

export interface ListeningSession {
  id: number;
  startTs: number;
  endTs: number;
  durationMs: number;
  msPlayed: number;
  events: number;
  qualifyingPlays: number;
  uniqueTracks: number;
  uniqueArtists: number;
  topArtistId: number | null;
  topArtist: string | null;
  topTrackId: number | null;
  topTrack: string | null;
  maxTrackRepeats: number;
  diversity: number;
}

export interface SessionEvent {
  ts: number;
  trackId: number;
  track: string;
  artistId: number;
  artist: string;
  msPlayed: number;
  skipped: boolean;
}

export interface SessionDetail extends ListeningSession {
  events_list: SessionEvent[];
}

export interface DayDetail {
  date: string;
  msPlayed: number;
  events: number;
  qualifyingPlays: number;
  uniqueTracks: number;
  uniqueArtists: number;
  firstTs: number | null;
  lastTs: number | null;
  topArtist: { id: number; name: string; plays: number } | null;
  topTrack: { id: number; name: string; artist: string; plays: number } | null;
  hourly: HourBucket[];
  topTracks: { id: number; name: string; artist: string; plays: number; msPlayed: number }[];
  sessions: ListeningSession[];
}

export interface OnThisDayEntry {
  year: number;
  date: string;
  events: number;
  msPlayed: number;
  qualifyingPlays: number;
  topArtist: { id: number; name: string; plays: number } | null;
  topTrack: { id: number; name: string; artist: string; plays: number } | null;
}

export interface RecordEntry {
  key: string;
  values: Record<string, string | number>;
  entity?: { kind: EntityKind; id: number; name: string; secondary: string | null };
  ts?: number | null;
}

export interface RewindYear {
  year: number;
  streams: number;
  qualifyingPlays: number;
  msPlayed: number;
  tracks: number;
  artists: number;
  albums: number;
  topTracks: TrackSummary[];
  topArtists: ArtistSummary[];
  topAlbums: AlbumSummary[];
  firstHeardArtists: { id: number; name: string; ts: number; plays: number }[];
  firstHeardTracks: { id: number; name: string; artist: string; ts: number; plays: number }[];
  biggestObsession: ObsessionItem | null;
  mostActiveMonth: { ym: string; plays: number; msPlayed: number } | null;
  mostActiveDay: { date: string; plays: number; msPlayed: number } | null;
  lateNightShare: number;
  hourly: HourBucket[];
  monthly: MonthlyPoint[];
  vanished: TrackSummary[];
  previous: { year: number; streams: number; msPlayed: number } | null;
}

export interface RewindMonth {
  ym: string;
  streams: number;
  qualifyingPlays: number;
  msPlayed: number;
  tracks: number;
  artists: number;
  topTracks: TrackSummary[];
  topArtists: ArtistSummary[];
  daily: DailyPoint[];
  newArtists: { id: number; name: string; plays: number }[];
}

export type SearchHitKind = 'track' | 'artist' | 'album' | 'era' | 'tag' | 'collection';

export interface SearchHit {
  kind: SearchHitKind;
  id: number;
  title: string;
  subtitle: string | null;
  plays: number;
  msPlayed: number;
  lastTs: number | null;
  score: number;
}

export interface SearchFilters {
  kinds?: SearchHitKind[];
  year?: number | null;
  firstHeardFrom?: number | null;
  firstHeardTo?: number | null;
  lastHeardFrom?: number | null;
  lastHeardTo?: number | null;
  minPlays?: number | null;
  artistId?: number | null;
  tagId?: number | null;
  minLostFavoriteScore?: number | null;
  status?: 'any' | 'favorite' | 'retired' | 'dormant' | 'active';
}

export type ImportPhase =
  | 'idle'
  | 'preparing'
  | 'scanning'
  | 'parsing'
  | 'writing'
  | 'analytics'
  | 'finalizing'
  | 'complete'
  | 'failed'
  | 'cancelled';

export interface ImportProgress {
  importId: number | null;
  phase: ImportPhase;
  /** 0..1 across the whole job. */
  progress: number;
  filesTotal: number;
  filesDone: number;
  currentFile: string | null;
  eventsFound: number;
  eventsInserted: number;
  eventsDuplicate: number;
  eventsInvalid: number;
  artists: number;
  tracks: number;
  albums: number;
  yearsFrom: number | null;
  yearsTo: number | null;
  analyticsStep: string | null;
  messageKey: string | null;
  error: AppError | null;
}

export interface ImportHighlight {
  key: string;
  values: Record<string, string | number>;
}

export interface ImportReport {
  importId: number;
  filesProcessed: number;
  filesSkipped: number;
  eventsFound: number;
  eventsInserted: number;
  eventsDuplicate: number;
  eventsInvalid: number;
  existingBefore: number;
  totalAfter: number;
  artists: number;
  tracks: number;
  albums: number;
  yearsFrom: number | null;
  yearsTo: number | null;
  durationMs: number;
  highlights: ImportHighlight[];
}

export interface ImportHistoryEntry {
  id: number;
  startedAt: number;
  finishedAt: number | null;
  sourceType: string;
  sourceName: string;
  fileCount: number;
  eventsFound: number;
  eventsInserted: number;
  eventsDuplicate: number;
  status: string;
}

export interface AppInfo {
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  arch: string;
  databasePath: string;
  logsPath: string;
  userDataPath: string;
  isDev: boolean;
}

export interface AppSettings {
  language: 'en' | 'el';
  startupBehavior: 'archive' | 'lastVisited' | 'rewind';
  sidebarCollapsed: boolean;
  density: 'comfortable' | 'compact';
  reducedMotion: boolean;
  qualifyingPlayMs: number;
  sessionGapMinutes: number;
  includePrivateSessions: boolean;
  dormancyDays: number;
  lastRoute: string;
  onboardingComplete: boolean;
  demoMode: boolean;
  analyticsAutoRebuild: boolean;
}

export interface EntitlementState {
  tier: 'free' | 'pro';
  unlockedFeatures: string[];
  source: 'development' | 'purchase' | 'trial';
}

export interface IntegrityReport {
  ok: boolean;
  checks: { name: string; ok: boolean; detail: string }[];
  sizeBytes: number;
  pageCount: number;
  freePages: number;
}

export interface BackupResult {
  path: string;
  sizeBytes: number;
  createdAt: number;
}

export interface BackupManifest {
  formatVersion: number;
  appVersion: string;
  createdAt: number;
  schemaVersion: number;
  eventCount: number;
  isDemo: boolean;
}

export interface RestoreResult {
  restored: boolean;
  manifest: BackupManifest;
  eventCount: number;
}

export interface ClockStats {
  hourly: HourBucket[];
  peakHour: number;
  dayparts: { key: string; plays: number; msPlayed: number; share: number }[];
  weekday: { plays: number; msPlayed: number };
  weekend: { plays: number; msPlayed: number };
  afterMidnightShare: number;
  byDow: { dow: number; plays: number; msPlayed: number }[];
}
