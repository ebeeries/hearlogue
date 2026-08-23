import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../stores/app-store';

/**
 * Global keyboard shortcuts.
 *
 * Bound once at the app root. Every binding is skipped while focus is inside a
 * text field, so typing "k" into a note never opens the search palette — with
 * the deliberate exception of Ctrl+K itself, which should work from anywhere.
 */

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  );
}

export function useGlobalShortcuts(): void {
  const navigate = useNavigate();
  const setSearchOpen = useAppStore((s) => s.setSearchOpen);
  const searchOpen = useAppStore((s) => s.searchOpen);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const mod = event.ctrlKey || event.metaKey;
      const typing = isTypingTarget(event.target);

      // Search: reachable from anywhere, including from inside a field.
      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(!searchOpen);
        return;
      }

      if (mod && event.key.toLowerCase() === 'i') {
        event.preventDefault();
        navigate('/import');
        return;
      }

      if (mod && event.key === ',') {
        event.preventDefault();
        navigate('/settings');
        return;
      }

      // Alt+Left / Alt+Right mirror the browser and the titlebar buttons.
      if (event.altKey && event.key === 'ArrowLeft') {
        event.preventDefault();
        navigate(-1);
        return;
      }
      if (event.altKey && event.key === 'ArrowRight') {
        event.preventDefault();
        navigate(1);
        return;
      }

      if (typing) return;

      // Ctrl+1..8 jump straight to a section, matching the sidebar order.
      if (mod && /^[1-8]$/.test(event.key)) {
        const routes = [
          '/archive',
          '/lost-favorites',
          '/rewind',
          '/eras',
          '/obsessions',
          '/graveyard',
          '/library',
          '/calendar',
        ];
        const target = routes[Number(event.key) - 1];
        if (target) {
          event.preventDefault();
          navigate(target);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate, setSearchOpen, searchOpen]);
}

/** Shortcut reference rendered in Settings, kept in step with the bindings above. */
export const SHORTCUTS: { keys: string; labelKey: string }[] = [
  { keys: 'Ctrl + K', labelKey: 'settings.shortcut.search' },
  { keys: 'Ctrl + I', labelKey: 'settings.shortcut.import' },
  { keys: 'Ctrl + ,', labelKey: 'settings.shortcut.settings' },
  { keys: 'Alt + ←', labelKey: 'settings.shortcut.back' },
  { keys: 'Esc', labelKey: 'settings.shortcut.close' },
];
