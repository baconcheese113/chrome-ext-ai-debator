import { expect, test, type Page } from '@playwright/test';
import { mockProvider } from '../../lib/adapters/mock';
import type { DriveResult, ProviderAdapter } from '../../lib/types';

/**
 * Runs the real driver in real Chromium. jsdom is not an option here: `isVisible` depends on
 * getBoundingClientRect and getComputedStyle, which jsdom stubs to zeroes — it would report
 * confident, wrong answers, which is precisely the failure mode this project keeps hitting.
 */

const PROMPT = 'Explain optimistic concurrency control in detail, with examples.';

async function open(page: Page, query: string, timeouts?: { newMessageTimeoutMs?: number }) {
  await page.goto(`/index.html?${query}`);
  await page.addScriptTag({ url: '/dist/driver-harness.js' });
  await page.waitForFunction(() => Boolean(window.__driver));
  if (timeouts) await page.evaluate((t) => window.__driver.setTimeouts(t), timeouts);
}

function run(page: Page, adapter: ProviderAdapter = mockProvider, minChars = 120) {
  return page.evaluate(
    ([a, prompt, min]) =>
      window.__driver.drive(a as ProviderAdapter, {
        providerId: 'mock',
        prompt: prompt as string,
        minChars: min as number,
      }),
    [adapter, PROMPT, minChars] as const,
  ) as Promise<DriveResult>;
}

test('extracts a normal reply', async ({ page }) => {
  await open(page, 'mode=normal&words=120&speed=5');
  const res = await run(page);

  expect(res.ok).toBe(true);
  expect(res.extraction?.via).toBe('message');
  expect(res.extraction?.text.length).toBeGreaterThan(200);
});

test('completion survives ambient DOM churn outside the conversation', async ({ page }) => {
  // The mock ticks a clock on <body> every 300ms. A document.body-scoped observer never sees
  // the page go quiet — that regression made Gemini crawl in real use.
  await open(page, 'mode=normal&words=80&speed=5');
  const started = Date.now();
  const res = await run(page);

  expect(res.ok).toBe(true);
  expect(Date.now() - started).toBeLessThan(20_000);
});

test('reads the artifact when the thread holds only a summary', async ({ page }) => {
  await open(page, 'mode=artifact&words=150&speed=5');
  const res = await run(page);

  expect(res.ok).toBe(true);
  expect(res.extraction?.via).toBe('artifact');
  expect(res.extraction?.text).toContain('concurrency');
});

test('walks past an empty trailing message node', async ({ page }) => {
  await open(page, 'mode=empty-tail&words=120&speed=5');
  const res = await run(page);

  expect(res.ok).toBe(true);
  expect(res.extraction?.text.length).toBeGreaterThan(200);
});

test('rejects a truncated reply instead of reporting success', async ({ page }) => {
  // The failure mode that matters most: not an error, but a confident partial answer.
  await open(page, 'mode=truncate&words=400&speed=2');
  const res = await run(page);

  expect(res.ok).toBe(false);
  expect(res.failure).toBe('implausible-response');
});

test('rejects a reply that is just our own prompt echoed back', async ({ page }) => {
  await open(page, 'mode=echo&speed=5');
  const res = await run(page);

  expect(res.ok).toBe(false);
  expect(res.failure).toBe('prompt-echo');
});

test('completes without a stop button via the slow quiescence path', async ({ page }) => {
  await open(page, 'mode=no-stop&words=80&speed=5');
  const res = await run(page);

  expect(res.ok).toBe(true);
  expect(res.extraction?.text.length).toBeGreaterThan(150);
});

test('does not call a long mid-stream pause the end of the reply', async ({ page }) => {
  await open(page, 'mode=slow&words=60&speed=5');
  const res = await run(page);

  expect(res.ok).toBe(true);
  // The tail after the 2.5s pause must be present; stopping early would truncate it.
  expect(res.extraction?.text.trim().endsWith('reason')).toBe(true);
});

test('reports no-new-message when nothing ever replies', async ({ page }) => {
  await open(page, 'mode=silent', { newMessageTimeoutMs: 2000 });
  const res = await run(page);

  expect(res.ok).toBe(false);
  expect(res.failure).toBe('no-new-message');
});

test('says the adapter is wrong when no selector matches the page', async ({ page }) => {
  await open(page, 'mode=normal&words=60&speed=5', { newMessageTimeoutMs: 2000 });
  const broken: ProviderAdapter = {
    ...mockProvider,
    response: { selectors: ['.this-matches-nothing'] },
    artifact: undefined,
  };
  const res = await run(page, broken);

  expect(res.ok).toBe(false);
  expect(res.failure).toBe('no-new-message');
  expect(res.detail).toContain('no element on this page matched');
});

test('never returns a previous turn when the newest one is blank', async ({ page }) => {
  // Guards the extraction floor. Without it, a blank new turn silently resolves to the last
  // round's reply and the panel trades stale content while looking healthy.
  await open(page, 'mode=normal&words=100&speed=5');
  const first = await run(page);
  expect(first.ok).toBe(true);

  await page.evaluate(() => {
    const el = document.createElement('div');
    el.className = 'msg assistant';
    el.dataset.role = 'assistant';
    el.textContent = '';
    document.getElementById('thread')!.appendChild(el);
  });

  const second = await run(page, mockProvider, 100_000);
  expect(second.ok).toBe(false);
  expect(second.extraction?.text).not.toBe(first.extraction?.text);
});

test('diagnostics name a pasteable selector for the composer', async ({ page }) => {
  await open(page, 'mode=normal');
  const diag = await page.evaluate(() => window.__driver.diagnose('test'));

  // suggestSelector deliberately prefers aria-label over id — labels outlive hashed ids.
  const composer = diag.candidateComposers.find((c) => c.contentEditable === 'true');
  expect(composer).toBeDefined();
  expect(composer!.suggestedSelector).toBe('div[aria-label="Message"]');
  expect(diag.candidateButtons.some((b) => b.testId === 'send-button')).toBe(true);
});
