import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  History,
  Shuffle,
  TrendingUp,
  TrendingDown,
  Minus,
  Moon,
  Flame,
  CalendarDays,
  ChevronRight,
  Share2,
} from 'lucide-react';
import { PageHeader } from '../layouts/PageHeader';
import { Button, Panel, Section, Segmented, cx } from '../components/ui/primitives';
import { EmptyState, ErrorState, PageSkeleton } from '../components/ui/states';
import { StatGrid } from '../components/domain/Stat';
import { TrackRow, ArtistRow, AlbumRow } from '../components/domain/rows';
import { Cover } from '../components/domain/Cover';
import { ListeningAreaChart, ListeningClock } from '../components/charts/charts';
import { ShareCardDialog } from '../features/share/ShareCardDialog';
import { useAsync } from '../hooks/useAsync';
import { useI18n } from '../i18n';
import { useAppStore } from '../stores/app-store';
import { api } from '../lib/api';
import { formatNumber, formatDuration, formatMonth, formatDate, formatPercent } from '../lib/format';
import type { RewindYear, RewindMonth } from '@shared/types/domain';

/**
 * Rewind.
 *
 * A year is presented as a place you can go back to. The two things that make it
 * feel like memory rather than statistics are near the bottom: what you heard
 * for the first time that year, and what you loved that year and never played
 * again.
 */

type Scope = 'year' | 'month';

export function RewindPage(): JSX.Element {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { year: yearParam } = useParams<{ year?: string }>();
  const hasArchive = useAppStore((s) => s.state?.hasArchive ?? false);

  const [scope, setScope] = useState<Scope>('year');
  const [month, setMonth] = useState<string | null>(null);

  const available = useAsync(() => api().rewind.years(), [hasArchive], { enabled: hasArchive });
  // Memoised so the fallback array does not create a new identity every render,
  // which would re-run the year resolution below on every single paint.
  const years = useMemo(() => available.data?.years ?? [], [available.data]);

  const selectedYear = useMemo(() => {
    const parsed = Number(yearParam);
    if (Number.isFinite(parsed) && years.includes(parsed)) return parsed;
    return years.length > 0 ? years[years.length - 1] : null;
  }, [yearParam, years]);

  const yearData = useAsync(
    () => api().rewind.year({ year: selectedYear as number }),
    [selectedYear],
    { enabled: selectedYear !== null && scope === 'year' },
  );

  const monthData = useAsync(() => api().rewind.month({ ym: month as string }), [month], {
    enabled: month !== null && scope === 'month',
  });

  useEffect(() => {
    if (scope === 'month' && !month && selectedYear) {
      setMonth(`${selectedYear}-01`);
    }
  }, [scope, month, selectedYear]);

  const pickRandomMonth = async (): Promise<void> => {
    const ym = await api().rewind.randomMonth();
    if (ym) {
      setMonth(ym);
      setScope('month');
    }
  };

  if (!hasArchive) {
    return (
      <EmptyState
        icon={<History />}
        title={t('empty.rewind')}
        body={t('empty.rewindBody')}
        action={
          <Button variant="primary" onClick={() => navigate('/import')}>
            {t('empty.noArchiveAction')}
          </Button>
        }
      />
    );
  }

  if (available.initial && available.loading) return <PageSkeleton />;
  if (available.error) return <ErrorState error={available.error} onRetry={available.reload} />;
  if (years.length === 0) {
    return (
      <Panel>
        <EmptyState icon={<History />} title={t('empty.rewind')} body={t('empty.rewindBody')} />
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={t('nav.rewind')}
        title={t('rewind.title')}
        description={t('rewind.subtitle')}
        actions={
          <>
            <Segmented
              value={scope}
              onChange={setScope}
              options={[
                { value: 'year', label: t('rewind.year') },
                { value: 'month', label: t('rewind.month') },
              ]}
            />
            <Button size="sm" variant="ghost" icon={<Shuffle />} onClick={() => void pickRandomMonth()}>
              {t('rewind.randomMonth')}
            </Button>
          </>
        }
      />

      {scope === 'year' && (
        <>
          <YearScrubber
            years={years}
            selected={selectedYear}
            onSelect={(year) => navigate(`/rewind/${year}`)}
          />
          {yearData.loading && yearData.initial && <PageSkeleton />}
          {yearData.error && <ErrorState error={yearData.error} onRetry={yearData.reload} />}
          {yearData.data && (
            <YearView
              data={yearData.data}
              onOpenMonth={(ym) => {
                setMonth(ym);
                setScope('month');
              }}
            />
          )}
        </>
      )}

      {scope === 'month' && (
        <>
          <MonthScrubber
            months={available.data?.months ?? []}
            selected={month}
            onSelect={setMonth}
          />
          {monthData.loading && monthData.initial && <PageSkeleton />}
          {monthData.error && <ErrorState error={monthData.error} onRetry={monthData.reload} />}
          {monthData.data && <MonthView data={monthData.data} />}
        </>
      )}
    </div>
  );
}

/* ------------------------------- scrubbers ------------------------------- */

function YearScrubber({
  years,
  selected,
  onSelect,
}: {
  years: number[];
  selected: number | null;
  onSelect: (year: number) => void;
}): JSX.Element {
  return (
    <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-2 no-scrollbar">
      {years.map((year) => {
        const active = year === selected;
        return (
          <button
            key={year}
            type="button"
            onClick={() => onSelect(year)}
            className={cx(
              'figure shrink-0 rounded-md border px-4 py-2 text-[14px] transition-all duration-150',
              active
                ? 'border-brass-500/40 bg-brass-500/12 text-brass-200'
                : 'border-white/[0.06] text-paper-500 hover:border-white/[0.13] hover:text-paper-100',
            )}
          >
            {year}
          </button>
        );
      })}
    </div>
  );
}

function MonthScrubber({
  months,
  selected,
  onSelect,
}: {
  months: string[];
  selected: string | null;
  onSelect: (ym: string) => void;
}): JSX.Element {
  const { locale } = useI18n();
  return (
    <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-2 no-scrollbar">
      {months.map((ym) => {
        const active = ym === selected;
        return (
          <button
            key={ym}
            type="button"
            onClick={() => onSelect(ym)}
            className={cx(
              'shrink-0 whitespace-nowrap rounded-md border px-3 py-1.5 text-[12.5px] transition-all duration-150',
              active
                ? 'border-brass-500/40 bg-brass-500/12 text-brass-200'
                : 'border-white/[0.06] text-paper-500 hover:border-white/[0.13] hover:text-paper-100',
            )}
          >
            {formatMonth(ym, locale, 'short')}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------- year view ------------------------------ */

function YearView({
  data,
  onOpenMonth,
}: {
  data: RewindYear;
  onOpenMonth: (ym: string) => void;
}): JSX.Element {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const [sharing, setSharing] = useState(false);

  const comparison = useMemo(() => {
    if (!data.previous || data.previous.msPlayed === 0) return null;
    const delta = (data.msPlayed - data.previous.msPlayed) / data.previous.msPlayed;
    const percent = Math.abs(Math.round(delta * 100));
    if (percent < 5) return { key: 'rewind.compareSame', percent, direction: 'same' as const };
    return {
      key: delta > 0 ? 'rewind.compareUp' : 'rewind.compareDown',
      percent,
      direction: delta > 0 ? ('up' as const) : ('down' as const),
    };
  }, [data]);

  return (
    <div className="flex flex-col stack-gap">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-[42px] leading-none tracking-tight text-paper-50">
            {data.year}
          </h2>
          {comparison && data.previous && (
            <p className="mt-3 flex items-center gap-1.5 text-[12.5px] text-paper-500">
              {comparison.direction === 'up' ? (
                <TrendingUp aria-hidden className="h-3.5 w-3.5 text-sage-400" />
              ) : comparison.direction === 'down' ? (
                <TrendingDown aria-hidden className="h-3.5 w-3.5 text-clay-400" />
              ) : (
                <Minus aria-hidden className="h-3.5 w-3.5" />
              )}
              {t(comparison.key, { percent: comparison.percent, year: data.previous.year })}
            </p>
          )}
        </div>
        <Button size="sm" variant="ghost" icon={<Share2 />} onClick={() => setSharing(true)}>
          {t('detail.share')}
        </Button>
      </div>

      <StatGrid
        columns={6}
        stats={[
          { label: t('stat.streams'), value: formatNumber(data.streams, locale) },
          { label: t('stat.listeningTime'), value: formatDuration(data.msPlayed, locale) },
          { label: t('stat.tracks'), value: formatNumber(data.tracks, locale) },
          { label: t('stat.artists'), value: formatNumber(data.artists, locale) },
          { label: t('stat.albums'), value: formatNumber(data.albums, locale) },
          {
            label: t('rewind.lateNight'),
            value: formatPercent(data.lateNightShare),
            tone: 'brass',
          },
        ]}
      />

      {data.monthly.length > 1 && (
        <Section title={t('rewind.months')}>
          <Panel className="card-pad">
            <ListeningAreaChart
              height={180}
              metric="msPlayed"
              data={data.monthly.map((point) => ({
                key: point.ym,
                plays: point.plays,
                msPlayed: point.msPlayed,
              }))}
            />
            <div className="mt-4 flex flex-wrap gap-1.5">
              {data.monthly.map((point) => (
                <button
                  key={point.ym}
                  type="button"
                  onClick={() => onOpenMonth(point.ym)}
                  className="rounded border border-white/[0.06] px-2 py-1 text-[11.5px] text-paper-500 transition-colors hover:border-white/[0.13] hover:text-paper-200"
                >
                  {formatMonth(point.ym, locale, 'short')}
                </button>
              ))}
            </div>
          </Panel>
        </Section>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {data.mostActiveMonth && (
          <Highlight
            icon={<CalendarDays className="h-4 w-4" />}
            label={t('rewind.mostActiveMonth')}
            value={formatMonth(data.mostActiveMonth.ym, locale)}
            hint={formatDuration(data.mostActiveMonth.msPlayed, locale)}
            onClick={() => onOpenMonth(data.mostActiveMonth!.ym)}
          />
        )}
        {data.mostActiveDay && (
          <Highlight
            icon={<CalendarDays className="h-4 w-4" />}
            label={t('rewind.mostActiveDay')}
            value={formatDate(data.mostActiveDay.date, locale)}
            hint={formatDuration(data.mostActiveDay.msPlayed, locale)}
            onClick={() => navigate(`/day/${data.mostActiveDay!.date}`)}
          />
        )}
        {data.biggestObsession && (
          <Highlight
            icon={<Flame className="h-4 w-4" />}
            label={t('rewind.biggestObsession')}
            value={data.biggestObsession.name}
            hint={t('obsessions.window', {
              plays: data.biggestObsession.windowPlays,
              days: data.biggestObsession.windowDays,
            })}
            onClick={() => navigate(`/track/${data.biggestObsession!.entityId}`)}
          />
        )}
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <Section title={t('archive.topTracks')}>
          <Panel className="py-2">
            {data.topTracks.map((track, index) => (
              <TrackRow key={track.id} track={track} index={index + 1} dense />
            ))}
          </Panel>
        </Section>

        <Section title={t('archive.topArtists')}>
          <Panel className="py-2">
            {data.topArtists.map((artist, index) => (
              <ArtistRow key={artist.id} artist={artist} index={index + 1} dense />
            ))}
          </Panel>
        </Section>
      </div>

      {data.topAlbums.length > 0 && (
        <Section title={t('detail.topAlbums')}>
          <Panel className="py-2">
            {data.topAlbums.map((album, index) => (
              <AlbumRow key={album.id} album={album} index={index + 1} dense />
            ))}
          </Panel>
        </Section>
      )}

      <div className="grid gap-8 lg:grid-cols-2">
        <Section title={t('rewind.firstHeardArtists', { year: data.year })}>
          <Panel className="card-pad">
            {data.firstHeardArtists.length === 0 ? (
              <p className="text-[13px] text-paper-600">{t('empty.genericBody')}</p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {data.firstHeardArtists.map((artist) => (
                  <li key={artist.id}>
                    <Link
                      to={`/artist/${artist.id}`}
                      className="group flex items-center gap-3 rounded px-1 py-1 transition-colors hover:bg-white/[0.03]"
                    >
                      <Cover name={artist.name} size="xs" rounded="full" />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-paper-200 group-hover:text-paper-50">
                        {artist.name}
                      </span>
                      <span className="text-[11.5px] text-paper-600">
                        {formatDate(artist.ts, locale, 'short')}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </Section>

        <Section title={t('rewind.vanished', { year: data.year })}>
          <Panel className={data.vanished.length === 0 ? 'card-pad' : 'py-2'}>
            {data.vanished.length === 0 ? (
              <p className="text-[13px] text-paper-600">{t('rewind.vanishedEmpty')}</p>
            ) : (
              data.vanished.map((track) => <TrackRow key={track.id} track={track} dense />)
            )}
          </Panel>
        </Section>
      </div>

      <Section title={t('clock.title')}>
        <Panel className="flex flex-col items-center gap-6 card-pad sm:flex-row sm:items-start">
          <ListeningClock hours={data.hourly} size={200} />
          <div className="flex-1">
            <p className="text-[13.5px] leading-relaxed text-paper-300">
              {t('clock.peakHour', {
                hour: `${String(
                  data.hourly.reduce((best, h) => (h.plays > best.plays ? h : best), data.hourly[0])
                    ?.hour ?? 0,
                ).padStart(2, '0')}:00`,
              })}
            </p>
            <p className="mt-2 text-[13.5px] leading-relaxed text-paper-400">
              {t('rewind.lateNightValue', { percent: Math.round(data.lateNightShare * 100) })}
            </p>
            <Moon aria-hidden className="mt-5 h-4 w-4 text-haze-400/70" />
          </div>
        </Panel>
      </Section>

      <ShareCardDialog
        open={sharing}
        onClose={() => setSharing(false)}
        card={{
          kind: 'year',
          title: String(data.year),
          subtitle: t('share.template.year'),
          statement: t('import.highlight.biggestYear', {
            year: data.year,
            plays: data.streams,
            hours: Math.round(data.msPlayed / 3600000),
          }),
          lines: data.topArtists.slice(0, 4).map((artist) => artist.name),
          figure: formatDuration(data.msPlayed, locale),
          figureLabel: t('stat.listeningTime'),
          accent: 'haze',
        }}
      />
    </div>
  );
}

function Highlight({
  icon,
  label,
  value,
  hint,
  onClick,
}: {
  icon: JSX.Element;
  label: string;
  value: string;
  hint: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button type="button" onClick={onClick} className="text-left">
      <Panel interactive className="flex h-full items-start gap-3.5 card-pad">
        <span aria-hidden className="mt-0.5 shrink-0 text-brass-400/80">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="eyebrow block">{label}</span>
          <span className="mt-1.5 block truncate font-display text-[16px] text-paper-50">{value}</span>
          <span className="mt-1 block truncate text-[12px] text-paper-500">{hint}</span>
        </span>
        <ChevronRight aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-paper-700" />
      </Panel>
    </button>
  );
}

/* ------------------------------- month view ------------------------------ */

function MonthView({ data }: { data: RewindMonth }): JSX.Element {
  const { t, locale } = useI18n();

  return (
    <div className="flex flex-col stack-gap">
      <h2 className="font-display text-[32px] leading-none tracking-tight text-paper-50">
        {formatMonth(data.ym, locale)}
      </h2>

      <StatGrid
        columns={4}
        stats={[
          { label: t('stat.streams'), value: formatNumber(data.streams, locale) },
          { label: t('stat.listeningTime'), value: formatDuration(data.msPlayed, locale) },
          { label: t('stat.tracks'), value: formatNumber(data.tracks, locale) },
          { label: t('stat.artists'), value: formatNumber(data.artists, locale) },
        ]}
      />

      {data.daily.length > 0 && (
        <Panel className="card-pad">
          <ListeningAreaChart
            height={150}
            metric="msPlayed"
            labelFormat="raw"
            data={data.daily.map((point) => ({
              key: point.date.slice(8),
              plays: point.plays,
              msPlayed: point.msPlayed,
            }))}
          />
        </Panel>
      )}

      <div className="grid gap-8 lg:grid-cols-2">
        <Section title={t('archive.topTracks')}>
          <Panel className="py-2">
            {data.topTracks.map((track, index) => (
              <TrackRow key={track.id} track={track} index={index + 1} dense />
            ))}
          </Panel>
        </Section>

        <Section title={t('archive.topArtists')}>
          <Panel className="py-2">
            {data.topArtists.map((artist, index) => (
              <ArtistRow key={artist.id} artist={artist} index={index + 1} dense />
            ))}
          </Panel>
        </Section>
      </div>

      {data.newArtists.length > 0 && (
        <Section title={t('rewind.newArtists')}>
          <Panel className="card-pad">
            <div className="flex flex-wrap gap-2">
              {data.newArtists.map((artist) => (
                <Link
                  key={artist.id}
                  to={`/artist/${artist.id}`}
                  className="flex items-center gap-2 rounded-full border border-white/[0.07] py-1 pl-1 pr-3 transition-colors hover:border-white/[0.14]"
                >
                  <Cover name={artist.name} size="xs" rounded="full" />
                  <span className="text-[12.5px] text-paper-300">{artist.name}</span>
                  <span className="figure text-[11.5px] text-paper-600">{artist.plays}</span>
                </Link>
              ))}
            </div>
          </Panel>
        </Section>
      )}
    </div>
  );
}
