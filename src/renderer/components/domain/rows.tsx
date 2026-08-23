import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { Cover } from './Cover';
import { cx, IconButton } from '../ui/primitives';
import { useI18n } from '../../i18n';
import { formatNumber, formatDuration, formatDate } from '../../lib/format';
import { openSpotify } from '../../lib/api';
import type { TrackSummary, ArtistSummary, AlbumSummary } from '@shared/types/domain';

/**
 * List rows.
 *
 * One row component per entity kind rather than a generic one: each carries
 * genuinely different secondary information, and a configurable mega-row would
 * be harder to read than three focused ones.
 */

interface BaseRowProps {
  to: string;
  index?: number;
  cover: ReactNode;
  title: string;
  subtitle?: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  uri?: string | null;
  className?: string;
  dense?: boolean;
}

function BaseRow({
  to,
  index,
  cover,
  title,
  subtitle,
  meta,
  trailing,
  uri,
  className,
  dense,
}: BaseRowProps): JSX.Element {
  const { t } = useI18n();

  return (
    <Link
      to={to}
      className={cx(
        'group relative flex items-center gap-3.5 rounded-md px-3 transition-colors duration-150',
        'hover:bg-white/[0.032] focus-visible:bg-white/[0.045]',
        dense ? 'py-2' : 'py-2.5',
        className,
      )}
    >
      {index !== undefined && (
        <span className="figure w-6 shrink-0 text-right text-[12px] tabular-nums text-paper-600">
          {index}
        </span>
      )}

      {cover}

      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-medium text-paper-100 group-hover:text-paper-50">
          {title}
        </p>
        {subtitle && (
          <p className="mt-0.5 truncate text-[12px] text-paper-500">{subtitle}</p>
        )}
      </div>

      {meta && (
        <div className="hidden shrink-0 items-center gap-6 text-right sm:flex">{meta}</div>
      )}

      {trailing}

      {uri && (
        <IconButton
          label={t('detail.openInSpotify')}
          size="sm"
          className="opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void openSpotify(uri);
          }}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </IconButton>
      )}
    </Link>
  );
}

/** A right-aligned figure with a caption underneath. */
export function RowMetric({
  value,
  label,
  width = 'w-16',
  tone = 'default',
}: {
  value: string | number;
  label?: string;
  width?: string;
  tone?: 'default' | 'muted' | 'brass';
}): JSX.Element {
  return (
    <div className={cx('shrink-0 text-right', width)}>
      <p
        className={cx(
          'figure text-[13px] tabular-nums',
          tone === 'brass' ? 'text-brass-300' : tone === 'muted' ? 'text-paper-500' : 'text-paper-200',
        )}
      >
        {value}
      </p>
      {label && <p className="text-[10px] uppercase tracking-wider text-paper-600">{label}</p>}
    </div>
  );
}

export function TrackRow({
  track,
  index,
  showAlbum,
  trailing,
  meta,
  dense,
}: {
  track: TrackSummary;
  index?: number;
  showAlbum?: boolean;
  trailing?: ReactNode;
  meta?: ReactNode;
  dense?: boolean;
}): JSX.Element {
  const { t, locale } = useI18n();

  return (
    <BaseRow
      to={`/track/${track.id}`}
      index={index}
      dense={dense}
      cover={<Cover name={track.album ?? track.name} secondary={track.artist} size={dense ? 'sm' : 'md'} />}
      title={track.name}
      subtitle={
        showAlbum && track.album ? `${track.artist} · ${track.album}` : track.artist
      }
      meta={
        meta ?? (
          <>
            <RowMetric value={formatNumber(track.qualifyingPlays, locale)} label={t('unit.plays')} />
            <RowMetric value={formatDuration(track.msPlayed, locale)} tone="muted" />
          </>
        )
      }
      trailing={trailing}
      uri={track.uri}
    />
  );
}

export function ArtistRow({
  artist,
  index,
  trailing,
  meta,
  dense,
}: {
  artist: ArtistSummary;
  index?: number;
  trailing?: ReactNode;
  meta?: ReactNode;
  dense?: boolean;
}): JSX.Element {
  const { t, locale } = useI18n();

  return (
    <BaseRow
      to={`/artist/${artist.id}`}
      index={index}
      dense={dense}
      cover={
        <Cover name={artist.name} size={dense ? 'sm' : 'md'} rounded="full" />
      }
      title={artist.name}
      subtitle={t('detail.tracksHeard') + ` · ${formatNumber(artist.trackCount, locale)}`}
      meta={
        meta ?? (
          <>
            <RowMetric value={formatNumber(artist.qualifyingPlays, locale)} label={t('unit.plays')} />
            <RowMetric value={formatDuration(artist.msPlayed, locale)} tone="muted" />
          </>
        )
      }
      trailing={trailing}
      uri={artist.uri}
    />
  );
}

export function AlbumRow({
  album,
  index,
  trailing,
  meta,
  dense,
}: {
  album: AlbumSummary;
  index?: number;
  trailing?: ReactNode;
  meta?: ReactNode;
  dense?: boolean;
}): JSX.Element {
  const { t, locale } = useI18n();

  return (
    <BaseRow
      to={`/album/${album.id}`}
      index={index}
      dense={dense}
      cover={<Cover name={album.name} secondary={album.artist} size={dense ? 'sm' : 'md'} />}
      title={album.name}
      subtitle={album.artist}
      meta={
        meta ?? (
          <>
            <RowMetric value={formatNumber(album.qualifyingPlays, locale)} label={t('unit.plays')} />
            <RowMetric value={formatDuration(album.msPlayed, locale)} tone="muted" />
          </>
        )
      }
      trailing={trailing}
      uri={album.uri}
    />
  );
}

/** A row of key/value facts, used across every detail page. */
export function FactList({
  facts,
  columns = 2,
  className,
}: {
  facts: { label: string; value: ReactNode; hint?: string }[];
  columns?: 1 | 2 | 3;
  className?: string;
}): JSX.Element {
  const cols = { 1: '', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3' };
  return (
    <dl className={cx('grid gap-x-8 gap-y-4', cols[columns], className)}>
      {facts.map((fact) => (
        <div key={fact.label} className="min-w-0">
          <dt className="eyebrow">{fact.label}</dt>
          <dd className="mt-1 truncate text-[13.5px] text-paper-100">{fact.value}</dd>
          {fact.hint && <dd className="mt-0.5 text-[11.5px] text-paper-500">{fact.hint}</dd>}
        </div>
      ))}
    </dl>
  );
}

/** Formats a timestamp as an absolute date, with "never" for null. */
export function useDateLabel(): (ts: number | null) => string {
  const { locale, t } = useI18n();
  return (ts) => (ts === null ? t('common.never') : formatDate(ts, locale));
}
