import type {
  AppInfo,
  AppSettings,
  ArchiveState,
  EntitlementState,
  LifetimeStats,
  YearlyPoint,
  TrackSummary,
  ArtistSummary,
  AlbumSummary,
  RediscoveryCard,
  OnThisDayEntry,
  RecordEntry,
  ClockStats,
  LostFavorite,
  LostFavoriteFilter,
  RewindYear,
  RewindMonth,
  Era,
  ObsessionSections,
  GraveyardItem,
  TrackDetail,
  ArtistDetail,
  AlbumDetail,
  DayDetail,
  ListeningSession,
  SessionDetail,
  Tag,
  Note,
  TrackFlags,
  SmartCollection,
  SmartRule,
  SearchHit,
  SearchFilters,
  ImportProgress,
  ImportReport,
  ImportHistoryEntry,
  IntegrityReport,
  BackupResult,
  BackupManifest,
  RestoreResult,
} from '@shared/types/domain';
import type { Paginated, EntityKind, AppError } from '@shared/types/common';

/**
 * The complete surface the renderer can see.
 *
 * This type is the contract: the preload script builds exactly this object and
 * nothing else crosses the bridge. There is no generic `invoke`, no `ipcRenderer`
 * and no way for renderer code to reach a channel that is not listed here.
 */

export interface ArchiveOverview {
  stats: LifetimeStats;
  yearly: YearlyPoint[];
  topTracks: TrackSummary[];
  topArtists: ArtistSummary[];
  lostFavoriteCount: number;
  eraCount: number;
  hasObsessions: boolean;
  graveyardCount: number;
}

export interface HeatmapResult {
  days: { date: string; value: number; plays: number; msPlayed: number }[];
  from: string | null;
  to: string | null;
  max: number;
  metric: 'msPlayed' | 'plays' | 'uniqueTracks';
  totalDays: number;
}

export interface SessionStats {
  total: number;
  averageEvents: number;
  averageMs: number;
  longest: ListeningSession | null;
  mostDiverse: ListeningSession | null;
  mostRepetitive: ListeningSession | null;
}

export interface LibraryTrack extends TrackSummary {
  favorite: boolean;
  retired: boolean;
  lostFavoriteScore: number;
  tagIds: number[];
}

export interface NoteWithSubject extends Note {
  subject: string;
  secondary: string | null;
}

export interface SearchFacets {
  years: number[];
  artists: { id: number; name: string; plays: number }[];
  tags: { id: number; name: string; color: string }[];
}

export interface HearlogueApi {
  app: {
    info(): Promise<AppInfo>;
    state(): Promise<ArchiveState>;
    entitlements(): Promise<EntitlementState>;
    quit(): Promise<boolean>;
  };
  settings: {
    all(): Promise<AppSettings>;
    patch(patch: Partial<AppSettings>): Promise<AppSettings>;
    reset(): Promise<AppSettings>;
  };
  importer: {
    pickFiles(): Promise<string[]>;
    pickFolder(): Promise<string[]>;
    start(paths: string[]): Promise<ImportProgress>;
    cancel(): Promise<boolean>;
    status(): Promise<{ progress: ImportProgress; report: ImportReport | null }>;
    report(): Promise<ImportReport | null>;
    history(): Promise<ImportHistoryEntry[]>;
    rebuildAnalytics(): Promise<ArchiveState>;
  };
  archive: {
    overview(): Promise<ArchiveOverview>;
    rediscovery(): Promise<RediscoveryCard | null>;
    onThisDay(input?: { month?: number | null; day?: number | null }): Promise<OnThisDayEntry[]>;
    records(): Promise<RecordEntry[]>;
    clock(): Promise<ClockStats>;
    topList(input: {
      kind?: EntityKind;
      year?: number | null;
      offset?: number;
      limit?: number;
    }): Promise<TrackSummary[] | ArtistSummary[] | AlbumSummary[]>;
  };
  lostFavorites: {
    list(input: {
      filter?: LostFavoriteFilter;
      offset?: number;
      limit?: number;
      diversify?: boolean;
      search?: string;
    }): Promise<Paginated<LostFavorite>>;
  };
  rewind: {
    years(): Promise<{ years: number[]; months: string[] }>;
    year(input: { year: number }): Promise<RewindYear>;
    month(input: { ym: string }): Promise<RewindMonth>;
    randomMonth(): Promise<string | null>;
  };
  eras: {
    list(): Promise<Era[]>;
    get(input: { id: number }): Promise<Era>;
    update(input: { id: number; customTitle: string | null }): Promise<Era>;
  };
  obsessions: {
    all(input?: { limit?: number }): Promise<ObsessionSections>;
  };
  graveyard: {
    list(input: {
      kind?: EntityKind;
      offset?: number;
      limit?: number;
      minDaysMissing?: number | null;
    }): Promise<Paginated<GraveyardItem>>;
  };
  entity: {
    track(input: { id: number }): Promise<TrackDetail>;
    artist(input: { id: number }): Promise<ArtistDetail>;
    album(input: { id: number }): Promise<AlbumDetail>;
  };
  calendar: {
    heatmap(input: {
      from?: string | null;
      to?: string | null;
      metric?: 'msPlayed' | 'plays' | 'uniqueTracks';
    }): Promise<HeatmapResult>;
    day(input: { date: string }): Promise<DayDetail>;
  };
  sessions: {
    list(input: {
      sort?: 'recent' | 'longest' | 'mostDiverse' | 'mostRepetitive' | 'mostTracks';
      offset?: number;
      limit?: number;
    }): Promise<Paginated<ListeningSession>>;
    get(input: { id: number }): Promise<SessionDetail>;
    stats(): Promise<SessionStats>;
  };
  library: {
    tracks(input: {
      tagId?: number | null;
      search?: string;
      sort?: 'plays' | 'msPlayed' | 'recent' | 'name' | 'artist' | 'lostFavorite';
      direction?: 'asc' | 'desc';
      offset?: number;
      limit?: number;
      status?: 'any' | 'favorite' | 'retired' | 'tagged' | 'untagged';
    }): Promise<Paginated<LibraryTrack>>;
    tags(): Promise<Tag[]>;
    createTag(input: { name: string; icon?: string; color?: string }): Promise<Tag>;
    updateTag(input: { id: number; name?: string; icon?: string; color?: string }): Promise<Tag>;
    deleteTag(input: { id: number }): Promise<boolean>;
    assignTag(input: { trackId: number; tagId: number }): Promise<boolean>;
    unassignTag(input: { trackId: number; tagId: number }): Promise<boolean>;
    setFlags(input: { trackId: number; favorite?: boolean; retired?: boolean }): Promise<TrackFlags>;
  };
  notes: {
    get(input: { entityType: Note['entityType']; entityId: number }): Promise<Note | null>;
    set(input: {
      entityType: Note['entityType'];
      entityId: number;
      body: string;
    }): Promise<Note | null>;
    list(): Promise<NoteWithSubject[]>;
  };
  collections: {
    list(): Promise<SmartCollection[]>;
    get(input: { id: number }): Promise<SmartCollection>;
    save(input: {
      id?: number | null;
      name: string;
      description?: string | null;
      icon?: string;
      matchMode?: 'all' | 'any';
      pinned?: boolean;
      rules: SmartRule[];
    }): Promise<SmartCollection>;
    remove(input: { id: number }): Promise<boolean>;
    preview(input: {
      matchMode?: 'all' | 'any';
      rules: SmartRule[];
      offset?: number;
      limit?: number;
    }): Promise<Paginated<TrackSummary>>;
    tracks(input: { id: number; offset?: number; limit?: number }): Promise<Paginated<TrackSummary>>;
  };
  search: {
    query(input: {
      query?: string;
      limit?: number;
      offset?: number;
      filters?: SearchFilters;
    }): Promise<{ items: SearchHit[]; total: number }>;
    facets(): Promise<SearchFacets>;
  };
  demo: {
    enable(): Promise<{ state: ArchiveState; seeding: boolean }>;
    disable(): Promise<ArchiveState>;
  };
  data: {
    backup(): Promise<BackupResult | null>;
    pickRestore(): Promise<{ path: string; manifest: BackupManifest } | null>;
    restore(input: { path: string }): Promise<RestoreResult>;
    exportCsv(): Promise<{ path: string; rows: number } | null>;
    deleteArchive(): Promise<ArchiveState>;
    integrity(): Promise<IntegrityReport>;
    resetDerived(): Promise<ArchiveState>;
    revealDatabase(): Promise<boolean>;
  };
  system: {
    openExternal(input: { url: string }): Promise<boolean>;
    openLogs(): Promise<boolean>;
    saveShareCard(input: { dataUrl: string; suggestedName: string }): Promise<string | null>;
    copyShareCard(input: { dataUrl: string; suggestedName: string }): Promise<boolean>;
  };
  events: {
    onImportProgress(listener: (progress: ImportProgress) => void): () => void;
    onImportDone(listener: (report: ImportReport) => void): () => void;
    onArchiveChanged(listener: (state: ArchiveState) => void): () => void;
    onNavigate(listener: (route: string) => void): () => void;
  };
}

/** Errors thrown by the bridge carry the structured payload from the main process. */
export interface BridgeError extends Error {
  appError: AppError;
}

declare global {
  interface Window {
    hearlogue: HearlogueApi;
  }
}
