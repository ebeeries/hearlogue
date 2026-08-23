import { app } from 'electron';
import path from 'node:path';
import { spawn } from 'node:child_process';

/**
 * Windows installer (Squirrel) lifecycle.
 *
 * The Squirrel installer launches the app with a flag during install, update and
 * uninstall so it can create or remove Start Menu and desktop shortcuts. In
 * those runs the app must do that one job and exit immediately rather than
 * opening a window.
 */

function runUpdater(args: string[]): void {
  const updateExe = path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
  try {
    spawn(updateExe, args, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    /* nothing useful can be done if the updater is missing */
  }
}

/** Returns true when the process was a Squirrel hook and the app should exit. */
export function handleSquirrelEvent(): boolean {
  if (process.platform !== 'win32' || process.argv.length < 2) return false;

  const command = process.argv[1];
  const exeName = path.basename(process.execPath);

  switch (command) {
    case '--squirrel-install':
    case '--squirrel-updated':
      runUpdater(['--createShortcut', exeName]);
      setTimeout(() => app.quit(), 1000);
      return true;

    case '--squirrel-uninstall':
      runUpdater(['--removeShortcut', exeName]);
      setTimeout(() => app.quit(), 1000);
      return true;

    case '--squirrel-obsolete':
      app.quit();
      return true;

    default:
      return false;
  }
}
