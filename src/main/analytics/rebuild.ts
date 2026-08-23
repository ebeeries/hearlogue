import type { Db } from '../database/types';
import { buildAggregates, buildSearchIndex, type AggregateOptions } from './aggregates';
import { loadEvents } from './sequences';
import { buildTrackSequences, buildArtistSequences } from './lost-favorites';
import { buildObsessions } from './obsessions';
import { buildSessions } from './sessions';
import { buildEras } from './eras';
import { buildGraveyard } from './graveyard';
import { ANALYTICS_ENGINE_VERSION } from '@shared/constants/app';
import { createLogger } from '../utils/logger';

const log = createLogger('analytics');

/**
 * The analytics rebuild.
 *
 * Order matters: the aggregate tables are the substrate everything else reads,
 * the columnar event load is shared by every sequential pass, and the search
 * index is written last because it indexes era titles that do not exist until
 * segmentation has run.
 */

export type AnalyticsStep =
  | 'aggregates'
  | 'loading'
  | 'tracks'
  | 'artists'
  | 'obsessions'
  | 'sessions'
  | 'eras'
  | 'graveyard'
  | 'search'
  | 'done';

export const ANALYTICS_STEPS: AnalyticsStep[] = [
  'aggregates',
  'loading',
  'tracks',
  'artists',
  'obsessions',
  'sessions',
  'eras',
  'graveyard',
  'search',
];

export interface RebuildSettings {
  qualifyingPlayMs: number;
  includePrivateSessions: boolean;
  sessionGapMinutes: number;
  dormancyDays: number;
}

export interface RebuildResult {
  durationMs: number;
  events: number;
  lostFavorites: number;
  obsessions: number;
  sessions: number;
  eras: number;
  graveyard: number;
  erasReason: string;
}

export type StepReporter = (step: AnalyticsStep, index: number, total: number) => void;

export function rebuildAnalytics(
  db: Db,
  settings: RebuildSettings,
  report: StepReporter = () => {},
  now: number = Date.now(),
): RebuildResult {
  const started = Date.now();
  const options: AggregateOptions = {
    qualifyingPlayMs: settings.qualifyingPlayMs,
    includePrivateSessions: settings.includePrivateSessions,
    now,
  };

  const total = ANALYTICS_STEPS.length;
  const step = (name: AnalyticsStep): void => {
    report(name, ANALYTICS_STEPS.indexOf(name), total);
  };

  step('aggregates');
  buildAggregates(db, options);

  step('loading');
  const columns = loadEvents(db, options);

  step('tracks');
  const tracks = buildTrackSequences(db, columns, {
    ...options,
    dormancyDays: settings.dormancyDays,
  });

  step('artists');
  buildArtistSequences(db, columns);

  step('obsessions');
  const obsessions = buildObsessions(db, columns);

  step('sessions');
  const sessions = buildSessions(db, columns, settings.sessionGapMinutes);

  step('eras');
  const eras = buildEras(db);

  step('graveyard');
  const graveyard = buildGraveyard(db, options);

  step('search');
  buildSearchIndex(db);

  const setMeta = db.prepare(
    'INSERT INTO app_metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  setMeta.run('analytics_version', String(ANALYTICS_ENGINE_VERSION));
  setMeta.run('analytics_built_at', String(now));
  setMeta.run('analytics_settings', JSON.stringify(settings));

  const result: RebuildResult = {
    durationMs: Date.now() - started,
    events: columns.n,
    lostFavorites: tracks.qualified,
    obsessions: obsessions.tracks + obsessions.artists + obsessions.albums,
    sessions: sessions.count,
    eras: eras.count,
    graveyard,
    erasReason: eras.reason,
  };

  log.info('analytics rebuilt', {
    events: result.events,
    ms: result.durationMs,
    eras: result.eras,
    lostFavorites: result.lostFavorites,
  });

  return result;
}

/** True when the stored analytics were produced by an older engine or settings. */
export function analyticsAreStale(db: Db, settings: RebuildSettings): boolean {
  const rows = db.prepare('SELECT key, value FROM app_metadata').all() as {
    key: string;
    value: string;
  }[];
  const meta = new Map(rows.map((r) => [r.key, r.value]));

  if (Number(meta.get('analytics_version') ?? 0) !== ANALYTICS_ENGINE_VERSION) return true;
  if (!meta.get('analytics_built_at')) return true;

  const storedRaw = meta.get('analytics_settings');
  if (!storedRaw) return true;
  try {
    const stored = JSON.parse(storedRaw) as Partial<RebuildSettings>;
    return (
      stored.qualifyingPlayMs !== settings.qualifyingPlayMs ||
      stored.includePrivateSessions !== settings.includePrivateSessions ||
      stored.sessionGapMinutes !== settings.sessionGapMinutes ||
      stored.dormancyDays !== settings.dormancyDays
    );
  } catch {
    return true;
  }
}

/** Clears every derived table without touching imported events or user content. */
export function resetDerivedAnalytics(db: Db): void {
  const run = db.transaction(() => {
    db.exec(`
      DELETE FROM track_stats;
      DELETE FROM artist_stats;
      DELETE FROM album_stats;
      DELETE FROM monthly_track_stats;
      DELETE FROM monthly_artist_stats;
      DELETE FROM daily_stats;
      DELETE FROM hourly_stats;
      DELETE FROM yearly_stats;
      DELETE FROM sessions;
      DELETE FROM era_artists;
      DELETE FROM era_tracks;
      DELETE FROM eras;
      DELETE FROM obsessions;
      DELETE FROM graveyard;
      DELETE FROM search_index;
      DELETE FROM app_metadata WHERE key IN ('analytics_version', 'analytics_built_at', 'analytics_settings');
    `);
  });
  run();
}
