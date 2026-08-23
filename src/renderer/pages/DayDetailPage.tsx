import { Link, useParams } from 'react-router-dom';
import { CalendarDays, Clock3, ChevronRight } from 'lucide-react';
import { PageHeader } from '../layouts/PageHeader';
import { Panel, Section, cx } from '../components/ui/primitives';
import { ErrorState, PageSkeleton, EmptyState } from '../components/ui/states';
import { StatGrid } from '../components/domain/Stat';
import { Cover } from '../components/domain/Cover';
import { ListeningBarChart } from '../components/charts/charts';
import { useAsync } from '../hooks/useAsync';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { formatNumber, formatDuration, formatDate, formatTime, formatHourLabel } from '../lib/format';

/**
 * A single day.
 *
 * Reached from the calendar heatmap or from "on this day". Shows the day's shape
 * hour by hour, what was played, and the sessions it broke into.
 */

export function DayDetailPage(): JSX.Element {
  const { t, locale } = useI18n();
  const { date } = useParams<{ date: string }>();

  const { data, error, loading, initial, reload } = useAsync(
    () => api().calendar.day({ date: date as string }),
    [date],
    { enabled: Boolean(date) },
  );

  if (initial && loading) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <PageSkeleton />;

  return (
    <div className="flex flex-col stack-gap">
      <PageHeader
        backTo={{ to: '/calendar', label: t('nav.calendar') }}
        eyebrow={t('nav.calendar')}
        title={formatDate(data.date, locale, 'long')}
        description={
          data.firstTs && data.lastTs
            ? `${t('calendar.day.firstPlay')} ${formatTime(data.firstTs, locale)} · ${t('calendar.day.lastPlay')} ${formatTime(data.lastTs, locale)}`
            : undefined
        }
      />

      {data.events === 0 ? (
        <Panel>
          <EmptyState icon={<CalendarDays />} title={t('calendar.noListening')} />
        </Panel>
      ) : (
        <>
          <StatGrid
            columns={4}
            stats={[
              { label: t('stat.listeningTime'), value: formatDuration(data.msPlayed, locale) },
              { label: t('stat.streams'), value: formatNumber(data.events, locale) },
              { label: t('stat.tracks'), value: formatNumber(data.uniqueTracks, locale) },
              { label: t('stat.artists'), value: formatNumber(data.uniqueArtists, locale) },
            ]}
          />

          <Section title={t('calendar.day.hourly')}>
            <Panel className="card-pad">
              <ListeningBarChart
                height={140}
                data={data.hourly.map((bucket) => ({
                  key: String(bucket.hour),
                  value: bucket.plays,
                  highlight: bucket.plays > 0,
                }))}
                labelFormat={(key) => formatHourLabel(Number(key))}
              />
            </Panel>
          </Section>

          <div className="grid gap-4 sm:grid-cols-2">
            {data.topArtist && (
              <Panel className="flex items-center gap-4 card-pad">
                <Cover name={data.topArtist.name} size="md" rounded="full" />
                <div className="min-w-0 flex-1">
                  <p className="eyebrow">{t('calendar.day.topArtist')}</p>
                  <Link
                    to={`/artist/${data.topArtist.id}`}
                    className="mt-1 block truncate font-display text-[16px] text-paper-50 hover:text-brass-300"
                  >
                    {data.topArtist.name}
                  </Link>
                </div>
                <span className="figure text-[15px] text-paper-400">{data.topArtist.plays}</span>
              </Panel>
            )}

            {data.topTrack && (
              <Panel className="flex items-center gap-4 card-pad">
                <Cover name={data.topTrack.name} secondary={data.topTrack.artist} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="eyebrow">{t('calendar.day.topTrack')}</p>
                  <Link
                    to={`/track/${data.topTrack.id}`}
                    className="mt-1 block truncate font-display text-[16px] text-paper-50 hover:text-brass-300"
                  >
                    {data.topTrack.name}
                  </Link>
                </div>
                <span className="figure text-[15px] text-paper-400">{data.topTrack.plays}</span>
              </Panel>
            )}
          </div>

          <Section title={t('calendar.day.tracks')}>
            <Panel className="overflow-hidden">
              {data.topTracks.map((track, index) => (
                <Link
                  key={track.id}
                  to={`/track/${track.id}`}
                  className={cx(
                    'flex items-center gap-3.5 border-b border-white/[0.035] px-4 py-2.5 last:border-b-0',
                    'transition-colors hover:bg-white/[0.028]',
                  )}
                >
                  <span className="figure w-5 text-right text-[12px] text-paper-600">
                    {index + 1}
                  </span>
                  <Cover name={track.name} secondary={track.artist} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] text-paper-100">{track.name}</span>
                    <span className="block truncate text-[11.5px] text-paper-500">{track.artist}</span>
                  </span>
                  <span className="figure shrink-0 text-[13px] text-paper-300">{track.plays}</span>
                  <span className="figure hidden w-16 shrink-0 text-right text-[12px] text-paper-500 sm:block">
                    {formatDuration(track.msPlayed, locale)}
                  </span>
                </Link>
              ))}
            </Panel>
          </Section>

          {data.sessions.length > 0 && (
            <Section title={t('calendar.day.sessions')}>
              <div className="flex flex-col gap-2">
                {data.sessions.map((session) => (
                  <Link key={session.id} to={`/session/${session.id}`}>
                    <Panel interactive className="flex items-center gap-4 card-pad">
                      <Clock3 aria-hidden className="h-4 w-4 shrink-0 text-paper-600" />
                      <span className="figure shrink-0 text-[13px] text-paper-200">
                        {formatTime(session.startTs, locale)} — {formatTime(session.endTs, locale)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-paper-500">
                        {session.topArtist ? `${t('sessions.dominant')} ${session.topArtist}` : ''}
                      </span>
                      <span className="figure shrink-0 text-[12.5px] text-paper-400">
                        {session.events} {t('unit.tracks')}
                      </span>
                      <span className="figure shrink-0 text-[12.5px] text-paper-400">
                        {formatDuration(session.msPlayed, locale)}
                      </span>
                      <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-paper-700" />
                    </Panel>
                  </Link>
                ))}
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
