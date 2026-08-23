import { Link, useParams } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { DetailHeader } from '../layouts/PageHeader';
import { Button, Meter, Panel, Section, Tooltip } from '../components/ui/primitives';
import { ErrorState, PageSkeleton } from '../components/ui/states';
import { Cover } from '../components/domain/Cover';
import { FactList, TrackRow } from '../components/domain/rows';
import { ListeningAreaChart } from '../components/charts/charts';
import { NoteEditor } from './TrackDetailPage';
import { useAsync } from '../hooks/useAsync';
import { useI18n } from '../i18n';
import { api, openSpotify } from '../lib/api';
import { formatNumber, formatDuration, formatDate, formatMonth } from '../lib/format';

/**
 * Album detail.
 *
 * The question this page answers that the others do not: did you live inside
 * this record, or did you replay one song from it? Breadth and top-three
 * concentration are shown together, with a sentence that states which it was.
 */

export function AlbumDetailPage(): JSX.Element {
  const { t, locale } = useI18n();
  const { id } = useParams<{ id: string }>();
  const albumId = Number(id);

  const { data, error, loading, initial, reload } = useAsync(
    () => api().entity.album({ id: albumId }),
    [albumId],
    { enabled: Number.isFinite(albumId) && albumId > 0 },
  );

  if (initial && loading) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <PageSkeleton />;

  const { album } = data;
  const listenedBroadly = data.breadth >= 0.55 && data.concentrationTop3 < 0.62;

  return (
    <div className="flex flex-col stack-gap">
      <DetailHeader
        backTo={{ to: `/artist/${album.artistId}`, label: album.artist }}
        cover={<Cover name={album.name} secondary={album.artist} size="hero" />}
        eyebrow={t('detail.album')}
        title={album.name}
        subtitle={
          <Link to={`/artist/${album.artistId}`} className="link-quiet">
            {album.artist}
          </Link>
        }
        facts={
          <FactList
            columns={3}
            facts={[
              { label: t('detail.totalPlays'), value: formatNumber(album.qualifyingPlays, locale) },
              { label: t('detail.listeningTime'), value: formatDuration(album.msPlayed, locale) },
              { label: t('detail.tracksHeard'), value: formatNumber(data.tracksHeard, locale) },
              { label: t('detail.firstHeard'), value: formatDate(album.firstTs, locale) },
              { label: t('detail.lastHeard'), value: formatDate(album.lastTs, locale) },
              {
                label: t('detail.peakMonth'),
                value: data.peakYm ? formatMonth(data.peakYm, locale, 'short') : '—',
              },
            ]}
          />
        }
        actions={
          album.uri ? (
            <Button variant="secondary" icon={<ExternalLink />} onClick={() => void openSpotify(album.uri)}>
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

      <Section title={t('detail.albumBreadth')}>
        <Panel className="card-pad">
          <p className="mb-5 text-[14px] leading-relaxed text-paper-200">
            {t(listenedBroadly ? 'detail.albumDeep' : 'detail.albumShallow')}
          </p>
          <div className="grid gap-6 sm:grid-cols-2">
            <Meter
              label={t('detail.albumBreadth')}
              value={data.breadth}
              tone="sage"
              hint={t('detail.albumBreadthValue', { percent: Math.round(data.breadth * 100) })}
            />
            <Meter
              label={t('detail.topTracks')}
              value={data.concentrationTop3}
              tone="brass"
              hint={t('detail.albumConcentration', {
                percent: Math.round(data.concentrationTop3 * 100),
              })}
            />
          </div>
        </Panel>
      </Section>

      {data.monthly.length > 1 && (
        <Section title={t('detail.timeline')}>
          <Panel className="card-pad">
            <ListeningAreaChart
              height={180}
              data={data.monthly.map((point) => ({
                key: point.ym,
                plays: point.qualifyingPlays,
                msPlayed: point.msPlayed,
              }))}
            />
          </Panel>
        </Section>
      )}

      <Section title={t('detail.topTracks')}>
        <Panel className="py-2">
          {data.topTracks.map((track, index) => (
            <TrackRow key={track.id} track={track} index={index + 1} dense />
          ))}
        </Panel>
      </Section>

      <Section title={t('detail.note')}>
        <NoteEditor entityType="album" entityId={album.id} initial={data.note?.body ?? ''} />
      </Section>
    </div>
  );
}
