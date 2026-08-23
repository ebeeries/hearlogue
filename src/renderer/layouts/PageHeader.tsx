import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { cx } from '../components/ui/primitives';

/**
 * The page header.
 *
 * Every screen opens the same way — a quiet eyebrow, a serif title, an optional
 * line of context, and actions pushed right. That repetition is what makes the
 * app feel like one product instead of twenty screens.
 */

export interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  backTo?: { to: string; label: string };
  meta?: ReactNode;
  className?: string;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  backTo,
  meta,
  className,
}: PageHeaderProps): JSX.Element {
  return (
    <header className={cx('animate-fade-up', className)}>
      {backTo && (
        <Link
          to={backTo.to}
          className={cx(
            'mb-4 inline-flex items-center gap-1 text-[12.5px] text-paper-500',
            'transition-colors duration-150 hover:text-paper-200',
          )}
        >
          <ChevronLeft aria-hidden className="h-3.5 w-3.5" />
          {backTo.label}
        </Link>
      )}

      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
          <h1 className="font-display text-[30px] leading-[1.15] tracking-tight text-paper-50">
            {title}
          </h1>
          {description && (
            <p className="mt-2.5 max-w-2xl text-[13.5px] leading-relaxed text-paper-400">
              {description}
            </p>
          )}
          {meta && <div className="mt-4">{meta}</div>}
        </div>

        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/**
 * A hero header for detail pages: large cover, title, and facts alongside.
 */
export function DetailHeader({
  cover,
  eyebrow,
  title,
  subtitle,
  facts,
  actions,
  backTo,
  aside,
}: {
  cover: ReactNode;
  eyebrow?: string;
  title: string;
  subtitle?: ReactNode;
  facts?: ReactNode;
  actions?: ReactNode;
  backTo?: { to: string; label: string };
  aside?: ReactNode;
}): JSX.Element {
  return (
    <header className="animate-fade-up">
      {backTo && (
        <Link
          to={backTo.to}
          className="mb-5 inline-flex items-center gap-1 text-[12.5px] text-paper-500 transition-colors hover:text-paper-200"
        >
          <ChevronLeft aria-hidden className="h-3.5 w-3.5" />
          {backTo.label}
        </Link>
      )}

      <div className="flex flex-col gap-7 md:flex-row md:items-start">
        <div className="shrink-0">{cover}</div>

        <div className="min-w-0 flex-1">
          {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
          <h1 className="font-display text-[28px] leading-[1.15] tracking-tight text-paper-50 text-selectable">
            {title}
          </h1>
          {subtitle && <div className="mt-2 text-[14px] text-paper-300">{subtitle}</div>}
          {facts && <div className="mt-6">{facts}</div>}
          {actions && <div className="mt-6 flex flex-wrap items-center gap-2">{actions}</div>}
        </div>

        {aside && <div className="shrink-0 md:pl-4">{aside}</div>}
      </div>
    </header>
  );
}
