import { app, dialog, BrowserWindow } from 'electron';
import fs from 'node:fs';
import { z } from 'zod';
import { handle, broadcast } from './register';
import { CH, PUSH } from '@shared/constants/channels';
import * as S from '@shared/schemas/ipc';
import { archiveService } from '../services/archive-service';
import { importService } from '../services/import-service';
import { resolveEntitlements } from '../services/entitlements';
import { openExternal, openLogsFolder, saveShareCard, copyShareCard, revealInFolder } from '../services/external';
import { logsDir, userDataDir } from '../utils/paths';
import { writeSettings } from '../database/repositories/settings';
import * as archiveRepo from '../database/repositories/archive';
import * as entityRepo from '../database/repositories/entities';
import * as discoveryRepo from '../database/repositories/discovery';
import * as eraRepo from '../database/repositories/eras';
import * as obsessionRepo from '../database/repositories/obsessions';
import * as rewindRepo from '../database/repositories/rewind';
import * as calendarRepo from '../database/repositories/calendar';
import * as libraryRepo from '../database/repositories/library';
import * as collectionRepo from '../database/repositories/collections';
import * as searchRepo from '../database/repositories/search';
import { importHistory } from '../database/repositories/settings';
import { HearlogueError } from '../utils/errors';
import { APP_NAME } from '@shared/constants/app';
import type { AppInfo } from '@shared/types/domain';

/**
 * Every IPC handler in one place.
 *
 * Handlers stay thin on purpose: validate (done by `handle`), call a repository,
 * return. Anything with real logic belongs in a repository or a service where it
 * can be tested without an Electron runtime.
 */

const db = () => archiveService.current;
const now = () => Date.now();

function focusedWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
}

export function registerHandlers(): void {
  /* ------------------------------- app ------------------------------- */

  handle(CH.app.info, S.EmptySchema, (): AppInfo => ({
    version: app.getVersion(),
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    node: process.versions.node ?? '',
    platform: process.platform,
    arch: process.arch,
    databasePath: archiveService.databaseFile,
    logsPath: logsDir(),
    userDataPath: userDataDir(),
    isDev: !app.isPackaged,
  }));

  handle(CH.app.state, S.EmptySchema, () => archiveService.state());
  handle(CH.app.entitlements, S.EmptySchema, () => resolveEntitlements());
  handle(CH.app.quit, S.EmptySchema, () => {
    app.quit();
    return true;
  });

  /* ----------------------------- settings ---------------------------- */

  handle(CH.settings.all, S.EmptySchema, () => archiveService.settings());

  handle(CH.settings.patch, S.SettingsPatchSchema, (patch) => {
    const previous = archiveService.settings();
    const next = writeSettings(db(), patch);

    // Changing an analytics threshold invalidates every derived table.
    const analyticsChanged =
      previous.qualifyingPlayMs !== next.qualifyingPlayMs ||
      previous.includePrivateSessions !== next.includePrivateSessions ||
      previous.sessionGapMinutes !== next.sessionGapMinutes ||
      previous.dormancyDays !== next.dormancyDays;

    if (analyticsChanged) broadcast(PUSH.archiveChanged, archiveService.state());
    return next;
  });

  handle(CH.settings.reset, S.EmptySchema, () => {
    const current = archiveService.settings();
    return writeSettings(db(), {
      language: current.language,
      startupBehavior: 'archive',
      sidebarCollapsed: false,
      density: 'comfortable',
      reducedMotion: false,
      analyticsAutoRebuild: true,
    });
  });

  /* ------------------------------ import ----------------------------- */

  handle(CH.importer.pickFiles, S.EmptySchema, async () => {
    const result = await dialog.showOpenDialog(focusedWindow() ?? undefined!, {
      title: 'Select your Spotify export',
      buttonLabel: 'Import',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Spotify export', extensions: ['zip', 'json'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    return result.canceled ? [] : result.filePaths;
  });

  handle(CH.importer.pickFolder, S.EmptySchema, async () => {
    const result = await dialog.showOpenDialog(focusedWindow() ?? undefined!, {
      title: 'Select your extracted Spotify data folder',
      buttonLabel: 'Import',
      properties: ['openDirectory'],
    });
    return result.canceled ? [] : result.filePaths;
  });

  handle(CH.importer.start, S.ImportStartSchema, ({ paths }) => importService.start(paths));

  handle(CH.importer.cancel, S.EmptySchema, () => {
    importService.cancel();
    return true;
  });

  handle(CH.importer.status, S.EmptySchema, () => importService.status());
  handle(CH.importer.report, S.EmptySchema, () => importService.status().report);
  handle(CH.importer.history, S.EmptySchema, () => importHistory(db()));

  handle(CH.importer.rebuildAnalytics, S.EmptySchema, () => {
    if (importService.isRunning) throw new HearlogueError('IMPORT_RUNNING', 'error.importRunning');
    archiveService.rebuildNow();
    const state = archiveService.state();
    broadcast(PUSH.archiveChanged, state);
    return state;
  });

  /* ----------------------------- archive ----------------------------- */

  handle(CH.archive.overview, S.EmptySchema, () => ({
    stats: archiveRepo.lifetimeStats(db()),
    yearly: archiveRepo.yearlyPoints(db()),
    topTracks: archiveRepo.topTracks(db(), 5),
    topArtists: archiveRepo.topArtists(db(), 5),
    lostFavoriteCount: discoveryRepo.lostFavoriteCount(db()),
    eraCount: eraRepo.eraCount(db()),
    hasObsessions: obsessionRepo.hasObsessions(db()),
    graveyardCount: (
      db().prepare('SELECT COUNT(*) AS n FROM graveyard').get() as { n: number }
    ).n,
  }));

  handle(CH.archive.rediscovery, S.EmptySchema, () => archiveRepo.rediscovery(db(), now()));
  handle(CH.archive.onThisDay, S.OnThisDaySchema, ({ month, day }) =>
    archiveRepo.onThisDay(db(), now(), month, day),
  );
  handle(CH.archive.records, S.EmptySchema, () => archiveRepo.records(db(), now()));
  handle(CH.archive.clock, S.EmptySchema, () => archiveRepo.clockStats(db()));

  handle(CH.archive.topList, S.TopListQuerySchema, ({ kind, year, offset, limit }) => {
    if (kind === 'artist') return archiveRepo.topArtists(db(), limit, offset, year);
    if (kind === 'album') return archiveRepo.topAlbums(db(), limit, offset, year);
    return archiveRepo.topTracks(db(), limit, offset, year);
  });

  /* -------------------------- lost favorites ------------------------- */

  handle(CH.lostFavorites.list, S.LostFavoritesQuerySchema, (query) =>
    discoveryRepo.lostFavorites(db(), { ...query, now: now() }),
  );

  /* ------------------------------ rewind ----------------------------- */

  handle(CH.rewind.years, S.EmptySchema, () => ({
    years: rewindRepo.availableYears(db()),
    months: rewindRepo.availableMonths(db()),
  }));
  handle(CH.rewind.year, S.RewindYearSchema, ({ year }) => rewindRepo.rewindYear(db(), year, now()));
  handle(CH.rewind.month, S.RewindMonthSchema, ({ ym }) => rewindRepo.rewindMonth(db(), ym));
  handle(CH.rewind.randomMonth, S.EmptySchema, () => rewindRepo.randomMonth(db(), Date.now()));

  /* ------------------------------- eras ------------------------------ */

  handle(CH.eras.list, S.EmptySchema, () => eraRepo.listEras(db()));
  handle(CH.eras.get, S.IdSchema, ({ id }) => eraRepo.getEra(db(), id));
  handle(CH.eras.update, S.EraUpdateSchema, ({ id, customTitle }) =>
    eraRepo.renameEra(db(), id, customTitle ?? null),
  );

  /* ---------------------------- obsessions --------------------------- */

  handle(CH.obsessions.all, S.ObsessionsQuerySchema, ({ limit }) =>
    obsessionRepo.obsessionSections(db(), limit),
  );

  /* ---------------------------- graveyard ---------------------------- */

  handle(CH.graveyard.list, S.GraveyardQuerySchema, (query) => discoveryRepo.graveyard(db(), query));

  /* ----------------------------- entities ---------------------------- */

  handle(CH.entity.track, S.IdSchema, ({ id }) => entityRepo.trackDetail(db(), id));
  handle(CH.entity.artist, S.IdSchema, ({ id }) => entityRepo.artistDetail(db(), id));
  handle(CH.entity.album, S.IdSchema, ({ id }) => entityRepo.albumDetail(db(), id));

  /* ----------------------------- calendar ---------------------------- */

  handle(CH.calendar.heatmap, S.HeatmapQuerySchema, ({ from, to, metric }) =>
    calendarRepo.heatmap(db(), from, to, metric),
  );
  handle(CH.calendar.day, S.DayQuerySchema, ({ date }) => calendarRepo.dayDetail(db(), date));

  /* ----------------------------- sessions ---------------------------- */

  handle(CH.sessions.list, S.SessionsQuerySchema, ({ sort, offset, limit }) =>
    calendarRepo.listSessions(db(), sort, offset, limit),
  );
  handle(CH.sessions.get, S.IdSchema, ({ id }) => calendarRepo.sessionDetail(db(), id));
  handle(CH.sessions.stats, S.EmptySchema, () => calendarRepo.sessionStats(db()));

  /* ------------------------------ library ---------------------------- */

  handle(CH.library.tracks, S.LibraryTracksQuerySchema, (query) =>
    libraryRepo.libraryTracks(db(), query),
  );
  handle(CH.library.tags, S.EmptySchema, () => libraryRepo.listTags(db()));
  handle(CH.library.createTag, S.TagCreateSchema, ({ name, icon, color }) =>
    libraryRepo.createTag(db(), name, icon, color),
  );
  handle(CH.library.updateTag, S.TagUpdateSchema, ({ id, ...patch }) =>
    libraryRepo.updateTag(db(), id, patch),
  );
  handle(CH.library.deleteTag, S.IdSchema, ({ id }) => {
    libraryRepo.deleteTag(db(), id);
    return true;
  });
  handle(CH.library.assignTag, S.TagAssignSchema, ({ trackId, tagId }) => {
    libraryRepo.assignTag(db(), trackId, tagId);
    return true;
  });
  handle(CH.library.unassignTag, S.TagAssignSchema, ({ trackId, tagId }) => {
    libraryRepo.unassignTag(db(), trackId, tagId);
    return true;
  });
  handle(CH.library.setFlags, S.TrackFlagsSchema, ({ trackId, ...patch }) =>
    libraryRepo.setTrackFlags(db(), trackId, patch),
  );

  /* ------------------------------- notes ----------------------------- */

  handle(CH.notes.get, S.NoteGetSchema, ({ entityType, entityId }) =>
    libraryRepo.getNote(db(), entityType, entityId),
  );
  handle(CH.notes.set, S.NoteSetSchema, ({ entityType, entityId, body }) =>
    libraryRepo.setNote(db(), entityType, entityId, body),
  );
  handle(CH.notes.list, S.EmptySchema, () => libraryRepo.listNotes(db()));

  /* ---------------------------- collections -------------------------- */

  handle(CH.collections.list, S.EmptySchema, () => collectionRepo.listCollections(db(), now()));
  handle(CH.collections.get, S.IdSchema, ({ id }) => collectionRepo.getCollection(db(), id, now()));
  handle(CH.collections.save, S.SmartCollectionSaveSchema, (input) =>
    collectionRepo.saveCollection(db(), input, now()),
  );
  handle(CH.collections.remove, S.IdSchema, ({ id }) => {
    collectionRepo.deleteCollection(db(), id);
    return true;
  });
  handle(CH.collections.preview, S.SmartCollectionPreviewSchema, ({ rules, matchMode, offset, limit }) =>
    collectionRepo.previewCollection(db(), rules, matchMode, offset, limit, now()),
  );
  handle(
    CH.collections.tracks,
    S.IdSchema.extend({
      offset: z.number().int().min(0).max(100_000).default(0),
      limit: z.number().int().min(1).max(500).default(50),
    }),
    ({ id, offset, limit }) => collectionRepo.collectionTracks(db(), id, offset, limit, now()),
  );

  /* ------------------------------ search ----------------------------- */

  handle(CH.search.query, S.SearchQuerySchema, ({ query, limit, offset, filters }) =>
    searchRepo.search(db(), { query, limit, offset, filters, now: now() }),
  );
  handle(CH.search.facets, S.EmptySchema, () => searchRepo.searchFacets(db()));

  /* ------------------------------- demo ------------------------------ */

  handle(CH.demo.enable, S.EmptySchema, () => {
    if (importService.isRunning) throw new HearlogueError('IMPORT_RUNNING', 'error.importRunning');
    archiveService.enterDemo();
    const needsSeeding = archiveService.demoNeedsSeeding();
    if (needsSeeding) importService.start([], { kind: 'demo' });
    const state = archiveService.state();
    broadcast(PUSH.archiveChanged, state);
    return { state, seeding: needsSeeding };
  });

  handle(CH.demo.disable, S.EmptySchema, () => {
    if (importService.isRunning) throw new HearlogueError('IMPORT_RUNNING', 'error.importRunning');
    archiveService.exitDemo();
    const state = archiveService.state();
    broadcast(PUSH.archiveChanged, state);
    return state;
  });

  /* ------------------------------- data ------------------------------ */

  handle(CH.data.backup, S.EmptySchema, async () => {
    const stamp = new Date().toISOString().slice(0, 10);
    const result = await dialog.showSaveDialog(focusedWindow() ?? undefined!, {
      title: 'Back up your archive',
      defaultPath: `${APP_NAME.toLowerCase()}-${stamp}.hearlogue`,
      filters: [{ name: 'HEARLOGUE backup', extensions: ['hearlogue'] }],
    });
    if (result.canceled || !result.filePath) return null;
    return archiveService.backup(result.filePath);
  });

  handle(CH.data.pickRestore, S.EmptySchema, async () => {
    const result = await dialog.showOpenDialog(focusedWindow() ?? undefined!, {
      title: 'Choose a backup to restore',
      properties: ['openFile'],
      filters: [{ name: 'HEARLOGUE backup', extensions: ['hearlogue', 'db'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const file = result.filePaths[0];
    return { path: file, manifest: archiveService.inspectBackup(file) };
  });

  handle(CH.data.restore, S.RestoreSchema, ({ path: file }) => {
    if (importService.isRunning) throw new HearlogueError('IMPORT_RUNNING', 'error.importRunning');
    const result = archiveService.restore(file);
    broadcast(PUSH.archiveChanged, archiveService.state());
    return result;
  });

  handle(CH.data.deleteArchive, S.EmptySchema, () => {
    if (importService.isRunning) throw new HearlogueError('IMPORT_RUNNING', 'error.importRunning');
    archiveService.deleteArchive();
    const state = archiveService.state();
    broadcast(PUSH.archiveChanged, state);
    return state;
  });

  handle(CH.data.integrity, S.EmptySchema, () => archiveService.integrity());

  handle(CH.data.resetDerived, S.EmptySchema, () => {
    if (importService.isRunning) throw new HearlogueError('IMPORT_RUNNING', 'error.importRunning');
    archiveService.resetDerived();
    const state = archiveService.state();
    broadcast(PUSH.archiveChanged, state);
    return state;
  });

  handle(CH.data.revealDatabase, S.EmptySchema, () => {
    revealInFolder(archiveService.databaseFile);
    return true;
  });

  handle(CH.data.exportCsv, S.EmptySchema, async () => {
    const result = await dialog.showSaveDialog(focusedWindow() ?? undefined!, {
      title: 'Export your archive as CSV',
      defaultPath: `hearlogue-tracks-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (result.canceled || !result.filePath) return null;
    return exportTracksCsv(result.filePath);
  });

  /* ------------------------------ system ----------------------------- */

  handle(CH.system.openExternal, S.OpenExternalSchema, async ({ url }) => {
    await openExternal(url);
    return true;
  });

  handle(CH.system.openLogs, S.EmptySchema, async () => {
    await openLogsFolder();
    return true;
  });

  handle(CH.system.saveShareCard, S.ShareCardSchema, ({ dataUrl, suggestedName }) =>
    saveShareCard(focusedWindow(), dataUrl, suggestedName),
  );

  handle(CH.system.copyShareCard, S.ShareCardSchema, ({ dataUrl }) => {
    copyShareCard(dataUrl);
    return true;
  });
}

/**
 * CSV export.
 *
 * One row per track with its lifetime figures — the shape people actually want
 * for a spreadsheet, rather than a dump of a million raw events.
 */

/**
 * A byte-order mark makes spreadsheet applications read the file as UTF-8 rather
 * than as the local ANSI codepage, which would otherwise mangle every non-ASCII
 * artist name. Written via a code point so the source file itself stays clean.
 */
const BOM = String.fromCharCode(0xfeff);
const CRLF = '\r\n';
function exportTracksCsv(target: string): { path: string; rows: number } {
  const rows = db()
    .prepare(
      `SELECT t.name AS track, ar.name AS artist, COALESCE(al.name, '') AS album,
              COALESCE(ts.plays, 0) AS plays, COALESCE(ts.q_plays, 0) AS qualifying_plays,
              COALESCE(ts.ms_played, 0) AS ms_played, ts.first_ts, ts.last_ts,
              COALESCE(ts.peak_year, '') AS peak_year, COALESCE(ts.lost_score, 0) AS lost_favorite_score,
              COALESCE(t.uri, '') AS spotify_uri
       FROM tracks t
       JOIN artists ar ON ar.id = t.artist_id
       LEFT JOIN albums al ON al.id = t.album_id
       LEFT JOIN track_stats ts ON ts.track_id = t.id
       ORDER BY COALESCE(ts.q_plays, 0) DESC`,
    )
    .all() as Record<string, string | number | null>[];

  const escape = (value: string | number | null): string => {
    if (value === null) return '';
    const text = String(value);
    // Prefix cells that a spreadsheet would treat as a formula.
    const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };

  const header = [
    'track',
    'artist',
    'album',
    'plays',
    'qualifying_plays',
    'minutes_played',
    'first_heard',
    'last_heard',
    'peak_year',
    'lost_favorite_score',
    'spotify_uri',
  ];

  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(
      [
        escape(row.track as string),
        escape(row.artist as string),
        escape(row.album as string),
        escape(row.plays as number),
        escape(row.qualifying_plays as number),
        escape(Math.round((row.ms_played as number) / 60000)),
        escape(row.first_ts ? new Date(row.first_ts as number).toISOString() : ''),
        escape(row.last_ts ? new Date(row.last_ts as number).toISOString() : ''),
        escape(row.peak_year as string),
        escape(row.lost_favorite_score as number),
        escape(row.spotify_uri as string),
      ].join(','),
    );
  }

  fs.writeFileSync(target, BOM + lines.join(CRLF), 'utf8');
  return { path: target, rows: rows.length };
}
