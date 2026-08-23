import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ExternalLink,
  Heart,
  Archive as ArchiveIcon,
  Tag as TagIcon,
  Share2,
  Plus,
  Check,
  Flame,
} from 'lucide-react';
import { DetailHeader } from '../layouts/PageHeader';
import {
  Badge,
  Button,
  IconButton,
  Panel,
  Section,
  Textarea,
  Tooltip,
  cx,
} from '../components/ui/primitives';
import { ErrorState, PageSkeleton, EmptyState } from '../components/ui/states';
import { Modal } from '../components/ui/overlays';
import { Cover } from '../components/domain/Cover';
import { ScoreDial, Stat } from '../components/domain/Stat';
import { FactList } from '../components/domain/rows';
import { ListeningAreaChart, ListeningClock } from '../components/charts/charts';
import { ShareCardDialog } from '../features/share/ShareCardDialog';
import { useAsync, useAction } from '../hooks/useAsync';
import { useI18n } from '../i18n';
import { useAppStore } from '../stores/app-store';
import { api, openSpotify } from '../lib/api';
import {
  formatNumber,
  formatDuration,
  formatDate,
  formatDateTime,
  formatMonth,
  formatSilence,
  formatPercent,
} from '../lib/format';
import type { Milestone, TrackDetail } from '@shared/types/domain';

/**
 * Track detail.
 *
 * The most complete view of a single song: what it was to you, when, and what
 * happened to it. The milestone timeline is the part that turns numbers into a
 * story — it reads chronologically, from first hearing to whatever the last
 * thing was.
 */

export function TrackDetailPage(): JSX.Element {
  const { t, locale } = useI18n();
  const { id } = useParams<{ id: string }>();
  const trackId = Number(id);

  const { data, error, loading, initial, reload } = useAsync(
    () => api().entity.track({ id: trackId }),
    [trackId],
    { enabled: Number.isFinite(trackId) && trackId > 0 },
  );

  const [sharing, setSharing] = useState(false);
  const [tagPicker, setTagPicker] = useState(false);

  if (initial && loading) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <PageSkeleton />;

  const { track } = data;

  return (
    <div className="flex flex-col stack-gap">
      <DetailHeader
        backTo={{ to: `/artist/${track.artistId}`, label: track.artist }}
        cover={<Cover name={track.album ?? track.name} secondary={track.artist} size="hero" />}
        eyebrow={t('detail.track')}
        title={track.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link to={`/artist/${track.artistId}`} className="link-quiet">
              {track.artist}
            </Link>
            {track.album && track.albumId && (
              <>
                <span aria-hidden className="text-paper-700">
                  ·
                </span>
                <Link to={`/album/${track.albumId}`} className="link-quiet">
                  {track.album}
                </Link>
              </>
            )}
          </span>
        }
        aside={
          data.lostFavoriteScore !== null ? (
            <Tooltip content={t('lost.score')}>
              <div>
                <ScoreDial score={data.lostFavoriteScore} size={96} label={t('lost.score')} />
              </div>
            </Tooltip>
          ) : undefined
        }
        facts={
          <FactList
            columns={3}
            facts={[
              {
                label: t('detail.totalPlays'),
                value: formatNumber(track.qualifyingPlays, locale),
                hint:
                  track.plays !== track.qualifyingPlays
                    ? `${formatNumber(track.plays, locale)} ${t('stat.streams').toLowerCase()}`
                    : undefined,
              },
              { label: t('detail.listeningTime'), value: formatDuration(track.msPlayed, locale) },
              {
                label: t('detail.firstHeard'),
                value: formatDate(track.firstTs, locale),
              },
              {
                label: t('detail.lastHeard'),
                value: formatDate(track.lastTs, locale),
                hint:
                  track.lastTs !== null
                    ? formatSilence(
                        Math.floor((Date.now() - track.lastTs) / 86_400_000),
                        t,
                      )
                    : undefined,
              },
              { label: t('detail.peakYear'), value: data.peakYear ?? '—' },
              {
                label: t('detail.peakMonth'),
                value: data.peakYm ? formatMonth(data.peakYm, locale, 'short') : '—',
                hint: data.peakYmPlays > 0 ? `${data.peakYmPlays} ${t('unit.plays')}` : undefined,
              },
            ]}
          />
        }
        actions={
          <TrackActions detail={data} onChanged={reload} onShare={() => setSharing(true)} onAddTag={() => setTagPicker(true)} />
        }
      />

      {data.tags.length > 0 && (
        <div className="-mt-4 flex flex-wrap gap-2">
          {data.tags.map((tag) => (
            <Link key={tag.id} to={`/library?tag=${tag.id}`}>
              <Badge tone="neutral" className="hover:border-white/20">
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: tag.color }}
                />
                {tag.name}
              </Badge>
            </Link>
          ))}
        </div>
      )}

      {data.monthly.length > 1 && (
        <Section title={t('detail.timeline')}>
          <Panel className="card-pad">
            <ListeningAreaChart
              data={data.monthly.map((point) => ({
                key: point.ym,
                plays: point.qualifyingPlays,
                msPlayed: point.msPlayed,
              }))}
              height={190}
            />
          </Panel>
        </Section>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Panel className="card-pad">
          <Stat
            label={t('detail.distinctDays')}
            value={formatNumber(data.distinctDays, locale)}
            size="sm"
          />
        </Panel>
        <Panel className="card-pad">
          <Stat label={t('detail.activeMonths')} value={data.activeMonths} size="sm" />
        </Panel>
        <Panel className="card-pad">
          <Stat
            label={t('detail.skips')}
            value={formatPercent(track.skipRate, 0)}
            size="sm"
            hint={`${formatNumber(data.skips, locale)} / ${formatNumber(track.plays, locale)}`}
          />
        </Panel>
        <Panel className="card-pad">
          <Stat
            label={t('detail.longestAbsence')}
            value={data.longestAbsenceDays > 0 ? formatSilence(data.longestAbsenceDays, t) : '—'}
            size="sm"
            hint={
              data.longestAbsenceFrom
                ? `${formatDate(data.longestAbsenceFrom, locale, 'short')} → ${formatDate(data.longestAbsenceTo, locale, 'short')}`
                : undefined
            }
          />
        </Panel>
      </div>

      {data.obsession && (
        <Section title={t('obsessions.peakPeriod')}>
          <Panel className="flex items-center gap-4 card-pad">
            <Flame aria-hidden className="h-5 w-5 shrink-0 text-clay-400" />
            <div className="min-w-0 flex-1">
              <p className="text-[14px] text-paper-100">
                {t('obsessions.window', {
                  plays: data.obsession.windowPlays,
                  days: data.obsession.windowDays,
                })}
              </p>
              <p className="mt-1 text-[12.5px] text-paper-500">
                {formatDate(data.obsession.windowStart, locale)} —{' '}
                {formatDate(data.obsession.windowEnd, locale)} ·{' '}
                {t('obsessions.share', { percent: Math.round(data.obsession.share * 100) })}
              </p>
            </div>
            <p className="figure shrink-0 text-[24px] text-brass-300">
              {data.obsession.windowPlays}
            </p>
          </Panel>
        </Section>
      )}

      <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        <Section title={t('detail.milestones')}>
          <Panel className="card-pad">
            <MilestoneTimeline milestones={data.milestones} />
          </Panel>
        </Section>

        <Section title={t('detail.hourly')}>
          <Panel className="flex items-center justify-center card-pad">
            <ListeningClock hours={data.hourly} size={196} />
          </Panel>
        </Section>
      </div>

      <Section title={t('detail.note')}>
        <NoteEditor entityType="track" entityId={track.id} initial={data.note?.body ?? ''} />
      </Section>

      <ShareCardDialog
        open={sharing}
        onClose={() => setSharing(false)}
        card={{
          kind: 'track',
          title: track.name,
          subtitle: track.artist,
          statement:
            track.lastTs !== null
              ? t('rediscovery.reason.dormant', {
                  plays: track.qualifyingPlays,
                  days: Math.floor((Date.now() - track.lastTs) / 86_400_000),
                })
              : undefined,
          lines: [
            `${t('detail.firstHeard')}: ${formatDate(track.firstTs, locale)}`,
            `${t('detail.lastHeard')}: ${formatDate(track.lastTs, locale)}`,
            data.peakYear ? `${t('detail.peakYear')}: ${data.peakYear}` : '',
          ].filter(Boolean),
          figure: formatNumber(track.qualifyingPlays, locale),
          figureLabel: t('unit.plays'),
          accent: 'brass',
        }}
      />

      <TagPickerDialog
        open={tagPicker}
        onClose={() => setTagPicker(false)}
        trackId={track.id}
        assigned={data.tags.map((tag) => tag.id)}
        onChanged={reload}
      />
    </div>
  );
}

/* -------------------------------- actions -------------------------------- */

function TrackActions({
  detail,
  onChanged,
  onShare,
  onAddTag,
}: {
  detail: TrackDetail;
  onChanged: () => void;
  onShare: () => void;
  onAddTag: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const toast = useAppStore((s) => s.toast);

  const setFlag = useAction(async (patch: { favorite?: boolean; retired?: boolean }) => {
    await api().library.setFlags({ trackId: detail.track.id, ...patch });
    onChanged();
  });

  return (
    <>
      {detail.track.uri ? (
        <Button variant="secondary" icon={<ExternalLink />} onClick={() => void openSpotify(detail.track.uri)}>
          {t('detail.openInSpotify')}
        </Button>
      ) : (
        <Tooltip content={t('detail.noUri')}>
          <Button variant="secondary" icon={<ExternalLink />} disabled>
            {t('detail.openInSpotify')}
          </Button>
        </Tooltip>
      )}

      <Button variant="ghost" icon={<TagIcon />} onClick={onAddTag}>
        {t('detail.addTag')}
      </Button>

      <IconButton
        label={detail.flags.favorite ? t('detail.unmarkFavorite') : t('detail.markFavorite')}
        active={detail.flags.favorite}
        onClick={() => {
          void setFlag.run({ favorite: !detail.flags.favorite }).then(() => {
            if (!detail.flags.favorite) toast('success', 'common.saved');
          });
        }}
      >
        <Heart className={cx('h-4 w-4', detail.flags.favorite && 'fill-current')} />
      </IconButton>

      <IconButton
        label={detail.flags.retired ? t('detail.unmarkRetired') : t('detail.markRetired')}
        active={detail.flags.retired}
        onClick={() => void setFlag.run({ retired: !detail.flags.retired })}
      >
        <ArchiveIcon className="h-4 w-4" />
      </IconButton>

      <IconButton label={t('detail.share')} onClick={onShare}>
        <Share2 className="h-4 w-4" />
      </IconButton>
    </>
  );
}

/* ------------------------------- milestones ------------------------------ */

function MilestoneTimeline({ milestones }: { milestones: Milestone[] }): JSX.Element {
  const { t, locale } = useI18n();

  if (milestones.length === 0) {
    return <p className="text-[13px] text-paper-600">{t('empty.genericBody')}</p>;
  }

  return (
    <ol className="relative flex flex-col gap-4 pl-6">
      <span
        aria-hidden
        className="absolute bottom-2 left-[3.5px] top-2 w-px bg-gradient-to-b from-transparent via-white/[0.08] to-transparent"
      />
      {milestones.map((milestone, index) => (
        <li key={`${milestone.kind}-${milestone.ts}-${index}`} className="relative">
          <span
            aria-hidden
            className={cx(
              'absolute -left-6 top-1.5 h-2 w-2 rounded-full',
              milestone.kind === 'comeback' || milestone.kind === 'peak-month'
                ? 'bg-brass-400'
                : milestone.kind === 'longest-absence'
                  ? 'bg-ember-500/70'
                  : 'bg-paper-600',
            )}
          />
          <p className="text-[13.5px] text-paper-200">
            {t(milestone.labelKey, milestone.values)}
          </p>
          <p className="mt-0.5 text-[11.5px] text-paper-600">
            {formatDateTime(milestone.ts, locale)}
          </p>
        </li>
      ))}
    </ol>
  );
}

/* ---------------------------------- note --------------------------------- */

export function NoteEditor({
  entityType,
  entityId,
  initial,
}: {
  entityType: 'track' | 'artist' | 'album' | 'era';
  entityId: number;
  initial: string;
}): JSX.Element {
  const { t } = useI18n();
  const toast = useAppStore((s) => s.toast);
  const [value, setValue] = useState(initial);
  const [dirty, setDirty] = useState(false);

  const save = useAction(async () => {
    await api().notes.set({ entityType, entityId, body: value });
    setDirty(false);
    toast('success', 'common.saved');
  });

  return (
    <Panel className="card-pad">
      <Textarea
        rows={3}
        value={value}
        placeholder={t('detail.notePlaceholder')}
        onChange={(event) => {
          setValue(event.target.value);
          setDirty(true);
        }}
        onBlur={() => {
          if (dirty) void save.run();
        }}
      />
      <div className="mt-3 flex items-center justify-between">
        <p className="text-[11.5px] text-paper-600">{t('settings.privacy.notesBody')}</p>
        {dirty && (
          <Button size="sm" variant="secondary" loading={save.pending} onClick={() => void save.run()}>
            {t('common.save')}
          </Button>
        )}
      </div>
    </Panel>
  );
}

/* ------------------------------- tag picker ------------------------------ */

export function TagPickerDialog({
  open,
  onClose,
  trackId,
  assigned,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  trackId: number;
  assigned: number[];
  onChanged: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const navigate = useNavigate();
  const tags = useAsync(() => api().library.tags(), [open], { enabled: open });

  const toggle = useAction(async (tagId: number, isAssigned: boolean) => {
    if (isAssigned) await api().library.unassignTag({ trackId, tagId });
    else await api().library.assignTag({ trackId, tagId });
    onChanged();
  });

  return (
    <Modal open={open} onClose={onClose} title={t('detail.addTag')} size="sm">
      {(tags.data ?? []).length === 0 ? (
        <EmptyState
          compact
          icon={<TagIcon />}
          title={t('empty.tags')}
          body={t('empty.tagsBody')}
          action={
            <Button
              variant="primary"
              size="sm"
              icon={<Plus />}
              onClick={() => {
                onClose();
                navigate('/library');
              }}
            >
              {t('empty.tagsAction')}
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-1">
          {(tags.data ?? []).map((tag) => {
            const isAssigned = assigned.includes(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => void toggle.run(tag.id, isAssigned)}
                className={cx(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-left transition-colors',
                  isAssigned ? 'bg-white/[0.055]' : 'hover:bg-white/[0.03]',
                )}
              >
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: tag.color }}
                />
                <span className="flex-1 text-[13.5px] text-paper-200">{tag.name}</span>
                {isAssigned && <Check aria-hidden className="h-4 w-4 text-brass-300" />}
              </button>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
