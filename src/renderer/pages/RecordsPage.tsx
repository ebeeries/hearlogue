import { Link } from 'react-router-dom';
import { Trophy } from 'lucide-react';
import { PageHeader } from '../layouts/PageHeader';
import { Panel, cx } from '../components/ui/primitives';
import { EmptyState, ErrorState, PageSkeleton } from '../components/ui/states';
import { Cover } from '../components/domain/Cover';
import { useAsync } from '../hooks/useAsync';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { formatDate, formatNumber } from '../lib/format';
import type { RecordEntry } from '@shared/types/domain';

/**
 * Records.
 *
 * A board of superlatives. Every row is drawn from a derived table — nothing is
 * estimated, and any record the archive cannot support is simply absent rather
 * than shown as zero.
 */

export function RecordsPage(): JSX.Element {
  const { t } = useI18n();
  const { data, error, loading, initial, reload } = useAsync(() => api().archive.records(), []);

  if (initial && loading) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const records = data ?? [];

  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        backTo={{ to: '/archive', label: t('nav.archive') }}
        eyebrow={t('nav.archive')}
        title={t('records.title')}
      />

      {records.length === 0 ? (
        <Panel>
          <EmptyState icon={<Trophy />} title={t('empty.records')} body={t('empty.recordsBody')} />
        </Panel>
      ) : (
        <div className="grid gap-2.5 lg:grid-cols-2">
          {records.map((record, index) => (
            <RecordCard key={record.key} record={record} index={index} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Values inside a record are a mix of counts, years and dates, and each wants
 * different treatment: 4,494 minutes needs a thousands separator, the year 2015
 * must not get one, and a date should read as a date rather than as ISO.
 */
const COUNT_KEYS = new Set(['plays', 'minutes', 'hours', 'days', 'tracks', 'count']);
const DATE_KEYS = new Set(['date', 'from', 'to']);

function presentValues(
  values: Record<string, string | number>,
  locale: string,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(values)) {
    if (COUNT_KEYS.has(key) && typeof value === 'number') {
      // Fractional figures (7.2 hours) keep their decimal.
      out[key] = Number.isInteger(value) ? formatNumber(value, locale) : String(value);
    } else if (DATE_KEYS.has(key) && typeof value === 'string' && value.length > 0) {
      out[key] = formatDate(value, locale);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function RecordCard({ record, index }: { record: RecordEntry; index: number }): JSX.Element {
  const { t, locale } = useI18n();
  const values = presentValues(record.values, locale);

  const route = record.entity
    ? record.entity.kind === 'track'
      ? `/track/${record.entity.id}`
      : record.entity.kind === 'artist'
        ? `/artist/${record.entity.id}`
        : `/album/${record.entity.id}`
    : null;

  const body = (
    <Panel
      interactive={Boolean(route)}
      className="flex h-full items-center gap-4 animate-fade-up card-pad"
      style={{ animationDelay: `${Math.min(index, 10) * 24}ms` }}
    >
      {record.entity ? (
        <Cover
          name={record.entity.name}
          secondary={record.entity.secondary}
          size="md"
          rounded={record.entity.kind === 'artist' ? 'full' : 'default'}
        />
      ) : (
        <span
          aria-hidden
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-white/[0.06] bg-white/[0.02] text-brass-500/70"
        >
          <Trophy className="h-4 w-4" />
        </span>
      )}

      <div className="min-w-0 flex-1">
        <p className="eyebrow">{t(record.key)}</p>
        <p className="mt-1.5 truncate font-display text-[16px] text-paper-50">
          {record.entity ? record.entity.name : t(`${record.key}Value`, values)}
        </p>
        <p className="mt-0.5 truncate text-[12px] text-paper-500">
          {record.entity
            ? t(`${record.key}Value`, values)
            : record.ts
              ? formatDate(record.ts, locale)
              : ''}
        </p>
      </div>
    </Panel>
  );

  return route ? (
    <Link to={route} className={cx('block h-full')}>
      {body}
    </Link>
  ) : (
    body
  );
}
