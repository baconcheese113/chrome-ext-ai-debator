import { expect, test, type Page } from '@playwright/test';
import { mockProvider } from '../../lib/adapters/mock';
import type { DriveResult, ProviderAdapter } from '../../lib/types';

/**
 * Runs the real driver in real Chromium. jsdom is not an option here: `isVisible` depends on
 * getBoundingClientRect and getComputedStyle, which jsdom stubs to zeroes — it would report
 * confident, wrong answers, which is precisely the failure mode this project keeps hitting.
 */

const PROMPT = 'Explain optimistic concurrency control in detail, with examples.';

async function open(
  page: Page,
  query: string,
  timeouts?: { newMessageTimeoutMs?: number; staleStopMs?: number },
) {
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

test('extracts correctly when layout is unavailable, as in a background tab', async ({ page }) => {
  // The failure that broke every real run. Chrome skips layout for background tabs, so
  // innerText returns '' and getBoundingClientRect returns 0x0 — models replied perfectly
  // while the extension reported "held no text" and "count stayed at N".
  //
  // The headless shell does not emulate tab visibility, so rather than depend on that, this
  // reproduces the mechanism directly: layout-dependent APIs are stubbed out for the
  // conversation region only, leaving the composer usable so the run can proceed.
  await open(page, 'mode=normal&words=120&speed=5');

  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { get: () => true, configurable: true });

    const inThread = (el: Element) => Boolean(el.closest?.('#thread'));

    const innerTextDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText')!;
    Object.defineProperty(HTMLElement.prototype, 'innerText', {
      configurable: true,
      get(this: HTMLElement) {
        return inThread(this) ? '' : innerTextDesc.get!.call(this);
      },
    });

    const rect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      return inThread(this)
        ? ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0 } as DOMRect)
        : rect.call(this);
    };
  });

  const res = await run(page);

  expect(res.ok).toBe(true);
  expect(res.extraction!.text.length).toBeGreaterThan(200);
  expect(res.extraction!.text).toContain('concurrency');
});

test('works when the provider virtualizes the thread', async ({ page }) => {
  // ChatGPT swaps off-screen turns for empty placeholders, so the count of rendered
  // assistant messages does not grow with the conversation. "Wait for the count to increase"
  // waited forever and reported the true-but-useless "assistant message count stayed at 3".
  // Turn identity is unaffected by what is or isn't mounted.
  await open(page, 'mode=virtualized&words=80&speed=5');

  const first = await run(page);
  expect(first.ok).toBe(true);
  expect(first.extraction!.text).toContain('Reply #1.');

  // Second turn: the first is now unmounted, so the rendered count is still one.
  const second = await run(page);
  expect(second.ok).toBe(true);
  expect(second.extraction!.text).toContain('Reply #2.');
  expect(second.extraction!.text).not.toContain('Reply #1.');
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

test('does not hang when a stop button is left visible after the reply', async ({ page }) => {
  // A real Claude thread was observed idle with "Stop response" still in the DOM. Believing
  // it unconditionally costs the whole 300s detect timeout for that seat.
  // Shrunk from the production 120s. That threshold is deliberately long — at 15s it cut
  // Grok off mid-think — so the test shrinks it rather than waiting two minutes.
  await open(page, 'mode=stuck-stop&words=80&speed=5', { staleStopMs: 8000 });
  const started = Date.now();
  const res = await run(page);

  expect(res.ok).toBe(true);
  expect(res.extraction!.text.length).toBeGreaterThan(150);
  // Resolves via the stale-stop escape, nowhere near the 300s detect timeout.
  expect(Date.now() - started).toBeLessThan(45_000);
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
  // Replies are numbered, so "not the previous turn" is a real assertion rather than a
  // coincidence of identical mock text.
  expect(first.extraction!.text).toContain('Reply #1.');
  expect(second.extraction?.text ?? '').not.toContain('Reply #1.');
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
