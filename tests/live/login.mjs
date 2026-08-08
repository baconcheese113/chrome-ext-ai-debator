import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * One-time manual login for the live smoke test.
 *
 * Opens a dedicated browser profile — NOT your everyday Chrome profile, which would be
 * locked and would put your main session at the mercy of a test run. Log into whichever
 * providers you want covered, then close the window. Sessions persist in .auth/, which is
 * gitignored.
 */
const PROFILE = join(import.meta.dirname, '../../.auth/live-profile');

const PROVIDERS = [
  'https://claude.ai/',
  'https://chatgpt.com/',
  'https://gemini.google.com/app',
  'https://grok.com/',
];

mkdirSync(PROFILE, { recursive: true });

const context = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chromium',
  headless: false,
  viewport: null,
});

for (const url of PROVIDERS) {
  const page = await context.newPage();
  await page.goto(url).catch(() => {});
}

console.log(`
Log into the providers you want the live smoke test to cover, then close the browser.
Sessions are stored in .auth/live-profile (gitignored, never committed).
Run the smoke test afterwards with:  npm run test:live
`);

await context.waitForEvent('close', { timeout: 0 });
