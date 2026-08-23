import { test, type CDPSession, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launchApp, type AppHandle } from './harness';

/**
 * Landing-page screenshot capture.
 *
 * The marketing site shows the real app, so these images are captured from the
 * real app rather than mocked up. Two things matter here that do not matter for
 * the design-review captures in `screenshots.spec.ts`:
 *
 *   - **Legibility.** A 1440px window scaled into a 880px column renders the
 *     app's 13px UI text at roughly 8px — unreadable. The feature shots are
 *     therefore taken from a narrower window, so that the same column shows
 *     them closer to their natural size.
 *   - **Sharpness.** Everything is captured at devicePixelRatio 2, so the site
 *     stays crisp on high-density displays.
 *
 * Skipped unless explicitly requested:
 *
 *   E2E_SITE_SHOTS=1 npx playwright test site-shots
 */

const ENABLED = process.env.E2E_SITE_SHOTS === '1';
const OUT_DIR = path.resolve('site/screens');

/** The hero shows the whole window, in the shape the app actually opens at. */
const HERO = { width: 1440, height: 940 };

/**
 * Feature rows show the window at the width where its own layout is still
 * comfortable but its text survives being scaled into a side-by-side column.
 */
const FEATURE = { width: 1180, height: 820 };

const SCALE = 2;

test.skip(!ENABLED, 'Set E2E_SITE_SHOTS=1 to capture landing-page screenshots.');
test.describe.configure({ mode: 'serial' });

let handle: AppHandle;
let page: Page;
let cdp: CDPSession;

test.beforeAll(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  handle = await launchApp();
  page = handle.page;

  cdp = await page.context().newCDPSession(page);

  await page.setViewportSize(HERO);
  await page.getByRole('button', { name: /Try Demo Archive/i }).click();
  await page
    .getByRole('heading', { name: /Your archive is ready/i })
    .waitFor({ timeout: 180_000 });
  await page.getByRole('button', { name: /Open My Archive/i }).click();
  await page.waitForTimeout(1500);
});

test.afterAll(async () => {
  await handle?.close();
});

/**
 * Playwright cannot change the device scale factor of a page it attached to
 * over CDP, so the override is driven through CDP directly.
 */
async function useViewport(size: { width: number; height: number }): Promise<void> {
  await page.setViewportSize(size);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: size.width,
    height: size.height,
    deviceScaleFactor: SCALE,
    mobile: false,
  });
  await page.waitForTimeout(700);
}

/**
 * `page.screenshot()` re-applies Playwright's own device metrics before it
 * fires, which silently drops the scale factor set above and yields a 1x image.
 * Capturing through CDP keeps the override intact.
 */
async function capture(name: string, hash: string, settleMs = 2000): Promise<void> {
  await page.evaluate((target) => {
    window.location.hash = target;
  }, hash);
  await page.waitForTimeout(settleMs);

  const { data } = (await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  })) as { data: string };

  fs.writeFileSync(path.join(OUT_DIR, `${name}.png`), Buffer.from(data, 'base64'));
}

test('capture the screens used by the landing page', async () => {
  await useViewport(HERO);
  await capture('01-archive', '#/archive', 2600);

  await useViewport(FEATURE);
  await capture('02-lost-favorites', '#/lost-favorites', 2200);
  await capture('04-eras', '#/eras', 2400);
  await capture('08-calendar', '#/calendar', 2800);

  for (const file of ['01-archive', '02-lost-favorites', '04-eras', '08-calendar']) {
    const stat = fs.statSync(path.join(OUT_DIR, `${file}.png`));
    process.stdout.write(`  ${file}.png  ${(stat.size / 1024).toFixed(0)} KB\n`);
  }
});
