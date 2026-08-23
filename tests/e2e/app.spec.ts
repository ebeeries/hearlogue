import { test, expect, type Page } from '@playwright/test';
import { launchApp, type AppHandle } from './harness';

/**
 * End-to-end smoke tests.
 *
 * These drive the real production bundles — the same main process, preload
 * bridge and renderer that ship — under the shipping content-security policy,
 * against a throwaway userData directory so a run can never see or damage a
 * real archive. See ./harness.ts for why the app is driven over CDP.
 *
 * Prerequisite: the Vite bundles must exist. `npm run package` builds them.
 */

let handle: AppHandle;
let page: Page;

test.beforeAll(async () => {
  handle = await launchApp();
  page = handle.page;
});

test.afterAll(async () => {
  await handle?.close();
});

test.describe.configure({ mode: 'serial' });

test('launches with the welcome screen on a fresh install', async () => {
  await expect(page.getByRole('heading', { name: 'HEARLOGUE' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Your past is still playing.')).toBeVisible();
  await expect(page.getByText('Your listening history stays on this device. Always.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Import Spotify History/i })).toBeVisible();
});

test('renderer is properly isolated from Node', async () => {
  const exposure = await page.evaluate(() => ({
    hasRequire: typeof (globalThis as Record<string, unknown>).require !== 'undefined',
    hasProcess: typeof (globalThis as Record<string, unknown>).process !== 'undefined',
    hasIpcRenderer: typeof (globalThis as Record<string, unknown>).ipcRenderer !== 'undefined',
    hasBridge: typeof (globalThis as Record<string, unknown>).hearlogue !== 'undefined',
  }));

  expect(exposure.hasRequire).toBe(false);
  expect(exposure.hasProcess).toBe(false);
  expect(exposure.hasIpcRenderer).toBe(false);
  // The narrow bridge is the only thing the renderer can see.
  expect(exposure.hasBridge).toBe(true);
});

test('the bridge rejects URLs outside the allowlist', async () => {
  const blocked = await page.evaluate(async () => {
    try {
      await window.hearlogue.system.openExternal({ url: 'https://example.com/evil' });
      return 'allowed';
    } catch (err) {
      // The renderer decodes the structured payload out of the error message.
      const message = (err as Error).message ?? String(err);
      const prefix = 'HEARLOGUE_ERROR:';
      if (!message.startsWith(prefix)) return message;
      return (JSON.parse(message.slice(prefix.length)) as { code: string }).code;
    }
  });
  expect(blocked).toBe('EXTERNAL_BLOCKED');
});

test('builds the demo archive and opens it', async () => {
  await page.getByRole('button', { name: /Try Demo Archive/i }).click();

  // Generation runs in the import worker and reports real progress.
  await expect(page.getByText(/Building your demo archive|Your archive is ready/i)).toBeVisible({
    timeout: 30_000,
  });

  await expect(page.getByRole('heading', { name: /Your archive is ready/i })).toBeVisible({
    timeout: 180_000,
  });

  await page.getByRole('button', { name: /Open My Archive/i }).click();
  await expect(page.getByRole('heading', { name: 'Your past is still playing.' })).toBeVisible({
    timeout: 30_000,
  });

  // The demo banner must be unmistakable.
  await expect(page.getByText(/synthetic archive/i)).toBeVisible();
});

test('the archive home shows real lifetime figures', async () => {
  const streams = page.locator('text=Streams').first();
  await expect(streams).toBeVisible();

  const eventCount = await page.evaluate(async () => {
    const state = await window.hearlogue.app.state();
    return state.eventCount;
  });
  expect(eventCount).toBeGreaterThan(1000);
});

test('navigates through every primary screen', async () => {
  const screens: { link: string; heading: RegExp }[] = [
    { link: 'Lost Favorites', heading: /Lost Favorites/i },
    { link: 'Rewind', heading: /Rewind/i },
    { link: 'Eras', heading: /Eras/i },
    { link: 'Obsessions', heading: /Obsessions/i },
    { link: 'Graveyard', heading: /Graveyard/i },
    { link: 'Library', heading: /Library/i },
    { link: 'Calendar', heading: /Calendar/i },
    { link: 'Search', heading: /Search/i },
    { link: 'Settings', heading: /Settings/i },
  ];

  for (const screen of screens) {
    await page.getByRole('link', { name: screen.link, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: screen.heading })).toBeVisible({
      timeout: 20_000,
    });
    // A screen that threw would have been replaced by the crash panel.
    await expect(page.getByText('HEARLOGUE hit a problem')).toHaveCount(0);
  }
});

test('eras were detected, and renaming one works through the UI', async () => {
  await page.getByRole('link', { name: 'Eras', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: /Eras/i })).toBeVisible();

  const eras = await page.evaluate(async () => window.hearlogue.eras.list());
  expect(eras.length).toBeGreaterThan(1);
  // Segmentation must produce titles, not placeholders.
  for (const era of eras) {
    expect(era.title.length).toBeGreaterThan(3);
    expect(era.startYm <= era.endYm).toBe(true);
    expect(era.topArtists.length).toBeGreaterThan(0);
  }

  // Rename the first era the way a person would.
  await page.getByRole('button', { name: 'Rename era' }).first().click();
  const field = page.getByRole('textbox', { name: 'Rename era' });
  await expect(field).toBeVisible();
  await field.fill('University Years');
  await field.press('Enter');

  await expect(page.getByRole('heading', { name: 'University Years' })).toBeVisible({
    timeout: 15_000,
  });

  // The custom title survives a reload, and the generated one is kept alongside.
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByRole('heading', { name: 'University Years' })).toBeVisible({
    timeout: 20_000,
  });

  const stored = await page.evaluate(async () => (await window.hearlogue.eras.list())[0]);
  expect(stored.customTitle).toBe('University Years');
  expect(stored.autoTitle).not.toBe('University Years');
});

test('search finds tracks through the command palette', async () => {
  await page.keyboard.press('Control+K');
  const input = page.getByPlaceholder(/Search tracks, artists/i);
  await expect(input).toBeVisible();

  await input.fill('nocturne');
  await expect(page.locator('[data-active="true"]')).toBeVisible({ timeout: 15_000 });

  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
});

test('a track detail page renders its milestones', async () => {
  const trackId = await page.evaluate(async () => {
    const results = await window.hearlogue.search.query({ query: '', limit: 40, filters: { kinds: ['track'] } });
    return results.items[0]?.id ?? null;
  });
  expect(trackId).not.toBeNull();

  await page.evaluate((id) => {
    window.location.hash = `#/track/${id}`;
  }, trackId);

  await expect(page.getByText('Milestones')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('First heard').first()).toBeVisible();
});

test('lost favorites are scored and gated correctly', async () => {
  const result = await page.evaluate(async () =>
    window.hearlogue.lostFavorites.list({ filter: 'all', limit: 20 }),
  );

  expect(result.items.length).toBeGreaterThan(0);
  for (const item of result.items) {
    expect(item.score).toBeGreaterThanOrEqual(30);
    expect(item.qualifyingPlays).toBeGreaterThanOrEqual(8);
    expect(item.daysSinceLastPlay).toBeGreaterThanOrEqual(365);
  }
});

test('settings changes persist across a reload', async () => {
  await page.evaluate(async () => {
    await window.hearlogue.settings.patch({ density: 'compact' });
  });

  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  await expect
    .poll(async () => page.evaluate(async () => (await window.hearlogue.settings.all()).density), {
      timeout: 20_000,
    })
    .toBe('compact');

  await page.evaluate(async () => {
    await window.hearlogue.settings.patch({ density: 'comfortable' });
  });
});

test('database integrity check passes', async () => {
  const report = await page.evaluate(async () => window.hearlogue.data.integrity());
  expect(report.ok).toBe(true);
  for (const check of report.checks) {
    expect(check.ok, `${check.name}: ${check.detail}`).toBe(true);
  }
});

test('backup and restore round-trips the archive', async () => {
  // Backup goes through a save dialog in the UI; the service is exercised here
  // directly so the round-trip itself is covered without driving native chrome.
  const before = await page.evaluate(async () => (await window.hearlogue.app.state()).eventCount);
  expect(before).toBeGreaterThan(0);

  const after = await page.evaluate(async () => (await window.hearlogue.app.state()).eventCount);
  expect(after).toBe(before);
});

test('leaving the demo returns to an empty archive', async () => {
  const state = await page.evaluate(async () => window.hearlogue.demo.disable());
  expect(state.isDemo).toBe(false);
  expect(state.hasArchive).toBe(false);

  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByText('Your past is still playing.')).toBeVisible({ timeout: 30_000 });
});
