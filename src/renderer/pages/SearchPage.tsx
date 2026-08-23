import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search as SearchIcon, SlidersHorizontal, X, Music, User, Disc3, Layers, Tag as TagIcon, Sparkles } from 'lucide-react';
import { PageHeader } from '../layouts/PageHeader';
import { Button, Chip, Input, Panel, Select, cx } from '../components/ui/primitives';
import { EmptyState, ErrorState, SkeletonRows } from '../components/ui/states';
import { Cover } from '../components/domain/Cover';
import { useAsync, useDebounced } from '../hooks/useAsync';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { formatNumber, formatDuration, formatDate } from '../lib/format';
import type { SearchFilters, SearchHit, SearchHitKind } from '@shared/types/domain';

/**
 * Full search.
 *
 * The palette handles fast lookup; this page is for interrogation — narrow by
 * year, by when something was first or last heard, by score, by tag. Filters are
 * applied by the main process against SQLite, so a filtered browse over a
 * hundred thousand tracks stays instant.
 */

const KINDS: SearchHitKind[] = ['track', 'artist', 'album', 'era', 'tag', 'collection'];

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

const PAGE_SIZE = 50;

export function SearchPage(): JSX.Element {
  const { t, locale } = useI18n();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [filters, setFilters] = useState<SearchFilters>({});
  const [showFilters, setShowFilters] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);

  const debounced = useDebounced(query, 220);
  const facets = useAsync(() => api().search.facets(), []);

  const results = useAsync(
    () => api().search.query({ query: debounced, filters, limit, offset: 0 }),
    [debounced, filters, limit],
  );

  const activeFilterCount = Object.values(filters).filter(
    (value) => value !== null && value !== undefined && value !== 'any' && !(Array.isArray(value) && value.length === 0),
  ).length;

  const setFilter = <K extends keyof SearchFilters>(key: K, value: SearchFilters[K]): void => {
    setFilters((current) => ({ ...current, [key]: value }));
    setLimit(PAGE_SIZE);
  };

  const items = results.data?.items ?? [];

  return (
    <div className="flex flex-col gap-7">
      <PageHeader eyebrow={t('nav.search')} title={t('search.title')} />

      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={query}
          autoFocus
          onChange={(event) => {
            setQuery(event.target.value);
            setLimit(PAGE_SIZE);
            params.set('q', event.target.value);
            setParams(params, { replace: true });
          }}
          placeholder={t('search.placeholder')}
          icon={<SearchIcon />}
          className="min-w-[280px] flex-1"
          aria-label={t('search.placeholder')}
        />
        <Button
          variant={showFilters || activeFilterCount > 0 ? 'secondary' : 'ghost'}
          icon={<SlidersHorizontal />}
          onClick={() => setShowFilters((value) => !value)}
        >
          {t('search.filters')}
          {activeFilterCount > 0 && (
            <span className="ml-1 rounded-full bg-brass-500/25 px-1.5 text-[11px] text-brass-200">
              {activeFilterCount}
            </span>
          )}
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {KINDS.map((kind) => {
          const selected = filters.kinds?.includes(kind) ?? false;
          return (
            <Chip
              key={kind}
              active={selected}
              onClick={() => {
                const current = filters.kinds ?? [];
                const next = selected ? current.filter((k) => k !== kind) : [...current, kind];
                setFilter('kinds', next.length > 0 ? next : undefined);
              }}
            >
              {t(`search.kind.${kind}`)}
            </Chip>
          );
        })}
      </div>

      {showFilters && (
        <Panel className="animate-fade-up card-pad">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <Field label={t('search.filter.year')}>
              <Select
                value={filters.year ?? 0}
                numeric
                onChange={(value) => setFilter('year', value === 0 ? null : value)}
                label={t('search.filter.year')}
                options={[
                  { value: 0, label: t('search.anyYear') },
                  ...(facets.data?.years ?? []).map((year) => ({ value: year, label: String(year) })),
                ]}
              />
            </Field>

            <Field label={t('search.filter.artist')}>
              <Select
                value={filters.artistId ?? 0}
                numeric
                onChange={(value) => setFilter('artistId', value === 0 ? null : value)}
                label={t('search.filter.artist')}
                options={[
                  { value: 0, label: t('search.anyArtist') },
                  ...(facets.data?.artists ?? []).map((artist) => ({
                    value: artist.id,
                    label: artist.name,
                  })),
                ]}
              />
            </Field>

            <Field label={t('search.filter.tag')}>
              <Select
                value={filters.tagId ?? 0}
                numeric
                onChange={(value) => setFilter('tagId', value === 0 ? null : value)}
                label={t('search.filter.tag')}
                options={[
                  { value: 0, label: t('search.anyTag') },
                  ...(facets.data?.tags ?? []).map((tag) => ({ value: tag.id, label: tag.name })),
                ]}
              />
            </Field>

            <Field label={t('search.filter.minPlays')}>
              <Input
                type="number"
                min={0}
                value={filters.minPlays ?? ''}
                onChange={(event) =>
                  setFilter('minPlays', event.target.value ? Number(event.target.value) : null)
                }
                aria-label={t('search.filter.minPlays')}
              />
            </Field>

            <Field label={t('search.filter.lostScore')}>
              <Input
                type="number"
                min={0}
                max={100}
                value={filters.minLostFavoriteScore ?? ''}
                onChange={(event) =>
                  setFilter(
                    'minLostFavoriteScore',
                    event.target.value ? Number(event.target.value) : null,
                  )
                }
                aria-label={t('search.filter.lostScore')}
              />
            </Field>

            <Field label={t('search.filter.status')}>
              <Select
                value={filters.status ?? 'any'}
                onChange={(value) => setFilter('status', value)}
                label={t('search.filter.status')}
                options={[
                  { value: 'any', label: t('search.status.any') },
                  { value: 'favorite', label: t('search.status.favorite') },
                  { value: 'retired', label: t('search.status.retired') },
                  { value: 'dormant', label: t('search.status.dormant') },
                  { value: 'active', label: t('search.status.active') },
                ]}
              />
            </Field>

            <Field label={t('search.filter.firstHeard')}>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  placeholder="1900"
                  value={filters.firstHeardFrom ?? ''}
                  onChange={(event) =>
                    setFilter('firstHeardFrom', event.target.value ? Number(event.target.value) : null)
                  }
                  aria-label={t('search.filter.firstHeard')}
                />
                <span className="text-paper-600">—</span>
                <Input
                  type="number"
                  placeholder="2026"
                  value={filters.firstHeardTo ?? ''}
                  onChange={(event) =>
                    setFilter('firstHeardTo', event.target.value ? Number(event.target.value) : null)
                  }
                  aria-label={t('search.filter.firstHeard')}
                />
              </div>
            </Field>

            <Field label={t('search.filter.lastHeard')}>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  placeholder="1900"
                  value={filters.lastHeardFrom ?? ''}
                  onChange={(event) =>
                    setFilter('lastHeardFrom', event.target.value ? Number(event.target.value) : null)
                  }
                  aria-label={t('search.filter.lastHeard')}
                />
                <span className="text-paper-600">—</span>
                <Input
                  type="number"
                  placeholder="2026"
                  value={filters.lastHeardTo ?? ''}
                  onChange={(event) =>
                    setFilter('lastHeardTo', event.target.value ? Number(event.target.value) : null)
                  }
                  aria-label={t('search.filter.lastHeard')}
                />
              </div>
            </Field>
          </div>

          {activeFilterCount > 0 && (
            <div className="mt-5 border-t border-white/[0.05] pt-4">
              <Button size="sm" variant="ghost" icon={<X />} onClick={() => setFilters({})}>
                {t('search.clearFilters')}
              </Button>
            </div>
          )}
        </Panel>
      )}

      {results.error && <ErrorState error={results.error} onRetry={results.reload} />}
      {results.initial && results.loading && <SkeletonRows rows={8} height="h-14" />}

      {!results.loading && items.length === 0 && (
        <Panel>
          <EmptyState
            icon={<SearchIcon />}
            title={debounced ? t('search.noResults', { query: debounced }) : t('empty.search')}
            body={debounced ? t('search.noResultsHint') : t('empty.searchBody')}
          />
        </Panel>
      )}

      {items.length > 0 && (
        <>
          <p className="text-[12.5px] text-paper-500">
            {t('search.results', { count: formatNumber(results.data?.total ?? 0, locale) })}
          </p>
          <Panel className="overflow-hidden">
            {items.map((hit) => (
              <ResultRow key={`${hit.kind}-${hit.id}`} hit={hit} />
            ))}
          </Panel>
        </>
      )}

      {results.data && items.length < results.data.total && (
        <div className="flex justify-center">
          <Button variant="secondary" loading={results.loading} onClick={() => setLimit((l) => l + PAGE_SIZE)}>
            {t('library.loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: JSX.Element }): JSX.Element {
  return (
    <div>
      <p className="eyebrow mb-2">{label}</p>
      {children}
    </div>
  );
}

function ResultRow({ hit }: { hit: SearchHit }): JSX.Element {
  const { t, locale } = useI18n();
  const Icon = KIND_ICONS[hit.kind];
  const isEntity = hit.kind === 'track' || hit.kind === 'artist' || hit.kind === 'album';

  return (
    <Link
      to={KIND_ROUTES[hit.kind](hit.id)}
      className={cx(
        'flex items-center gap-3.5 border-b border-white/[0.03] px-4 py-2.5 last:border-b-0',
        'transition-colors hover:bg-white/[0.028]',
      )}
    >
      {isEntity ? (
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

      <span className="hidden w-20 shrink-0 text-right text-2xs uppercase tracking-wider text-paper-600 sm:block">
        {t(`search.kind.${hit.kind}`)}
      </span>

      {hit.plays > 0 && (
        <>
          <span className="figure w-14 shrink-0 text-right text-[12.5px] text-paper-300">
            {formatNumber(hit.plays, locale)}
          </span>
          <span className="figure hidden w-16 shrink-0 text-right text-[12px] text-paper-500 md:block">
            {formatDuration(hit.msPlayed, locale)}
          </span>
          <span className="hidden w-20 shrink-0 text-right text-[11.5px] text-paper-600 lg:block">
            {formatDate(hit.lastTs, locale, 'short')}
          </span>
        </>
      )}
    </Link>
  );
}
