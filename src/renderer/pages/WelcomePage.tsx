import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Import, FlaskConical, ShieldCheck, WifiOff, UserX, HardDrive } from 'lucide-react';
import { Button, cx } from '../components/ui/primitives';
import { useT } from '../i18n';
import { useAppStore } from '../stores/app-store';
import { api } from '../lib/api';
import { APP_NAME, APP_TAGLINE, APP_DESCRIPTION, TITLEBAR_HEIGHT } from '@shared/constants/app';

/**
 * First run.
 *
 * The whole screen has one job: make the product's promise legible in about four
 * seconds, and make the privacy position impossible to miss. Everything below
 * the fold is reassurance, not features.
 */

export function WelcomePage(): JSX.Element {
  const t = useT();
  const navigate = useNavigate();
  const setArchiveState = useAppStore((s) => s.setArchiveState);
  const setImportProgress = useAppStore((s) => s.setImportProgress);
  const toast = useAppStore((s) => s.toast);
  const [starting, setStarting] = useState<'demo' | null>(null);

  const startDemo = async (): Promise<void> => {
    setStarting('demo');
    try {
      const result = await api().demo.enable();
      setArchiveState(result.state);
      if (result.seeding) {
        const status = await api().importer.status();
        setImportProgress(status.progress);
        navigate('/import?demo=1');
      } else {
        navigate('/archive');
      }
    } catch {
      toast('error', 'error.unknown');
      setStarting(null);
    }
  };

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-ink-950">
      <div className="app-drag shrink-0" style={{ height: TITLEBAR_HEIGHT }} />

      {/* A single warm pool of light behind the wordmark, nothing more. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-[560px] w-[860px] -translate-x-1/2 -translate-y-1/3 opacity-[0.42]"
        style={{
          background:
            'radial-gradient(closest-side, rgba(214,176,106,0.16), rgba(214,176,106,0.03) 55%, transparent 78%)',
        }}
      />

      <div className="relative flex flex-1 items-center justify-center overflow-y-auto px-8 py-10">
        <div className="w-full max-w-3xl">
          <header className="animate-fade-up text-center">
            <h1 className="font-display text-[46px] leading-none tracking-[0.14em] text-paper-50">
              {APP_NAME}
            </h1>
            <p className="mt-5 font-display text-[19px] italic text-brass-300">{APP_TAGLINE}</p>
            <p className="mx-auto mt-6 max-w-lg text-[14.5px] leading-relaxed text-paper-400">
              {APP_DESCRIPTION}
            </p>
          </header>

          <div
            className="mt-11 flex animate-fade-up flex-col items-center gap-3 sm:flex-row sm:justify-center"
            style={{ animationDelay: '90ms' }}
          >
            <Button
              size="lg"
              variant="primary"
              icon={<Import />}
              onClick={() => navigate('/import')}
              className="w-full sm:w-auto"
            >
              {t('onboarding.import')}
            </Button>
            <Button
              size="lg"
              variant="secondary"
              icon={<FlaskConical />}
              loading={starting === 'demo'}
              onClick={() => void startDemo()}
              className="w-full sm:w-auto"
            >
              {t('onboarding.demo')}
            </Button>
          </div>

          <p
            className="mt-6 flex animate-fade-up items-center justify-center gap-2 text-[12.5px] text-paper-500"
            style={{ animationDelay: '150ms' }}
          >
            <ShieldCheck aria-hidden className="h-3.5 w-3.5 text-sage-500" />
            {t('onboarding.privacy')}
          </p>

          <div
            className="mt-16 grid animate-fade-up gap-px overflow-hidden rounded-lg border border-white/[0.06] bg-white/[0.045] sm:grid-cols-3"
            style={{ animationDelay: '220ms' }}
          >
            <Promise
              icon={<HardDrive className="h-4 w-4" />}
              title={t('onboarding.point.local')}
              body={t('onboarding.point.localBody')}
            />
            <Promise
              icon={<UserX className="h-4 w-4" />}
              title={t('onboarding.point.noAccount')}
              body={t('onboarding.point.noAccountBody')}
            />
            <Promise
              icon={<WifiOff className="h-4 w-4" />}
              title={t('onboarding.point.offline')}
              body={t('onboarding.point.offlineBody')}
            />
          </div>

          <p
            className="mt-8 animate-fade-up text-center text-[11.5px] leading-relaxed text-paper-600"
            style={{ animationDelay: '280ms' }}
          >
            {t('import.step1.disclaimer')}
          </p>
        </div>
      </div>
    </div>
  );
}

function Promise({
  icon,
  title,
  body,
}: {
  icon: JSX.Element;
  title: string;
  body: string;
}): JSX.Element {
  return (
    <div className={cx('flex flex-col gap-3 bg-ink-900 p-6')}>
      <span aria-hidden className="text-brass-400/80">
        {icon}
      </span>
      <h3 className="font-display text-[14.5px] text-paper-100">{title}</h3>
      <p className="text-[12.5px] leading-relaxed text-paper-500">{body}</p>
    </div>
  );
}
