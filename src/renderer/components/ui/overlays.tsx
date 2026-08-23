import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { Button, IconButton, cx } from './primitives';
import { useT } from '../../i18n';
import { useAppStore } from '../../stores/app-store';

/**
 * Modals, drawers and toasts.
 *
 * Focus handling is done here rather than per-dialog: opening traps focus,
 * Escape closes, and closing returns focus to whatever opened the dialog. Doing
 * it once means every confirmation in the app is keyboard-complete by default.
 */

function useDialogBehaviour(open: boolean, onClose: () => void, containerRef: React.RefObject<HTMLElement>): void {
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement | null;

    const focusFirst = (): void => {
      const container = containerRef.current;
      if (!container) return;
      const focusable = container.querySelector<HTMLElement>(
        'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      (focusable ?? container).focus();
    };
    const timer = setTimeout(focusFirst, 30);

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const container = containerRef.current;
      if (!container) return;
      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(
          'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown, true);
      previousFocus.current?.focus?.();
    };
  }, [open, onClose, containerRef]);
}

/* --------------------------------- Modal --------------------------------- */

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  tone?: 'default' | 'danger';
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  tone = 'default',
}: ModalProps): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null);
  useDialogBehaviour(open, onClose, ref);
  if (!open) return null;

  const widths = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl' };

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-8">
      <div
        className="absolute inset-0 animate-fade-in bg-black/65 backdrop-blur-[3px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cx(
          'relative w-full animate-scale-in overflow-hidden rounded-xl',
          'border border-white/[0.09] bg-ink-850 shadow-lift',
          widths[size],
        )}
      >
        <header className="flex items-start justify-between gap-6 border-b border-white/[0.06] px-6 py-5">
          <div className="min-w-0">
            <h2
              className={cx(
                'font-display text-[17px] leading-snug',
                tone === 'danger' ? 'text-ember-400' : 'text-paper-50',
              )}
            >
              {title}
            </h2>
            {description && (
              <p className="mt-2 text-[13px] leading-relaxed text-paper-400">{description}</p>
            )}
          </div>
          <IconButton label="Close" size="sm" onClick={onClose} className="-mr-1 -mt-1">
            <X className="h-4 w-4" />
          </IconButton>
        </header>

        {children && <div className="max-h-[60vh] overflow-y-auto px-6 py-5">{children}</div>}

        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-white/[0.06] bg-black/20 px-6 py-4">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------- Confirm --------------------------------- */

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel,
  tone = 'default',
  pending,
  children,
  confirmDisabled,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  body: string;
  confirmLabel: string;
  tone?: 'default' | 'danger';
  pending?: boolean;
  children?: ReactNode;
  confirmDisabled?: boolean;
}): JSX.Element | null {
  const t = useT();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={body}
      size="sm"
      tone={tone}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={pending}
            disabled={confirmDisabled}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}

/* --------------------------------- Drawer -------------------------------- */

export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
  width = 'max-w-lg',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null);
  useDialogBehaviour(open, onClose, ref);
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[200] flex justify-end">
      <div className="absolute inset-0 animate-fade-in bg-black/55" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cx(
          'relative flex h-full w-full flex-col animate-slide-in-right',
          'border-l border-white/[0.08] bg-ink-880 shadow-lift',
          width,
        )}
      >
        <header className="flex items-center justify-between gap-4 border-b border-white/[0.06] px-6 py-5">
          <h2 className="font-display text-[17px] text-paper-50">{title}</h2>
          <IconButton label="Close" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </IconButton>
        </header>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-white/[0.06] bg-black/20 px-6 py-4">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* --------------------------------- Toasts -------------------------------- */

const TOAST_ICONS = {
  info: Info,
  success: CheckCircle2,
  error: AlertTriangle,
};

const TOAST_TONES = {
  info: 'border-white/[0.1] text-paper-200',
  success: 'border-sage-700/60 text-sage-400',
  error: 'border-ember-700/60 text-ember-400',
};

export function Toaster(): JSX.Element {
  const toasts = useAppStore((s) => s.toasts);
  const dismiss = useAppStore((s) => s.dismissToast);
  const t = useT();

  return createPortal(
    <div
      className="pointer-events-none fixed bottom-6 left-1/2 z-[300] flex -translate-x-1/2 flex-col items-center gap-2"
      role="status"
      aria-live="polite"
    >
      {toasts.map((toast) => {
        const Icon = TOAST_ICONS[toast.kind];
        return (
          <div
            key={toast.id}
            className={cx(
              'pointer-events-auto flex animate-fade-up items-center gap-3 rounded-lg border',
              'bg-ink-800/95 py-2.5 pl-3.5 pr-2.5 shadow-lift backdrop-blur',
              TOAST_TONES[toast.kind],
            )}
          >
            <Icon aria-hidden className="h-4 w-4 shrink-0" />
            <span className="text-[13px] text-paper-100">{t(toast.messageKey, toast.values)}</span>
            <IconButton label={t('common.dismiss')} size="sm" onClick={() => dismiss(toast.id)}>
              <X className="h-3.5 w-3.5" />
            </IconButton>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
