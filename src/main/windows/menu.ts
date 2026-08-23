import { Menu, app, type MenuItemConstructorOptions } from 'electron';
import { APP_NAME } from '@shared/constants/app';
import { openLogsFolder } from '../services/external';

/**
 * The application menu.
 *
 * The menu bar is hidden by default (the app has its own chrome), but the menu
 * still exists so that keyboard accelerators work and so that Alt reveals the
 * standard Windows menu for anyone who expects it. Navigation items simply push
 * a route to the renderer rather than duplicating any logic.
 */

export interface MenuOptions {
  onNavigate: (route: string) => void;
  isDev: boolean;
}

export function buildApplicationMenu(options: MenuOptions): Menu {
  const nav = (route: string): (() => void) => () => options.onNavigate(route);

  const template: MenuItemConstructorOptions[] = [
    {
      label: '&File',
      submenu: [
        {
          label: 'Import History…',
          accelerator: 'CmdOrCtrl+I',
          click: nav('/import'),
        },
        { type: 'separator' },
        { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: nav('/settings') },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
      ],
    },
    {
      label: '&Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: '&Go',
      submenu: [
        { label: 'Archive', accelerator: 'CmdOrCtrl+1', click: nav('/archive') },
        { label: 'Lost Favorites', accelerator: 'CmdOrCtrl+2', click: nav('/lost-favorites') },
        { label: 'Rewind', accelerator: 'CmdOrCtrl+3', click: nav('/rewind') },
        { label: 'Eras', accelerator: 'CmdOrCtrl+4', click: nav('/eras') },
        { label: 'Obsessions', accelerator: 'CmdOrCtrl+5', click: nav('/obsessions') },
        { label: 'Graveyard', accelerator: 'CmdOrCtrl+6', click: nav('/graveyard') },
        { label: 'Library', accelerator: 'CmdOrCtrl+7', click: nav('/library') },
        { label: 'Calendar', accelerator: 'CmdOrCtrl+8', click: nav('/calendar') },
        { type: 'separator' },
        { label: 'Search', accelerator: 'CmdOrCtrl+K', click: nav('/search') },
      ],
    },
    {
      label: '&View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(options.isDev
          ? ([{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }] as MenuItemConstructorOptions[])
          : []),
      ],
    },
    {
      label: '&Help',
      submenu: [
        { label: 'Keyboard Shortcuts', click: nav('/settings?section=general') },
        { label: 'Privacy', click: nav('/settings?section=privacy') },
        { type: 'separator' },
        { label: 'Open Logs Folder', click: () => void openLogsFolder() },
        { type: 'separator' },
        { label: `About ${APP_NAME}`, click: nav('/settings?section=about') },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}
