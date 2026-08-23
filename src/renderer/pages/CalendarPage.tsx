import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, Clock3, ListMusic } from 'lucide-react';
import { PageHeader } from '../layouts/PageHeader';
import { Button, Panel, Section, Segmented, cx } from '../components/ui/primitives';
import { EmptyState, ErrorState, PageSkeleton } from '../components/ui/states';
import { Stat } from '../components/domain/Stat';
import { ListeningClock, ProportionBar, CHART_COLORS } from '../components/charts/charts';
import { useAsync } from '../hooks/useAsync';
import { useI18n } from '../i18n';
import { useAppStore } from '../stores/app-store';
import { api } from '../lib/api';
import { formatNumber, formatDuration, formatDate, weekdayLabel, formatHourLabel } from '../lib/format';
import type { HeatmapResult } from '@preload/api-types';

/**
 * Calendar.
 *
 * A GitHub-style heatmap of every day with listening, plus the Listening Clock.
 * Weeks run as columns and days as rows, which is what makes multi-year history
 * scannable in one horizontal sweep.
 */

type Metric = 'msPlayed' | 'plays' | 'uniqueTracks';

export function CalendarPage(): JSX.Element {
  const { t } = useI18n();
  const navigate = useNavigate();
  const hasArchive = useAppStore((s) => s.state?.hasArchive ?? false);
  const [metric, setMetric] = useState<Metric>('msPlayed');

  const heatmap = useAsync(() => api().calendar.heatmap({ metric }), [metric, hasArchive], {
    enabled: hasArchive,
  });
  const clock = useAsync(() => api().archive.clock(), [hasArchive], { enabled: hasArchive });

  if (!hasArchive) {
    return (
      <EmptyState
        icon={<CalendarDays />}
        title={t('empty.calendar')}
        body={t('empty.calendarBody')}
        action={
          <Button variant="primary" onClick={() => navigate('/import')}>
            {t('empty.noArchiveAction')}
          </Button>
        }
      />
    );
  }

  if (heatmap.initial && heatmap.loading) return <PageSkeleton />;
  if (heatmap.error) return <ErrorState error={heatmap.error} onRetry={heatmap.reload} />;

  const data = heatmap.data;
  const clockData = clock.data;

  return (
    <div className="flex flex-col stack-gap">
      <PageHeader
        eyebrow={t('nav.calendar')}
        title={t('calendar.title')}
        description={t('calendar.subtitle')}
        actions={
          <Segmented
            value={metric}
            onChange={setMetric}
            size="sm"
            options={[
              { value: 'msPlayed', label: t('calendar.metric.msPlayed') },
              { value: 'plays', label: t('calendar.metric.plays') },
              { value: 'uniqueTracks', label: t('calendar.metric.uniqueTracks') },
            ]}
          />
        }
      />

      {!data || data.days.length === 0 ? (
        <Panel>
          <EmptyState icon={<CalendarDays />} title={t('empty.calendar')} body={t('empty.calendarBody')} />
        </Panel>
      ) : (
        <Heatmap data={data} metric={metric} onSelect={(date) => navigate(`/day/${date}`)} />
      )}

      {clockData && (
        <Section title={t('clock.title')}>
          <Panel className="flex flex-col gap-8 card-pad lg:flex-row lg:items-center">
            <ListeningClock hours={clockData.hourly} size={230} className="mx-auto shrink-0" />

            <div className="flex flex-1 flex-col gap-7">
              <div className="grid gap-6 sm:grid-cols-2">
                <Stat
                  label={t('clock.peakHourLabel')}
                  value={formatHourLabel(clockData.peakHour)}
                  size="md"
                  tone="brass"
                  hint={t('clock.peakHour', { hour: formatHourLabel(clockData.peakHour) })}
                />
                <Stat
                  label={t('clock.afterMidnightLabel')}
                  value={`${Math.round(clockData.afterMidnightShare * 100)}%`}
                  size="md"
                  hint={t('clock.afterMidnight', {
                    percent: Math.round(clockData.afterMidnightShare * 100),
                  })}
                />
              </div>

              <div>
                <p className="eyebrow mb-3">{t('clock.throughTheDay')}</p>
                <ProportionBar
                  segments={clockData.dayparts.map((part, index) => ({
                    key: part.key,
                    label: t(`clock.daypart.${part.key}`),
                    value: part.plays,
                    color: [
                      CHART_COLORS.haze,
                      CHART_COLORS.sage,
                      CHART_COLORS.accent,
                      CHART_COLORS.clay,
                      CHART_COLORS.plum,
                    ][index % 5],
                  }))}
                />
              </div>

              <div>
                <p className="eyebrow mb-3">{t('clock.weekdayVsWeekend')}</p>
                <ProportionBar
                  segments={[
                    {
                      key: 'weekday',
                      label: t('clock.weekday'),
                      value: clockData.weekday.plays,
                      color: CHART_COLORS.accent,
                    },
                    {
                      key: 'weekend',
                      label: t('clock.weekend'),
                      value: clockData.weekend.plays,
                      color: CHART_COLORS.haze,
                    },
                  ]}
                />
              </div>
            </div>
          </Panel>
        </Section>
      )}

      <Section
        title={t('sessions.title')}
        description={t('sessions.subtitle', { minutes: 30 })}
        action={
          <Button size="sm" variant="secondary" icon={<ListMusic />} onClick={() => navigate('/sessions')}>
            {t('common.viewAll')}
          </Button>
        }
      >
        <SessionSummary />
      </Section>
    </div>
  );
}

/* -------------------------------- heatmap -------------------------------- */

interface HeatmapWeek {
  key: string;
  days: ({ date: string; value: number; plays: number; msPlayed: number } | null)[];
}

function buildWeeks(days: HeatmapResult['days'], from: string, to: string): HeatmapWeek[] {
  const byDate = new Map(days.map((day) => [day.date, day]));
  const weeks: HeatmapWeek[] = [];

  const start = new Date(`${from}T12:00:00`);
  // Rewind to the Sunday on or before the first day, so rows line up as weekdays.
  start.setDate(start.getDate() - start.getDay());
  const end = new Date(`${to}T12:00:00`);

  const cursor = new Date(start);
  while (cursor <= end) {
    const week: HeatmapWeek = { key: cursor.toISOString().slice(0, 10), days: [] };
    for (let i = 0; i < 7; i++) {
      const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(
        cursor.getDate(),
      ).padStart(2, '0')}`;
      week.days.push(byDate.get(iso) ?? (iso >= from && iso <= to ? { date: iso, value: 0, plays: 0, msPlayed: 0 } : null));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

/** Five intensity steps, so a day's level is readable without a legend lookup. */
function levelFor(value: number, max: number): number {
  if (value <= 0) return 0;
  const ratio = value / Math.max(max, 1);
  if (ratio > 0.62) return 4;
  if (ratio > 0.34) return 3;
  if (ratio > 0.15) return 2;
  return 1;
}

const LEVEL_CLASSES = [
  'bg-white/[0.035]',
  'bg-brass-700/45',
  'bg-brass-600/60',
  'bg-brass-500/75',
  'bg-brass-400',
];

function Heatmap({
  data,
  metric,
  onSelect,
}: {
  data: HeatmapResult;
  metric: Metric;
  onSelect: (date: string) => void;
}): JSX.Element {
  const { t, locale } = useI18n();

  const weeks = useMemo(
    () => (data.from && data.to ? buildWeeks(data.days, data.from, data.to) : []),
    [data],
  );

  // Month labels sit above the first week that starts a new month.
  const monthLabels = useMemo(() => {
    const labels: { index: number; label: string }[] = [];
    let lastMonth = '';
    weeks.forEach((week, index) => {
      const firstReal = week.days.find(Boolean);
      if (!firstReal) return;
      const month = firstReal.date.slice(0, 7);
      if (month !== lastMonth) {
        lastMonth = month;
        labels.push({
          index,
          label: new Intl.DateTimeFormat(locale, { month: 'short' }).format(
            new Date(`${firstReal.date}T12:00:00`),
          ),
        });
      }
    });
    return labels;
  }, [weeks, locale]);

  const formatValue = (value: number): string =>
    metric === 'msPlayed' ? formatDuration(value, locale) : formatNumber(value, locale);

  return (
    <Panel className="card-pad">
      <div className="overflow-x-auto pb-2">
        <div className="inline-flex flex-col gap-1.5" style={{ minWidth: weeks.length * 14 }}>
          <div className="relative h-4" style={{ marginLeft: 26 }}>
            {monthLabels.map((label) => (
              <span
                key={`${label.index}-${label.label}`}
                className="absolute text-[10px] text-paper-600"
                style={{ left: label.index * 14 }}
              >
                {label.label}
              </span>
            ))}
          </div>

          <div className="flex gap-[3px]">
            <div className="mr-1.5 flex flex-col gap-[3px]">
              {[0, 1, 2, 3, 4, 5, 6].map((dow) => (
                <span
                  key={dow}
                  className="flex h-[11px] items-center text-[9px] text-paper-700"
                  style={{ width: 20 }}
                >
                  {dow % 2 === 1 ? weekdayLabel(dow, locale).slice(0, 2) : ''}
                </span>
              ))}
            </div>

            {weeks.map((week) => (
              <div key={week.key} className="flex flex-col gap-[3px]">
                {week.days.map((day, dow) =>
                  day === null ? (
                    <span key={dow} className="h-[11px] w-[11px]" />
                  ) : (
                    <button
                      key={day.date}
                      type="button"
                      onClick={() => day.plays > 0 && onSelect(day.date)}
                      disabled={day.plays === 0}
                      aria-label={`${formatDate(day.date, locale)} — ${formatValue(day.value)}`}
                      title={`${formatDate(day.date, locale)} · ${formatValue(day.value)}`}
                      className={cx(
                        'h-[11px] w-[11px] rounded-[2px] transition-all duration-100',
                        LEVEL_CLASSES[levelFor(day.value, data.max)],
                        day.plays > 0 && 'hover:ring-1 hover:ring-brass-300/60',
                      )}
                    />
                  ),
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-white/[0.05] pt-4">
        <span className="text-[11.5px] text-paper-600">
          {formatNumber(data.totalDays, locale)} {t('stat.activeDays').toLowerCase()}
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-paper-600">
          {t('calendar.less')}
          {LEVEL_CLASSES.map((className, index) => (
            <span key={index} aria-hidden className={cx('h-[11px] w-[11px] rounded-[2px]', className)} />
          ))}
          {t('calendar.more')}
        </span>
      </div>
    </Panel>
  );
}

/* ---------------------------- session summary ---------------------------- */

function SessionSummary(): JSX.Element {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const { data } = useAsync(() => api().sessions.stats(), []);

  if (!data || data.total === 0) {
    return (
      <Panel>
        <EmptyState compact icon={<Clock3 />} title={t('empty.sessions')} body={t('empty.sessionsBody')} />
      </Panel>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Panel className="card-pad">
        <Stat
          label={t('sessions.countLabel')}
          value={formatNumber(data.total, locale)}
          size="sm"
        />
      </Panel>
      <Panel className="card-pad">
        <Stat
          label={t('sessions.average')}
          value={formatDuration(data.averageMs, locale)}
          size="sm"
          hint={`${Math.round(data.averageEvents)} ${t('unit.tracks')}`}
        />
      </Panel>
      {data.longest && (
        <button type="button" onClick={() => navigate(`/session/${data.longest!.id}`)} className="text-left">
          <Panel interactive className="h-full card-pad">
            <Stat
              label={t('records.longestSession')}
              value={formatDuration(data.longest.msPlayed, locale)}
              size="sm"
              hint={`${data.longest.events} ${t('unit.tracks')} · ${formatDate(data.longest.startTs, locale, 'short')}`}
            />
          </Panel>
        </button>
      )}
    </div>
  );
}
