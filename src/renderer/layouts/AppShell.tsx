import { useEffect, useRef, type ReactNode } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Search, FlaskConical, X, Loader2 } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { Button, IconButton, cx } from '../components/ui/primitives';
import { RouteErrorBoundary } from '../components/ui/states';
import { Toaster } from '../components/ui/overlays';
import { CommandPalette } from '../features/search/CommandPalette';
import { useT } from '../i18n';
import { useAppStore } from '../stores/app-store';
import { api } from '../lib/api';
import { TITLEBAR_HEIGHT } from '@shared/constants/app';

/**
 * The application shell.
 *
 * Holds the sidebar, the draggable titlebar strip, the demo banner and the
 * routed content. The content column is what scrolls; the chrome never moves,
 * which is what makes the app feel like a desktop product rather than a page.
 */

export function AppShell(): JSX.Element {
  const t = useT();
  const location = useLocation();
  const navigate = useNavigate();
  const contentRef = useRef<HTMLDivElement>(null);

  const isDemo = useAppStore((s) => s.state?.isDemo ?? false);
  const importProgress = useAppStore((s) => s.importProgress);
  const patchSettings = useAppStore((s) => s.patchSettings);
  const startupBehavior = useAppStore((s) => s.settings.startupBehavior);

  // Scrolling back to the top on navigation is what a person expects; keeping a
  // previous page's scroll offset on a new screen reads as a bug.
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [location.pathname]);

  // Remember where the user was, so "open where I left off" has something to use.
  useEffect(() => {
    if (startupBehavior !== 'lastVisited') return;
    const timer = setTimeout(() => {
      void patchSettings({ lastRoute: location.pathname + location.search });
    }, 900);
    return () => clearTimeout(timer);
  }, [location.pathname, location.search, startupBehavior, patchSettings]);

  const importing =
    importProgress !== null &&
    !['complete', 'failed', 'cancelled', 'idle'].includes(importProgress.phase);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-ink-900">
      <Sidebar />

      <div className="relative flex min-w-0 flex-1 flex-col">
        <TitleBar />

        {isDemo && <DemoBanner />}

        {importing && <ImportBanner />}

        <main
          ref={contentRef}
          className="flex-1 overflow-y-auto overflow-x-hidden"
          id="main-content"
        >
          <RouteErrorBoundary onReset={() => navigate('/archive')}>
            <div className="mx-auto w-full px-8 pb-24 pt-6" style={{ maxWidth: 'var(--content-max)' }}>
              <Outlet />
            </div>
          </RouteErrorBoundary>
        </main>
      </div>

      <CommandPalette />
      <Toaster />

      {/* Keyboard users can jump past the sidebar to the content. */}
      <a
        href="#main-content"
        className={cx(
          'sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[400]',
          'focus:rounded-md focus:bg-ink-750 focus:px-4 focus:py-2 focus:text-[13px] focus:text-paper-50',
        )}
      >
        {t('nav.archive')}
      </a>
    </div>
  );
}

/**
 * The titlebar.
 *
 * The window is frameless with a native overlay for the system controls, so this
 * strip provides back/forward and search while leaving a draggable region and
 * enough clearance on the right for the minimise/maximise/close buttons.
 */
function TitleBar(): JSX.Element {
  const t = useT();
  const navigate = useNavigate();
  const setSearchOpen = useAppStore((s) => s.setSearchOpen);

  return (
    <header
      className="app-drag flex shrink-0 items-center gap-1 border-b border-white/[0.045] bg-ink-900/80 px-3 backdrop-blur"
      style={{ height: TITLEBAR_HEIGHT, paddingRight: 150 }}
    >
      <div className="app-no-drag flex items-center gap-0.5">
        <IconButton label={t('nav.back')} size="sm" onClick={() => navigate(-1)}>
          <ChevronLeft className="h-4 w-4" />
        </IconButton>
        <IconButton label={t('nav.forward')} size="sm" onClick={() => navigate(1)}>
          <ChevronRight className="h-4 w-4" />
        </IconButton>
      </div>

      <div className="flex-1" />

      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        className={cx(
          'app-no-drag group flex h-7 items-center gap-2 rounded-md border border-white/[0.06]',
          'bg-black/25 pl-2.5 pr-2 text-[12px] text-paper-500 transition-colors duration-150',
          'hover:border-white/[0.11] hover:text-paper-300',
        )}
      >
        <Search aria-hidden className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{t('nav.search')}</span>
        <kbd
          aria-hidden
          className="ml-2 rounded border border-white/[0.07] px-1 py-px font-mono text-[9.5px] text-paper-600"
        >
          Ctrl K
        </kbd>
      </button>
    </header>
  );
}

function DemoBanner(): JSX.Element {
  const t = useT();
  const navigate = useNavigate();
  const setArchiveState = useAppStore((s) => s.setArchiveState);
  const toast = useAppStore((s) => s.toast);

  const exitDemo = async (): Promise<void> => {
    try {
      const state = await api().demo.disable();
      setArchiveState(state);
      navigate(state.hasArchive ? '/archive' : '/welcome');
    } catch {
      toast('error', 'error.unknown');
    }
  };

  return (
    <Banner
      icon={<FlaskConical className="h-3.5 w-3.5" />}
      tone="brass"
      message={t('demo.notice')}
      actions={
        <>
          <Button size="sm" variant="ghost" onClick={() => void exitDemo()}>
            {t('demo.exit')}
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              void exitDemo().then(() => navigate('/import'));
            }}
          >
            {t('demo.import')}
          </Button>
        </>
      }
    />
  );
}

function ImportBanner(): JSX.Element {
  const t = useT();
  const navigate = useNavigate();
  const progress = useAppStore((s) => s.importProgress);
  if (!progress) return <></>;

  return (
    <Banner
      icon={<Loader2 className="h-3.5 w-3.5 animate-spin" />}
      tone="neutral"
      message={t(progress.messageKey ?? 'import.message.preparing')}
      actions={
        <Button size="sm" variant="ghost" onClick={() => navigate('/import')}>
          {t('common.viewDetails')}
        </Button>
      }
      progress={progress.progress}
    />
  );
}

function Banner({
  icon,
  message,
  actions,
  tone,
  progress,
  onDismiss,
}: {
  icon: ReactNode;
  message: string;
  actions?: ReactNode;
  tone: 'brass' | 'neutral';
  progress?: number;
  onDismiss?: () => void;
}): JSX.Element {
  return (
    <div
      className={cx(
        'relative flex shrink-0 items-center gap-3 border-b px-6 py-2',
        tone === 'brass'
          ? 'border-brass-600/25 bg-brass-900/25'
          : 'border-white/[0.06] bg-ink-850',
      )}
    >
      <span
        aria-hidden
        className={cx('shrink-0', tone === 'brass' ? 'text-brass-400' : 'text-paper-400')}
      >
        {icon}
      </span>
      <p className="min-w-0 flex-1 truncate text-[12.5px] text-paper-300">{message}</p>
      {actions}
      {onDismiss && (
        <IconButton label="Dismiss" size="sm" onClick={onDismiss}>
          <X className="h-3.5 w-3.5" />
        </IconButton>
      )}
      {progress !== undefined && (
        <span
          aria-hidden
          className="absolute bottom-0 left-0 h-px bg-brass-400 transition-[width] duration-500 ease-out"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      )}
    </div>
  );
}
