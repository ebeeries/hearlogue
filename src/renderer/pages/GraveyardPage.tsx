import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Skull, ExternalLink, Info, Share2 } from 'lucide-react';
import { PageHeader } from '../layouts/PageHeader';
import { Button, IconButton, Panel, Segmented, Tooltip, cx } from '../components/ui/primitives';
import { EmptyState, ErrorState, SkeletonRows } from '../components/ui/states';
import { Cover } from '../components/domain/Cover';
import { ShareCardDialog } from '../features/share/ShareCardDialog';
import { useAsync } from '../hooks/useAsync';
import { useI18n } from '../i18n';
import { useAppStore } from '../stores/app-store';
import { api, openSpotify } from '../lib/api';
import { formatNumber, formatDate, formatSilence, ordinal } from '../lib/format';
import type { EntityKind } from '@shared/types/common';
import type { GraveyardItem } from '@shared/types/domain';

/**
 * The Graveyard.
 *
 * Presented as a register rather than a gallery: a dense, ordered list where the
 * numbers line up column to column, so the scale of what was left behind is
 * legible at a glance. "Revive" opens the item in Spotify, which is the only
 * thing HEARLOGUE can honestly offer — it does not control playback.
 */

const PAGE_SIZE = 40;

export function GraveyardPage(): JSX.Element {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const hasArchive = useAppStore((s) => s.state?.hasArchive ?? false);

  const [kind, setKind] = useState<EntityKind>('artist');
  const [sharing, setSharing] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);

  const { data, error, loading, initial, reload } = useAsync(
    () => api().graveyard.list({ kind, limit, offset: 0 }),
    [kind, limit, hasArchive],
    { enabled: hasArchive },
  );

  if (!hasArchive) {
    return (
      <EmptyState
        icon={<Skull />}
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

  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        eyebrow={t('nav.graveyard')}
        title={t('graveyard.title')}
        description={t('graveyard.subtitle')}
        actions={
          <>
            <Button
              size="sm"
              variant="ghost"
              icon={<Share2 />}
              disabled={items.length === 0}
              onClick={() => setSharing(true)}
            >
              {t('detail.share')}
            </Button>
            <Tooltip content={t('graveyard.explain')}>
              <IconButton label={t('graveyard.explain')}>
                <Info className="h-4 w-4" />
              </IconButton>
            </Tooltip>
          </>
        }
      />

      <div className="flex items-center justify-between gap-4">
        <Segmented
          value={kind}
          onChange={(value) => {
            setKind(value);
            setLimit(PAGE_SIZE);
          }}
          options={[
            { value: 'artist', label: t('graveyard.artists') },
            { value: 'track', label: t('graveyard.tracks') },
            { value: 'album', label: t('graveyard.albums') },
          ]}
        />
        {data && data.total > 0 && (
          <p className="text-[12.5px] text-paper-500">{formatNumber(data.total, locale)}</p>
        )}
      </div>

      {error && <ErrorState error={error} onRetry={reload} />}
      {initial && loading && <SkeletonRows rows={8} height="h-16" />}

      {!loading && items.length === 0 && (
        <Panel>
          <EmptyState icon={<Skull />} title={t('empty.graveyard')} body={t('empty.graveyardBody')} />
        </Panel>
      )}

      {items.length > 0 && (
        <Panel className="overflow-hidden">
          {/* Column headers keep a dense table readable without adding lines. */}
          <div className="hidden items-center gap-4 border-b border-white/[0.055] px-5 py-2.5 lg:flex">
            <span className="w-8" />
            <span className="flex-1 eyebrow">{t(`graveyard.${kind}s`)}</span>
            <span className="w-16 eyebrow text-right">{t('graveyard.peakYear')}</span>
            <span className="w-20 eyebrow text-right">{t('graveyard.historicalPlays')}</span>
            <span className="w-28 eyebrow text-right">{t('graveyard.lastHeard')}</span>
            <span className="w-28 eyebrow text-right">{t('graveyard.daysMissing')}</span>
            <span className="w-20" />
          </div>

          {items.map((item, index) => (
            <GraveyardRow key={`${item.kind}-${item.entityId}`} item={item} index={index} />
          ))}
        </Panel>
      )}

      <ShareCardDialog
        open={sharing}
        onClose={() => setSharing(false)}
        card={{
          kind: 'graveyard',
          title: t('share.template.graveyard'),
          subtitle: t('graveyard.title'),
          statement: t('graveyard.subtitle'),
          lines: items.slice(0, 5).map((item) => item.name),
          figure: formatNumber(data?.total ?? items.length, locale),
          figureLabel: t(`graveyard.${kind}s`),
          accent: 'sage',
        }}
      />

      {items.length > 0 && data && items.length < data.total && (
        <div className="flex justify-center">
          <Button variant="secondary" loading={loading} onClick={() => setLimit((l) => l + PAGE_SIZE)}>
            {t('library.loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}

function GraveyardRow({ item, index }: { item: GraveyardItem; index: number }): JSX.Element {
  const { t, locale } = useI18n();

  const route =
    item.kind === 'track'
      ? `/track/${item.entityId}`
      : item.kind === 'artist'
        ? `/artist/${item.entityId}`
        : `/album/${item.entityId}`;

  return (
    <div
      className={cx(
        'group flex items-center gap-4 border-b border-white/[0.035] px-5 py-3 last:border-b-0',
        'transition-colors duration-150 hover:bg-white/[0.025]',
      )}
      style={{ animationDelay: `${Math.min(index, 10) * 18}ms` }}
    >
      <Cover
        name={item.name}
        secondary={item.secondary}
        size="sm"
        rounded={item.kind === 'artist' ? 'full' : 'default'}
        className="opacity-70 transition-opacity group-hover:opacity-100"
      />

      <div className="min-w-0 flex-1">
        <Link
          to={route}
          className="block truncate text-[13.5px] text-paper-200 transition-colors hover:text-paper-50"
        >
          {item.name}
        </Link>
        {item.secondary && (
          <p className="mt-0.5 truncate text-[11.5px] text-paper-600">{item.secondary}</p>
        )}
        {/* On narrow layouts the columns collapse into an inline summary. */}
        <p className="mt-1 text-[11.5px] text-paper-600 lg:hidden">
          {item.peakYear} · {formatNumber(item.historicalPlays, locale)} {t('unit.plays')} ·{' '}
          {formatSilence(item.daysMissing, t)}
        </p>
      </div>

      <span className="hidden w-16 text-right lg:block">
        <span className="figure text-[13px] text-paper-300">{item.peakYear ?? '—'}</span>
        {item.rankAtPeak !== null && item.rankAtPeak <= 25 && (
          <span className="block text-[10.5px] text-brass-500/70">{ordinal(item.rankAtPeak)}</span>
        )}
      </span>

      <span className="hidden w-20 text-right lg:block">
        <span className="figure text-[13px] text-paper-200">
          {formatNumber(item.historicalPlays, locale)}
        </span>
      </span>

      <span className="hidden w-28 text-right lg:block">
        <span className="text-[12.5px] text-paper-400">{formatDate(item.lastTs, locale, 'short')}</span>
      </span>

      <span className="hidden w-28 text-right lg:block">
        <span className="text-[12.5px] text-paper-500">{formatSilence(item.daysMissing, t)}</span>
      </span>

      <div className="w-20 shrink-0 text-right">
        {item.uri ? (
          <Button
            size="sm"
            variant="ghost"
            icon={<ExternalLink />}
            className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            onClick={() => void openSpotify(item.uri)}
          >
            {t('graveyard.revive')}
          </Button>
        ) : (
          <Tooltip content={t('detail.noUri')}>
            <span className="text-[11px] text-paper-700">—</span>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
