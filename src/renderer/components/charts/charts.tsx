import { useMemo, type ReactNode } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from 'recharts';
import { cx } from '../ui/primitives';
import { useI18n } from '../../i18n';
import {
  formatCompact,
  formatDuration,
  formatDurationShort,
  formatMonth,
  formatHourLabel,
} from '../../lib/format';

/**
 * Charts.
 *
 * Recharts, wrapped so no screen configures axes, grids or tooltips itself.
 * The house style: no chart junk, one accent, hairline gridlines on the value
 * axis only, and a tooltip that reads like a sentence rather than a data dump.
 */

export const CHART_COLORS = {
  accent: '#D6B06A',
  accentSoft: 'rgba(214,176,106,0.16)',
  muted: '#5E6871',
  grid: 'rgba(255,255,255,0.045)',
  axis: '#6E6961',
  sage: '#7E9384',
  haze: '#7C8BA3',
  clay: '#B08268',
  plum: '#96768F',
} as const;

const AXIS_STYLE = {
  fontSize: 10.5,
  fill: CHART_COLORS.axis,
  fontFamily: 'Segoe UI, Inter, system-ui, sans-serif',
} as const;

interface ChartTooltipRow {
  label: string;
  value: string;
}

function ChartTooltipBox({ title, rows }: { title: string; rows: ChartTooltipRow[] }): JSX.Element {
  return (
    <div className="rounded-md border border-white/[0.1] bg-ink-750/95 px-3 py-2 shadow-lift backdrop-blur">
      <p className="text-[11px] font-medium uppercase tracking-wider text-paper-400">{title}</p>
      <div className="mt-1.5 flex flex-col gap-0.5">
        {rows.map((row) => (
          <p key={row.label} className="flex items-baseline gap-3 text-[12.5px]">
            <span className="text-paper-500">{row.label}</span>
            <span className="figure ml-auto text-paper-100">{row.value}</span>
          </p>
        ))}
      </div>
    </div>
  );
}

export interface TimeSeriesPoint {
  key: string;
  plays: number;
  msPlayed: number;
}

/**
 * The monthly listening curve used on every detail page and in Rewind.
 *
 * An area rather than a line: the shape of a relationship over time reads better
 * as mass than as a thread, especially where months drop to zero.
 */
export function ListeningAreaChart({
  data,
  height = 168,
  metric = 'plays',
  labelFormat = 'month',
  className,
  color = CHART_COLORS.accent,
}: {
  data: TimeSeriesPoint[];
  height?: number;
  metric?: 'plays' | 'msPlayed';
  labelFormat?: 'month' | 'year' | 'raw';
  className?: string;
  color?: string;
}): JSX.Element {
  const { locale, t } = useI18n();
  const gradientId = useMemo(() => `area-${Math.random().toString(36).slice(2, 9)}`, []);

  const formatLabel = (value: string): string => {
    if (labelFormat === 'month') return formatMonth(value, locale, 'short');
    return value;
  };

  return (
    <div className={cx('w-full', className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: -14 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.34} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
          <XAxis
            dataKey="key"
            tick={AXIS_STYLE}
            tickLine={false}
            axisLine={false}
            minTickGap={38}
            padding={{ left: 12, right: 12 }}
            tickFormatter={formatLabel}
          />
          <YAxis
            tick={AXIS_STYLE}
            tickLine={false}
            axisLine={false}
            width={52}
            tickFormatter={(value: number) =>
              metric === 'msPlayed'
                ? formatDurationShort(value, locale)
                : formatCompact(value, locale)
            }
          />
          <Tooltip
            cursor={{ stroke: 'rgba(255,255,255,0.12)', strokeWidth: 1 }}
            content={({ active, payload }: TooltipProps<number, string>) => {
              if (!active || !payload?.length) return null;
              const point = payload[0].payload as TimeSeriesPoint;
              return (
                <ChartTooltipBox
                  title={formatLabel(point.key)}
                  rows={[
                    { label: t('stat.plays'), value: formatCompact(point.plays, locale) },
                    { label: t('stat.listeningTime'), value: formatDuration(point.msPlayed, locale) },
                  ]}
                />
              );
            }}
          />
          <Area
            type="monotone"
            dataKey={metric}
            stroke={color}
            strokeWidth={1.6}
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={{ r: 3, fill: color, stroke: '#0B0D0F', strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface BarPoint {
  key: string;
  value: number;
  secondary?: number;
  highlight?: boolean;
}

export function ListeningBarChart({
  data,
  height = 150,
  className,
  valueFormat = 'count',
  onSelect,
  labelFormat,
  color = CHART_COLORS.accent,
}: {
  data: BarPoint[];
  height?: number;
  className?: string;
  valueFormat?: 'count' | 'duration';
  onSelect?: (key: string) => void;
  labelFormat?: (key: string) => string;
  color?: string;
}): JSX.Element {
  const { locale, t } = useI18n();
  const format = (value: number): string =>
    valueFormat === 'duration' ? formatDuration(value, locale) : formatCompact(value, locale);
  const axisFormat = (value: number): string =>
    valueFormat === 'duration'
      ? formatDurationShort(value, locale)
      : formatCompact(value, locale);

  return (
    <div className={cx('w-full', className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 6, right: 4, bottom: 0, left: -14 }}
          onClick={(state) => {
            const key = state?.activeLabel;
            if (onSelect && typeof key === 'string') onSelect(key);
          }}
        >
          <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
          <XAxis
            dataKey="key"
            tick={AXIS_STYLE}
            tickLine={false}
            axisLine={false}
            minTickGap={16}
            tickFormatter={labelFormat}
          />
          <YAxis
            tick={AXIS_STYLE}
            tickLine={false}
            axisLine={false}
            width={52}
            tickFormatter={axisFormat}
          />
          <Tooltip
            cursor={{ fill: 'rgba(255,255,255,0.035)' }}
            content={({ active, payload, label }: TooltipProps<number, string>) => {
              if (!active || !payload?.length) return null;
              const point = payload[0].payload as BarPoint;
              return (
                <ChartTooltipBox
                  title={labelFormat ? labelFormat(String(label)) : String(label)}
                  rows={[{ label: t('stat.plays'), value: format(point.value) }]}
                />
              );
            }}
          />
          <Bar dataKey="value" radius={[2, 2, 0, 0]} isAnimationActive={false} maxBarSize={38}>
            {data.map((point, index) => (
              <Cell
                key={index}
                fill={point.highlight ? color : 'rgba(214,176,106,0.35)'}
                cursor={onSelect ? 'pointer' : 'default'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * The 24-hour listening clock.
 *
 * A radial layout rather than a bar chart, because the question it answers —
 * "when in the day do I listen?" — is inherently cyclical, and a bar chart
 * visually severs midnight from 1am.
 */
export function ListeningClock({
  hours,
  size = 220,
  className,
}: {
  hours: { hour: number; plays: number; msPlayed: number }[];
  size?: number;
  className?: string;
}): JSX.Element {
  const { t } = useI18n();
  const max = Math.max(...hours.map((h) => h.plays), 1);
  const center = size / 2;
  const innerRadius = size * 0.2;
  const maxRadius = size * 0.38;

  return (
    <div className={cx('relative', className)} style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={t('clock.title')}>
        {[0.33, 0.66, 1].map((ring) => (
          <circle
            key={ring}
            cx={center}
            cy={center}
            r={innerRadius + (maxRadius - innerRadius) * ring}
            fill="none"
            stroke="rgba(255,255,255,0.04)"
            strokeWidth="1"
          />
        ))}

        {hours.map((bucket) => {
          // Midnight at the top; each hour occupies 15 degrees.
          const startAngle = (bucket.hour / 24) * 360 - 90 - 6.5;
          const endAngle = startAngle + 13;
          const radius = innerRadius + (bucket.plays / max) * (maxRadius - innerRadius);
          const toPoint = (angle: number, r: number): [number, number] => [
            center + r * Math.cos((angle * Math.PI) / 180),
            center + r * Math.sin((angle * Math.PI) / 180),
          ];
          const [x1, y1] = toPoint(startAngle, innerRadius);
          const [x2, y2] = toPoint(endAngle, innerRadius);
          const [x3, y3] = toPoint(endAngle, radius);
          const [x4, y4] = toPoint(startAngle, radius);
          const intensity = 0.25 + (bucket.plays / max) * 0.68;

          return (
            <path
              key={bucket.hour}
              d={`M${x1} ${y1} A${innerRadius} ${innerRadius} 0 0 1 ${x2} ${y2} L${x3} ${y3} A${radius} ${radius} 0 0 0 ${x4} ${y4} Z`}
              fill={CHART_COLORS.accent}
              opacity={intensity}
            >
              <title>{`${formatHourLabel(bucket.hour)} — ${bucket.plays}`}</title>
            </path>
          );
        })}

        {[0, 6, 12, 18].map((hour) => {
          const angle = (hour / 24) * 360 - 90;
          const r = maxRadius + size * 0.075;
          const x = center + r * Math.cos((angle * Math.PI) / 180);
          const y = center + r * Math.sin((angle * Math.PI) / 180);
          return (
            <text
              key={hour}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="9.5"
              fill={CHART_COLORS.axis}
              letterSpacing="0.08em"
            >
              {String(hour).padStart(2, '0')}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

/** A horizontal proportion bar, used for daypart and weekday splits. */
export function ProportionBar({
  segments,
  className,
  height = 8,
}: {
  segments: { key: string; label: string; value: number; color: string }[];
  className?: string;
  height?: number;
}): JSX.Element {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0) || 1;
  return (
    <div className={cx('flex flex-col gap-3', className)}>
      <div
        className="flex w-full overflow-hidden rounded-full bg-white/[0.04]"
        style={{ height }}
      >
        {segments.map((segment) => (
          <span
            key={segment.key}
            className="h-full transition-all duration-700 ease-out"
            style={{ width: `${(segment.value / total) * 100}%`, backgroundColor: segment.color }}
            title={`${segment.label}: ${Math.round((segment.value / total) * 100)}%`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1.5">
        {segments.map((segment) => (
          <span key={segment.key} className="flex items-center gap-1.5 text-[11.5px] text-paper-400">
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: segment.color }}
            />
            {segment.label}
            <span className="figure text-paper-300">
              {Math.round((segment.value / total) * 100)}%
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Wraps a chart with a caption for screen-reader users. */
export function ChartFrame({
  children,
  description,
  className,
}: {
  children: ReactNode;
  description: string;
  className?: string;
}): JSX.Element {
  return (
    <figure className={cx('m-0', className)} role="img" aria-label={description}>
      {children}
    </figure>
  );
}
