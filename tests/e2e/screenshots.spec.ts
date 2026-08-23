import { test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launchApp, type AppHandle } from './harness';

/**
 * Screenshot capture.
 *
 * Not an assertion suite — a way to look at every screen of the real app with a
 * populated archive, for design review and for attaching to a release. Skipped
 * unless explicitly requested:
 *
 *   E2E_SCREENSHOTS=1 npx playwright test screenshots
 */

const ENABLED = process.env.E2E_SCREENSHOTS === '1';
const OUT_DIR = path.resolve('tests/e2e/.artifacts/screens');

test.skip(!ENABLED, 'Set E2E_SCREENSHOTS=1 to capture screenshots.');
test.describe.configure({ mode: 'serial' });

let handle: AppHandle;
let page: Page;

test.beforeAll(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  handle = await launchApp();
  page = handle.page;
  await page.setViewportSize({ width: 1440, height: 940 });

  // Seed the demo archive so every screen has something real to show.
  await page.getByRole('button', { name: /Try Demo Archive/i }).click();
  await page
    .getByRole('heading', { name: /Your archive is ready/i })
    .waitFor({ timeout: 180_000 });
  await page.getByRole('button', { name: /Open My Archive/i }).click();
  await page.waitForTimeout(1200);
});

test.afterAll(async () => {
  await handle?.close();
});

async function capture(name: string, hash: string, settleMs = 1400): Promise<void> {
  await page.evaluate((target) => {
    window.location.hash = target;
  }, hash);
  await page.waitForTimeout(settleMs);
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
}

test('capture every screen', async () => {
  await capture('01-archive', '#/archive', 2200);
  await capture('02-lost-favorites', '#/lost-favorites', 2000);
  await capture('03-rewind', '#/rewind', 2200);
  await capture('04-eras', '#/eras', 2200);
  await capture('05-obsessions', '#/obsessions', 2000);
  await capture('06-graveyard', '#/graveyard', 1800);
  await capture('07-library', '#/library', 1800);
  await capture('08-calendar', '#/calendar', 2400);
  await capture('09-search', '#/search', 1600);
  await capture('10-settings', '#/settings', 1600);
  await capture('11-records', '#/records', 1600);
  await capture('12-sessions', '#/sessions', 1600);

  const trackId = await page.evaluate(async () => {
    const results = await window.hearlogue.search.query({
      query: '',
      limit: 5,
      filters: { kinds: ['track'] },
    });
    return results.items[0]?.id ?? 1;
  });
  await capture('13-track-detail', `#/track/${trackId}`, 1800);

  const artistId = await page.evaluate(async () => {
    const results = await window.hearlogue.search.query({
      query: '',
      limit: 5,
      filters: { kinds: ['artist'] },
    });
    return results.items[0]?.id ?? 1;
  });
  await capture('14-artist-detail', `#/artist/${artistId}`, 1800);

  // The command palette sits above whatever screen is showing.
  await page.evaluate(() => {
    window.location.hash = '#/archive';
  });
  await page.waitForTimeout(1200);
  await page.keyboard.press('Control+K');
  await page.getByPlaceholder(/Search tracks, artists/i).fill('nocturne');
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT_DIR, '15-command-palette.png') });
  await page.keyboard.press('Escape');

  // The welcome screen, captured last so it does not disturb the archive.
  await page.evaluate(async () => {
    await window.hearlogue.demo.disable();
  });
  await page.reload();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(OUT_DIR, '00-welcome.png') });
});
