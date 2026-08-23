import { MS_PER_DAY } from '@shared/utils/time';

/**
 * Presentation-level formatting.
 *
 * The rule throughout: never invent precision. Listening time is shown as hours
 * and minutes because that is what the archive knows; nothing here rounds a
 * count into a claim the data cannot support.
 */

export function formatNumber(value: number, locale = 'en-GB'): string {
  return new Intl.NumberFormat(locale).format(Math.round(value));
}

export function formatCompact(value: number, locale = 'en-GB'): string {
  if (Math.abs(value) < 10_000) return formatNumber(value, locale);
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(
    value,
  );
}

/** Listening time, scaled to whatever unit reads most naturally. */
export function formatDuration(ms: number, locale = 'en-GB'): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0m';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours < 48) return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
  const days = Math.floor(hours / 24);
  const leftoverHours = hours % 24;
  return leftoverHours === 0
    ? `${formatNumber(days, locale)}d`
    : `${formatNumber(days, locale)}d ${leftoverHours}h`;
}

/**
 * Single-unit duration, for chart axes where the label has to fit a fixed
 * gutter. `formatDuration` can return "1d 6h", which clips; this returns "1d".
 */
export function formatDurationShort(ms: number, locale = 'en-GB'): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0';
  const minutes = ms / 60_000;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${formatNumber(hours / 24, locale)}d`;
}

/** Long form for hero figures: "1,284 hours". */
export function formatHours(ms: number, locale = 'en-GB'): string {
  return formatNumber(ms / 3_600_000, locale);
}

export function formatMinutes(ms: number, locale = 'en-GB'): string {
  return formatNumber(ms / 60_000, locale);
}

export function formatClock(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatPercent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

const MONTHS_LONG: Record<string, Intl.DateTimeFormatOptions> = {
  long: { year: 'numeric', month: 'long' },
  short: { year: 'numeric', month: 'short' },
};

export function formatMonth(ym: string, locale = 'en-GB', style: 'long' | 'short' = 'long'): string {
  const year = Number(ym.slice(0, 4));
  const month = Number(ym.slice(5, 7));
  if (!year || !month) return ym;
  return new Intl.DateTimeFormat(locale, MONTHS_LONG[style]).format(new Date(year, month - 1, 1));
}

export function formatDate(
  input: number | string | null | undefined,
  locale = 'en-GB',
  style: 'long' | 'medium' | 'short' = 'medium',
): string {
  if (input === null || input === undefined) return '—';
  const date = typeof input === 'string' ? new Date(`${input}T12:00:00`) : new Date(input);
  if (Number.isNaN(date.getTime())) return '—';
  const options: Intl.DateTimeFormatOptions =
    style === 'long'
      ? { year: 'numeric', month: 'long', day: 'numeric' }
      : style === 'short'
        ? { year: '2-digit', month: 'short', day: 'numeric' }
        : { year: 'numeric', month: 'short', day: 'numeric' };
  return new Intl.DateTimeFormat(locale, options).format(date);
}

export function formatDateTime(ts: number | null, locale = 'en-GB'): string {
  if (ts === null) return '—';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ts));
}

export function formatTime(ts: number | null, locale = 'en-GB'): string {
  if (ts === null) return '—';
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(
    new Date(ts),
  );
}

export function formatYear(ts: number | null): string {
  if (ts === null) return '—';
  return String(new Date(ts).getFullYear());
}

export function daysSince(ts: number | null, now = Date.now()): number {
  if (ts === null) return 0;
  return Math.max(0, Math.floor((now - ts) / MS_PER_DAY));
}

/**
 * A silence, described the way a person would.
 *
 * Below a fortnight the exact day count is what matters; beyond that, years and
 * months carry the weight and a precise day count only adds noise.
 */
export function formatSilence(
  days: number,
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  if (days < 1) return t('common.today');
  if (days === 1) return t('time.day');
  if (days < 45) return t('time.days', { count: days });
  const months = Math.round(days / 30.44);
  if (days < 365) return months === 1 ? t('time.month') : t('time.months', { count: months });
  const years = Math.floor(days / 365);
  const remainingMonths = Math.round((days - years * 365) / 30.44);
  if (remainingMonths === 0 || years >= 4) {
    return years === 1 ? t('time.year') : t('time.years', { count: years });
  }
  const yearPart = years === 1 ? t('time.year') : t('time.years', { count: years });
  const monthPart =
    remainingMonths === 1 ? t('time.month') : t('time.months', { count: remainingMonths });
  return `${yearPart}, ${monthPart}`;
}

export function formatHourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

export const WEEKDAY_KEYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function weekdayLabel(dow: number, locale = 'en-GB'): string {
  // 2024-01-07 was a Sunday, which makes the offset arithmetic obvious.
  const date = new Date(2024, 0, 7 + dow);
  return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date);
}

/** Ordinal for rank badges: 1st, 2nd, 3rd. English-only by design. */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

export function pluralize(
  count: number,
  singular: string,
  plural: string,
): string {
  return count === 1 ? singular : plural;
}

/** Truncates on a word boundary so a label never ends mid-word. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut.trimEnd()}…`;
}
