import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { Loader2 } from 'lucide-react';

/**
 * The primitive layer.
 *
 * Everything visual in HEARLOGUE is composed from these. They exist so that
 * spacing, radius, weight and motion stay consistent across twenty screens
 * without any of them re-deciding what a button looks like.
 */

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/* --------------------------------- Button -------------------------------- */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'quiet' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  // The one true call to action: warm brass on near-black, never a flat fill.
  primary:
    'bg-gradient-to-b from-brass-300 to-brass-500 text-ink-950 font-medium ' +
    'shadow-[0_1px_0_rgba(255,255,255,0.25)_inset,0_6px_18px_-8px_rgba(214,176,106,0.5)] ' +
    'hover:from-brass-200 hover:to-brass-400 active:from-brass-400 active:to-brass-600',
  secondary:
    'bg-white/[0.045] text-paper-100 border border-white/[0.09] ' +
    'hover:bg-white/[0.075] hover:border-white/[0.14] active:bg-white/[0.03]',
  ghost: 'text-paper-300 hover:text-paper-50 hover:bg-white/[0.05] active:bg-white/[0.02]',
  quiet: 'text-paper-400 hover:text-paper-100',
  danger:
    'bg-ember-700/25 text-ember-400 border border-ember-700/50 ' +
    'hover:bg-ember-700/40 hover:text-ember-400 active:bg-ember-700/20',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[12.5px] gap-1.5 rounded',
  md: 'h-9.5 px-4 text-[13.5px] gap-2 rounded-md',
  lg: 'h-11 px-6 text-[14.5px] gap-2.5 rounded-md',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, iconRight, block, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      className={cx(
        'inline-flex select-none items-center justify-center whitespace-nowrap',
        'transition-all duration-150 ease-out',
        'disabled:pointer-events-none disabled:opacity-40',
        BUTTON_SIZES[size],
        BUTTON_VARIANTS[variant],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
      ) : (
        icon && <span aria-hidden className="shrink-0 [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>
      )}
      {children}
      {iconRight && (
        <span aria-hidden className="shrink-0 [&>svg]:h-3.5 [&>svg]:w-3.5">{iconRight}</span>
      )}
    </button>
  );
});

/** A square button holding only an icon. Always needs an accessible label. */
export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: 'sm' | 'md';
  active?: boolean;
  tone?: 'default' | 'danger';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = 'md', active, tone = 'default', className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-md transition-all duration-150',
        size === 'sm' ? 'h-7 w-7' : 'h-8.5 w-8.5',
        active
          ? 'bg-brass-500/15 text-brass-300'
          : tone === 'danger'
            ? 'text-paper-500 hover:bg-ember-700/25 hover:text-ember-400'
            : 'text-paper-400 hover:bg-white/[0.06] hover:text-paper-50',
        'disabled:pointer-events-none disabled:opacity-35',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

/* ---------------------------------- Card --------------------------------- */

export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'raised' | 'flat' | 'inset';
  interactive?: boolean;
}

export function Panel({
  variant = 'raised',
  interactive,
  className,
  children,
  ...rest
}: PanelProps): JSX.Element {
  return (
    <div
      className={cx(
        variant === 'raised' ? 'panel' : variant === 'flat' ? 'panel-flat' : 'panel-inset',
        interactive &&
          'transition-all duration-200 ease-out hover:border-white/[0.11] hover:bg-ink-800/80 hover:shadow-lift',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/* -------------------------------- Section -------------------------------- */

export interface SectionProps {
  title?: string;
  eyebrow?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}

/** A titled block. The eyebrow/title pairing is the app's main rhythm device. */
export function Section({
  title,
  eyebrow,
  description,
  action,
  children,
  className,
  id,
}: SectionProps): JSX.Element {
  return (
    <section id={id} className={cx('flex flex-col gap-4', className)}>
      {(title || eyebrow || action) && (
        <header className="flex items-end justify-between gap-6">
          <div className="min-w-0">
            {eyebrow && <p className="eyebrow mb-1.5">{eyebrow}</p>}
            {title && (
              <h2 className="font-display text-[19px] leading-tight text-paper-50">{title}</h2>
            )}
            {description && (
              <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-paper-400">
                {description}
              </p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/* --------------------------------- Badge --------------------------------- */

export type BadgeTone = 'neutral' | 'brass' | 'sage' | 'haze' | 'clay' | 'plum' | 'ember';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-white/[0.055] text-paper-300 border-white/[0.07]',
  brass: 'bg-brass-500/12 text-brass-300 border-brass-500/25',
  sage: 'bg-sage-700/25 text-sage-400 border-sage-700/45',
  haze: 'bg-haze-700/25 text-haze-400 border-haze-700/45',
  clay: 'bg-clay-700/25 text-clay-400 border-clay-700/45',
  plum: 'bg-plum-700/25 text-plum-400 border-plum-700/45',
  ember: 'bg-ember-700/25 text-ember-400 border-ember-700/45',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
  icon,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
}): JSX.Element {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded border px-2 py-[3px]',
        'text-2xs font-medium uppercase tracking-wider',
        BADGE_TONES[tone],
        className,
      )}
    >
      {icon && <span aria-hidden className="[&>svg]:h-3 [&>svg]:w-3">{icon}</span>}
      {children}
    </span>
  );
}

/* --------------------------------- Input --------------------------------- */

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: ReactNode;
  suffix?: ReactNode;
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { icon, suffix, invalid, className, ...rest },
  ref,
) {
  return (
    <div className="relative flex items-center">
      {icon && (
        <span aria-hidden className="pointer-events-none absolute left-3 text-paper-500 [&>svg]:h-4 [&>svg]:w-4">
          {icon}
        </span>
      )}
      <input
        ref={ref}
        className={cx(
          'h-9.5 w-full rounded-md border bg-black/25 text-[13.5px] text-paper-100',
          'placeholder:text-paper-600 transition-colors duration-150',
          'focus:border-brass-500/45 focus:bg-black/35',
          invalid ? 'border-ember-700' : 'border-white/[0.08] hover:border-white/[0.13]',
          icon ? 'pl-9' : 'pl-3',
          suffix ? 'pr-10' : 'pr-3',
          className,
        )}
        {...rest}
      />
      {suffix && (
        <span className="absolute right-3 text-[12px] text-paper-500">{suffix}</span>
      )}
    </div>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        className={cx(
          'w-full resize-none rounded-md border border-white/[0.08] bg-black/25 p-3',
          'text-[13.5px] leading-relaxed text-paper-100 placeholder:text-paper-600',
          'transition-colors duration-150 hover:border-white/[0.13]',
          'focus:border-brass-500/45 focus:bg-black/35',
          className,
        )}
        {...rest}
      />
    );
  },
);

/* --------------------------------- Select -------------------------------- */

export interface SelectOption<T extends string | number> {
  value: T;
  label: string;
}

export interface SelectProps<T extends string | number> {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  label?: string;
  className?: string;
  disabled?: boolean;
  numeric?: boolean;
}

/**
 * A native `<select>`, styled.
 *
 * A custom listbox would look marginally more designed and behave measurably
 * worse — native keyboard handling, type-ahead and long-list virtualisation are
 * all free here and all fiddly to rebuild.
 */
export function Select<T extends string | number>({
  value,
  options,
  onChange,
  label,
  className,
  disabled,
  numeric,
}: SelectProps<T>): JSX.Element {
  return (
    <div className={cx('relative', className)}>
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) =>
          onChange((numeric ? Number(event.target.value) : event.target.value) as T)
        }
        className={cx(
          'h-9 w-full appearance-none rounded-md border border-white/[0.08] bg-black/25',
          'pl-3 pr-8 text-[13px] text-paper-100 transition-colors duration-150',
          'hover:border-white/[0.13] focus:border-brass-500/45',
          'disabled:opacity-40',
        )}
      >
        {options.map((option) => (
          <option key={String(option.value)} value={option.value} className="bg-ink-800 text-paper-100">
            {option.label}
          </option>
        ))}
      </select>
      <svg
        aria-hidden
        viewBox="0 0 12 12"
        className="pointer-events-none absolute right-3 top-1/2 h-2.5 w-2.5 -translate-y-1/2 text-paper-500"
      >
        <path d="M2 4.5 6 8.5 10 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </div>
  );
}

/* -------------------------------- Segmented ------------------------------ */

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

/** Two-to-five mutually exclusive choices, shown inline. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
  size = 'md',
}: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  size?: 'sm' | 'md';
}): JSX.Element {
  return (
    <div
      role="tablist"
      className={cx(
        'inline-flex items-center gap-0.5 rounded-md border border-white/[0.06] bg-black/25 p-0.5',
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cx(
              'inline-flex items-center gap-1.5 rounded px-3 transition-all duration-150',
              size === 'sm' ? 'h-7 text-[12px]' : 'h-8 text-[12.5px]',
              active
                ? 'bg-white/[0.09] text-paper-50 shadow-inset'
                : 'text-paper-400 hover:text-paper-100',
            )}
          >
            {option.icon && (
              <span aria-hidden className="[&>svg]:h-3.5 [&>svg]:w-3.5">{option.icon}</span>
            )}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------------------------- Chip --------------------------------- */

/** A filter chip. Scrollable rows of these drive Lost Favorites and Library. */
export function Chip({
  active,
  onClick,
  children,
  count,
  color,
  className,
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  count?: number;
  color?: string;
  className?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'group inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5',
        'text-[12.5px] transition-all duration-150',
        active
          ? 'border-brass-500/40 bg-brass-500/12 text-brass-200'
          : 'border-white/[0.07] text-paper-400 hover:border-white/[0.14] hover:text-paper-100',
        className,
      )}
    >
      {color && (
        <span
          aria-hidden
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: color }}
        />
      )}
      {children}
      {count !== undefined && (
        <span className={cx('tabular-nums text-[11px]', active ? 'text-brass-400/80' : 'text-paper-600')}>
          {count}
        </span>
      )}
    </button>
  );
}

/* -------------------------------- Switch --------------------------------- */

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative h-[22px] w-[38px] shrink-0 rounded-full border transition-colors duration-200',
        checked
          ? 'border-brass-500/50 bg-brass-500/30'
          : 'border-white/[0.09] bg-white/[0.045]',
        'disabled:opacity-40',
      )}
    >
      <span
        aria-hidden
        className={cx(
          'absolute top-1/2 h-[15px] w-[15px] -translate-y-1/2 rounded-full transition-all duration-200 ease-out',
          checked ? 'left-[19px] bg-brass-200' : 'left-[3px] bg-paper-500',
        )}
      />
    </button>
  );
}

/* ------------------------------- Skeletons ------------------------------- */

export function Skeleton({ className }: { className?: string }): JSX.Element {
  return <div aria-hidden className={cx('skeleton', className)} />;
}

export function SkeletonRows({ rows = 6, height = 'h-14' }: { rows?: number; height?: string }): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={cx('w-full rounded-md', height)} />
      ))}
    </div>
  );
}

/* ------------------------------- Progress -------------------------------- */

export function ProgressBar({
  value,
  className,
  indeterminate,
}: {
  value: number;
  className?: string;
  indeterminate?: boolean;
}): JSX.Element {
  return (
    <div
      role="progressbar"
      aria-valuenow={indeterminate ? undefined : Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cx('h-1 w-full overflow-hidden rounded-full bg-white/[0.06]', className)}
    >
      <div
        className={cx(
          'h-full rounded-full bg-gradient-to-r from-brass-500 to-brass-300',
          indeterminate ? 'w-1/3 animate-pulse-soft' : 'transition-[width] duration-500 ease-out',
        )}
        style={indeterminate ? undefined : { width: `${Math.min(100, Math.max(0, value * 100))}%` }}
      />
    </div>
  );
}

/* --------------------------------- Meter --------------------------------- */

/** A labelled 0..1 bar, used for score dimensions and album breadth. */
export function Meter({
  label,
  value,
  tone = 'brass',
  hint,
}: {
  label: string;
  value: number;
  tone?: 'brass' | 'sage' | 'haze' | 'plum';
  hint?: string;
}): JSX.Element {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  const colors: Record<string, string> = {
    brass: 'from-brass-600 to-brass-300',
    sage: 'from-sage-700 to-sage-400',
    haze: 'from-haze-700 to-haze-400',
    plum: 'from-plum-700 to-plum-400',
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[12px] text-paper-400">{label}</span>
        <span className="figure text-[12px] text-paper-300">{percent}</span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-white/[0.05]">
        <div
          className={cx('h-full rounded-full bg-gradient-to-r transition-all duration-700 ease-out', colors[tone])}
          style={{ width: `${percent}%` }}
        />
      </div>
      {hint && <span className="text-[11px] text-paper-600">{hint}</span>}
    </div>
  );
}

/* ------------------------------- Tooltip --------------------------------- */

/**
 * CSS-only tooltip.
 *
 * Positioned by the browser rather than a floating-element library — the app's
 * tooltips are short, always sit above their trigger, and never need collision
 * handling worth 8 kilobytes of dependency.
 */
export function Tooltip({
  content,
  children,
  side = 'top',
}: {
  content: string;
  children: ReactNode;
  side?: 'top' | 'bottom';
}): JSX.Element {
  return (
    <span className="group/tt relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={cx(
          'pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap',
          'rounded border border-white/[0.09] bg-ink-750 px-2 py-1 text-[11.5px] text-paper-200',
          'opacity-0 shadow-lift transition-all duration-150 group-hover/tt:opacity-100',
          side === 'top'
            ? 'bottom-full mb-1.5 translate-y-1 group-hover/tt:translate-y-0'
            : 'top-full mt-1.5 -translate-y-1 group-hover/tt:translate-y-0',
        )}
      >
        {content}
      </span>
    </span>
  );
}

/* ------------------------------ Scroll region ---------------------------- */

export function ScrollArea({
  children,
  className,
  fade,
}: {
  children: ReactNode;
  className?: string;
  fade?: boolean;
}): JSX.Element {
  return (
    <div className={cx('overflow-y-auto overflow-x-hidden', fade && 'scroll-fade', className)}>
      {children}
    </div>
  );
}
