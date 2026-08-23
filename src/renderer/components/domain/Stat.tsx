import type { ReactNode } from 'react';
import { cx, Panel } from '../ui/primitives';

/**
 * Figures.
 *
 * The number is set in the display serif at a size that lets it carry the block,
 * with the label reduced to a quiet caption. That inversion — data loud, chrome
 * quiet — is the main reason the app reads as an archive rather than a
 * dashboard.
 */

export interface StatProps {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: string;
  icon?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  tone?: 'default' | 'brass';
  className?: string;
}

const VALUE_SIZES = {
  sm: 'text-[20px]',
  md: 'text-[27px]',
  lg: 'text-[38px]',
};

export function Stat({
  label,
  value,
  unit,
  hint,
  icon,
  size = 'md',
  tone = 'default',
  className,
}: StatProps): JSX.Element {
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <div className="flex items-center gap-1.5">
        {icon && (
          <span aria-hidden className="text-paper-600 [&>svg]:h-3 [&>svg]:w-3">
            {icon}
          </span>
        )}
        <p className="eyebrow">{label}</p>
      </div>
      <p
        className={cx(
          'figure leading-none',
          VALUE_SIZES[size],
          tone === 'brass' ? 'text-brass-300' : 'text-paper-50',
        )}
      >
        {value}
        {unit && <span className="ml-1 text-[0.45em] font-sans text-paper-500">{unit}</span>}
      </p>
      {hint && <p className="mt-0.5 text-[11.5px] text-paper-500">{hint}</p>}
    </div>
  );
}

/** Stats grouped into one panel with hairline separators between them. */
export function StatGrid({
  stats,
  columns = 4,
  className,
}: {
  stats: StatProps[];
  columns?: 2 | 3 | 4 | 6;
  className?: string;
}): JSX.Element {
  const cols = {
    2: 'grid-cols-2',
    3: 'grid-cols-2 sm:grid-cols-3',
    4: 'grid-cols-2 lg:grid-cols-4',
    6: 'grid-cols-3 lg:grid-cols-6',
  };

  return (
    <Panel className={cx('overflow-hidden', className)}>
      <div className={cx('grid', cols[columns])}>
        {stats.map((stat, index) => (
          <div
            key={stat.label}
            className={cx(
              'card-pad',
              // Hairlines only between cells, never around the outside.
              index % columns !== 0 && 'lg:border-l lg:border-white/[0.05]',
              index % 2 !== 0 && columns === 4 && 'border-l border-white/[0.05] lg:border-l',
              index >= columns && 'border-t border-white/[0.05] lg:border-t',
              columns === 4 && index >= 2 && 'border-t border-white/[0.05] lg:border-t-0',
              columns === 4 && index >= 4 && 'lg:border-t',
            )}
          >
            <Stat {...stat} />
          </div>
        ))}
      </div>
    </Panel>
  );
}

/**
 * A circular score dial.
 *
 * Used for the Lost Favorite Score, where a bare number would not convey that
 * 88 is exceptional and 34 is marginal.
 */
export function ScoreDial({
  score,
  size = 84,
  label,
  className,
}: {
  score: number;
  size?: number;
  label?: string;
  className?: string;
}): JSX.Element {
  const clamped = Math.max(0, Math.min(100, score));
  const stroke = size <= 56 ? 3 : 4;
  const radius = (size - stroke) / 2 - 1;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);

  // Colour carries a second signal, but the number is always present too, so the
  // meaning never depends on colour alone.
  const tone =
    clamped >= 75 ? '#E6C88C' : clamped >= 55 ? '#D6B06A' : clamped >= 40 ? '#B08268' : '#918B7E';

  return (
    <div className={cx('relative shrink-0', className)} style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="-rotate-90" width={size} height={size}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={tone}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 900ms cubic-bezier(0.16,1,0.3,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="figure leading-none"
          style={{ color: tone, fontSize: size * 0.32 }}
        >
          {Math.round(clamped)}
        </span>
        {label && size >= 72 && (
          <span className="mt-1 text-[9px] uppercase tracking-widest text-paper-600">{label}</span>
        )}
      </div>
    </div>
  );
}

/** A compact inline sparkline for row-level trends. */
export function SparkBars({
  values,
  className,
  height = 22,
  tone = 'brass',
}: {
  values: number[];
  className?: string;
  height?: number;
  tone?: 'brass' | 'muted';
}): JSX.Element | null {
  if (values.length === 0) return null;
  const max = Math.max(...values, 1);
  const color = tone === 'brass' ? 'bg-brass-500/70' : 'bg-paper-600/50';

  return (
    <div
      aria-hidden
      className={cx('flex items-end gap-[2px]', className)}
      style={{ height }}
    >
      {values.map((value, index) => (
        <span
          key={index}
          className={cx('w-[3px] shrink-0 rounded-[1px]', color)}
          style={{ height: `${Math.max(6, (value / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}
