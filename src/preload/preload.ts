import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { CH, PUSH } from '@shared/constants/channels';
import type { HearlogueApi, BridgeError } from './api-types';
import type { AppError } from '@shared/types/common';
import type { ImportProgress } from '@shared/types/domain';

/**
 * The context bridge.
 *
 * Runs sandboxed with context isolation on. `ipcRenderer` is captured in this
 * module scope and never exposed; the renderer only ever receives the frozen
 * object built below, whose methods each target one fixed channel. There is no
 * generic escape hatch, so a compromised renderer cannot address a channel the
 * API does not already offer.
 */

interface IpcResult<T> {
  ok: boolean;
  data?: T;
  error?: AppError;
}

/**
 * Errors thrown across the context bridge are re-created in the renderer's
 * world, and only `name`, `message` and `stack` survive that hop — a custom
 * property such as `appError` silently disappears. The structured payload is
 * therefore encoded into the message itself, prefixed so the renderer can tell
 * a HEARLOGUE error from an incidental one. `renderer/lib/api.ts` decodes it.
 */
export const BRIDGE_ERROR_PREFIX = 'HEARLOGUE_ERROR:';

function bridgeError(error: AppError): BridgeError {
  const err = new Error(`${BRIDGE_ERROR_PREFIX}${JSON.stringify(error)}`) as BridgeError;
  err.name = 'HearlogueBridgeError';
  // Kept for the same-world case (tests importing the preload directly).
  err.appError = error;
  return err;
}

/** Binds one channel to a call that resolves data or throws a structured error. */
function call<T>(channel: string) {
  return async (payload?: unknown): Promise<T> => {
    const result = (await ipcRenderer.invoke(channel, payload ?? {})) as IpcResult<T>;
    if (!result || result.ok !== true) {
      throw bridgeError(
        result?.error ?? { code: 'UNKNOWN', messageKey: 'error.unknown' },
      );
    }
    return result.data as T;
  };
}

/** Subscribes to a push channel and returns its unsubscribe function. */
function subscribe<T>(channel: string) {
  return (listener: (payload: T) => void): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: T): void => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  };
}

const api: HearlogueApi = {
  app: {
    info: call(CH.app.info),
    state: call(CH.app.state),
    entitlements: call(CH.app.entitlements),
    quit: call(CH.app.quit),
  },
  settings: {
    all: call(CH.settings.all),
    patch: call(CH.settings.patch),
    reset: call(CH.settings.reset),
  },
  importer: {
    pickFiles: call(CH.importer.pickFiles),
    pickFolder: call(CH.importer.pickFolder),
    start: (paths) => call<ImportProgress>(CH.importer.start)({ paths }),
    cancel: call(CH.importer.cancel),
    status: call(CH.importer.status),
    report: call(CH.importer.report),
    history: call(CH.importer.history),
    rebuildAnalytics: call(CH.importer.rebuildAnalytics),
  },
  archive: {
    overview: call(CH.archive.overview),
    rediscovery: call(CH.archive.rediscovery),
    onThisDay: call(CH.archive.onThisDay),
    records: call(CH.archive.records),
    clock: call(CH.archive.clock),
    topList: call(CH.archive.topList),
  },
  lostFavorites: {
    list: call(CH.lostFavorites.list),
  },
  rewind: {
    years: call(CH.rewind.years),
    year: call(CH.rewind.year),
    month: call(CH.rewind.month),
    randomMonth: call(CH.rewind.randomMonth),
  },
  eras: {
    list: call(CH.eras.list),
    get: call(CH.eras.get),
    update: call(CH.eras.update),
  },
  obsessions: {
    all: call(CH.obsessions.all),
  },
  graveyard: {
    list: call(CH.graveyard.list),
  },
  entity: {
    track: call(CH.entity.track),
    artist: call(CH.entity.artist),
    album: call(CH.entity.album),
  },
  calendar: {
    heatmap: call(CH.calendar.heatmap),
    day: call(CH.calendar.day),
  },
  sessions: {
    list: call(CH.sessions.list),
    get: call(CH.sessions.get),
    stats: call(CH.sessions.stats),
  },
  library: {
    tracks: call(CH.library.tracks),
    tags: call(CH.library.tags),
    createTag: call(CH.library.createTag),
    updateTag: call(CH.library.updateTag),
    deleteTag: call(CH.library.deleteTag),
    assignTag: call(CH.library.assignTag),
    unassignTag: call(CH.library.unassignTag),
    setFlags: call(CH.library.setFlags),
  },
  notes: {
    get: call(CH.notes.get),
    set: call(CH.notes.set),
    list: call(CH.notes.list),
  },
  collections: {
    list: call(CH.collections.list),
    get: call(CH.collections.get),
    save: call(CH.collections.save),
    remove: call(CH.collections.remove),
    preview: call(CH.collections.preview),
    tracks: call(CH.collections.tracks),
  },
  search: {
    query: call(CH.search.query),
    facets: call(CH.search.facets),
  },
  demo: {
    enable: call(CH.demo.enable),
    disable: call(CH.demo.disable),
  },
  data: {
    backup: call(CH.data.backup),
    pickRestore: call(CH.data.pickRestore),
    restore: call(CH.data.restore),
    exportCsv: call(CH.data.exportCsv),
    deleteArchive: call(CH.data.deleteArchive),
    integrity: call(CH.data.integrity),
    resetDerived: call(CH.data.resetDerived),
    revealDatabase: call(CH.data.revealDatabase),
  },
  system: {
    openExternal: call(CH.system.openExternal),
    openLogs: call(CH.system.openLogs),
    saveShareCard: call(CH.system.saveShareCard),
    copyShareCard: call(CH.system.copyShareCard),
  },
  events: {
    onImportProgress: subscribe(PUSH.importProgress),
    onImportDone: subscribe(PUSH.importDone),
    onArchiveChanged: subscribe(PUSH.archiveChanged),
    onNavigate: subscribe(PUSH.navigate),
  },
};

contextBridge.exposeInMainWorld('hearlogue', api);
