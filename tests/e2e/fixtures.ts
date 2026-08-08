import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, test as base, type BrowserContext, type Page } from '@playwright/test';
import { MOCK_URL } from '../../playwright.config';

/** The e2e build, which alone carries the localhost mock adapter. Built by `npm run build:e2e`. */
const EXTENSION_PATH = join(import.meta.dirname, '../../.output/chrome-mv3-e2e');

/**
 * Loads the real unpacked extension. MV3 service workers require a persistent context, and
 * extensions need Chrome's new headless mode rather than the old headless shell.
 */
export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
  dashboard: Page;
}>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'ai-debator-e2e-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
      ],
    });
    await use(context);
    await context.close();
    rmSync(userDataDir, { recursive: true, force: true });
  },

  extensionId: async ({ context }, use) => {
    let worker = context.serviceWorkers()[0];
    worker ??= await context.waitForEvent('serviceworker');
    await use(worker.url().split('/')[2]!);
  },

  dashboard: async ({ context, extensionId }, use) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/dashboard.html`);
    await use(page);
  },
});

export const expect = test.expect;

/** Opens a mock provider tab and waits for its content script to be live. */
export async function openMockTab(context: BrowserContext, query: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${MOCK_URL}/index.html?${query}`);
  await page.waitForSelector('#composer');
  return page;
}

/**
 * Seats a tab from the real dashboard UI. Driving the actual controls rather than writing
 * storage directly is the point — it covers the wiring a storage shortcut would skip.
 */
export async function seatTab(dashboard: Page, title: string, role: 'Participant' | 'Narrator', name: string) {
  const row = dashboard.locator('li', { has: dashboard.locator(`input[value]`) }).filter({ hasText: title });
  await row.locator('input.name').fill(name);
  await row.locator('select').selectOption({ label: role });
}
