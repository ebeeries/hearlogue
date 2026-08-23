import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Search, Music, User, Disc3, Layers, Tag as TagIcon, Sparkles, CornerDownLeft } from 'lucide-react';
import { cx } from '../../components/ui/primitives';
import { Cover } from '../../components/domain/Cover';
import { useAppStore } from '../../stores/app-store';
import { useAsync, useDebounced } from '../../hooks/useAsync';
import { api } from '../../lib/api';
import { useI18n } from '../../i18n';
import { formatNumber } from '../../lib/format';
import type { SearchHit, SearchHitKind } from '@shared/types/domain';

/**
 * The Ctrl+K palette.
 *
 * Search is the fastest route to anything in an archive with a hundred thousand
 * plays in it, so it is available from every screen without navigating away.
 * Results arrive from SQLite's FTS index, which keeps it responsive at scale.
 */

const KIND_ICONS: Record<SearchHitKind, typeof Music> = {
  track: Music,
  artist: User,
  album: Disc3,
  era: Layers,
  tag: TagIcon,
  collection: Sparkles,
};

const KIND_ROUTES: Record<SearchHitKind, (id: number) => string> = {
  track: (id) => `/track/${id}`,
  artist: (id) => `/artist/${id}`,
  album: (id) => `/album/${id}`,
  era: (id) => `/eras?era=${id}`,
  tag: (id) => `/library?tag=${id}`,
  collection: (id) => `/collection/${id}`,
};

export function CommandPalette(): JSX.Element | null {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const open = useAppStore((s) => s.searchOpen);
  const setOpen = useAppStore((s) => s.setSearchOpen);
  const hasArchive = useAppStore((s) => s.state?.hasArchive ?? false);

  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const debounced = useDebounced(query, 160);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { data, loading } = useAsync(
    () => api().search.query({ query: debounced, limit: 24 }),
    [debounced, open],
    { enabled: open && hasArchive },
  );

  const results = useMemo<SearchHit[]>(() => data?.items ?? [], [data]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setCursor(0);
      return;
    }
    const timer = setTimeout(() => inputRef.current?.focus(), 20);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => setCursor(0), [debounced]);

  // Keep the highlighted row inside the visible scroll area.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.querySelector<HTMLElement>('[data-active="true"]');
    active?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  if (!open) return null;

  const go = (hit: SearchHit): void => {
    setOpen(false);
    navigate(KIND_ROUTES[hit.kind](hit.id));
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setCursor((c) => Math.min(c + 1, Math.max(0, results.length - 1)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const hit = results[cursor];
      if (hit) go(hit);
      else if (query.trim()) {
        setOpen(false);
        navigate(`/search?q=${encodeURIComponent(query.trim())}`);
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[250] flex items-start justify-center pt-[12vh]">
      <div
        className="absolute inset-0 animate-fade-in bg-black/60 backdrop-blur-[3px]"
        onClick={() => setOpen(false)}
        aria-hidden
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('search.title')}
        className={cx(
          'relative w-full max-w-2xl animate-scale-in overflow-hidden rounded-xl',
          'border border-white/[0.1] bg-ink-850/97 shadow-lift backdrop-blur-xl',
        )}
      >
        <div className="flex items-center gap-3 border-b border-white/[0.06] px-4">
          <Search aria-hidden className="h-4 w-4 shrink-0 text-paper-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('search.placeholder')}
            aria-label={t('search.placeholder')}
            autoComplete="off"
            spellCheck={false}
            className="h-13 flex-1 bg-transparent py-4 text-[15px] text-paper-50 placeholder:text-paper-600 focus:outline-none"
          />
          {loading && (
            <span aria-hidden className="h-3 w-3 animate-pulse-soft rounded-full bg-brass-500/60" />
          )}
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-2">
          {!hasArchive && (
            <p className="px-5 py-8 text-center text-[13px] text-paper-500">
              {t('empty.noArchiveBody')}
            </p>
          )}

          {hasArchive && results.length === 0 && debounced.trim().length > 0 && !loading && (
            <div className="px-5 py-8 text-center">
              <p className="text-[13.5px] text-paper-300">
                {t('search.noResults', { query: debounced })}
              </p>
              <p className="mt-1.5 text-[12px] text-paper-600">{t('search.noResultsHint')}</p>
            </div>
          )}

          {hasArchive && results.length === 0 && debounced.trim().length === 0 && (
            <p className="px-5 py-8 text-center text-[13px] text-paper-600">{t('empty.searchBody')}</p>
          )}

          {results.map((hit, index) => {
            const Icon = KIND_ICONS[hit.kind];
            const active = index === cursor;
            return (
              <button
                key={`${hit.kind}-${hit.id}`}
                type="button"
                data-active={active}
                onMouseEnter={() => setCursor(index)}
                onClick={() => go(hit)}
                className={cx(
                  'flex w-full items-center gap-3 px-4 py-2 text-left transition-colors duration-100',
                  active ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]',
                )}
              >
                {hit.kind === 'track' || hit.kind === 'album' || hit.kind === 'artist' ? (
                  <Cover
                    name={hit.title}
                    secondary={hit.subtitle}
                    size="sm"
                    rounded={hit.kind === 'artist' ? 'full' : 'default'}
                  />
                ) : (
                  <span
                    aria-hidden
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-white/[0.06] bg-white/[0.02] text-paper-500"
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                )}

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] text-paper-100">{hit.title}</span>
                  {hit.subtitle && (
                    <span className="block truncate text-[11.5px] text-paper-500">{hit.subtitle}</span>
                  )}
                </span>

                <span className="shrink-0 text-2xs uppercase tracking-wider text-paper-600">
                  {t(`search.kind.${hit.kind}`)}
                </span>

                {hit.plays > 0 && (
                  <span className="figure w-14 shrink-0 text-right text-[12px] text-paper-500">
                    {formatNumber(hit.plays, locale)}
                  </span>
                )}

                {active && (
                  <CornerDownLeft aria-hidden className="h-3.5 w-3.5 shrink-0 text-paper-600" />
                )}
              </button>
            );
          })}
        </div>

        <footer className="flex items-center justify-between border-t border-white/[0.06] bg-black/25 px-4 py-2">
          <span className="flex items-center gap-3 text-[11px] text-paper-600">
            <Hint keys="↑ ↓" label="navigate" />
            <Hint keys="↵" label="open" />
            <Hint keys="esc" label="close" />
          </span>
          {results.length > 0 && (
            <span className="text-[11px] text-paper-600">
              {t('search.results', { count: data?.total ?? results.length })}
            </span>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function Hint({ keys, label }: { keys: string; label: string }): JSX.Element {
  return (
    <span className="flex items-center gap-1">
      <kbd className="rounded border border-white/[0.08] px-1 py-px font-mono text-[9.5px] text-paper-500">
        {keys}
      </kbd>
      {label}
    </span>
  );
}
