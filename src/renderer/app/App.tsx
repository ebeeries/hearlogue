import { useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes, useNavigate, useLocation } from 'react-router-dom';
import { AppShell } from '../layouts/AppShell';
import { I18nProvider } from '../i18n';
import { useAppStore } from '../stores/app-store';
import { useGlobalShortcuts } from '../hooks/useShortcuts';
import { api } from '../lib/api';

import { WelcomePage } from '../pages/WelcomePage';
import { ImportPage } from '../pages/ImportPage';
import { ArchivePage } from '../pages/ArchivePage';
import { LostFavoritesPage } from '../pages/LostFavoritesPage';
import { RewindPage } from '../pages/RewindPage';
import { ErasPage } from '../pages/ErasPage';
import { ObsessionsPage } from '../pages/ObsessionsPage';
import { GraveyardPage } from '../pages/GraveyardPage';
import { LibraryPage } from '../pages/LibraryPage';
import { CalendarPage } from '../pages/CalendarPage';
import { SearchPage } from '../pages/SearchPage';
import { SettingsPage } from '../pages/SettingsPage';
import { TrackDetailPage } from '../pages/TrackDetailPage';
import { ArtistDetailPage } from '../pages/ArtistDetailPage';
import { AlbumDetailPage } from '../pages/AlbumDetailPage';
import { DayDetailPage } from '../pages/DayDetailPage';
import { SessionsPage } from '../pages/SessionsPage';
import { SessionDetailPage } from '../pages/SessionDetailPage';
import { CollectionDetailPage } from '../pages/CollectionDetailPage';
import { RecordsPage } from '../pages/RecordsPage';
import { BootScreen } from './BootScreen';

/**
 * Router and app root.
 *
 * HashRouter rather than BrowserRouter: the renderer is loaded from a `file://`
 * URL when packaged, where path-based routing does not survive a reload.
 */

function ShellRoutes(): JSX.Element {
  useGlobalShortcuts();
  useMainProcessEvents();
  useAppearancePreferences();

  return (
    <Routes>
      <Route path="/welcome" element={<WelcomePage />} />
      <Route path="/import" element={<ImportPage />} />

      <Route element={<AppShell />}>
        <Route path="/archive" element={<ArchivePage />} />
        <Route path="/lost-favorites" element={<LostFavoritesPage />} />
        <Route path="/rewind" element={<RewindPage />} />
        <Route path="/rewind/:year" element={<RewindPage />} />
        <Route path="/eras" element={<ErasPage />} />
        <Route path="/obsessions" element={<ObsessionsPage />} />
        <Route path="/graveyard" element={<GraveyardPage />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/records" element={<RecordsPage />} />
        <Route path="/sessions" element={<SessionsPage />} />
        <Route path="/session/:id" element={<SessionDetailPage />} />
        <Route path="/track/:id" element={<TrackDetailPage />} />
        <Route path="/artist/:id" element={<ArtistDetailPage />} />
        <Route path="/album/:id" element={<AlbumDetailPage />} />
        <Route path="/day/:date" element={<DayDetailPage />} />
        <Route path="/collection/:id" element={<CollectionDetailPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/archive" replace />} />
    </Routes>
  );
}

/** Subscribes to push messages from the main process. */
function useMainProcessEvents(): void {
  const navigate = useNavigate();
  const setImportProgress = useAppStore((s) => s.setImportProgress);
  const setImportReport = useAppStore((s) => s.setImportReport);
  const setArchiveState = useAppStore((s) => s.setArchiveState);

  useEffect(() => {
    const bridge = api();
    const unsubscribers = [
      bridge.events.onImportProgress(setImportProgress),
      bridge.events.onImportDone(setImportReport),
      bridge.events.onArchiveChanged(setArchiveState),
      bridge.events.onNavigate((route) => navigate(route)),
    ];
    return () => unsubscribers.forEach((off) => off());
  }, [navigate, setImportProgress, setImportReport, setArchiveState]);
}

/** Mirrors density and motion preferences onto the document element. */
function useAppearancePreferences(): void {
  const density = useAppStore((s) => s.settings.density);
  const reducedMotion = useAppStore((s) => s.settings.reducedMotion);
  const language = useAppStore((s) => s.settings.language);

  useEffect(() => {
    document.documentElement.dataset.density = density;
    document.documentElement.dataset.motion = reducedMotion ? 'reduced' : 'full';
    document.documentElement.lang = language;
  }, [density, reducedMotion, language]);
}

/**
 * Routing guards.
 *
 * Two separate concerns, deliberately not merged:
 *
 *  - The empty-archive guard is *reactive*. Whenever there is no imported
 *    history — first run, after a delete, after leaving the demo — every screen
 *    in the shell would render an empty state, so the app goes to Welcome
 *    instead. Running only once at startup would leave someone stranded on a
 *    blank Graveyard after deleting their archive.
 *  - The startup-behaviour preference is *one-shot*: it applies to the route the
 *    app opened on, and must never yank someone back later while they navigate.
 */
function StartupRedirect(): JSX.Element {
  const location = useLocation();
  const state = useAppStore((s) => s.state);
  const settings = useAppStore((s) => s.settings);
  const [startupApplied, setStartupApplied] = useState(false);
  const navigate = useNavigate();

  const path = location.pathname;

  useEffect(() => {
    if (!state) return;
    // Welcome and the import wizard are the two screens that work without data.
    if (path === '/welcome' || path === '/import') return;

    if (!state.hasArchive && !state.importRunning) {
      navigate('/welcome', { replace: true });
    }
  }, [state, path, navigate]);

  useEffect(() => {
    if (startupApplied || !state) return;
    if (!state.hasArchive) return;
    setStartupApplied(true);

    if (path !== '/' && path !== '/archive') return;

    if (settings.startupBehavior === 'lastVisited' && settings.lastRoute) {
      navigate(settings.lastRoute, { replace: true });
    } else if (settings.startupBehavior === 'rewind') {
      navigate('/rewind', { replace: true });
    } else if (path === '/') {
      navigate('/archive', { replace: true });
    }
  }, [startupApplied, state, settings, navigate, path]);

  return <ShellRoutes />;
}

export function App(): JSX.Element {
  const ready = useAppStore((s) => s.ready);
  const bootstrap = useAppStore((s) => s.bootstrap);
  const language = useAppStore((s) => s.settings.language);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    bootstrap().catch((err: unknown) => {
      setBootError(err instanceof Error ? err.message : String(err));
    });
  }, [bootstrap]);

  if (!ready) return <BootScreen error={bootError} />;

  return (
    <I18nProvider language={language}>
      <HashRouter>
        <StartupRedirect />
      </HashRouter>
    </I18nProvider>
  );
}
