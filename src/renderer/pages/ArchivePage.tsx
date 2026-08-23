import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Compass,
  History,
  Layers,
  Flame,
  Skull,
  CalendarDays,
  Trophy,
  ExternalLink,
  ArrowRight,
  RefreshCw,
  Import,
  ChevronRight,
  Clock3,
} from 'lucide-react';
import { PageHeader } from '../layouts/PageHeader';
import { Button, Panel, Section, cx, IconButton, Badge } from '../components/ui/primitives';
import { EmptyState, ErrorState, PageSkeleton } from '../components/ui/states';
import { Stat, StatGrid } from '../components/domain/Stat';
import { Cover } from '../components/domain/Cover';
import { TrackRow, ArtistRow } from '../components/domain/rows';
import { ListeningBarChart } from '../components/charts/charts';
import { useAsync } from '../hooks/useAsync';
import { useI18n } from '../i18n';
import { useAppStore } from '../stores/app-store';
import { api, openSpotify } from '../lib/api';
import { formatNumber, formatDuration, formatDate, formatSilence, daysSince } from '../lib/format';
import type { RediscoveryCard, OnThisDayEntry } from '@shared/types/domain';

/**
 * The Archive home.
 *
 * Structured as a descent: one rediscovery you were not expecting, then the
 * shape of your listening life, then the doors into everything else. The
 * rediscovery card comes first because it is the only part of the app that
 * tells you something without being asked.
 */

export function ArchivePage(): JSX.Element {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const hasArchive = useAppStore((s) => s.state?.hasArchive ?? false);
  const analyticsStale = useAppStore((s) => s.state?.analyticsStale ?? false);

  const overview = useAsync(() => api().archive.overview(), [hasArchive], { enabled: hasArchive });
  const rediscovery = useAsync(() => api().archive.rediscovery(), [hasArchive], {
    enabled: hasArchive,
  });
  const onThisDay = useAsync(() => api().archive.onThisDay({}), [hasArchive], {
    enabled: hasArchive,
  });

  if (!hasArchive) return <NoArchive />;
  if (overview.initial && overview.loading) return <PageSkeleton />;
  if (overview.error) return <ErrorState error={overview.error} onRetry={overview.reload} />;

  const stats = overview.data?.stats;

  return (
    <div className="flex flex-col stack-gap">
      <PageHeader
        eyebrow={t('archive.title')}
        title={t('app.tagline')}
        description={t('archive.subtitle')}
        actions={
          analyticsStale ? (
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw />}
              onClick={() => navigate('/settings?section=analytics')}
            >
              {t('settings.rebuildNow')}
            </Button>
          ) : undefined
        }
      />

      <RediscoveryHero card={rediscovery.data ?? null} onRefresh={rediscovery.reload} />

      {stats && (
        <Section title={t('archive.lifetime')} eyebrow={t('stat.years')}>
          <StatGrid
            columns={6}
            stats={[
              { label: t('stat.streams'), value: formatNumber(stats.streams, locale) },
              { label: t('stat.listeningTime'), value: formatDuration(stats.msPlayed, locale) },
              { label: t('stat.tracks'), value: formatNumber(stats.tracks, locale) },
              { label: t('stat.artists'), value: formatNumber(stats.artists, locale) },
              { label: t('stat.albums'), value: formatNumber(stats.albums, locale) },
              {
                label: t('stat.years'),
                value: stats.years,
                hint:
                  stats.firstTs && stats.lastTs
                    ? `${new Date(stats.firstTs).getFullYear()}–${new Date(stats.lastTs).getFullYear()}`
                    : undefined,
              },
            ]}
          />
        </Section>
      )}

      {overview.data && overview.data.yearly.length > 1 && (
        <Section
          title={t('archive.timeline')}
          action={
            <Button size="sm" variant="quiet" iconRight={<ChevronRight />} onClick={() => navigate('/rewind')}>
              {t('nav.rewind')}
            </Button>
          }
        >
          <Panel className="card-pad">
            <ListeningBarChart
              height={168}
              valueFormat="duration"
              onSelect={(key) => navigate(`/rewind/${key}`)}
              data={overview.data.yearly.map((point) => ({
                key: String(point.year),
                value: point.msPlayed,
                highlight: true,
              }))}
            />
          </Panel>
        </Section>
      )}

      <ExploreGrid
        lostFavoriteCount={overview.data?.lostFavoriteCount ?? 0}
        eraCount={overview.data?.eraCount ?? 0}
        graveyardCount={overview.data?.graveyardCount ?? 0}
        hasObsessions={overview.data?.hasObsessions ?? false}
      />

      <OnThisDaySection entries={onThisDay.data ?? []} />

      <div className="grid gap-8 lg:grid-cols-2">
        <Section
          title={t('archive.topTracks')}
          action={
            <Button size="sm" variant="quiet" iconRight={<ChevronRight />} onClick={() => navigate('/library')}>
              {t('common.viewAll')}
            </Button>
          }
        >
          <Panel className="py-2">
            {(overview.data?.topTracks ?? []).map((track, index) => (
              <TrackRow key={track.id} track={track} index={index + 1} dense />
            ))}
          </Panel>
        </Section>

        <Section
          title={t('archive.topArtists')}
          action={
            <Button size="sm" variant="quiet" iconRight={<ChevronRight />} onClick={() => navigate('/search')}>
              {t('common.viewAll')}
            </Button>
          }
        >
          <Panel className="py-2">
            {(overview.data?.topArtists ?? []).map((artist, index) => (
              <ArtistRow key={artist.id} artist={artist} index={index + 1} dense />
            ))}
          </Panel>
        </Section>
      </div>
    </div>
  );
}

/* ------------------------------ rediscovery ------------------------------ */

function RediscoveryHero({
  card,
  onRefresh,
}: {
  card: RediscoveryCard | null;
  onRefresh: () => void;
}): JSX.Element {
  const { t, locale } = useI18n();
  const navigate = useNavigate();

  if (!card) {
    return (
      <Panel className="overflow-hidden">
        <EmptyState
          compact
          icon={<Compass />}
          title={t('empty.lostFavorites')}
          body={t('empty.lostFavoritesBody')}
        />
      </Panel>
    );
  }

  const { track } = card;
  const silence = formatSilence(card.daysSinceLastPlay, t);

  return (
    <Panel className="relative overflow-hidden animate-fade-up">
      {/* Warm wash behind the cover, so the card reads as lit rather than flat. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 opacity-60"
        style={{
          background:
            'radial-gradient(closest-side, rgba(214,176,106,0.13), transparent 72%)',
        }}
      />

      <div className="relative flex flex-col gap-7 card-pad sm:flex-row sm:items-start">
        <Cover name={track.album ?? track.name} secondary={track.artist} size="hero" />

        <div className="min-w-0 flex-1">
          <p className="eyebrow text-brass-400/80">{t('archive.rediscovery.eyebrow')}</p>

          <h2 className="mt-3 font-display text-[26px] leading-tight text-paper-50 text-selectable">
            {track.name}
          </h2>
          <Link
            to={`/artist/${track.artistId}`}
            className="mt-1.5 inline-block text-[14px] text-paper-300 transition-colors hover:text-brass-300"
          >
            {track.artist}
          </Link>

          <p className="mt-5 max-w-lg text-[14px] leading-relaxed text-paper-300">
            {t(card.reasonKey, card.reasonValues)}
          </p>

          <dl className="mt-6 grid max-w-lg grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
            <Fact label={t('archive.rediscovery.plays')} value={formatNumber(track.qualifyingPlays, locale)} />
            <Fact label={t('archive.rediscovery.firstHeard')} value={formatDate(track.firstTs, locale, 'short')} />
            <Fact label={t('archive.rediscovery.lastHeard')} value={formatDate(track.lastTs, locale, 'short')} />
            <Fact label={t('archive.rediscovery.silence')} value={silence} tone="brass" />
          </dl>

          <div className="mt-7 flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={() => navigate(`/track/${track.id}`)} iconRight={<ArrowRight />}>
              {t('common.viewDetails')}
            </Button>
            {track.uri && (
              <Button variant="secondary" icon={<ExternalLink />} onClick={() => void openSpotify(track.uri)}>
                {t('detail.openInSpotify')}
              </Button>
            )}
            <IconButton label={t('archive.rediscovery.another')} onClick={onRefresh} className="ml-auto">
              <RefreshCw className="h-4 w-4" />
            </IconButton>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function Fact({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'brass';
}): JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="eyebrow">{label}</dt>
      <dd
        className={cx(
          'figure mt-1 truncate text-[14px]',
          tone === 'brass' ? 'text-brass-300' : 'text-paper-100',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/* --------------------------------- explore ------------------------------- */

function ExploreGrid({
  lostFavoriteCount,
  eraCount,
  graveyardCount,
  hasObsessions,
}: {
  lostFavoriteCount: number;
  eraCount: number;
  graveyardCount: number;
  hasObsessions: boolean;
}): JSX.Element {
  const { t, locale } = useI18n();

  const cards = [
    {
      to: '/lost-favorites',
      icon: Compass,
      title: t('nav.lostFavorites'),
      body: t('lost.subtitle'),
      meta: lostFavoriteCount > 0 ? formatNumber(lostFavoriteCount, locale) : null,
      accent: 'brass',
    },
    {
      to: '/rewind',
      icon: History,
      title: t('nav.rewind'),
      body: t('rewind.subtitle'),
      meta: null,
      accent: 'haze',
    },
    {
      to: '/eras',
      icon: Layers,
      title: t('nav.eras'),
      body: t('eras.subtitle'),
      meta: eraCount > 0 ? String(eraCount) : null,
      accent: 'plum',
    },
    {
      to: '/obsessions',
      icon: Flame,
      title: t('nav.obsessions'),
      body: t('obsessions.subtitle'),
      meta: hasObsessions ? null : null,
      accent: 'clay',
    },
    {
      to: '/graveyard',
      icon: Skull,
      title: t('nav.graveyard'),
      body: t('graveyard.subtitle'),
      meta: graveyardCount > 0 ? formatNumber(graveyardCount, locale) : null,
      accent: 'sage',
    },
    {
      to: '/records',
      icon: Trophy,
      title: t('records.title'),
      body: t('empty.recordsBody'),
      meta: null,
      accent: 'brass',
    },
  ] as const;

  const accents: Record<string, string> = {
    brass: 'text-brass-400/80',
    haze: 'text-haze-400/80',
    plum: 'text-plum-400/80',
    clay: 'text-clay-400/80',
    sage: 'text-sage-400/80',
  };

  return (
    <Section title={t('archive.explore')}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Link key={card.to} to={card.to} className="group">
              <Panel interactive className="flex h-full flex-col gap-3 card-pad">
                <div className="flex items-start justify-between">
                  <Icon aria-hidden className={cx('h-4 w-4', accents[card.accent])} strokeWidth={1.75} />
                  {card.meta && (
                    <span className="figure text-[13px] text-paper-500">{card.meta}</span>
                  )}
                </div>
                <h3 className="font-display text-[16px] text-paper-100 transition-colors group-hover:text-paper-50">
                  {card.title}
                </h3>
                <p className="text-[12.5px] leading-relaxed text-paper-500">{card.body}</p>
                <ArrowRight
                  aria-hidden
                  className="mt-auto h-3.5 w-3.5 text-paper-700 opacity-0 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-brass-400 group-hover:opacity-100"
                />
              </Panel>
            </Link>
          );
        })}
      </div>
    </Section>
  );
}

/* ------------------------------- on this day ----------------------------- */

function OnThisDaySection({ entries }: { entries: OnThisDayEntry[] }): JSX.Element | null {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const [index, setIndex] = useState(0);

  const entry = entries[index];
  const today = useMemo(() => formatDate(Date.now(), locale, 'long'), [locale]);

  if (entries.length === 0) {
    return (
      <Section title={t('archive.onThisDay')} eyebrow={today}>
        <Panel>
          <EmptyState compact icon={<CalendarDays />} title={t('archive.onThisDay.empty')} />
        </Panel>
      </Section>
    );
  }

  return (
    <Section
      title={t('archive.onThisDay.in', { year: entry.year })}
      eyebrow={today}
      action={
        entries.length > 1 ? (
          <div className="flex items-center gap-1">
            {entries.slice(0, 8).map((candidate, i) => (
              <button
                key={candidate.year}
                type="button"
                onClick={() => setIndex(i)}
                className={cx(
                  'figure rounded px-2 py-1 text-[12px] transition-colors',
                  i === index
                    ? 'bg-white/[0.07] text-paper-100'
                    : 'text-paper-600 hover:text-paper-300',
                )}
              >
                {candidate.year}
              </button>
            ))}
          </div>
        ) : undefined
      }
    >
      <Panel className="card-pad">
        <div className="grid gap-6 sm:grid-cols-4">
          <Stat label={t('stat.streams')} value={formatNumber(entry.events, locale)} size="sm" />
          <Stat
            label={t('stat.listeningTime')}
            value={formatDuration(entry.msPlayed, locale)}
            size="sm"
          />
          <div className="min-w-0">
            <p className="eyebrow">{t('calendar.day.topArtist')}</p>
            {entry.topArtist ? (
              <Link
                to={`/artist/${entry.topArtist.id}`}
                className="mt-1 block truncate text-[14px] text-paper-100 transition-colors hover:text-brass-300"
              >
                {entry.topArtist.name}
              </Link>
            ) : (
              <p className="mt-1 text-[14px] text-paper-600">—</p>
            )}
          </div>
          <div className="min-w-0">
            <p className="eyebrow">{t('calendar.day.topTrack')}</p>
            {entry.topTrack ? (
              <Link
                to={`/track/${entry.topTrack.id}`}
                className="mt-1 block truncate text-[14px] text-paper-100 transition-colors hover:text-brass-300"
              >
                {entry.topTrack.name}
              </Link>
            ) : (
              <p className="mt-1 text-[14px] text-paper-600">—</p>
            )}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between border-t border-white/[0.05] pt-4">
          <Badge tone="neutral" icon={<Clock3 />}>
            {formatSilence(daysSince(Date.parse(`${entry.date}T12:00:00`)), t)}
          </Badge>
          <Button
            size="sm"
            variant="quiet"
            iconRight={<ChevronRight />}
            onClick={() => navigate(`/day/${entry.date}`)}
          >
            {t('common.viewDetails')}
          </Button>
        </div>
      </Panel>
    </Section>
  );
}

/* -------------------------------- no archive ----------------------------- */

function NoArchive(): JSX.Element {
  const { t } = useI18n();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <EmptyState
        icon={<Import />}
        title={t('empty.noArchive')}
        body={t('empty.noArchiveBody')}
        action={
          <Button variant="primary" icon={<Import />} onClick={() => navigate('/import')}>
            {t('empty.noArchiveAction')}
          </Button>
        }
      />
    </div>
  );
}
