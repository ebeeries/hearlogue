import { Link, useParams } from 'react-router-dom';
import { SkipForward } from 'lucide-react';
import { PageHeader } from '../layouts/PageHeader';
import { Panel, Section, cx } from '../components/ui/primitives';
import { ErrorState, PageSkeleton } from '../components/ui/states';
import { StatGrid } from '../components/domain/Stat';
import { Cover } from '../components/domain/Cover';
import { useAsync } from '../hooks/useAsync';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { formatDuration, formatDateTime, formatTime, formatClock } from '../lib/format';

/**
 * A single listening session, played back as a running order.
 *
 * Short plays are shown with their real dwell time rather than hidden, because
 * the skips are part of what the session was.
 */
export function SessionDetailPage(): JSX.Element {
  const { t, locale } = useI18n();
  const { id } = useParams<{ id: string }>();
  const sessionId = Number(id);

  const { data, error, loading, initial, reload } = useAsync(
    () => api().sessions.get({ id: sessionId }),
    [sessionId],
    { enabled: Number.isFinite(sessionId) && sessionId > 0 },
  );

  if (initial && loading) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <PageSkeleton />;

  return (
    <div className="flex flex-col stack-gap">
      <PageHeader
        backTo={{ to: '/sessions', label: t('sessions.title') }}
        eyebrow={t('sessions.detail')}
        title={formatDateTime(data.startTs, locale)}
        description={
          data.topArtist ? `${t('sessions.dominant')} ${data.topArtist}` : undefined
        }
      />

      <StatGrid
        columns={4}
        stats={[
          { label: t('sessions.duration'), value: formatDuration(data.msPlayed, locale) },
          { label: t('sessions.tracks'), value: data.events },
          { label: t('stat.artists'), value: data.uniqueArtists },
          {
            label: t('sessions.diversity'),
            value: `${Math.round(data.diversity * 100)}%`,
            hint:
              data.maxTrackRepeats > 1
                ? t('sessions.repeats', { count: data.maxTrackRepeats })
                : undefined,
          },
        ]}
      />

      <Section title={t('calendar.day.tracks')}>
        <Panel className="overflow-hidden">
          {data.events_list.map((event, index) => (
            <div
              key={`${event.ts}-${index}`}
              className={cx(
                'flex items-center gap-3.5 border-b border-white/[0.03] px-4 py-2 last:border-b-0',
                event.skipped && 'opacity-55',
              )}
            >
              <span className="figure w-12 shrink-0 text-[11.5px] text-paper-600">
                {formatTime(event.ts, locale)}
              </span>
              <Cover name={event.track} secondary={event.artist} size="xs" />
              <span className="min-w-0 flex-1">
                <Link
                  to={`/track/${event.trackId}`}
                  className="block truncate text-[13px] text-paper-100 hover:text-brass-300"
                >
                  {event.track}
                </Link>
                <Link
                  to={`/artist/${event.artistId}`}
                  className="block truncate text-[11.5px] text-paper-500 hover:text-paper-300"
                >
                  {event.artist}
                </Link>
              </span>
              {event.skipped && (
                <SkipForward aria-hidden className="h-3.5 w-3.5 shrink-0 text-ember-500/70" />
              )}
              <span className="figure w-12 shrink-0 text-right text-[12px] text-paper-500">
                {formatClock(event.msPlayed)}
              </span>
            </div>
          ))}
        </Panel>
      </Section>
    </div>
  );
}
