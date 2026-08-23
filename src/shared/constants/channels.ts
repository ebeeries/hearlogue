/**
 * The complete IPC surface. Every channel is listed here once so that the
 * preload bridge, the main-process router and the type definitions can never
 * drift apart. Channels are namespaced `hearlogue:<domain>.<method>`.
 */

export const CH = {
  app: {
    info: 'hearlogue:app.info',
    state: 'hearlogue:app.state',
    entitlements: 'hearlogue:app.entitlements',
    quit: 'hearlogue:app.quit',
  },
  settings: {
    all: 'hearlogue:settings.all',
    patch: 'hearlogue:settings.patch',
    reset: 'hearlogue:settings.reset',
  },
  importer: {
    pickFiles: 'hearlogue:import.pickFiles',
    pickFolder: 'hearlogue:import.pickFolder',
    start: 'hearlogue:import.start',
    cancel: 'hearlogue:import.cancel',
    status: 'hearlogue:import.status',
    report: 'hearlogue:import.report',
    history: 'hearlogue:import.history',
    rebuildAnalytics: 'hearlogue:import.rebuildAnalytics',
  },
  archive: {
    overview: 'hearlogue:archive.overview',
    rediscovery: 'hearlogue:archive.rediscovery',
    onThisDay: 'hearlogue:archive.onThisDay',
    records: 'hearlogue:archive.records',
    clock: 'hearlogue:archive.clock',
    topList: 'hearlogue:archive.topList',
  },
  lostFavorites: {
    list: 'hearlogue:lostFavorites.list',
  },
  rewind: {
    years: 'hearlogue:rewind.years',
    year: 'hearlogue:rewind.year',
    month: 'hearlogue:rewind.month',
    randomMonth: 'hearlogue:rewind.randomMonth',
  },
  eras: {
    list: 'hearlogue:eras.list',
    get: 'hearlogue:eras.get',
    update: 'hearlogue:eras.update',
  },
  obsessions: {
    all: 'hearlogue:obsessions.all',
  },
  graveyard: {
    list: 'hearlogue:graveyard.list',
  },
  entity: {
    track: 'hearlogue:entity.track',
    artist: 'hearlogue:entity.artist',
    album: 'hearlogue:entity.album',
  },
  calendar: {
    heatmap: 'hearlogue:calendar.heatmap',
    day: 'hearlogue:calendar.day',
  },
  sessions: {
    list: 'hearlogue:sessions.list',
    get: 'hearlogue:sessions.get',
    stats: 'hearlogue:sessions.stats',
  },
  library: {
    tracks: 'hearlogue:library.tracks',
    tags: 'hearlogue:library.tags',
    createTag: 'hearlogue:library.createTag',
    updateTag: 'hearlogue:library.updateTag',
    deleteTag: 'hearlogue:library.deleteTag',
    assignTag: 'hearlogue:library.assignTag',
    unassignTag: 'hearlogue:library.unassignTag',
    setFlags: 'hearlogue:library.setFlags',
  },
  notes: {
    get: 'hearlogue:notes.get',
    set: 'hearlogue:notes.set',
    list: 'hearlogue:notes.list',
  },
  collections: {
    list: 'hearlogue:collections.list',
    get: 'hearlogue:collections.get',
    save: 'hearlogue:collections.save',
    remove: 'hearlogue:collections.remove',
    preview: 'hearlogue:collections.preview',
    tracks: 'hearlogue:collections.tracks',
  },
  search: {
    query: 'hearlogue:search.query',
    facets: 'hearlogue:search.facets',
  },
  demo: {
    enable: 'hearlogue:demo.enable',
    disable: 'hearlogue:demo.disable',
  },
  data: {
    backup: 'hearlogue:data.backup',
    restore: 'hearlogue:data.restore',
    pickRestore: 'hearlogue:data.pickRestore',
    exportCsv: 'hearlogue:data.exportCsv',
    deleteArchive: 'hearlogue:data.deleteArchive',
    integrity: 'hearlogue:data.integrity',
    resetDerived: 'hearlogue:data.resetDerived',
    revealDatabase: 'hearlogue:data.revealDatabase',
  },
  system: {
    openExternal: 'hearlogue:system.openExternal',
    openLogs: 'hearlogue:system.openLogs',
    saveShareCard: 'hearlogue:system.saveShareCard',
    copyShareCard: 'hearlogue:system.copyShareCard',
  },
} as const;

/** Push channels: main -> renderer. */
export const PUSH = {
  importProgress: 'hearlogue:push.importProgress',
  importDone: 'hearlogue:push.importDone',
  archiveChanged: 'hearlogue:push.archiveChanged',
  navigate: 'hearlogue:push.navigate',
  toast: 'hearlogue:push.toast',
} as const;

type Leaf<T> = T extends string ? T : T extends Record<string, unknown> ? Leaf<T[keyof T]> : never;
export type InvokeChannel = Leaf<typeof CH>;
export type PushChannel = (typeof PUSH)[keyof typeof PUSH];

export const ALL_INVOKE_CHANNELS: string[] = Object.values(CH).flatMap((group) =>
  Object.values(group as Record<string, string>),
);
