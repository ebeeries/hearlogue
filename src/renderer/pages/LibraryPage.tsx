import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Library as LibraryIcon,
  Plus,
  Search as SearchIcon,
  Pencil,
  Trash2,
  Heart,
  Archive as ArchiveIcon,
  StickyNote,
  Sparkles,
  Pin,
} from 'lucide-react';
import { PageHeader } from '../layouts/PageHeader';
import {
  Button,
  Chip,
  IconButton,
  Input,
  Panel,
  Section,
  Segmented,
  Select,
  cx,
} from '../components/ui/primitives';
import { EmptyState, ErrorState, SkeletonRows } from '../components/ui/states';
import { ConfirmDialog, Modal } from '../components/ui/overlays';
import { Cover } from '../components/domain/Cover';
import { CollectionEditor } from '../features/collections/CollectionEditor';
import { useAsync, useAction, useDebounced } from '../hooks/useAsync';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { formatNumber, formatDuration, formatDate } from '../lib/format';
import { TAG_COLORS, TAG_ICONS } from '@shared/models/defaults';
import type { Tag, SmartCollection } from '@shared/types/domain';
import type { LibraryTrack } from '@preload/api-types';

/**
 * Library.
 *
 * HEARLOGUE's own layer: tags, flags, notes and Smart Collections, all local.
 * Three tabs rather than three screens, because they are the same idea seen
 * three ways.
 */

type Tab = 'tracks' | 'collections' | 'notes';
const PAGE_SIZE = 60;

export function LibraryPage(): JSX.Element {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>('tracks');

  const tagParam = params.get('tag');
  const activeTag = tagParam ? Number(tagParam) : null;

  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        eyebrow={t('nav.library')}
        title={t('library.title')}
        description={t('library.subtitle')}
        actions={
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'tracks', label: t('library.allTracks') },
              { value: 'collections', label: t('library.collections') },
              { value: 'notes', label: t('library.notes') },
            ]}
          />
        }
      />

      {tab === 'tracks' && (
        <TracksTab
          activeTag={activeTag}
          onSelectTag={(id) => {
            if (id === null) params.delete('tag');
            else params.set('tag', String(id));
            setParams(params, { replace: true });
          }}
        />
      )}
      {tab === 'collections' && <CollectionsTab />}
      {tab === 'notes' && <NotesTab />}
    </div>
  );
}

/* -------------------------------- tracks --------------------------------- */

function TracksTab({
  activeTag,
  onSelectTag,
}: {
  activeTag: number | null;
  onSelectTag: (id: number | null) => void;
}): JSX.Element {
  const { t, locale } = useI18n();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'plays' | 'msPlayed' | 'recent' | 'name' | 'artist' | 'lostFavorite'>('plays');
  const [status, setStatus] = useState<'any' | 'favorite' | 'retired' | 'tagged' | 'untagged'>('any');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [editingTag, setEditingTag] = useState<Tag | 'new' | null>(null);
  const [deletingTag, setDeletingTag] = useState<Tag | null>(null);

  const debounced = useDebounced(search, 240);
  const tags = useAsync(() => api().library.tags(), []);
  const tracks = useAsync(
    () =>
      api().library.tracks({
        tagId: activeTag,
        search: debounced,
        sort,
        status,
        limit,
        offset: 0,
      }),
    [activeTag, debounced, sort, status, limit],
  );

  const deleteTag = useAction(async (id: number) => {
    await api().library.deleteTag({ id });
    if (activeTag === id) onSelectTag(null);
    tags.reload();
    tracks.reload();
  });

  const items = tracks.data?.items ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Chip active={activeTag === null} onClick={() => onSelectTag(null)}>
          {t('library.allTracks')}
        </Chip>
        {(tags.data ?? []).map((tag) => (
          <Chip
            key={tag.id}
            active={activeTag === tag.id}
            onClick={() => onSelectTag(tag.id)}
            color={tag.color}
            count={tag.trackCount}
          >
            {tag.name}
          </Chip>
        ))}
        <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => setEditingTag('new')}>
          {t('library.newTag')}
        </Button>
      </div>

      {activeTag !== null && (
        <div className="flex items-center gap-2">
          {(() => {
            const tag = (tags.data ?? []).find((candidate) => candidate.id === activeTag);
            if (!tag) return null;
            return (
              <>
                <span className="text-[12.5px] text-paper-500">{tag.name}</span>
                <IconButton label={t('library.editTag')} size="sm" onClick={() => setEditingTag(tag)}>
                  <Pencil className="h-3.5 w-3.5" />
                </IconButton>
                <IconButton
                  label={t('library.deleteTag')}
                  size="sm"
                  tone="danger"
                  onClick={() => setDeletingTag(tag)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </IconButton>
              </>
            );
          })()}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('library.searchPlaceholder')}
          icon={<SearchIcon />}
          className="w-full max-w-xs"
          aria-label={t('library.searchPlaceholder')}
        />
        <Select
          value={sort}
          onChange={setSort}
          label={t('library.sort.plays')}
          className="w-44"
          options={[
            { value: 'plays', label: t('library.sort.plays') },
            { value: 'msPlayed', label: t('library.sort.msPlayed') },
            { value: 'recent', label: t('library.sort.recent') },
            { value: 'lostFavorite', label: t('library.sort.lostFavorite') },
            { value: 'name', label: t('library.sort.name') },
            { value: 'artist', label: t('library.sort.artist') },
          ]}
        />
        <Select
          value={status}
          onChange={setStatus}
          label={t('library.filter.any')}
          className="w-40"
          options={[
            { value: 'any', label: t('library.filter.any') },
            { value: 'favorite', label: t('library.filter.favorite') },
            { value: 'retired', label: t('library.filter.retired') },
            { value: 'tagged', label: t('library.filter.tagged') },
            { value: 'untagged', label: t('library.filter.untagged') },
          ]}
        />
      </div>

      {tracks.error && <ErrorState error={tracks.error} onRetry={tracks.reload} />}
      {tracks.initial && tracks.loading && <SkeletonRows rows={10} height="h-12" />}

      {!tracks.loading && items.length === 0 && (
        <Panel>
          <EmptyState
            icon={<LibraryIcon />}
            title={t('empty.generic')}
            body={t('empty.genericBody')}
          />
        </Panel>
      )}

      {items.length > 0 && (
        <Panel className="overflow-hidden">
          {items.map((track) => (
            <LibraryRow key={track.id} track={track} onChanged={tracks.reload} />
          ))}
        </Panel>
      )}

      {tracks.data && items.length < tracks.data.total && (
        <div className="flex flex-col items-center gap-2">
          <Button variant="secondary" loading={tracks.loading} onClick={() => setLimit((l) => l + PAGE_SIZE)}>
            {t('library.loadMore')}
          </Button>
          <p className="text-[11.5px] text-paper-600">
            {t('library.showing', {
              shown: items.length,
              total: formatNumber(tracks.data.total, locale),
            })}
          </p>
        </div>
      )}

      <TagEditor
        tag={editingTag}
        onClose={() => setEditingTag(null)}
        onSaved={() => {
          setEditingTag(null);
          tags.reload();
        }}
      />

      <ConfirmDialog
        open={deletingTag !== null}
        onClose={() => setDeletingTag(null)}
        onConfirm={() => {
          if (deletingTag) void deleteTag.run(deletingTag.id).then(() => setDeletingTag(null));
        }}
        title={t('library.deleteTag')}
        body={t('library.deleteTagConfirm', { name: deletingTag?.name ?? '' })}
        confirmLabel={t('common.delete')}
        tone="danger"
        pending={deleteTag.pending}
      />
    </div>
  );
}

function LibraryRow({
  track,
  onChanged,
}: {
  track: LibraryTrack;
  onChanged: () => void;
}): JSX.Element {
  const { t, locale } = useI18n();

  const setFlag = useAction(async (patch: { favorite?: boolean; retired?: boolean }) => {
    await api().library.setFlags({ trackId: track.id, ...patch });
    onChanged();
  });

  return (
    <div
      className={cx(
        'group flex items-center gap-3.5 border-b border-white/[0.03] px-4 py-2 last:border-b-0',
        'transition-colors hover:bg-white/[0.028]',
        track.retired && 'opacity-60',
      )}
    >
      <Cover name={track.album ?? track.name} secondary={track.artist} size="sm" />

      <div className="min-w-0 flex-1">
        <Link
          to={`/track/${track.id}`}
          className="block truncate text-[13.5px] text-paper-100 hover:text-brass-300"
        >
          {track.name}
        </Link>
        <Link
          to={`/artist/${track.artistId}`}
          className="block truncate text-[11.5px] text-paper-500 hover:text-paper-300"
        >
          {track.artist}
        </Link>
      </div>

      {track.lostFavoriteScore > 0 && (
        <span className="figure hidden w-10 shrink-0 text-right text-[12px] text-brass-400/80 sm:block">
          {Math.round(track.lostFavoriteScore)}
        </span>
      )}

      <span className="figure hidden w-14 shrink-0 text-right text-[12.5px] text-paper-300 sm:block">
        {formatNumber(track.qualifyingPlays, locale)}
      </span>
      <span className="figure hidden w-16 shrink-0 text-right text-[12px] text-paper-500 md:block">
        {formatDuration(track.msPlayed, locale)}
      </span>
      <span className="hidden w-20 shrink-0 text-right text-[11.5px] text-paper-600 lg:block">
        {formatDate(track.lastTs, locale, 'short')}
      </span>

      <div className="flex shrink-0 items-center gap-0.5">
        <IconButton
          label={track.favorite ? t('detail.unmarkFavorite') : t('detail.markFavorite')}
          size="sm"
          active={track.favorite}
          className={cx(!track.favorite && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100')}
          onClick={() => void setFlag.run({ favorite: !track.favorite })}
        >
          <Heart className={cx('h-3.5 w-3.5', track.favorite && 'fill-current')} />
        </IconButton>
        <IconButton
          label={track.retired ? t('detail.unmarkRetired') : t('detail.markRetired')}
          size="sm"
          active={track.retired}
          className={cx(!track.retired && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100')}
          onClick={() => void setFlag.run({ retired: !track.retired })}
        >
          <ArchiveIcon className="h-3.5 w-3.5" />
        </IconButton>
      </div>
    </div>
  );
}

/* ------------------------------- tag editor ------------------------------ */

function TagEditor({
  tag,
  onClose,
  onSaved,
}: {
  tag: Tag | 'new' | null;
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const isNew = tag === 'new';
  const existing = tag !== 'new' && tag !== null ? tag : null;

  const [name, setName] = useState(existing?.name ?? '');
  const [color, setColor] = useState(existing?.color ?? TAG_COLORS[0]);
  const [icon, setIcon] = useState(existing?.icon ?? 'Tag');

  const save = useAction(async () => {
    if (isNew) await api().library.createTag({ name: name.trim(), color, icon });
    else if (existing) await api().library.updateTag({ id: existing.id, name: name.trim(), color, icon });
    onSaved();
  });

  // Reset the form whenever a different tag is opened.
  const key = existing?.id ?? (isNew ? 'new' : 'none');

  return (
    <Modal
      key={key}
      open={tag !== null}
      onClose={onClose}
      title={isNew ? t('library.newTag') : t('library.editTag')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={save.pending}
            disabled={name.trim().length === 0}
            onClick={() => void save.run()}
          >
            {isNew ? t('common.create') : t('common.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div>
          <label className="eyebrow mb-2 block" htmlFor="tag-name">
            {t('library.tagName')}
          </label>
          <Input
            id="tag-name"
            value={name}
            autoFocus
            onChange={(event) => setName(event.target.value)}
            invalid={save.error !== null}
          />
          {save.error && (
            <p className="mt-2 text-[12px] text-ember-400">
              {t(save.error.messageKey, { detail: save.error.detail ?? name })}
            </p>
          )}
        </div>

        <div>
          <p className="eyebrow mb-2">{t('library.tagColor')}</p>
          <div className="flex flex-wrap gap-2">
            {TAG_COLORS.map((candidate) => (
              <button
                key={candidate}
                type="button"
                aria-label={candidate}
                onClick={() => setColor(candidate)}
                className={cx(
                  'h-7 w-7 rounded-full transition-all duration-150',
                  color === candidate
                    ? 'ring-2 ring-paper-200 ring-offset-2 ring-offset-ink-850'
                    : 'hover:scale-110',
                )}
                style={{ backgroundColor: candidate }}
              />
            ))}
          </div>
        </div>

        <div>
          <p className="eyebrow mb-2">{t('library.tagIcon')}</p>
          <Select
            value={icon}
            onChange={setIcon}
            label={t('library.tagIcon')}
            options={TAG_ICONS.map((value) => ({ value, label: value }))}
          />
        </div>
      </div>
    </Modal>
  );
}

/* ----------------------------- collections tab --------------------------- */

function CollectionsTab(): JSX.Element {
  const { t, locale } = useI18n();
  const [editing, setEditing] = useState<SmartCollection | 'new' | null>(null);
  const collections = useAsync(() => api().collections.list(), []);

  if (collections.error) {
    return <ErrorState error={collections.error} onRetry={collections.reload} />;
  }

  const items = collections.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <Section
        title={t('collections.title')}
        action={
          <Button size="sm" variant="secondary" icon={<Plus />} onClick={() => setEditing('new')}>
            {t('collections.new')}
          </Button>
        }
      >
        {items.length === 0 ? (
          <Panel>
            <EmptyState
              icon={<Sparkles />}
              title={t('empty.collections')}
              body={t('empty.collectionsBody')}
              action={
                <Button variant="primary" icon={<Plus />} onClick={() => setEditing('new')}>
                  {t('empty.collectionsAction')}
                </Button>
              }
            />
          </Panel>
        ) : (
          <div className="grid gap-2.5 lg:grid-cols-2">
            {items.map((collection) => (
              <Panel key={collection.id} interactive className="flex items-start gap-4 card-pad">
                <span
                  aria-hidden
                  className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/[0.06] bg-white/[0.02] text-brass-500/70"
                >
                  <Sparkles className="h-4 w-4" />
                </span>

                <div className="min-w-0 flex-1">
                  <Link
                    to={`/collection/${collection.id}`}
                    className="flex items-center gap-2 font-display text-[16px] text-paper-50 hover:text-brass-300"
                  >
                    {collection.name}
                    {collection.pinned && <Pin aria-hidden className="h-3 w-3 text-paper-600" />}
                  </Link>
                  {collection.description && (
                    <p className="mt-1 text-[12.5px] leading-relaxed text-paper-500">
                      {collection.description}
                    </p>
                  )}
                  <p className="mt-2.5 text-[11.5px] text-paper-600">
                    {t('collections.matching', {
                      count: formatNumber(collection.count ?? 0, locale),
                    })}{' '}
                    · {t('collections.rules', { count: collection.rules.length })}
                  </p>
                </div>

                <IconButton
                  label={t('collections.edit')}
                  size="sm"
                  onClick={() => setEditing(collection)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </IconButton>
              </Panel>
            ))}
          </div>
        )}
      </Section>

      <CollectionEditor
        collection={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          collections.reload();
        }}
      />
    </div>
  );
}

/* -------------------------------- notes tab ------------------------------ */

function NotesTab(): JSX.Element {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const notes = useAsync(() => api().notes.list(), []);

  if (notes.error) return <ErrorState error={notes.error} onRetry={notes.reload} />;

  const items = notes.data ?? [];

  if (items.length === 0) {
    return (
      <Panel>
        <EmptyState icon={<StickyNote />} title={t('empty.notes')} body={t('empty.notesBody')} />
      </Panel>
    );
  }

  const routeFor = (entityType: string, entityId: number): string => {
    if (entityType === 'track') return `/track/${entityId}`;
    if (entityType === 'artist') return `/artist/${entityId}`;
    if (entityType === 'album') return `/album/${entityId}`;
    return `/eras?era=${entityId}`;
  };

  return (
    <div className="flex flex-col gap-2.5">
      {items.map((note) => (
        <button
          key={note.id}
          type="button"
          onClick={() => navigate(routeFor(note.entityType, note.entityId))}
          className="text-left"
        >
          <Panel interactive className="card-pad">
            <div className="flex items-baseline justify-between gap-4">
              <p className="truncate font-display text-[15px] text-paper-100">{note.subject}</p>
              <span className="shrink-0 text-[11.5px] text-paper-600">
                {formatDate(note.updatedAt, locale, 'short')}
              </span>
            </div>
            {note.secondary && (
              <p className="mt-0.5 truncate text-[12px] text-paper-500">{note.secondary}</p>
            )}
            <p className="mt-3 whitespace-pre-wrap text-[13px] leading-relaxed text-paper-300">
              {note.body}
            </p>
          </Panel>
        </button>
      ))}
    </div>
  );
}
