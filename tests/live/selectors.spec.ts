import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect, test, type BrowserContext } from '@playwright/test';
import { ADAPTERS_BY_ID } from '../../lib/adapters';
import type { DriveResult, ProviderAdapter } from '../../lib/types';

/**
 * Selector rot detector. This is the only test that can tell you an adapter has stopped
 * working against the real thing — no fixture or mock can, because they were captured or
 * written on a day the provider had not yet redesigned.
 *
 * Costs real subscription quota. One short prompt per provider, run rarely, never in CI.
 */

const PROFILE = join(import.meta.dirname, '../../.auth/live-profile');
const HARNESS = join(import.meta.dirname, '../mock-provider/dist/driver-harness.js');

const PROMPT = 'In one short sentence, what is optimistic concurrency control?';

/** Providers to probe, with a page that lands on a usable chat. */
const TARGETS: Array<{ id: string; url: string }> = [
  { id: 'claude', url: 'https://claude.ai/new' },
  { id: 'chatgpt', url: 'https://chatgpt.com/' },
  { id: 'gemini', url: 'https://gemini.google.com/app' },
  { id: 'grok', url: 'https://grok.com/' },
];

let context: BrowserContext;

test.beforeAll(async () => {
  if (!existsSync(PROFILE)) {
    throw new Error('No logged-in profile. Run `npm run test:live:login` first.');
  }
  if (!existsSync(HARNESS)) {
    throw new Error('Driver harness missing. Run `npm run build:harness` first.');
  }
  context = await chromium.launchPersistentContext(PROFILE, {
    channel: 'chromium',
    headless: false, // Providers are markedly more hostile to headless sessions.
    viewport: null,
  });
});

test.afterAll(async () => context?.close());

for (const target of TARGETS) {
  test(`${target.id}: adapter still drives the real UI`, async () => {
    const adapter: ProviderAdapter | undefined = ADAPTERS_BY_ID[target.id];
    expect(adapter, `no adapter registered for ${target.id}`).toBeDefined();

    const page = await context.newPage();
    await page.goto(target.url, { waitUntil: 'domcontentloaded' });
    // Give SPA routing and any login redirect time to settle before judging the page.
    await page.waitForTimeout(5000);

    if (/login|signin|auth/i.test(page.url())) {
      throw new Error(`Not logged into ${target.id} (landed on ${page.url()})`);
    }

    await page.addScriptTag({ path: HARNESS });
    const result = (await page.evaluate(
      ([a, prompt]) =>
        window.__driver.drive(a as ProviderAdapter, {
          providerId: (a as ProviderAdapter).id,
          prompt: prompt as string,
          minChars: 40,
        }),
      [adapter!, PROMPT] as const,
    )) as DriveResult;

    // On failure, dump what the page actually offers so the adapter can be repaired from
    // evidence rather than another guess.
    if (!result.ok) {
      const diag = await page.evaluate(() => window.__driver.diagnose('live smoke failure'));
      console.error(
        `\n${target.id} FAILED: ${result.failure} — ${result.detail}\n` +
          `composers: ${JSON.stringify(diag.candidateComposers.map((c) => c.suggestedSelector))}\n` +
          `responses: ${JSON.stringify(diag.candidateResponseContainers.map((c) => c.suggestedSelector))}\n`,
      );
    }

    expect(result.ok, `${result.failure}: ${result.detail}`).toBe(true);
    expect(result.extraction!.text.length).toBeGreaterThan(40);
    // An artifact reply means the inline-only instruction is being ignored and the adapter's
    // artifact selectors are carrying the run — worth knowing, not worth failing.
    if (result.extraction!.via === 'artifact') {
      console.warn(`${target.id}: replied via artifact, not inline.`);
    }
    await page.close();
  });
}
