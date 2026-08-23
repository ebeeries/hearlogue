import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Sparkles } from 'lucide-react';
import { Button, IconButton, Input, Panel, Segmented, Select, Switch, Textarea, cx } from '../../components/ui/primitives';
import { Modal, ConfirmDialog } from '../../components/ui/overlays';
import { Cover } from '../../components/domain/Cover';
import { useAsync, useAction, useDebounced } from '../../hooks/useAsync';
import { useI18n } from '../../i18n';
import { api } from '../../lib/api';
import { formatNumber } from '../../lib/format';
import type { SmartCollection, SmartRule, RuleField, RuleOperator } from '@shared/types/domain';

/**
 * The Smart Collection rule builder.
 *
 * Rules read as sentences ("Play count is more than 30") and the matching set is
 * previewed live as they are edited, so a rule can be tuned by seeing what it
 * catches rather than by reasoning about it.
 */

const FIELDS: RuleField[] = [
  'plays',
  'msPlayed',
  'firstHeardYear',
  'lastHeardYear',
  'daysSinceLastPlay',
  'lostFavoriteScore',
  'peakYear',
  'skipRate',
  'artist',
  'album',
  'tag',
  'favorite',
  'retired',
];

const NUMERIC_OPS: RuleOperator[] = ['gt', 'gte', 'lt', 'lte', 'eq', 'neq', 'between'];
const TEXT_OPS: RuleOperator[] = ['contains', 'notContains', 'eq', 'neq'];
const BOOLEAN_OPS: RuleOperator[] = ['isTrue', 'isFalse'];

function fieldType(field: RuleField): 'number' | 'text' | 'boolean' {
  if (field === 'artist' || field === 'album' || field === 'tag') return 'text';
  if (field === 'favorite' || field === 'retired') return 'boolean';
  return 'number';
}

function operatorsFor(field: RuleField): RuleOperator[] {
  const type = fieldType(field);
  if (type === 'text') return TEXT_OPS;
  if (type === 'boolean') return BOOLEAN_OPS;
  return NUMERIC_OPS;
}

const EMPTY_RULE: SmartRule = { field: 'plays', operator: 'gte', value: '20' };

export function CollectionEditor({
  collection,
  onClose,
  onSaved,
}: {
  collection: SmartCollection | 'new' | null;
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const { t, locale } = useI18n();
  const isNew = collection === 'new';
  const existing = collection !== 'new' && collection !== null ? collection : null;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [matchMode, setMatchMode] = useState<'all' | 'any'>('all');
  const [pinned, setPinned] = useState(false);
  const [rules, setRules] = useState<SmartRule[]>([EMPTY_RULE]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (collection === null) return;
    setName(existing?.name ?? '');
    setDescription(existing?.description ?? '');
    setMatchMode(existing?.matchMode ?? 'all');
    setPinned(existing?.pinned ?? false);
    setRules(
      existing && existing.rules.length > 0
        ? existing.rules.map((rule) => ({ ...rule }))
        : [{ ...EMPTY_RULE }],
    );
  }, [collection, existing]);

  const debouncedRules = useDebounced(rules, 400);
  const preview = useAsync(
    () => api().collections.preview({ rules: debouncedRules, matchMode, limit: 8 }),
    [debouncedRules, matchMode, collection],
    { enabled: collection !== null && debouncedRules.length > 0 },
  );

  const save = useAction(async () => {
    await api().collections.save({
      id: existing?.id ?? null,
      name: name.trim(),
      description: description.trim() || null,
      icon: 'Sparkles',
      matchMode,
      pinned,
      rules,
    });
    onSaved();
  });

  const remove = useAction(async () => {
    if (!existing) return;
    await api().collections.remove({ id: existing.id });
    onSaved();
  });

  const updateRule = (index: number, patch: Partial<SmartRule>): void => {
    setRules((current) =>
      current.map((rule, i) => {
        if (i !== index) return rule;
        const next = { ...rule, ...patch };
        // Switching field families invalidates the operator; pick a sane default.
        if (patch.field && !operatorsFor(patch.field).includes(next.operator)) {
          next.operator = operatorsFor(patch.field)[0];
        }
        return next;
      }),
    );
  };

  const valid = name.trim().length > 0 && rules.length > 0;

  return (
    <>
      <Modal
        open={collection !== null}
        onClose={onClose}
        title={isNew ? t('collections.new') : t('collections.edit')}
        size="lg"
        footer={
          <>
            {existing && (
              <Button variant="danger" icon={<Trash2 />} onClick={() => setConfirmDelete(true)} className="mr-auto">
                {t('common.delete')}
              </Button>
            )}
            <Button variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" loading={save.pending} disabled={!valid} onClick={() => void save.run()}>
              {t('collections.save')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="eyebrow mb-2 block" htmlFor="collection-name">
                {t('collections.name')}
              </label>
              <Input
                id="collection-name"
                value={name}
                autoFocus
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="flex items-end">
              <label className="flex w-full cursor-pointer items-center justify-between gap-3 pb-2 text-[13px] text-paper-300">
                {t('collections.pin')}
                <Switch checked={pinned} onChange={setPinned} label={t('collections.pin')} />
              </label>
            </div>
          </div>

          <div>
            <label className="eyebrow mb-2 block" htmlFor="collection-description">
              {t('collections.description')}
            </label>
            <Textarea
              id="collection-description"
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between">
              <p className="eyebrow">{t('collections.rules', { count: rules.length })}</p>
              <Segmented
                value={matchMode}
                onChange={setMatchMode}
                size="sm"
                options={[
                  { value: 'all', label: t('collections.matchAll') },
                  { value: 'any', label: t('collections.matchAny') },
                ]}
              />
            </div>

            <div className="flex flex-col gap-2">
              {rules.map((rule, index) => (
                <RuleRow
                  key={index}
                  rule={rule}
                  index={index}
                  matchMode={matchMode}
                  canRemove={rules.length > 1}
                  onChange={(patch) => updateRule(index, patch)}
                  onRemove={() => setRules((current) => current.filter((_, i) => i !== index))}
                />
              ))}
            </div>

            <Button
              size="sm"
              variant="ghost"
              icon={<Plus />}
              className="mt-2"
              onClick={() => setRules((current) => [...current, { ...EMPTY_RULE }])}
            >
              {t('collections.addRule')}
            </Button>
          </div>

          <div>
            <p className="eyebrow mb-2.5">{t('collections.preview')}</p>
            <Panel variant="inset" className="overflow-hidden">
              {preview.data && preview.data.total > 0 ? (
                <>
                  <p className="border-b border-white/[0.05] px-4 py-2.5 text-[12.5px] text-paper-400">
                    {t('collections.matching', {
                      count: formatNumber(preview.data.total, locale),
                    })}
                  </p>
                  {preview.data.items.slice(0, 6).map((track) => (
                    <div
                      key={track.id}
                      className="flex items-center gap-3 border-b border-white/[0.03] px-4 py-2 last:border-b-0"
                    >
                      <Cover name={track.name} secondary={track.artist} size="xs" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] text-paper-200">{track.name}</span>
                        <span className="block truncate text-[11px] text-paper-600">{track.artist}</span>
                      </span>
                      <span className="figure text-[11.5px] text-paper-500">
                        {formatNumber(track.qualifyingPlays, locale)}
                      </span>
                    </div>
                  ))}
                </>
              ) : (
                <p className="px-4 py-6 text-center text-[12.5px] text-paper-600">
                  {preview.loading ? t('common.loading') : t('collections.matching', { count: 0 })}
                </p>
              )}
            </Panel>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void remove.run()}
        title={t('collections.delete')}
        body={t('collections.deleteConfirm', { name: existing?.name ?? '' })}
        confirmLabel={t('common.delete')}
        tone="danger"
        pending={remove.pending}
      />
    </>
  );
}

function RuleRow({
  rule,
  index,
  matchMode,
  canRemove,
  onChange,
  onRemove,
}: {
  rule: SmartRule;
  index: number;
  matchMode: 'all' | 'any';
  canRemove: boolean;
  onChange: (patch: Partial<SmartRule>) => void;
  onRemove: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const type = fieldType(rule.field);
  const operators = useMemo(() => operatorsFor(rule.field), [rule.field]);

  return (
    <div className="flex items-center gap-2">
      <span className="w-10 shrink-0 text-right text-[11.5px] text-paper-600">
        {index === 0 ? '' : matchMode === 'all' ? t('rule.and') : t('collections.matchAny').split(' ')[1]}
      </span>

      <Select
        value={rule.field}
        onChange={(field) => onChange({ field: field as RuleField })}
        label={t('search.filter.kind')}
        className="w-44 shrink-0"
        options={FIELDS.map((field) => ({ value: field, label: t(`rule.field.${field}`) }))}
      />

      <Select
        value={rule.operator}
        onChange={(operator) => onChange({ operator: operator as RuleOperator })}
        label={t('rule.op.eq')}
        className="w-36 shrink-0"
        options={operators.map((operator) => ({ value: operator, label: t(`rule.op.${operator}`) }))}
      />

      {type !== 'boolean' && (
        <Input
          value={rule.value}
          onChange={(event) => onChange({ value: event.target.value })}
          type={type === 'number' ? 'number' : 'text'}
          className={cx(rule.operator === 'between' ? 'w-24' : 'flex-1')}
          aria-label={t(`rule.field.${rule.field}`)}
        />
      )}

      {rule.operator === 'between' && (
        <Input
          value={rule.value2 ?? ''}
          onChange={(event) => onChange({ value2: event.target.value })}
          type="number"
          className="w-24"
          aria-label={t(`rule.field.${rule.field}`)}
        />
      )}

      <IconButton
        label={t('collections.removeRule')}
        size="sm"
        tone="danger"
        disabled={!canRemove}
        onClick={onRemove}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </IconButton>
    </div>
  );
}

export { Sparkles };
