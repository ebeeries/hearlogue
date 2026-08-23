import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Sparkles, Pencil } from 'lucide-react';
import { PageHeader } from '../layouts/PageHeader';
import { Badge, Button, Panel } from '../components/ui/primitives';
import { EmptyState, ErrorState, PageSkeleton, SkeletonRows } from '../components/ui/states';
import { TrackRow } from '../components/domain/rows';
import { CollectionEditor } from '../features/collections/CollectionEditor';
import { useAsync } from '../hooks/useAsync';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { formatNumber } from '../lib/format';

/**
 * A Smart Collection's contents.
 *
 * The rules are restated as chips at the top, so it is always obvious why a
 * track is in the list — a collection whose membership you cannot explain is not
 * useful.
 */

const PAGE_SIZE = 50;

export function CollectionDetailPage(): JSX.Element {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const collectionId = Number(id);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [editing, setEditing] = useState(false);

  const collection = useAsync(() => api().collections.get({ id: collectionId }), [collectionId], {
    enabled: Number.isFinite(collectionId) && collectionId > 0,
  });

  const tracks = useAsync(
    () => api().collections.tracks({ id: collectionId, limit, offset: 0 }),
    [collectionId, limit, collection.data?.updatedAt],
    { enabled: Number.isFinite(collectionId) && collectionId > 0 },
  );

  if (collection.initial && collection.loading) return <PageSkeleton />;
  if (collection.error) return <ErrorState error={collection.error} onRetry={collection.reload} />;
  if (!collection.data) return <PageSkeleton />;

  const data = collection.data;
  const items = tracks.data?.items ?? [];

  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        backTo={{ to: '/library', label: t('library.collections') }}
        eyebrow={t('collections.title')}
        title={data.name}
        description={data.description ?? undefined}
        actions={
          <Button variant="secondary" icon={<Pencil />} onClick={() => setEditing(true)}>
            {t('common.edit')}
          </Button>
        }
        meta={
          <div className="flex flex-wrap items-center gap-2">
            {data.rules.map((rule, index) => (
              <Badge key={index} tone="neutral">
                {t(`rule.field.${rule.field}`)} {t(`rule.op.${rule.operator}`)}{' '}
                {rule.operator === 'isTrue' || rule.operator === 'isFalse'
                  ? ''
                  : rule.operator === 'between'
                    ? `${rule.value} – ${rule.value2 ?? ''}`
                    : rule.value}
              </Badge>
            ))}
          </div>
        }
      />

      {tracks.error && <ErrorState error={tracks.error} onRetry={tracks.reload} />}
      {tracks.initial && tracks.loading && <SkeletonRows rows={8} height="h-14" />}

      {!tracks.loading && items.length === 0 && (
        <Panel>
          <EmptyState
            icon={<Sparkles />}
            title={t('collections.matching', { count: 0 })}
            body={t('empty.collectionsBody')}
            action={
              <Button variant="secondary" onClick={() => setEditing(true)}>
                {t('common.edit')}
              </Button>
            }
          />
        </Panel>
      )}

      {items.length > 0 && (
        <>
          <p className="text-[12.5px] text-paper-500">
            {t('collections.matching', { count: formatNumber(tracks.data?.total ?? 0, locale) })}
          </p>
          <Panel className="py-2">
            {items.map((track, index) => (
              <TrackRow key={track.id} track={track} index={index + 1} dense />
            ))}
          </Panel>
        </>
      )}

      {tracks.data && items.length < tracks.data.total && (
        <div className="flex justify-center">
          <Button variant="secondary" loading={tracks.loading} onClick={() => setLimit((l) => l + PAGE_SIZE)}>
            {t('library.loadMore')}
          </Button>
        </div>
      )}

      <CollectionEditor
        collection={editing ? data : null}
        onClose={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          void collection.reload();
          void tracks.reload();
          // Deleting from the editor leaves nothing to show here.
          void api()
            .collections.get({ id: collectionId })
            .catch(() => navigate('/library'));
        }}
      />
    </div>
  );
}
