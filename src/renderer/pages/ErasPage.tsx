import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Layers, Pencil, Info, Check, RotateCcw, Share2 } from 'lucide-react';
import { PageHeader } from '../layouts/PageHeader';
import {
  IconButton,
  Input,
  Panel,
  Textarea,
  Tooltip,
  cx,
} from '../components/ui/primitives';
import { EmptyState, ErrorState, PageSkeleton } from '../components/ui/states';
import { Cover } from '../components/domain/Cover';
import { ShareCardDialog } from '../features/share/ShareCardDialog';
import { useAsync, useAction } from '../hooks/useAsync';
import { useI18n } from '../i18n';
import { useAppStore } from '../stores/app-store';
import { api } from '../lib/api';
import { formatNumber, formatDuration, formatMonth } from '../lib/format';
import type { Era } from '@shared/types/domain';

/**
 * Eras.
 *
 * Presented as a vertical timeline with a continuous rule down the left, so the
 * eye reads it as one life rather than as a list of cards. Each era gets a
 * generous block with its own accent, its dominant artists, and space for the
 * user's own name and note — because only they know that 2019 was "the Montreal
 * year".
 */

const ACCENT_CLASSES: Record<string, { dot: string; text: string; wash: string }> = {
  brass: { dot: 'bg-brass-400', text: 'text-brass-300', wash: 'rgba(214,176,106,0.10)' },
  sage: { dot: 'bg-sage-400', text: 'text-sage-400', wash: 'rgba(126,147,132,0.10)' },
  haze: { dot: 'bg-haze-400', text: 'text-haze-400', wash: 'rgba(124,139,163,0.10)' },
  clay: { dot: 'bg-clay-400', text: 'text-clay-400', wash: 'rgba(176,130,104,0.10)' },
  plum: { dot: 'bg-plum-400', text: 'text-plum-400', wash: 'rgba(150,118,143,0.10)' },
};

export function ErasPage(): JSX.Element {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const hasArchive = useAppStore((s) => s.state?.hasArchive ?? false);

  const { data, error, loading, initial, reload } = useAsync(() => api().eras.list(), [hasArchive], {
    enabled: hasArchive,
  });

  const focusedEra = params.get('era');

  useEffect(() => {
    if (!focusedEra || !data) return;
    const element = document.getElementById(`era-${focusedEra}`);
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusedEra, data]);

  if (!hasArchive) {
    return <EmptyState icon={<Layers />} title={t('empty.noArchive')} body={t('empty.noArchiveBody')} />;
  }
  if (initial && loading) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const eras = data ?? [];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={t('nav.eras')}
        title={t('eras.title')}
        description={t('eras.subtitle')}
        actions={
          <Tooltip content={t('eras.explain')}>
            <IconButton label={t('eras.explain')}>
              <Info className="h-4 w-4" />
            </IconButton>
          </Tooltip>
        }
      />

      {eras.length === 0 ? (
        <Panel>
          <EmptyState icon={<Layers />} title={t('empty.eras')} body={t('empty.erasBody')} />
        </Panel>
      ) : (
        <div className="relative">
          {/* The spine. Fades at both ends so it reads as continuing beyond view. */}
          <div
            aria-hidden
            className="absolute bottom-6 left-[7px] top-6 w-px bg-gradient-to-b from-transparent via-white/[0.09] to-transparent"
          />

          <div className="flex flex-col gap-5">
            {eras.map((era, index) => (
              <EraBlock
                key={era.id}
                era={era}
                index={index}
                highlighted={focusedEra === String(era.id)}
                onChanged={reload}
                onClearFocus={() => {
                  params.delete('era');
                  setParams(params, { replace: true });
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EraBlock({
  era,
  index,
  highlighted,
  onChanged,
  onClearFocus,
}: {
  era: Era;
  index: number;
  highlighted: boolean;
  onChanged: () => void;
  onClearFocus: () => void;
}): JSX.Element {
  const { t, locale } = useI18n();
  const toast = useAppStore((s) => s.toast);
  const accent = ACCENT_CLASSES[era.accent] ?? ACCENT_CLASSES.brass;

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(era.customTitle ?? '');
  const [note, setNote] = useState(era.note?.body ?? '');
  const [noteDirty, setNoteDirty] = useState(false);
  const [sharing, setSharing] = useState(false);

  const rename = useAction(async (value: string | null) => {
    await api().eras.update({ id: era.id, customTitle: value });
    onChanged();
  });

  const saveNote = useAction(async (value: string) => {
    await api().notes.set({ entityType: 'era', entityId: era.id, body: value });
    setNoteDirty(false);
    toast('success', 'common.saved');
  });

  useEffect(() => {
    if (highlighted) {
      const timer = setTimeout(onClearFocus, 2600);
      return () => clearTimeout(timer);
    }
  }, [highlighted, onClearFocus]);

  const topArtist = era.topArtists[0];

  return (
    <div
      id={`era-${era.id}`}
      className="relative animate-fade-up pl-8"
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
    >
      <span
        aria-hidden
        className={cx(
          'absolute left-0 top-7 h-[15px] w-[15px] rounded-full border-[3px] border-ink-900',
          accent.dot,
        )}
      />

      <Panel
        className={cx(
          'relative overflow-hidden transition-all duration-500',
          highlighted && 'ring-1 ring-brass-500/40',
        )}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-32"
          style={{ background: `linear-gradient(to bottom, ${accent.wash}, transparent)` }}
        />

        <div className="relative card-pad">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className={cx('eyebrow', accent.text)}>
                {formatMonth(era.startYm, locale, 'short')} — {formatMonth(era.endYm, locale, 'short')}
                <span className="ml-3 text-paper-600">{t('eras.months', { count: era.months })}</span>
              </p>

              {editing ? (
                <div className="mt-3 flex max-w-lg items-center gap-2">
                  <Input
                    value={title}
                    autoFocus
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder={era.autoTitle}
                    aria-label={t('eras.rename')}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        void rename.run(title.trim() || null).then(() => setEditing(false));
                      }
                      if (event.key === 'Escape') setEditing(false);
                    }}
                  />
                  <IconButton
                    label={t('common.save')}
                    onClick={() => void rename.run(title.trim() || null).then(() => setEditing(false))}
                  >
                    <Check className="h-4 w-4" />
                  </IconButton>
                  {era.customTitle && (
                    <Tooltip content={t('eras.resetName')}>
                      <IconButton
                        label={t('eras.resetName')}
                        onClick={() => {
                          setTitle('');
                          void rename.run(null).then(() => setEditing(false));
                        }}
                      >
                        <RotateCcw className="h-4 w-4" />
                      </IconButton>
                    </Tooltip>
                  )}
                </div>
              ) : (
                <div className="mt-2.5 flex items-center gap-2">
                  <h2 className="font-display text-[25px] leading-tight text-paper-50">
                    {era.title}
                  </h2>
                  <IconButton
                    label={t('eras.rename')}
                    size="sm"
                    onClick={() => {
                      setTitle(era.customTitle ?? '');
                      setEditing(true);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </IconButton>
                </div>
              )}

              {era.customTitle && !editing && (
                <p className="mt-1 text-[12px] text-paper-600">{era.autoTitle}</p>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <IconButton label={t('detail.share')} onClick={() => setSharing(true)}>
                <Share2 className="h-4 w-4" />
              </IconButton>
              {topArtist && (
                <Cover name={topArtist.name} size="lg" rounded="full" />
              )}
            </div>
          </div>

          <dl className="mt-7 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
            <Figure label={t('stat.streams')} value={formatNumber(era.streams, locale)} />
            <Figure label={t('stat.listeningTime')} value={formatDuration(era.msPlayed, locale)} />
            <Figure label={t('eras.newArtistsLabel')} value={formatNumber(era.newArtists, locale)} />
            {/*
             * The opening era has nothing before it to differ from, so a shift
             * strength of zero would be misleading rather than informative.
             */}
            <Figure
              label={era.position === 0 ? t('eras.firstEra') : t('eras.changeStrength')}
              value={era.position === 0 ? '—' : `${Math.round(era.changeStrength * 100)}%`}
              tone={era.position === 0 ? undefined : accent.text}
            />
          </dl>

          <div className="mt-7 grid gap-7 lg:grid-cols-2">
            <div>
              <p className="eyebrow mb-3">{t('eras.dominant')}</p>
              <div className="flex flex-col gap-1">
                {era.topArtists.slice(0, 5).map((artist, rank) => {
                  const share = era.topArtists[0]?.msPlayed
                    ? artist.msPlayed / era.topArtists[0].msPlayed
                    : 0;
                  return (
                    <Link
                      key={artist.id}
                      to={`/artist/${artist.id}`}
                      className="group relative flex items-center gap-3 rounded px-2 py-1.5 transition-colors hover:bg-white/[0.03]"
                    >
                      {/*
                       * A share bar rather than a block: it fades out to the
                       * right so the rows read as a chart, not as buttons.
                       */}
                      <span
                        aria-hidden
                        className="absolute inset-y-px left-0 rounded bg-gradient-to-r from-white/[0.055] to-white/[0.005]"
                        style={{ width: `${Math.max(6, share * 100)}%` }}
                      />
                      <span className="figure relative w-4 text-[11.5px] text-paper-600">
                        {rank + 1}
                      </span>
                      <span className="relative min-w-0 flex-1 truncate text-[13px] text-paper-200 group-hover:text-paper-50">
                        {artist.name}
                      </span>
                      <span className="figure relative text-[12px] text-paper-500">
                        {formatNumber(artist.plays, locale)}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="eyebrow mb-3">{t('eras.tracks')}</p>
              <div className="flex flex-col gap-1">
                {era.topTracks.slice(0, 5).map((track, rank) => (
                  <Link
                    key={track.id}
                    to={`/track/${track.id}`}
                    className="group flex items-center gap-3 rounded px-2 py-1.5 transition-colors hover:bg-white/[0.03]"
                  >
                    <span className="figure w-4 text-[11.5px] text-paper-600">{rank + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-paper-200 group-hover:text-paper-50">
                        {track.name}
                      </span>
                      <span className="block truncate text-[11.5px] text-paper-600">
                        {track.artist}
                      </span>
                    </span>
                    <span className="figure text-[12px] text-paper-500">
                      {formatNumber(track.plays, locale)}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-7 border-t border-white/[0.05] pt-5">
            <p className="eyebrow mb-2.5">{t('eras.note')}</p>
            <Textarea
              rows={2}
              value={note}
              placeholder={t('eras.notePlaceholder')}
              onChange={(event) => {
                setNote(event.target.value);
                setNoteDirty(true);
              }}
              onBlur={() => {
                if (noteDirty) void saveNote.run(note);
              }}
            />
          </div>
        </div>
      </Panel>

      <ShareCardDialog
        open={sharing}
        onClose={() => setSharing(false)}
        card={{
          kind: 'era',
          title: era.title,
          subtitle: `${formatMonth(era.startYm, locale, 'short')} — ${formatMonth(era.endYm, locale, 'short')}`,
          lines: era.topArtists.slice(0, 4).map((artist) => artist.name),
          figure: formatNumber(era.streams, locale),
          figureLabel: t('stat.streams'),
          accent: era.accent,
        }}
      />
    </div>
  );
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}): JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="eyebrow">{label}</dt>
      <dd className={cx('figure mt-1 truncate text-[16px]', tone ?? 'text-paper-100')}>{value}</dd>
    </div>
  );
}
