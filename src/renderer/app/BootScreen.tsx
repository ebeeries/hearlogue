import { APP_NAME, APP_TAGLINE } from '@shared/constants/app';

/**
 * Shown while the archive opens.
 *
 * Normally on screen for a few hundred milliseconds, so it is deliberately a
 * held moment rather than a spinner — the wordmark fading up sets the tone
 * before the first screen arrives.
 */
export function BootScreen({ error }: { error: string | null }): JSX.Element {
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center bg-ink-900">
      <div className="animate-fade-up text-center">
        <h1 className="font-display text-[22px] tracking-[0.32em] text-paper-200">{APP_NAME}</h1>
        <p className="mt-3 text-[13px] italic text-paper-500">{APP_TAGLINE}</p>
      </div>

      {error ? (
        <div className="mt-10 max-w-md px-8 text-center">
          <p className="text-[13px] leading-relaxed text-ember-400">
            HEARLOGUE could not start.
          </p>
          <p className="mt-2 text-[12px] leading-relaxed text-paper-600">{error}</p>
        </div>
      ) : (
        <div
          aria-hidden
          className="mt-10 h-px w-32 overflow-hidden rounded-full bg-white/[0.06]"
        >
          <span className="block h-full w-1/3 animate-pulse-soft bg-brass-500/70" />
        </div>
      )}
    </div>
  );
}
