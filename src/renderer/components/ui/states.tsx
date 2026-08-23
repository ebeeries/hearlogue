import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button, Panel, cx } from './primitives';
export { Skeleton, SkeletonRows } from './primitives';
import { useT } from '../../i18n';
import type { AppError } from '@shared/types/common';

/**
 * Empty, error and loading states.
 *
 * Every screen in HEARLOGUE has designed versions of all three. An empty
 * Graveyard is not a failure — it means nothing was abandoned, and the copy says
 * so rather than showing a shrug.
 */

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
  secondaryAction?: ReactNode;
  className?: string;
  compact?: boolean;
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  secondaryAction,
  className,
  compact,
}: EmptyStateProps): JSX.Element {
  return (
    <div
      className={cx(
        'flex flex-col items-center justify-center text-center',
        compact ? 'gap-3 px-6 py-10' : 'gap-4 px-8 py-20',
        className,
      )}
    >
      {icon && (
        <div
          aria-hidden
          className={cx(
            'flex items-center justify-center rounded-full',
            'border border-white/[0.06] bg-white/[0.02] text-paper-600',
            compact ? 'h-10 w-10 [&>svg]:h-4 [&>svg]:w-4' : 'h-14 w-14 [&>svg]:h-6 [&>svg]:w-6',
          )}
        >
          {icon}
        </div>
      )}
      <div className="max-w-md">
        <h3
          className={cx(
            'font-display text-paper-100',
            compact ? 'text-[15px]' : 'text-[18px]',
          )}
        >
          {title}
        </h3>
        {body && (
          <p className="mt-2 text-[13px] leading-relaxed text-paper-500">{body}</p>
        )}
      </div>
      {(action || secondaryAction) && (
        <div className="mt-2 flex items-center gap-2">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
  className,
}: {
  error: AppError;
  onRetry?: () => void;
  className?: string;
}): JSX.Element {
  const t = useT();
  return (
    <Panel variant="flat" className={cx('flex items-start gap-4 p-5', className)}>
      <div
        aria-hidden
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ember-700/25 text-ember-400"
      >
        <AlertTriangle className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="font-display text-[15px] text-paper-100">{t('error.title')}</h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-paper-400">
          {t(error.messageKey, error.detail ? { detail: error.detail } : undefined)}
        </p>
      </div>
      {onRetry && (
        <Button size="sm" variant="secondary" icon={<RotateCcw />} onClick={onRetry}>
          {t('common.retry')}
        </Button>
      )}
    </Panel>
  );
}

/**
 * Route-level error boundary.
 *
 * A render failure on one screen must not take down the shell, because the
 * sidebar is how a person gets to a screen that still works.
 */
interface BoundaryState {
  error: Error | null;
}

export class RouteErrorBoundary extends Component<
  { children: ReactNode; onReset?: () => void },
  BoundaryState
> {
  override state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Route render failed', error, info.componentStack);
  }

  private reset = (): void => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return <CrashPanel onReset={this.reset} />;
  }
}

function CrashPanel({ onReset }: { onReset: () => void }): JSX.Element {
  const t = useT();
  return (
    <div className="flex h-full items-center justify-center p-10">
      <Panel className="max-w-lg p-8 text-center">
        <div
          aria-hidden
          className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-ember-700/20 text-ember-400"
        >
          <AlertTriangle className="h-5 w-5" />
        </div>
        <h2 className="mt-5 font-display text-[19px] text-paper-50">{t('error.crashTitle')}</h2>
        <p className="mt-2.5 text-[13px] leading-relaxed text-paper-400">{t('error.crashBody')}</p>
        <div className="mt-6 flex justify-center gap-2">
          <Button variant="primary" onClick={onReset} icon={<RotateCcw />}>
            {t('error.reload')}
          </Button>
        </div>
      </Panel>
    </div>
  );
}

/** A page-level loading shape: a title block plus a few content blocks. */
export function PageSkeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-8" aria-hidden>
      <div className="flex flex-col gap-3">
        <div className="skeleton h-3 w-24 rounded" />
        <div className="skeleton h-7 w-64 rounded" />
      </div>
      <div className="skeleton h-44 w-full rounded-lg" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="skeleton h-24 rounded-lg" />
        ))}
      </div>
      <div className="flex flex-col gap-1.5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="skeleton h-14 w-full rounded-md" />
        ))}
      </div>
    </div>
  );
}
