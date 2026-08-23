/**
 * Time helpers.
 *
 * Spotify stamps every event in UTC, but a listening life is lived locally:
 * "late-night listening" means midnight where the listener was, not in
 * Greenwich. HEARLOGUE therefore stores the epoch milliseconds *and* the local
 * calendar parts computed at import time, so day/hour analytics stay stable and
 * queryable without repeatedly converting a million timestamps.
 */

export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

export interface LocalParts {
  date: string; // YYYY-MM-DD
  ym: string; // YYYY-MM
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  dow: number; // 0 = Sunday
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Local calendar breakdown of an epoch-millisecond timestamp. */
export function localParts(ts: number): LocalParts {
  const d = new Date(ts);
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const day = d.getDate();
  return {
    date: `${year}-${pad2(month)}-${pad2(day)}`,
    ym: `${year}-${pad2(month)}`,
    year,
    month,
    day,
    hour: d.getHours(),
    dow: d.getDay(),
  };
}

/** Parses the several timestamp spellings Spotify has used. Returns NaN on failure. */
export function parseTimestamp(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // Older exports occasionally carry seconds rather than milliseconds.
    return raw < 1e11 ? raw * 1000 : raw;
  }
  if (typeof raw !== 'string') return NaN;
  const value = raw.trim();
  if (!value) return NaN;

  // "2019-03-14 21:07" (legacy StreamingHistory) has no timezone marker but is UTC.
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(value)) {
    return Date.parse(`${value.replace(' ', 'T')}Z`);
  }
  // "2019-03-14T21:07:33Z" and friends.
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? NaN : parsed;
}

export function ymOf(date: string): string {
  return date.slice(0, 7);
}

export function yearOf(ym: string): number {
  return Number(ym.slice(0, 4));
}

/** Inclusive list of every YYYY-MM between two months. */
export function monthRange(startYm: string, endYm: string): string[] {
  const out: string[] = [];
  let y = Number(startYm.slice(0, 4));
  let m = Number(startYm.slice(5, 7));
  const endY = Number(endYm.slice(0, 4));
  const endM = Number(endYm.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${pad2(m)}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** Number of whole months between two YYYY-MM values, inclusive of both ends. */
export function monthSpan(startYm: string, endYm: string): number {
  const y1 = Number(startYm.slice(0, 4));
  const m1 = Number(startYm.slice(5, 7));
  const y2 = Number(endYm.slice(0, 4));
  const m2 = Number(endYm.slice(5, 7));
  return (y2 - y1) * 12 + (m2 - m1) + 1;
}

/** Local-midnight epoch of the first day of a YYYY-MM. */
export function startOfMonthTs(ym: string): number {
  return new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1, 0, 0, 0, 0).getTime();
}

/** Local epoch of the last millisecond of a YYYY-MM. */
export function endOfMonthTs(ym: string): number {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  return new Date(y, m, 1, 0, 0, 0, 0).getTime() - 1;
}

export function startOfDayTs(date: string): number {
  return new Date(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
  ).getTime();
}

export function daysBetween(a: number, b: number): number {
  return Math.floor(Math.abs(b - a) / MS_PER_DAY);
}

export function addDays(date: string, days: number): string {
  const d = new Date(startOfDayTs(date) + days * MS_PER_DAY);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function todayLocalDate(now = Date.now()): string {
  return localParts(now).date;
}

/** Formats a YYYY-MM as a stable sort key friendly integer, e.g. 201903. */
export function ymToInt(ym: string): number {
  return Number(ym.slice(0, 4)) * 100 + Number(ym.slice(5, 7));
}
