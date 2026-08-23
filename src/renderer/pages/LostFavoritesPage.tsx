import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Compass, Info, Search as SearchIcon, Shuffle, ExternalLink } from 'lucide-react';
import { PageHeader } from '../layouts/PageHeader';
import { Button, Chip, Input, Panel, Switch, cx, Tooltip, IconButton } from '../components/ui/primitives';
import { EmptyState, ErrorState, SkeletonRows } from '../components/ui/states';
import { ScoreDial, Stat } from '../components/domain/Stat';
import { Cover } from '../components/domain/Cover';
import { Meter } from '../components/ui/primitives';
import { useAsync, useDebounced } from '../hooks/useAsync';
import { useI18n } from '../i18n';
import { useAppStore } from '../stores/app-store';
import { api, openSpotify } from '../lib/api';
import { formatNumber, formatDuration, formatDate, formatSilence } from '../lib/format';
import type { LostFavorite, LostFavoriteFilter } from '@shared/types/domain';

/**
 * Lost Favorites.
 *
 * The hero rediscovery surface. Each entry is presented as a small case: what it
 * was to you, how long the silence has been, and — expandable — exactly which
 * parts of the score put it here, because a number nobody can interrogate is not
 * trustworthy.
 */

const FILTERS: LostFavoriteFilter[] = [
  'all',
  'deepCuts',
  'oldFavorites',
  'forgottenArtists',
  'forgottenAlbums',
  'years3',
  'years5',
  'years10',
];

const PAGE_SIZE = 40;

export function LostFavoritesPage(): JSX.Element {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const hasArchive = useAppStore((s) => s.state?.hasArchive ?? false);

  const [filter, setFilter] = useState<LostFavoriteFilter>('all');
  const [diversify, setDiversify] = useState(true);
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const debouncedSearch = useDebounced(search, 220);

  const { data, error, loading, initial, reload } = useAsync(
    () =>
      api().lostFavorites.list({
        filter,
        diversify,
        limit,
        offset: 0,
        search: debouncedSearch || undefined,
      }),
    [filter, diversify, limit, debouncedSearch, hasArchive],
    { enabled: hasArchive },
  );

  if (!hasArchive) {
    return (
      <EmptyState
        icon={<Compass />}
        title={t('empty.noArchive')}
        body={t('empty.noArchiveBody')}
        action={
          <Button variant="primary" onClick={() => navigate('/import')}>
            {t('empty.noArchiveAction')}
          </Button>
        }
      />
    );
  }

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        eyebrow={t('nav.lostFavorites')}
        title={t('lost.title')}
        description={t('lost.subtitle')}
        actions={
          <Tooltip content={t('lost.explain')}>
            <IconButton label={t('lost.explain')}>
              <Info className="h-4 w-4" />
            </IconButton>
          </Tooltip>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="-mx-1 flex flex-1 gap-2 overflow-x-auto px-1 pb-1 no-scrollbar">
          {FILTERS.map((key) => (
            <Chip
              key={key}
              active={filter === key}
              onClick={() => {
                setFilter(key);
                setLimit(PAGE_SIZE);
              }}
            >
              {t(`lost.filter.${key}`)}
            </Chip>
          ))}
        </div>

        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('common.searchPlaceholder')}
          icon={<SearchIcon />}
          className="w-52"
          aria-label={t('common.searchPlaceholder')}
        />
      </div>

      <div className="flex items-center justify-between">
        <p className="text-[12.5px] text-paper-500">
          {total > 0 ? t('lost.count', { count: formatNumber(total, locale) }) : ''}
        </p>
        <label className="flex cursor-pointer items-center gap-2.5 text-[12.5px] text-paper-400">
          <Shuffle aria-hidden className="h-3.5 w-3.5 text-paper-600" />
          {t('lost.diversify')}
          <Switch checked={diversify} onChange={setDiversify} label={t('lost.diversify')} />
        </label>
      </div>

      {error && <ErrorState error={error} onRetry={reload} />}

      {initial && loading && <SkeletonRows rows={6} height="h-[104px]" />}

      {!loading && items.length === 0 && (
        <Panel>
          <EmptyState
            icon={<Compass />}
            title={t(filter === 'all' && !debouncedSearch ? 'empty.lostFavorites' : 'empty.lostFavoritesFiltered')}
            body={t(
              filter === 'all' && !debouncedSearch
                ? 'empty.lostFavoritesBody'
                : 'empty.lostFavoritesFilteredBody',
            )}
            action={
              filter !== 'all' ? (
                <Button variant="secondary" onClick={() => setFilter('all')}>
                  {t('lost.filter.all')}
                </Button>
              ) : undefined
            }
          />
        </Panel>
      )}

      <div className="flex flex-col gap-2.5">
        {items.map((item, index) => (
          <LostCard key={item.id} item={item} index={index} />
        ))}
      </div>

      {items.length > 0 && items.length < total && (
        <div className="flex justify-center pt-2">
          <Button variant="secondary" loading={loading} onClick={() => setLimit((l) => l + PAGE_SIZE)}>
            {t('library.loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}

function LostCard({ item, index }: { item: LostFavorite; index: number }): JSX.Element {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);

  const dimensions: { key: keyof LostFavorite['dimensions']; tone: 'brass' | 'sage' | 'haze' | 'plum' }[] = [
    { key: 'historicalAffinity', tone: 'brass' },
    { key: 'dormancy', tone: 'haze' },
    { key: 'peakIntensity', tone: 'clay' as 'brass' },
    { key: 'engagementQuality', tone: 'sage' },
    { key: 'historicalConsistency', tone: 'plum' },
  ];

  return (
    <Panel
      className={cx('overflow-hidden animate-fade-up')}
      style={{ animationDelay: `${Math.min(index, 8) * 28}ms` }}
    >
      <div className="flex items-center gap-4 card-pad">
        <Cover name={item.album ?? item.name} secondary={item.artist} size="lg" />

        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => navigate(`/track/${item.id}`)}
            className="block max-w-full truncate text-left font-display text-[17px] text-paper-50 transition-colors hover:text-brass-200"
          >
            {item.name}
          </button>
          <button
            type="button"
            onClick={() => navigate(`/artist/${item.artistId}`)}
            className="mt-0.5 block max-w-full truncate text-left text-[13px] text-paper-400 transition-colors hover:text-paper-200"
          >
            {item.artist}
          </button>

          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1.5 text-[12px] text-paper-500">
            <span>
              <span className="figure text-paper-200">{formatNumber(item.qualifyingPlays, locale)}</span>{' '}
              {t('unit.plays')}
            </span>
            <span>
              <span className="figure text-paper-200">{formatDuration(item.msPlayed, locale)}</span>
            </span>
            {item.peakYear && (
              <span>
                {t('detail.peakYear')}{' '}
                <span className="figure text-paper-200">{item.peakYear}</span>
              </span>
            )}
            <span className="text-brass-400/90">
              {t('detail.lastHeard')} {formatDate(item.lastTs, locale, 'short')} ·{' '}
              {formatSilence(item.daysSinceLastPlay, t)}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            aria-label={t('lost.score')}
            className="rounded-full transition-transform duration-200 hover:scale-[1.04]"
          >
            <ScoreDial score={item.score} size={64} />
          </button>
          {item.uri && (
            <IconButton label={t('detail.openInSpotify')} onClick={() => void openSpotify(item.uri)}>
              <ExternalLink className="h-4 w-4" />
            </IconButton>
          )}
        </div>
      </div>

      {expanded && (
        <div className="animate-fade-in border-t border-white/[0.05] bg-black/20 px-6 py-5">
          <p className="eyebrow mb-4">{t('lost.score')}</p>
          <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            {dimensions.map((dimension) => (
              <Meter
                key={dimension.key}
                label={t(`lost.dimension.${dimension.key}`)}
                value={item.dimensions[dimension.key]}
                tone={dimension.tone}
              />
            ))}
          </div>
          <div className="mt-5 grid gap-6 border-t border-white/[0.05] pt-4 sm:grid-cols-3">
            <Stat
              label={t('detail.firstHeard')}
              value={formatDate(item.firstTs, locale, 'short')}
              size="sm"
            />
            <Stat label={t('detail.activeMonths')} value={item.activeMonths} size="sm" />
            <Stat
              label={t('detail.peakMonth')}
              value={formatNumber(item.peakWindowPlays, locale)}
              size="sm"
              hint={t('unit.plays')}
            />
          </div>
        </div>
      )}
    </Panel>
  );
}
