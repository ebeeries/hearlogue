import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Flame, Zap, Disc3, Timer, TrendingUp, CalendarRange, Repeat, Share2 } from 'lucide-react';
import { PageHeader } from '../layouts/PageHeader';
import { Button, IconButton, Panel, Section, cx } from '../components/ui/primitives';
import { EmptyState, ErrorState, PageSkeleton } from '../components/ui/states';
import { Cover } from '../components/domain/Cover';
import { ShareCardDialog } from '../features/share/ShareCardDialog';
import { useAsync } from '../hooks/useAsync';
import { useI18n } from '../i18n';
import { useAppStore } from '../stores/app-store';
import { api } from '../lib/api';
import { formatNumber, formatDate } from '../lib/format';
import type { ObsessionItem, ObsessionSections } from '@shared/types/domain';

/**
 * Obsessions.
 *
 * Seven sections, each answering a different question about intensity. The tone
 * is playful but every figure is literal: "94 plays in 30 days" means exactly
 * that, within a date range the card names.
 */

interface SectionSpec {
  key: keyof ObsessionSections;
  titleKey: string;
  icon: typeof Flame;
  accent: string;
  describe: (item: ObsessionItem, t: (k: string, v?: Record<string, string | number>) => string) => string;
}

const SECTIONS: SectionSpec[] = [
  {
    key: 'destroyed',
    titleKey: 'obsessions.destroyed',
    icon: Flame,
    accent: 'text-clay-400',
    describe: (item, t) => t('obsessions.window', { plays: item.windowPlays, days: item.windowDays }),
  },
  {
    key: 'oneHit',
    titleKey: 'obsessions.oneHit',
    icon: Zap,
    accent: 'text-brass-400',
    describe: (item, t) =>
      item.playsAfter === 0
        ? t('obsessions.afterNever')
        : t('obsessions.after', { count: item.playsAfter }),
  },
  {
    key: 'artistBinges',
    titleKey: 'obsessions.artistBinges',
    icon: TrendingUp,
    accent: 'text-plum-400',
    describe: (item, t) => t('obsessions.window', { plays: item.windowPlays, days: item.windowDays }),
  },
  {
    key: 'albumAddictions',
    titleKey: 'obsessions.albumAddictions',
    icon: Disc3,
    accent: 'text-haze-400',
    describe: (item, t) => t('obsessions.window', { plays: item.windowPlays, days: item.windowDays }),
  },
  {
    key: 'fastestHundred',
    titleKey: 'obsessions.fastestHundred',
    icon: Timer,
    accent: 'text-sage-400',
    describe: (item, t) =>
      item.daysToHundred !== null
        ? t('obsessions.daysTo', { count: 100, days: item.daysToHundred })
        : '',
  },
  {
    key: 'mostIntenseWeek',
    titleKey: 'obsessions.mostIntenseWeek',
    icon: CalendarRange,
    accent: 'text-brass-400',
    describe: (item, t) => t('obsessions.peakWeek', { plays: item.peakWeekPlays }),
  },
  {
    key: 'longest',
    titleKey: 'obsessions.longest',
    icon: Repeat,
    accent: 'text-clay-400',
    describe: (item, t) => t('obsessions.runMonths', { count: item.longestRunMonths }),
  },
];

export function ObsessionsPage(): JSX.Element {
  const { t } = useI18n();
  const navigate = useNavigate();
  const hasArchive = useAppStore((s) => s.state?.hasArchive ?? false);
  const [shareItem, setShareItem] = useState<ObsessionItem | null>(null);

  const { data, error, loading, initial, reload } = useAsync(
    () => api().obsessions.all({ limit: 10 }),
    [hasArchive],
    { enabled: hasArchive },
  );

  if (!hasArchive) {
    return (
      <EmptyState
        icon={<Flame />}
        title={t('empty.noArchive')}
        body={t('empty.noArchiveBody')}
        action={
          <Button variant="primary" onClick={() => navigate('/import')}>
            {t('empty.noArchiveAction')}
          </Button>
        }
      />
    );
  }
  if (initial && loading) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const sections = data;
  const populated = sections
    ? SECTIONS.filter((section) => (sections[section.key] ?? []).length > 0)
    : [];

  return (
    <div className="flex flex-col stack-gap">
      <PageHeader
        eyebrow={t('nav.obsessions')}
        title={t('obsessions.title')}
        description={t('obsessions.subtitle')}
      />

      {populated.length === 0 ? (
        <Panel>
          <EmptyState icon={<Flame />} title={t('empty.obsessions')} body={t('empty.obsessionsBody')} />
        </Panel>
      ) : (
        populated.map((section) => (
          <ObsessionSection
            key={section.key}
            spec={section}
            items={sections?.[section.key] ?? []}
            onShare={setShareItem}
          />
        ))
      )}

      {shareItem && (
        <ShareCardDialog
          open
          onClose={() => setShareItem(null)}
          card={{
            kind: 'obsession',
            title: shareItem.name,
            subtitle: shareItem.secondary ?? t('obsessions.title'),
            statement: t('obsessions.window', {
              plays: shareItem.windowPlays,
              days: shareItem.windowDays,
            }),
            lines: [
              t('obsessions.share', { percent: Math.round(shareItem.share * 100) }),
              shareItem.playsAfter === 0
                ? t('obsessions.afterNever')
                : t('obsessions.after', { count: shareItem.playsAfter }),
            ],
            figure: String(shareItem.windowPlays),
            figureLabel: t('unit.plays'),
            accent: 'clay',
          }}
        />
      )}
    </div>
  );
}

function ObsessionSection({
  spec,
  items,
  onShare,
}: {
  spec: SectionSpec;
  items: ObsessionItem[];
  onShare: (item: ObsessionItem) => void;
}): JSX.Element {
  const { t } = useI18n();
  const Icon = spec.icon;

  return (
    <Section
      title={t(spec.titleKey)}
      eyebrow={undefined}
      action={
        <Icon aria-hidden className={cx('h-4 w-4', spec.accent)} strokeWidth={1.75} />
      }
    >
      <div className="grid gap-2.5 lg:grid-cols-2">
        {items.slice(0, 6).map((item, index) => (
          <ObsessionCard
            key={`${item.kind}-${item.entityId}`}
            item={item}
            index={index}
            description={spec.describe(item, t)}
            onShare={() => onShare(item)}
          />
        ))}
      </div>
    </Section>
  );
}

function ObsessionCard({
  item,
  index,
  description,
  onShare,
}: {
  item: ObsessionItem;
  index: number;
  description: string;
  onShare: () => void;
}): JSX.Element {
  const { t, locale } = useI18n();

  const route =
    item.kind === 'track'
      ? `/track/${item.entityId}`
      : item.kind === 'artist'
        ? `/artist/${item.entityId}`
        : `/album/${item.entityId}`;

  const sharePercent = Math.round(item.share * 100);

  return (
    <Panel
      interactive
      className="group relative overflow-hidden animate-fade-up"
      style={{ animationDelay: `${Math.min(index, 6) * 30}ms` }}
    >
      {/* The share bar doubles as the card's visual weight. */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 bg-gradient-to-r from-clay-700/25 to-transparent"
        style={{ width: `${Math.max(10, sharePercent)}%` }}
      />

      <div className="relative flex items-center gap-4 card-pad">
        <Cover
          name={item.name}
          secondary={item.secondary}
          size="md"
          rounded={item.kind === 'artist' ? 'full' : 'default'}
        />

        <div className="min-w-0 flex-1">
          <Link
            to={route}
            className="block truncate text-[14px] font-medium text-paper-100 transition-colors hover:text-brass-200"
          >
            {item.name}
          </Link>
          {item.secondary && (
            <p className="mt-0.5 truncate text-[12px] text-paper-500">{item.secondary}</p>
          )}
          <p className="mt-2 text-[12px] text-paper-400">{description}</p>
          <p className="mt-1 text-[11.5px] text-paper-600">
            {formatDate(item.windowStart, locale, 'short')} — {formatDate(item.windowEnd, locale, 'short')}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <p className="figure text-[22px] leading-none text-brass-300">
            {formatNumber(item.windowPlays, locale)}
          </p>
          <p className="mt-1.5 text-[11px] text-paper-600">
            {t('obsessions.share', { percent: sharePercent })}
          </p>
        </div>

        <IconButton
          label={t('detail.share')}
          size="sm"
          className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          onClick={onShare}
        >
          <Share2 className="h-3.5 w-3.5" />
        </IconButton>
      </div>
    </Panel>
  );
}
