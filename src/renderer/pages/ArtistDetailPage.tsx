import { useParams } from 'react-router-dom';
import { ExternalLink, Sparkles } from 'lucide-react';
import { DetailHeader } from '../layouts/PageHeader';
import { Button, Panel, Section, Tooltip, cx } from '../components/ui/primitives';
import { ErrorState, PageSkeleton } from '../components/ui/states';
import { Cover } from '../components/domain/Cover';
import { FactList, TrackRow, AlbumRow } from '../components/domain/rows';
import { Stat } from '../components/domain/Stat';
import { ListeningAreaChart } from '../components/charts/charts';
import { NoteEditor } from './TrackDetailPage';
import { useAsync } from '../hooks/useAsync';
import { useI18n } from '../i18n';
import { api, openSpotify } from '../lib/api';
import {
  formatNumber,
  formatDuration,
  formatDate,
  formatMonth,
  formatSilence,
  formatPercent,
} from '../lib/format';
import type { Insight } from '@shared/types/domain';

/**
 * Artist detail.
 *
 * The relationship curve is the centrepiece — a single artist's monthly
 * listening over a decade tells you more than any table. Insights below it are
 * assembled from real counts, never generated prose.
 */

export function ArtistDetailPage(): JSX.Element {
  const { t, locale } = useI18n();
  const { id } = useParams<{ id: string }>();
  const artistId = Number(id);

  const { data, error, loading, initial, reload } = useAsync(
    () => api().entity.artist({ id: artistId }),
    [artistId],
    { enabled: Number.isFinite(artistId) && artistId > 0 },
  );

  if (initial && loading) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <PageSkeleton />;

  const { artist } = data;

  return (
    <div className="flex flex-col stack-gap">
      <DetailHeader
        cover={<Cover name={artist.name} size="hero" rounded="full" />}
        eyebrow={t('detail.artist')}
        title={artist.name}
        subtitle={
          <span className="text-paper-400">
            {formatNumber(artist.trackCount, locale)} {t('unit.tracks')} ·{' '}
            {formatNumber(data.albumCount, locale)} {t('unit.albums')}
          </span>
        }
        facts={
          <FactList
            columns={3}
            facts={[
              { label: t('detail.totalPlays'), value: formatNumber(artist.qualifyingPlays, locale) },
              { label: t('detail.listeningTime'), value: formatDuration(artist.msPlayed, locale) },
              { label: t('detail.firstHeard'), value: formatDate(artist.firstTs, locale) },
              {
                label: t('detail.lastHeard'),
                value: formatDate(artist.lastTs, locale),
                hint:
                  artist.lastTs !== null
                    ? formatSilence(Math.floor((Date.now() - artist.lastTs) / 86_400_000), t)
                    : undefined,
              },
              { label: t('detail.peakYear'), value: data.peakYear ?? '—' },
              {
                label: t('detail.peakMonth'),
                value: data.peakYm ? formatMonth(data.peakYm, locale, 'short') : '—',
              },
            ]}
          />
        }
        actions={
          artist.uri ? (
            <Button variant="secondary" icon={<ExternalLink />} onClick={() => void openSpotify(artist.uri)}>
              {t('detail.openInSpotify')}
            </Button>
          ) : (
            <Tooltip content={t('detail.noUri')}>
              <Button variant="secondary" icon={<ExternalLink />} disabled>
                {t('detail.openInSpotify')}
              </Button>
            </Tooltip>
          )
        }
      />

      {data.monthly.length > 1 && (
        <Section title={t('detail.relationship')}>
          <Panel className="card-pad">
            <ListeningAreaChart
              height={210}
              metric="msPlayed"
              data={data.monthly.map((point) => ({
                key: point.ym,
                plays: point.qualifyingPlays,
                msPlayed: point.msPlayed,
              }))}
            />
          </Panel>
        </Section>
      )}

      {data.insights.length > 0 && (
        <Section title={t('detail.insights')}>
          <div className="grid gap-2.5 lg:grid-cols-2">
            {data.insights.map((insight) => (
              <InsightCard key={insight.key} insight={insight} />
            ))}
          </div>
        </Section>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Panel className="card-pad">
          <Stat label={t('stat.streams')} value={formatNumber(data.events, locale)} size="sm" />
        </Panel>
        <Panel className="card-pad">
          <Stat
            label={t('detail.skips')}
            value={formatPercent(data.events > 0 ? data.skips / data.events : 0)}
            size="sm"
          />
        </Panel>
        <Panel className="card-pad">
          <Stat
            label={t('detail.longestAbsence')}
            value={data.longestAbsenceDays > 0 ? formatSilence(data.longestAbsenceDays, t) : '—'}
            size="sm"
            hint={
              data.longestAbsenceFrom
                ? `${formatDate(data.longestAbsenceFrom, locale, 'short')} → ${formatDate(data.longestAbsenceTo, locale, 'short')}`
                : undefined
            }
          />
        </Panel>
        <Panel className="card-pad">
          <Stat
            label={t('detail.shortPlays')}
            value={formatNumber(data.shortPlays, locale)}
            size="sm"
          />
        </Panel>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <Section title={t('detail.topTracks')}>
          <Panel className="py-2">
            {data.topTracks.map((track, index) => (
              <TrackRow key={track.id} track={track} index={index + 1} dense />
            ))}
          </Panel>
        </Section>

        <Section title={t('detail.topAlbums')}>
          <Panel className="py-2">
            {data.topAlbums.length === 0 ? (
              <p className="px-4 py-6 text-[13px] text-paper-600">{t('empty.genericBody')}</p>
            ) : (
              data.topAlbums.map((album, index) => (
                <AlbumRow key={album.id} album={album} index={index + 1} dense />
              ))
            )}
          </Panel>
        </Section>
      </div>

      <Section title={t('detail.note')}>
        <NoteEditor entityType="artist" entityId={artist.id} initial={data.note?.body ?? ''} />
      </Section>
    </div>
  );
}

function InsightCard({ insight }: { insight: Insight }): JSX.Element {
  const { t } = useI18n();
  const tone =
    insight.tone === 'warm'
      ? 'text-brass-400/80'
      : insight.tone === 'cool'
        ? 'text-haze-400/80'
        : 'text-paper-500';

  return (
    <Panel className="flex items-start gap-3.5 card-pad">
      <Sparkles aria-hidden className={cx('mt-0.5 h-3.5 w-3.5 shrink-0', tone)} />
      <p className="text-[13.5px] leading-relaxed text-paper-200">
        {t(insight.key, insight.values)}
      </p>
    </Panel>
  );
}
