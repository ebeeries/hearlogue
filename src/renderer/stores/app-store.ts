import { create } from 'zustand';
import { api } from '../lib/api';
import type {
  AppInfo,
  AppSettings,
  ArchiveState,
  EntitlementState,
  ImportProgress,
  ImportReport,
} from '@shared/types/domain';
import type { FeatureKey } from '@shared/constants/features';
import { DEFAULT_SETTINGS } from '@shared/models/defaults';

/**
 * Global application state.
 *
 * Only what genuinely spans screens lives here: who we are, what the archive
 * contains, the user's preferences, entitlements, and any import in flight.
 * Everything a single page needs stays inside that page — the store is not a
 * cache for query results.
 */

export interface ToastMessage {
  id: number;
  kind: 'info' | 'success' | 'error';
  messageKey: string;
  values?: Record<string, string | number>;
}

interface AppStore {
  ready: boolean;
  info: AppInfo | null;
  state: ArchiveState | null;
  settings: AppSettings;
  entitlements: EntitlementState | null;

  importProgress: ImportProgress | null;
  importReport: ImportReport | null;

  toasts: ToastMessage[];
  searchOpen: boolean;

  bootstrap: () => Promise<void>;
  refreshState: () => Promise<void>;
  patchSettings: (patch: Partial<AppSettings>) => Promise<void>;
  setImportProgress: (progress: ImportProgress | null) => void;
  setImportReport: (report: ImportReport | null) => void;
  setArchiveState: (state: ArchiveState) => void;
  toast: (kind: ToastMessage['kind'], messageKey: string, values?: ToastMessage['values']) => void;
  dismissToast: (id: number) => void;
  setSearchOpen: (open: boolean) => void;
  hasFeature: (feature: FeatureKey) => boolean;
}

let toastId = 0;

export const useAppStore = create<AppStore>((set, get) => ({
  ready: false,
  info: null,
  state: null,
  settings: DEFAULT_SETTINGS,
  entitlements: null,
  importProgress: null,
  importReport: null,
  toasts: [],
  searchOpen: false,

  bootstrap: async () => {
    const bridge = api();
    const [info, state, settings, entitlements, importStatus] = await Promise.all([
      bridge.app.info(),
      bridge.app.state(),
      bridge.settings.all(),
      bridge.app.entitlements(),
      bridge.importer.status(),
    ]);
    set({
      info,
      state,
      settings,
      entitlements,
      ready: true,
      // An import may already have been running when this window opened.
      importProgress:
        importStatus.progress.phase === 'idle' ? null : importStatus.progress,
      importReport: importStatus.report,
    });
  },

  refreshState: async () => {
    const state = await api().app.state();
    set({ state });
  },

  patchSettings: async (patch) => {
    // Applied optimistically: these are local preferences, and a failed write is
    // reported by the settings screen rather than silently reverting the toggle.
    set({ settings: { ...get().settings, ...patch } });
    const settings = await api().settings.patch(patch);
    set({ settings });
  },

  setImportProgress: (importProgress) => set({ importProgress }),
  setImportReport: (importReport) => set({ importReport }),
  setArchiveState: (state) => set({ state }),

  toast: (kind, messageKey, values) => {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, kind, messageKey, values }] });
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 7000 : 4200);
  },

  dismissToast: (id) => set({ toasts: get().toasts.filter((toast) => toast.id !== id) }),

  setSearchOpen: (searchOpen) => set({ searchOpen }),

  hasFeature: (feature) => {
    const entitlements = get().entitlements;
    if (!entitlements) return true;
    return entitlements.unlockedFeatures.includes(feature);
  },
}));

/** Selector helpers, so components subscribe to the narrowest slice possible. */
export const selectSettings = (s: AppStore): AppSettings => s.settings;
export const selectArchive = (s: AppStore): ArchiveState | null => s.state;
export const selectImportProgress = (s: AppStore): ImportProgress | null => s.importProgress;

export function useHasArchive(): boolean {
  return useAppStore((s) => s.state?.hasArchive ?? false);
}

export function useIsDemo(): boolean {
  return useAppStore((s) => s.state?.isDemo ?? false);
}

export function useEntitlement(feature: FeatureKey): boolean {
  return useAppStore((s) => s.hasFeature(feature));
}
