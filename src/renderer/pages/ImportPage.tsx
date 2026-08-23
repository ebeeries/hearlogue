import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  FileArchive,
  FolderOpen,
  Upload,
  X,
  ExternalLink,
  ShieldCheck,
  Check,
  AlertTriangle,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import { Button, IconButton, Panel, ProgressBar, cx } from '../components/ui/primitives';
import { useT, useI18n } from '../i18n';
import { useAppStore } from '../stores/app-store';
import { api, openSpotify } from '../lib/api';
import { formatNumber } from '../lib/format';
import { APP_NAME, TITLEBAR_HEIGHT } from '@shared/constants/app';
import type { ImportProgress } from '@shared/types/domain';

/**
 * The import wizard.
 *
 * Four steps, each doing one thing. Step three is the one that matters most:
 * a long import needs to feel like something is genuinely happening, so it shows
 * real counters climbing rather than an indeterminate bar, and the rotating
 * copy describes work actually in progress.
 */

type Step = 1 | 2 | 3 | 4;

const ROTATING_KEYS = [
  'import.rotating.1',
  'import.rotating.2',
  'import.rotating.3',
  'import.rotating.4',
  'import.rotating.5',
  'import.rotating.6',
  'import.rotating.7',
  'import.rotating.8',
];

export function ImportPage(): JSX.Element {
  const t = useT();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const isDemoSeeding = params.get('demo') === '1';

  const progress = useAppStore((s) => s.importProgress);
  const report = useAppStore((s) => s.importReport);
  const hasArchive = useAppStore((s) => s.state?.hasArchive ?? false);
  const refreshState = useAppStore((s) => s.refreshState);
  const toast = useAppStore((s) => s.toast);

  const [paths, setPaths] = useState<string[]>([]);
  const [step, setStep] = useState<Step>(isDemoSeeding ? 3 : 1);

  const running =
    progress !== null && !['complete', 'failed', 'cancelled', 'idle'].includes(progress.phase);

  // The wizard follows the import rather than the other way round: reopening
  // this page mid-import lands straight on the progress step.
  useEffect(() => {
    if (running) setStep(3);
    else if (progress?.phase === 'complete' && report) setStep(4);
  }, [running, progress?.phase, report]);

  useEffect(() => {
    if (progress?.phase === 'complete') void refreshState();
  }, [progress?.phase, refreshState]);

  const start = useCallback(async () => {
    if (paths.length === 0) return;
    try {
      await api().importer.start(paths);
      setStep(3);
    } catch {
      toast('error', 'error.unknown');
    }
  }, [paths, toast, ]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-ink-950">
      <header
        className="app-drag flex shrink-0 items-center justify-between px-5"
        style={{ height: TITLEBAR_HEIGHT, paddingRight: 150 }}
      >
        <span className="font-display text-[12px] tracking-[0.22em] text-paper-400">
          {APP_NAME}
        </span>
        {!running && (
          <IconButton
            label={t('common.close')}
            size="sm"
            className="app-no-drag"
            onClick={() => navigate(hasArchive ? '/archive' : '/welcome')}
          >
            <X className="h-4 w-4" />
          </IconButton>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-8 pb-16 pt-4">
        <div className="mx-auto w-full max-w-2xl">
          <StepIndicator step={step} />

          {step === 1 && <StepGetData onNext={() => setStep(2)} />}
          {step === 2 && (
            <StepDropFiles
              paths={paths}
              setPaths={setPaths}
              onBack={() => setStep(1)}
              onStart={() => void start()}
            />
          )}
          {step === 3 && <StepProcessing progress={progress} isDemo={isDemoSeeding} />}
          {step === 4 && <StepComplete />}
        </div>
      </div>
    </div>
  );
}

function StepIndicator({ step }: { step: Step }): JSX.Element {
  const t = useT();
  return (
    <div className="mb-9 flex items-center gap-3">
      <span className="eyebrow">{t('import.step', { current: step, total: 4 })}</span>
      <div className="flex flex-1 gap-1.5">
        {([1, 2, 3, 4] as Step[]).map((n) => (
          <span
            key={n}
            className={cx(
              'h-px flex-1 rounded-full transition-colors duration-500',
              n <= step ? 'bg-brass-500/70' : 'bg-white/[0.07]',
            )}
          />
        ))}
      </div>
    </div>
  );
}

/* --------------------------------- step 1 -------------------------------- */

function StepGetData({ onNext }: { onNext: () => void }): JSX.Element {
  const t = useT();

  return (
    <div className="animate-fade-up">
      <h1 className="font-display text-[27px] leading-tight text-paper-50">
        {t('import.step1.title')}
      </h1>
      <p className="mt-3 text-[14px] leading-relaxed text-paper-400">{t('import.step1.lead')}</p>

      <ol className="mt-8 flex flex-col gap-px overflow-hidden rounded-lg border border-white/[0.06] bg-white/[0.045]">
        {['how1', 'how2', 'how3', 'how4'].map((key, index) => (
          <li key={key} className="flex items-start gap-4 bg-ink-900 px-5 py-4">
            <span className="figure mt-px w-4 shrink-0 text-[13px] text-brass-400/80">
              {index + 1}
            </span>
            <span className="text-[13.5px] leading-relaxed text-paper-300">
              {t(`import.step1.${key}`)}
            </span>
          </li>
        ))}
      </ol>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          icon={<ExternalLink />}
          onClick={() => void openSpotify('https://www.spotify.com/account/privacy/')}
        >
          {t('import.step1.open')}
        </Button>
        <Button variant="primary" iconRight={<ArrowRight />} onClick={onNext}>
          {t('common.next')}
        </Button>
      </div>

      <p className="mt-8 text-[11.5px] leading-relaxed text-paper-600">
        {t('import.step1.disclaimer')}
      </p>
    </div>
  );
}

/* --------------------------------- step 2 -------------------------------- */

function StepDropFiles({
  paths,
  setPaths,
  onBack,
  onStart,
}: {
  paths: string[];
  setPaths: (paths: string[]) => void;
  onBack: () => void;
  onStart: () => void;
}): JSX.Element {
  const t = useT();
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  /**
   * Drag and drop.
   *
   * Electron exposes the real filesystem path on a dropped File, which is what
   * lets a ZIP be streamed from disk instead of read into the renderer. Browsers
   * do not, so the browse button is always available as the reliable route.
   */
  const onDrop = (event: React.DragEvent): void => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);

    const dropped: string[] = [];
    for (const file of Array.from(event.dataTransfer.files)) {
      const withPath = file as File & { path?: string };
      if (withPath.path) dropped.push(withPath.path);
    }
    if (dropped.length > 0) setPaths(dropped);
  };

  const pick = async (kind: 'files' | 'folder'): Promise<void> => {
    const selected =
      kind === 'files' ? await api().importer.pickFiles() : await api().importer.pickFolder();
    if (selected.length > 0) setPaths(selected);
  };

  return (
    <div className="animate-fade-up">
      <h1 className="font-display text-[27px] leading-tight text-paper-50">
        {t('import.step2.title')}
      </h1>
      <p className="mt-3 text-[14px] leading-relaxed text-paper-400">{t('import.step2.lead')}</p>

      <div
        onDragEnter={(event) => {
          event.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          dragDepth.current -= 1;
          if (dragDepth.current <= 0) setDragging(false);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
        className={cx(
          'mt-8 flex flex-col items-center justify-center rounded-xl border border-dashed px-8 py-16',
          'transition-all duration-200 ease-out',
          dragging
            ? 'border-brass-400/60 bg-brass-500/[0.07] shadow-glowBrass'
            : 'border-white/[0.11] bg-white/[0.012] hover:border-white/[0.18]',
        )}
      >
        <div
          aria-hidden
          className={cx(
            'flex h-14 w-14 items-center justify-center rounded-full border transition-all duration-200',
            dragging
              ? 'border-brass-400/40 bg-brass-500/15 text-brass-300'
              : 'border-white/[0.07] bg-white/[0.02] text-paper-500',
          )}
        >
          <Upload className="h-5 w-5" />
        </div>

        <p className="mt-5 font-display text-[17px] text-paper-100">{t('import.step2.drop')}</p>
        <p className="mt-1.5 text-[12.5px] text-paper-500">{t('import.step2.dropHint')}</p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <Button variant="secondary" icon={<FileArchive />} onClick={() => void pick('files')}>
            {t('import.step2.browse')}
          </Button>
          <Button variant="ghost" icon={<FolderOpen />} onClick={() => void pick('folder')}>
            {t('import.step2.folder')}
          </Button>
        </div>
      </div>

      {paths.length > 0 && (
        <Panel variant="flat" className="mt-4 animate-fade-up overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/[0.05] px-4 py-2.5">
            <span className="text-[12.5px] text-paper-300">
              {t('import.step2.selected', { count: paths.length })}
            </span>
            <Button size="sm" variant="quiet" onClick={() => setPaths([])}>
              {t('import.step2.clear')}
            </Button>
          </div>
          <ul className="max-h-40 overflow-y-auto">
            {paths.slice(0, 60).map((path) => (
              <li
                key={path}
                className="truncate px-4 py-1.5 font-mono text-[11.5px] text-paper-500"
                title={path}
              >
                {path}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="mt-7 flex items-center justify-between gap-3">
        <Button variant="ghost" onClick={onBack}>
          {t('common.back')}
        </Button>
        <Button
          variant="primary"
          size="lg"
          disabled={paths.length === 0}
          onClick={onStart}
          iconRight={<ArrowRight />}
        >
          {t('import.step2.begin')}
        </Button>
      </div>

      <p className="mt-6 flex items-center gap-2 text-[12px] text-paper-600">
        <ShieldCheck aria-hidden className="h-3.5 w-3.5 text-sage-500" />
        {t('onboarding.privacy')}
      </p>
    </div>
  );
}

/* --------------------------------- step 3 -------------------------------- */

function StepProcessing({
  progress,
  isDemo,
}: {
  progress: ImportProgress | null;
  isDemo: boolean;
}): JSX.Element {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const [rotatingIndex, setRotatingIndex] = useState(0);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setRotatingIndex((i) => (i + 1) % ROTATING_KEYS.length), 3400);
    return () => clearInterval(timer);
  }, []);

  const failed = progress?.phase === 'failed';
  const cancelled = progress?.phase === 'cancelled';

  const counters = useMemo(
    () => [
      { key: 'import.stat.events', value: progress?.eventsFound ?? 0 },
      { key: 'import.stat.artists', value: progress?.artists ?? 0 },
      { key: 'import.stat.tracks', value: progress?.tracks ?? 0 },
      { key: 'import.stat.albums', value: progress?.albums ?? 0 },
    ],
    [progress],
  );

  const years =
    progress?.yearsFrom && progress?.yearsTo
      ? progress.yearsTo - progress.yearsFrom + 1
      : 0;

  if (failed || cancelled) {
    return (
      <div className="animate-fade-up">
        <div
          aria-hidden
          className={cx(
            'flex h-12 w-12 items-center justify-center rounded-full',
            failed ? 'bg-ember-700/25 text-ember-400' : 'bg-white/[0.05] text-paper-400',
          )}
        >
          {failed ? <AlertTriangle className="h-5 w-5" /> : <X className="h-5 w-5" />}
        </div>
        <h1 className="mt-6 font-display text-[26px] text-paper-50">
          {t(failed ? 'import.failed' : 'import.cancelled')}
        </h1>
        <p className="mt-3 text-[14px] leading-relaxed text-paper-400">
          {failed && progress?.error
            ? t(progress.error.messageKey, progress.error.detail ? { detail: progress.error.detail } : undefined)
            : t('import.cancelledBody')}
        </p>
        <div className="mt-7 flex gap-2">
          <Button variant="primary" onClick={() => window.location.reload()}>
            {t('import.tryAgain')}
          </Button>
          <Button variant="ghost" onClick={() => navigate('/welcome')}>
            {t('common.back')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-up">
      <h1 className="font-display text-[27px] leading-tight text-paper-50">
        {isDemo ? t('demo.building') : t('import.step3.title')}
      </h1>

      <p className="mt-3 h-5 text-[14px] text-brass-300/90 transition-opacity duration-500">
        {progress?.phase === 'analytics' && progress.analyticsStep
          ? t(`import.analytics.${progress.analyticsStep}`)
          : t(ROTATING_KEYS[rotatingIndex])}
      </p>

      <ProgressBar value={progress?.progress ?? 0} className="mt-7" />

      <div className="mt-3 flex items-center justify-between text-[11.5px] text-paper-600">
        <span>
          {progress && progress.filesTotal > 0
            ? `${progress.filesDone} / ${progress.filesTotal} ${t('import.stat.files').toLowerCase()}`
            : ''}
        </span>
        <span className="figure">{Math.round((progress?.progress ?? 0) * 100)}%</span>
      </div>

      <div className="mt-9 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-white/[0.06] bg-white/[0.045] sm:grid-cols-4">
        {counters.map((counter) => (
          <div key={counter.key} className="bg-ink-900 px-4 py-5">
            <p className="eyebrow">{t(counter.key)}</p>
            <p className="figure mt-1.5 text-[23px] leading-none text-paper-50">
              {formatNumber(counter.value, locale)}
            </p>
          </div>
        ))}
      </div>

      {years > 0 && (
        <p className="mt-5 text-[13px] text-paper-400">
          {t('import.highlight.years', {
            years,
            from: progress?.yearsFrom ?? 0,
            to: progress?.yearsTo ?? 0,
          })}
        </p>
      )}

      {progress?.currentFile && (
        <p className="mt-5 truncate font-mono text-[11px] text-paper-600" title={progress.currentFile}>
          {progress.currentFile}
        </p>
      )}

      {!isDemo && (
        <div className="mt-9">
          <Button
            variant="ghost"
            loading={cancelling}
            onClick={() => {
              setCancelling(true);
              void api().importer.cancel();
            }}
          >
            {t('import.cancel')}
          </Button>
        </div>
      )}
    </div>
  );
}

/* --------------------------------- step 4 -------------------------------- */

function StepComplete(): JSX.Element {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const report = useAppStore((s) => s.importReport);
  const isDemo = useAppStore((s) => s.state?.isDemo ?? false);

  if (!report) {
    return (
      <div className="animate-fade-up">
        <h1 className="font-display text-[27px] text-paper-50">{t('import.step4.title')}</h1>
        <Button variant="primary" size="lg" className="mt-8" onClick={() => navigate('/archive')}>
          {t('import.openArchive')}
        </Button>
      </div>
    );
  }

  return (
    <div className="animate-fade-up">
      <div
        aria-hidden
        className="flex h-12 w-12 items-center justify-center rounded-full bg-brass-500/15 text-brass-300"
      >
        <Check className="h-5 w-5" />
      </div>

      <h1 className="mt-6 font-display text-[30px] leading-tight text-paper-50">
        {t('import.step4.title')}
      </h1>

      {/* The payoff: real findings, stated plainly, before any statistics. */}
      <ul className="mt-8 flex flex-col gap-px overflow-hidden rounded-lg border border-white/[0.06] bg-white/[0.045]">
        {report.highlights.map((highlight) => (
          <li key={highlight.key} className="flex items-start gap-3.5 bg-ink-900 px-5 py-4">
            <Sparkles aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brass-400/70" />
            <span className="text-[14px] leading-relaxed text-paper-200">
              {t(highlight.key, highlight.values)}
            </span>
          </li>
        ))}
      </ul>

      <Panel variant="flat" className="mt-5 p-5">
        <p className="eyebrow mb-3">{t('import.report.title')}</p>
        <div className="flex flex-col gap-1.5 text-[12.5px] text-paper-400">
          <ReportLine text={t('import.report.existing', { count: formatNumber(report.existingBefore, locale) })} />
          <ReportLine
            text={t('import.report.inserted', { count: formatNumber(report.eventsInserted, locale) })}
            emphasis
          />
          <ReportLine text={t('import.report.duplicates', { count: formatNumber(report.eventsDuplicate, locale) })} />
          {report.eventsInvalid > 0 && (
            <ReportLine text={t('import.report.invalid', { count: formatNumber(report.eventsInvalid, locale) })} />
          )}
          {report.filesSkipped > 0 && (
            <ReportLine text={t('import.report.skippedFiles', { count: report.filesSkipped })} />
          )}
          <ReportLine text={t('import.report.duration', { seconds: (report.durationMs / 1000).toFixed(1) })} />
        </div>
      </Panel>

      <div className="mt-8 flex items-center gap-3">
        <Button
          variant="primary"
          size="lg"
          iconRight={<ArrowRight />}
          onClick={() => navigate('/archive')}
        >
          {t('import.openArchive')}
        </Button>
        {!isDemo && (
          <Button variant="ghost" onClick={() => navigate('/lost-favorites')}>
            {t('nav.lostFavorites')}
          </Button>
        )}
      </div>
    </div>
  );
}

function ReportLine({ text, emphasis }: { text: string; emphasis?: boolean }): JSX.Element {
  return (
    <p className={cx('flex items-baseline gap-2', emphasis && 'text-paper-100')}>
      <span aria-hidden className="text-paper-600">
        ·
      </span>
      {text}
    </p>
  );
}
