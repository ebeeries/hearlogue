import { NavLink, useLocation } from 'react-router-dom';
import {
  Archive,
  Compass,
  History,
  Layers,
  Flame,
  Skull,
  Library,
  CalendarDays,
  Search,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  FlaskConical,
} from 'lucide-react';
import { cx, Tooltip } from '../components/ui/primitives';
import { useT } from '../i18n';
import { useAppStore } from '../stores/app-store';
import { APP_NAME } from '@shared/constants/app';

/**
 * The sidebar.
 *
 * Ordered by how the product wants to be used rather than alphabetically:
 * Archive first as the home, then the four rediscovery surfaces, then the tools
 * that operate on them, with Settings separated below a rule.
 */

interface NavItem {
  to: string;
  labelKey: string;
  icon: typeof Archive;
  shortcut?: string;
}

const PRIMARY: NavItem[] = [
  { to: '/archive', labelKey: 'nav.archive', icon: Archive, shortcut: '1' },
  { to: '/lost-favorites', labelKey: 'nav.lostFavorites', icon: Compass, shortcut: '2' },
  { to: '/rewind', labelKey: 'nav.rewind', icon: History, shortcut: '3' },
  { to: '/eras', labelKey: 'nav.eras', icon: Layers, shortcut: '4' },
  { to: '/obsessions', labelKey: 'nav.obsessions', icon: Flame, shortcut: '5' },
  { to: '/graveyard', labelKey: 'nav.graveyard', icon: Skull, shortcut: '6' },
  { to: '/library', labelKey: 'nav.library', icon: Library, shortcut: '7' },
  { to: '/calendar', labelKey: 'nav.calendar', icon: CalendarDays, shortcut: '8' },
  { to: '/search', labelKey: 'nav.search', icon: Search, shortcut: 'K' },
];

const SECONDARY: NavItem[] = [{ to: '/settings', labelKey: 'nav.settings', icon: Settings }];

function NavRow({
  item,
  collapsed,
  active,
}: {
  item: NavItem;
  collapsed: boolean;
  active: boolean;
}): JSX.Element {
  const t = useT();
  const label = t(item.labelKey);
  const Icon = item.icon;

  const link = (
    <NavLink
      to={item.to}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'group relative flex items-center rounded-md transition-all duration-150',
        collapsed ? 'h-9 w-9 justify-center' : 'h-9 gap-3 px-2.5',
        active
          ? 'bg-white/[0.055] text-paper-50'
          : 'text-paper-400 hover:bg-white/[0.03] hover:text-paper-100',
      )}
    >
      {/* The active marker is a brass rule, not a filled pill. */}
      <span
        aria-hidden
        className={cx(
          'absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-brass-400',
          'transition-all duration-200 ease-out',
          active ? 'opacity-100' : 'opacity-0',
          collapsed ? '-left-1.5' : '-left-2',
        )}
      />
      <Icon
        aria-hidden
        className={cx('h-4 w-4 shrink-0 transition-colors', active && 'text-brass-300')}
        strokeWidth={1.75}
      />
      {!collapsed && (
        <>
          <span className="flex-1 truncate text-[13px]">{label}</span>
          {item.shortcut && (
            /*
             * Hidden from assistive technology on purpose: the shortcut is a
             * visual affordance, and including it would make the link's
             * accessible name "Lost Favorites 2". The bindings themselves are
             * listed properly in Settings.
             */
            <kbd
              aria-hidden
              className={cx(
                'rounded border border-white/[0.07] px-1 py-px font-mono text-[9.5px]',
                'text-paper-600 opacity-0 transition-opacity group-hover:opacity-100',
              )}
            >
              {item.shortcut}
            </kbd>
          )}
        </>
      )}
    </NavLink>
  );

  return collapsed ? <Tooltip content={label}>{link}</Tooltip> : link;
}

export function Sidebar(): JSX.Element {
  const t = useT();
  const location = useLocation();
  const collapsed = useAppStore((s) => s.settings.sidebarCollapsed);
  const patchSettings = useAppStore((s) => s.patchSettings);
  const isDemo = useAppStore((s) => s.state?.isDemo ?? false);

  const isActive = (to: string): boolean =>
    location.pathname === to || location.pathname.startsWith(`${to}/`);

  return (
    <aside
      className={cx(
        'relative z-20 flex shrink-0 flex-col border-r border-white/[0.055] bg-ink-900',
        'transition-[width] duration-250 ease-smooth',
      )}
      style={{ width: collapsed ? 'var(--sidebar-width-collapsed)' : 'var(--sidebar-width)' }}
    >
      {/* Wordmark. Sits in the draggable titlebar strip. */}
      <div
        className={cx(
          'app-drag flex shrink-0 items-center',
          collapsed ? 'justify-center px-0' : 'px-4',
        )}
        style={{ height: 'var(--shell-titlebar)' }}
      >
        {collapsed ? (
          <span className="font-display text-[15px] tracking-tight text-brass-300">H</span>
        ) : (
          <span className="font-display text-[13px] tracking-[0.22em] text-paper-200">
            {APP_NAME}
          </span>
        )}
      </div>

      {isDemo && !collapsed && (
        <div className="mx-3 mb-1 mt-1 rounded border border-brass-600/30 bg-brass-900/30 px-2.5 py-1.5">
          <span className="flex items-center gap-1.5 text-2xs uppercase tracking-widest text-brass-400">
            <FlaskConical aria-hidden className="h-3 w-3" />
            {t('demo.badge')}
          </span>
        </div>
      )}

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-2 no-scrollbar">
        {PRIMARY.map((item) => (
          <NavRow key={item.to} item={item} collapsed={collapsed} active={isActive(item.to)} />
        ))}

        <div className={cx('my-2', collapsed ? 'mx-1.5' : 'mx-0')}>
          <div className="divider" />
        </div>

        {SECONDARY.map((item) => (
          <NavRow key={item.to} item={item} collapsed={collapsed} active={isActive(item.to)} />
        ))}
      </nav>

      <div className={cx('shrink-0 px-3 pb-3', collapsed && 'flex justify-center')}>
        <button
          type="button"
          onClick={() => void patchSettings({ sidebarCollapsed: !collapsed })}
          aria-label={collapsed ? t('nav.expand') : t('nav.collapse')}
          title={collapsed ? t('nav.expand') : t('nav.collapse')}
          className={cx(
            'flex h-8 items-center rounded-md text-paper-600 transition-colors',
            'hover:bg-white/[0.04] hover:text-paper-300',
            collapsed ? 'w-8 justify-center' : 'w-full gap-2.5 px-2.5',
          )}
        >
          {collapsed ? (
            <PanelLeftOpen aria-hidden className="h-4 w-4" strokeWidth={1.75} />
          ) : (
            <>
              <PanelLeftClose aria-hidden className="h-4 w-4" strokeWidth={1.75} />
              <span className="text-[12px]">{t('nav.collapse')}</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
