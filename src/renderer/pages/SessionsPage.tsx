import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock3, ChevronRight, Repeat, Shuffle } from 'lucide-react';
import { PageHeader } from '../layouts/PageHeader';
import { Button, Panel, Segmented, cx } from '../components/ui/primitives';
import { EmptyState, ErrorState, SkeletonRows } from '../components/ui/states';
import { Cover } from '../components/domain/Cover';
import { useAsync } from '../hooks/useAsync';
import { useI18n } from '../i18n';
import { useAppStore } from '../stores/app-store';
import { api } from '../lib/api';
import { formatNumber, formatDuration, formatDateTime } from '../lib/format';
import type { ListeningSession } from '@shared/types/domain';

type Sort = 'recent' | 'longest' | 'mostDiverse' | 'mostRepetitive' | 'mostTracks';

const PAGE_SIZE = 30;

export function SessionsPage(): JSX.Element {
  const { t, locale } = useI18n();
  const sessionGap = useAppStore((s) => s.settings.sessionGapMinutes);
  const [sort, setSort] = useState<Sort>('longest');
  const [limit, setLimit] = useState(PAGE_SIZE);

  const { data, error, loading, initial, reload } = useAsync(
    () => api().sessions.list({ sort, limit, offset: 0 }),
    [sort, limit],
  );

  const items = data?.items ?? [];

  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        backTo={{ to: '/calendar', label: t('nav.calendar') }}
        eyebrow={t('nav.calendar')}
        title={t('sessions.title')}
        description={t('sessions.subtitle', { minutes: sessionGap })}
        actions={
          <Segmented
            value={sort}
            onChange={(value) => {
              setSort(value);
              setLimit(PAGE_SIZE);
            }}
            size="sm"
            options={[
              { value: 'longest', label: t('sessions.sort.longest') },
              { value: 'mostTracks', label: t('sessions.sort.mostTracks') },
              { value: 'mostDiverse', label: t('sessions.sort.mostDiverse') },
              { value: 'mostRepetitive', label: t('sessions.sort.mostRepetitive') },
              { value: 'recent', label: t('sessions.sort.recent') },
            ]}
          />
        }
      />

      {error && <ErrorState error={error} onRetry={reload} />}
      {initial && loading && <SkeletonRows rows={8} height="h-16" />}

      {!loading && items.length === 0 && (
        <Panel>
          <EmptyState icon={<Clock3 />} title={t('empty.sessions')} body={t('empty.sessionsBody')} />
        </Panel>
      )}

      {items.length > 0 && (
        <Panel className="overflow-hidden">
          {items.map((session) => (
            <SessionRow key={session.id} session={session} sort={sort} />
          ))}
        </Panel>
      )}

      {data && items.length < data.total && (
        <div className="flex justify-center">
          <Button variant="secondary" loading={loading} onClick={() => setLimit((l) => l + PAGE_SIZE)}>
            {t('library.loadMore')}
          </Button>
        </div>
      )}

      {data && data.total > 0 && (
        <p className="text-center text-[12px] text-paper-600">
          {t('library.showing', { shown: items.length, total: formatNumber(data.total, locale) })}
        </p>
      )}
    </div>
  );
}

function SessionRow({ session, sort }: { session: ListeningSession; sort: Sort }): JSX.Element {
  const { t, locale } = useI18n();

  return (
    <Link
      to={`/session/${session.id}`}
      className={cx(
        'group flex items-center gap-4 border-b border-white/[0.035] px-5 py-3 last:border-b-0',
        'transition-colors hover:bg-white/[0.028]',
      )}
    >
      {session.topArtist ? (
        <Cover name={session.topArtist} size="sm" rounded="full" />
      ) : (
        <span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/[0.06] text-paper-600"
        >
          <Clock3 className="h-4 w-4" />
        </span>
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] text-paper-100">
          {session.topArtist ?? formatDateTime(session.startTs, locale)}
        </p>
        <p className="mt-0.5 truncate text-[11.5px] text-paper-500">
          {formatDateTime(session.startTs, locale)}
          {session.topTrack && ` · ${session.topTrack}`}
        </p>
      </div>

      <div className="hidden items-center gap-6 sm:flex">
        <Metric value={formatDuration(session.msPlayed, locale)} label={t('sessions.duration')} />
        <Metric value={String(session.events)} label={t('sessions.tracks')} />
        <Metric value={String(session.uniqueArtists)} label={t('stat.artists')} />
        {sort === 'mostRepetitive' ? (
          <Metric
            value={`${session.maxTrackRepeats}×`}
            label={t('sessions.repeats', { count: session.maxTrackRepeats }).split(' ')[0]}
            icon={<Repeat className="h-3 w-3" />}
          />
        ) : (
          <Metric
            value={`${Math.round(session.diversity * 100)}%`}
            label={t('sessions.diversity')}
            icon={<Shuffle className="h-3 w-3" />}
          />
        )}
      </div>

      <ChevronRight
        aria-hidden
        className="h-3.5 w-3.5 shrink-0 text-paper-700 transition-transform group-hover:translate-x-0.5"
      />
    </Link>
  );
}

function Metric({
  value,
  label,
  icon,
}: {
  value: string;
  label: string;
  icon?: JSX.Element;
}): JSX.Element {
  return (
    <span className="w-16 shrink-0 text-right">
      <span className="figure block text-[13px] text-paper-200">{value}</span>
      <span className="flex items-center justify-end gap-1 text-[10px] uppercase tracking-wider text-paper-600">
        {icon}
        {label}
      </span>
    </span>
  );
}
