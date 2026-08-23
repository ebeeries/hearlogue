import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Settings as SettingsIcon,
  Palette,
  Database,
  ShieldCheck,
  BarChart3,
  Wrench,
  Info,
  FolderOpen,
  Import,
  RefreshCw,
  Save,
  Upload,
  FileDown,
  Trash2,
  Stethoscope,
  ScrollText,
  Check,
  AlertTriangle,
  WifiOff,
} from 'lucide-react';
import { PageHeader } from '../layouts/PageHeader';
import {
  Button,
  Input,
  Panel,
  Section,
  Select,
  Switch,
  cx,
} from '../components/ui/primitives';
import { ConfirmDialog } from '../components/ui/overlays';
import { ErrorState } from '../components/ui/states';
import { useAsync, useAction } from '../hooks/useAsync';
import { useI18n } from '../i18n';
import { useAppStore } from '../stores/app-store';
import { api } from '../lib/api';
import { SHORTCUTS } from '../hooks/useShortcuts';
import { formatNumber, formatDate, formatDateTime } from '../lib/format';
import { APP_NAME } from '@shared/constants/app';
import type { AppSettings, IntegrityReport } from '@shared/types/domain';

/**
 * Settings.
 *
 * Sectioned rather than tabbed, with a sticky index on the left, because several
 * of these settings are ones a person arrives at from a link ("open the privacy
 * section") and deep-linking into a tab is fiddlier than scrolling to an anchor.
 */

type SectionKey =
  | 'general'
  | 'appearance'
  | 'data'
  | 'privacy'
  | 'analytics'
  | 'advanced'
  | 'about';

const SECTIONS: { key: SectionKey; icon: typeof SettingsIcon }[] = [
  { key: 'general', icon: SettingsIcon },
  { key: 'appearance', icon: Palette },
  { key: 'data', icon: Database },
  { key: 'privacy', icon: ShieldCheck },
  { key: 'analytics', icon: BarChart3 },
  { key: 'advanced', icon: Wrench },
  { key: 'about', icon: Info },
];

export function SettingsPage(): JSX.Element {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const target = params.get('section') as SectionKey | null;

  useEffect(() => {
    if (!target) return;
    const timer = setTimeout(() => {
      document.getElementById(`settings-${target}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
    return () => clearTimeout(timer);
  }, [target]);

  return (
    <div className="flex flex-col gap-7">
      <PageHeader eyebrow={t('nav.settings')} title={t('settings.title')} />

      <div className="flex gap-10">
        <nav className="sticky top-4 hidden h-fit w-44 shrink-0 flex-col gap-0.5 lg:flex">
          {SECTIONS.map((section) => {
            const Icon = section.icon;
            return (
              <a
                key={section.key}
                href={`#settings-${section.key}`}
                className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[12.5px] text-paper-500 transition-colors hover:bg-white/[0.03] hover:text-paper-100"
              >
                <Icon aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />
                {t(`settings.section.${section.key}`)}
              </a>
            );
          })}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col stack-gap">
          <GeneralSection />
          <AppearanceSection />
          <DataSection />
          <PrivacySection />
          <AnalyticsSection />
          <AdvancedSection />
          <AboutSection />
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- helpers -------------------------------- */

function Row({
  label,
  hint,
  children,
  danger,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  danger?: boolean;
}): JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.045] px-5 py-4 last:border-b-0">
      <div className="min-w-0 max-w-md">
        <p className={cx('text-[13.5px]', danger ? 'text-ember-400' : 'text-paper-100')}>{label}</p>
        {hint && <p className="mt-1 text-[12px] leading-relaxed text-paper-500">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function SettingsSection({
  id,
  title,
  children,
  description,
}: {
  id: SectionKey;
  title: string;
  children: React.ReactNode;
  description?: string;
}): JSX.Element {
  return (
    <Section id={`settings-${id}`} title={title} description={description} eyebrow={undefined}>
      <Panel className="overflow-hidden">{children}</Panel>
    </Section>
  );
}

function useSetting<K extends keyof AppSettings>(key: K): [AppSettings[K], (value: AppSettings[K]) => void] {
  const value = useAppStore((s) => s.settings[key]);
  const patch = useAppStore((s) => s.patchSettings);
  return [value, (next) => void patch({ [key]: next } as Partial<AppSettings>)];
}

/* -------------------------------- sections ------------------------------- */

function GeneralSection(): JSX.Element {
  const { t } = useI18n();
  const [language, setLanguage] = useSetting('language');
  const [startup, setStartup] = useSetting('startupBehavior');

  return (
    <SettingsSection id="general" title={t('settings.section.general')}>
      <Row label={t('settings.language')}>
        <Select
          value={language}
          onChange={setLanguage}
          label={t('settings.language')}
          className="w-44"
          options={[
            { value: 'en', label: t('settings.language.en') },
            { value: 'el', label: t('settings.language.el') },
          ]}
        />
      </Row>

      <Row label={t('settings.startup')}>
        <Select
          value={startup}
          onChange={setStartup}
          label={t('settings.startup')}
          className="w-44"
          options={[
            { value: 'archive', label: t('settings.startup.archive') },
            { value: 'lastVisited', label: t('settings.startup.lastVisited') },
            { value: 'rewind', label: t('settings.startup.rewind') },
          ]}
        />
      </Row>

      <div className="px-5 py-4">
        <p className="mb-3 text-[13.5px] text-paper-100">{t('settings.shortcuts')}</p>
        <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
          {SHORTCUTS.map((shortcut) => (
            <div key={shortcut.keys} className="flex items-center justify-between gap-4">
              <span className="text-[12.5px] text-paper-400">{t(shortcut.labelKey)}</span>
              <kbd className="rounded border border-white/[0.08] bg-black/25 px-2 py-0.5 font-mono text-[11px] text-paper-300">
                {shortcut.keys}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </SettingsSection>
  );
}

function AppearanceSection(): JSX.Element {
  const { t } = useI18n();
  const [density, setDensity] = useSetting('density');
  const [reducedMotion, setReducedMotion] = useSetting('reducedMotion');
  const [sidebarCollapsed, setSidebarCollapsed] = useSetting('sidebarCollapsed');

  return (
    <SettingsSection id="appearance" title={t('settings.section.appearance')}>
      <Row label={t('settings.density')}>
        <Select
          value={density}
          onChange={setDensity}
          label={t('settings.density')}
          className="w-44"
          options={[
            { value: 'comfortable', label: t('settings.density.comfortable') },
            { value: 'compact', label: t('settings.density.compact') },
          ]}
        />
      </Row>
      <Row label={t('settings.motion')} hint={t('settings.motionHint')}>
        <Switch checked={reducedMotion} onChange={setReducedMotion} label={t('settings.motion')} />
      </Row>
      <Row label={t('settings.sidebar')}>
        <Switch
          checked={sidebarCollapsed}
          onChange={setSidebarCollapsed}
          label={t('settings.sidebar')}
        />
      </Row>
    </SettingsSection>
  );
}

function DataSection(): JSX.Element {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const info = useAppStore((s) => s.info);
  const toast = useAppStore((s) => s.toast);
  const setArchiveState = useAppStore((s) => s.setArchiveState);
  const [restoreTarget, setRestoreTarget] = useState<{ path: string; date: number; events: number } | null>(null);

  const history = useAsync(() => api().importer.history(), []);

  const backup = useAction(async () => {
    const result = await api().data.backup();
    if (result) toast('success', 'share.saved', { path: result.path });
  });

  const pickRestore = useAction(async () => {
    const picked = await api().data.pickRestore();
    if (picked) {
      setRestoreTarget({
        path: picked.path,
        date: picked.manifest.createdAt,
        events: picked.manifest.eventCount,
      });
    }
  });

  const restore = useAction(async (path: string) => {
    const result = await api().data.restore({ path });
    setRestoreTarget(null);
    toast('success', 'common.saved');
    setArchiveState(await api().app.state());
    history.reload();
    return result;
  });

  const exportCsv = useAction(async () => {
    const result = await api().data.exportCsv();
    if (result) toast('success', 'settings.exported', { rows: formatNumber(result.rows, locale) });
  });

  return (
    <SettingsSection id="data" title={t('settings.section.data')}>
      <Row label={t('settings.databaseLocation')} hint={info?.databasePath}>
        <Button
          size="sm"
          variant="secondary"
          icon={<FolderOpen />}
          onClick={() => void api().data.revealDatabase()}
        >
          {t('settings.reveal')}
        </Button>
      </Row>

      <Row label={t('settings.importMore')} hint={t('settings.importMoreHint')}>
        <Button size="sm" variant="secondary" icon={<Import />} onClick={() => navigate('/import')}>
          {t('onboarding.import')}
        </Button>
      </Row>

      <Row label={t('settings.backup')} hint={t('settings.backupHint')}>
        <Button size="sm" variant="secondary" icon={<Save />} loading={backup.pending} onClick={() => void backup.run()}>
          {t('settings.backup')}
        </Button>
      </Row>

      <Row label={t('settings.restore')} hint={t('settings.restoreHint')}>
        <Button
          size="sm"
          variant="secondary"
          icon={<Upload />}
          loading={pickRestore.pending}
          onClick={() => void pickRestore.run()}
        >
          {t('settings.restore')}
        </Button>
      </Row>

      <Row label={t('settings.export')} hint={t('settings.exportHint')}>
        <Button
          size="sm"
          variant="secondary"
          icon={<FileDown />}
          loading={exportCsv.pending}
          onClick={() => void exportCsv.run()}
        >
          {t('settings.export')}
        </Button>
      </Row>

      {(history.data ?? []).length > 0 && (
        <div className="px-5 py-4">
          <p className="mb-3 text-[13.5px] text-paper-100">{t('settings.importHistory')}</p>
          <div className="flex flex-col gap-1.5">
            {(history.data ?? []).slice(0, 6).map((entry) => (
              <div
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-black/20 px-3 py-2"
              >
                <span className="text-[12.5px] text-paper-300">{entry.sourceName}</span>
                <span className="flex items-center gap-4 text-[11.5px] text-paper-600">
                  <span>{formatDateTime(entry.startedAt, locale)}</span>
                  <span className="figure">+{formatNumber(entry.eventsInserted, locale)}</span>
                  <span
                    className={cx(
                      'rounded px-1.5 py-px text-2xs uppercase tracking-wider',
                      entry.status === 'complete'
                        ? 'bg-sage-700/30 text-sage-400'
                        : entry.status === 'running'
                          ? 'bg-white/[0.06] text-paper-400'
                          : 'bg-ember-700/25 text-ember-400',
                    )}
                  >
                    {entry.status}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={restoreTarget !== null}
        onClose={() => setRestoreTarget(null)}
        onConfirm={() => {
          if (restoreTarget) void restore.run(restoreTarget.path);
        }}
        title={t('settings.restore')}
        body={t('settings.restoreConfirm', {
          date: restoreTarget ? formatDate(restoreTarget.date, locale) : '',
          events: restoreTarget ? formatNumber(restoreTarget.events, locale) : '',
        })}
        confirmLabel={t('settings.restore')}
        pending={restore.pending}
      />
    </SettingsSection>
  );
}

function PrivacySection(): JSX.Element {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const state = useAppStore((s) => s.state);
  const setArchiveState = useAppStore((s) => s.setArchiveState);
  const isDemo = useAppStore((s) => s.state?.isDemo ?? false);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');

  const deleteArchive = useAction(async () => {
    const next = await api().data.deleteArchive();
    setArchiveState(next);
    setConfirming(false);
    setTyped('');
    navigate('/welcome');
  });

  return (
    <Section id="settings-privacy" title={t('settings.section.privacy')}>
      <Panel className="overflow-hidden">
        <div className="border-b border-white/[0.045] px-5 py-5">
          <div className="flex items-start gap-3.5">
            <WifiOff aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-sage-400" />
            <div>
              <p className="font-display text-[16px] text-paper-50">
                {t('settings.privacy.headline')}
              </p>
              <p className="mt-2.5 max-w-2xl text-[13px] leading-relaxed text-paper-400">
                {t('settings.privacy.body')}
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-px bg-white/[0.045] sm:grid-cols-2">
          <div className="bg-ink-850 px-5 py-4">
            <p className="eyebrow mb-2 text-sage-400">{t('settings.privacy.stored')}</p>
            <p className="text-[12.5px] leading-relaxed text-paper-400">
              {t('settings.privacy.storedList')}
            </p>
          </div>
          <div className="bg-ink-850 px-5 py-4">
            <p className="eyebrow mb-2 text-ember-400">{t('settings.privacy.discarded')}</p>
            <p className="text-[12.5px] leading-relaxed text-paper-400">
              {t('settings.privacy.discardedList')}
            </p>
          </div>
        </div>

        <Row label={t('settings.privacy.notes')} hint={t('settings.privacy.notesBody')}>
          <span />
        </Row>

        <Row
          label={t('settings.privacy.delete')}
          hint={t('settings.privacy.deleteHint')}
          danger
        >
          <Button
            size="sm"
            variant="danger"
            icon={<Trash2 />}
            disabled={isDemo}
            onClick={() => setConfirming(true)}
          >
            {t('common.delete')}
          </Button>
        </Row>
      </Panel>

      <ConfirmDialog
        open={confirming}
        onClose={() => {
          setConfirming(false);
          setTyped('');
        }}
        onConfirm={() => void deleteArchive.run()}
        title={t('settings.privacy.deleteConfirm')}
        body={t('settings.privacy.deleteBody', {
          events: formatNumber(state?.eventCount ?? 0, locale),
        })}
        confirmLabel={t('settings.privacy.deleteAction')}
        tone="danger"
        pending={deleteArchive.pending}
        confirmDisabled={typed.trim().toUpperCase() !== 'DELETE'}
      >
        {/* Typing the word is deliberate friction: this is unrecoverable. */}
        <label className="eyebrow mb-2 block" htmlFor="delete-confirm">
          {t('settings.privacy.deleteTypeToConfirm')}
        </label>
        <Input
          id="delete-confirm"
          value={typed}
          autoFocus
          autoComplete="off"
          onChange={(event) => setTyped(event.target.value)}
        />
      </ConfirmDialog>
    </Section>
  );
}

function AnalyticsSection(): JSX.Element {
  const { t } = useI18n();
  const toast = useAppStore((s) => s.toast);
  const setArchiveState = useAppStore((s) => s.setArchiveState);
  const stale = useAppStore((s) => s.state?.analyticsStale ?? false);

  const [qualifying, setQualifying] = useSetting('qualifyingPlayMs');
  const [gap, setGap] = useSetting('sessionGapMinutes');
  const [privateSessions, setPrivateSessions] = useSetting('includePrivateSessions');
  const [dormancy, setDormancy] = useSetting('dormancyDays');
  const [autoRebuild, setAutoRebuild] = useSetting('analyticsAutoRebuild');

  const rebuild = useAction(async () => {
    const next = await api().importer.rebuildAnalytics();
    setArchiveState(next);
    toast('success', 'common.saved');
  });

  // With auto-rebuild on, a threshold change recomputes without being asked.
  useEffect(() => {
    if (!stale || !autoRebuild || rebuild.pending) return;
    const timer = setTimeout(() => void rebuild.run(), 900);
    return () => clearTimeout(timer);
  }, [stale, autoRebuild, rebuild]);

  return (
    <SettingsSection id="analytics" title={t('settings.section.analytics')}>
      {stale && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-brass-600/25 bg-brass-900/25 px-5 py-3">
          <span className="flex items-center gap-2.5 text-[12.5px] text-brass-300">
            <AlertTriangle aria-hidden className="h-3.5 w-3.5" />
            {t('settings.staleWarning')}
          </span>
          <Button
            size="sm"
            variant="primary"
            icon={<RefreshCw />}
            loading={rebuild.pending}
            onClick={() => void rebuild.run()}
          >
            {t('settings.rebuildNow')}
          </Button>
        </div>
      )}

      <Row label={t('settings.qualifyingPlay')} hint={t('settings.qualifyingPlayHint')}>
        <Select
          value={qualifying}
          numeric
          onChange={setQualifying}
          label={t('settings.qualifyingPlay')}
          className="w-40"
          options={[5000, 10000, 15000, 30000, 45000, 60000].map((ms) => ({
            value: ms,
            label: t('settings.seconds', { count: ms / 1000 }),
          }))}
        />
      </Row>

      <Row label={t('settings.sessionGap')} hint={t('settings.sessionGapHint')}>
        <Select
          value={gap}
          numeric
          onChange={setGap}
          label={t('settings.sessionGap')}
          className="w-40"
          options={[10, 15, 20, 30, 45, 60, 120].map((minutes) => ({
            value: minutes,
            label: t('settings.minutes', { count: minutes }),
          }))}
        />
      </Row>

      <Row label={t('settings.dormancy')} hint={t('settings.dormancyHint')}>
        <Select
          value={dormancy}
          numeric
          onChange={setDormancy}
          label={t('settings.dormancy')}
          className="w-40"
          options={[180, 365, 545, 730, 1095, 1825].map((days) => ({
            value: days,
            label: t('settings.days', { count: days }),
          }))}
        />
      </Row>

      <Row label={t('settings.privateSessions')} hint={t('settings.privateSessionsHint')}>
        <Switch
          checked={privateSessions}
          onChange={setPrivateSessions}
          label={t('settings.privateSessions')}
        />
      </Row>

      <Row label={t('settings.autoRebuild')} hint={t('settings.autoRebuildHint')}>
        <Switch checked={autoRebuild} onChange={setAutoRebuild} label={t('settings.autoRebuild')} />
      </Row>

      <Row label={t('settings.rebuild')} hint={t('settings.rebuildHint')}>
        <Button
          size="sm"
          variant="secondary"
          icon={<RefreshCw />}
          loading={rebuild.pending}
          onClick={() => void rebuild.run()}
        >
          {rebuild.pending ? t('settings.rebuilding') : t('settings.rebuild')}
        </Button>
      </Row>
    </SettingsSection>
  );
}

function AdvancedSection(): JSX.Element {
  const { t, locale } = useI18n();
  const toast = useAppStore((s) => s.toast);
  const setArchiveState = useAppStore((s) => s.setArchiveState);
  const [report, setReport] = useState<IntegrityReport | null>(null);

  const check = useAction(async () => {
    setReport(await api().data.integrity());
  });

  const resetDerived = useAction(async () => {
    setArchiveState(await api().data.resetDerived());
    toast('success', 'common.saved');
  });

  const sizeLabel = useMemo(() => {
    if (!report) return null;
    const mb = report.sizeBytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  }, [report]);

  return (
    <SettingsSection id="advanced" title={t('settings.section.advanced')}>
      <Row label={t('settings.openLogs')} hint={t('settings.openLogsHint')}>
        <Button size="sm" variant="secondary" icon={<ScrollText />} onClick={() => void api().system.openLogs()}>
          {t('settings.openLogs')}
        </Button>
      </Row>

      <Row label={t('settings.integrity')} hint={t('settings.integrityHint')}>
        <Button
          size="sm"
          variant="secondary"
          icon={<Stethoscope />}
          loading={check.pending}
          onClick={() => void check.run()}
        >
          {t('settings.integrity')}
        </Button>
      </Row>

      {report && (
        <div className="border-b border-white/[0.045] bg-black/20 px-5 py-4">
          <p
            className={cx(
              'mb-3 flex items-center gap-2 text-[13px]',
              report.ok ? 'text-sage-400' : 'text-ember-400',
            )}
          >
            {report.ok ? (
              <Check aria-hidden className="h-3.5 w-3.5" />
            ) : (
              <AlertTriangle aria-hidden className="h-3.5 w-3.5" />
            )}
            {t(report.ok ? 'settings.integrityOk' : 'settings.integrityFailed')}
          </p>
          <div className="flex flex-col gap-1">
            {report.checks.map((item) => (
              <div key={item.name} className="flex items-center justify-between gap-4 text-[12px]">
                <span className="font-mono text-paper-500">{item.name}</span>
                <span className={cx('truncate', item.ok ? 'text-paper-400' : 'text-ember-400')}>
                  {item.detail}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11.5px] text-paper-600">
            {t('settings.databaseSize')}: {sizeLabel} ·{' '}
            {t('settings.pages', {
              count: formatNumber(report.pageCount, locale),
              free: formatNumber(report.freePages, locale),
            })}
          </p>
        </div>
      )}

      <Row label={t('settings.resetDerived')} hint={t('settings.resetDerivedHint')}>
        <Button
          size="sm"
          variant="secondary"
          loading={resetDerived.pending}
          onClick={() => void resetDerived.run()}
        >
          {t('settings.resetDerived')}
        </Button>
      </Row>

      {check.error && <ErrorState error={check.error} className="m-5" />}
    </SettingsSection>
  );
}

function AboutSection(): JSX.Element {
  const { t } = useI18n();
  const info = useAppStore((s) => s.info);

  return (
    <SettingsSection id="about" title={t('settings.section.about')}>
      <div className="px-5 py-5">
        <p className="font-display text-[18px] tracking-[0.2em] text-paper-100">{APP_NAME}</p>
        <p className="mt-1.5 text-[13px] italic text-paper-500">{t('app.tagline')}</p>
        <p className="mt-4 max-w-2xl text-[13px] leading-relaxed text-paper-400">
          {t('settings.about.body')}
        </p>
      </div>

      <Row label={t('settings.version')}>
        <span className="figure text-[13px] text-paper-300">{info?.version ?? '—'}</span>
      </Row>
      <Row label={t('settings.electron')}>
        <span className="figure text-[13px] text-paper-300">
          {info ? `${info.electron} · Chromium ${info.chrome}` : '—'}
        </span>
      </Row>

      <div className="px-5 py-4">
        <p className="text-[13.5px] text-paper-100">{t('settings.licenses')}</p>
        <p className="mt-1.5 max-w-2xl text-[12px] leading-relaxed text-paper-500">
          {t('settings.licensesBody')}
        </p>
      </div>
    </SettingsSection>
  );
}
