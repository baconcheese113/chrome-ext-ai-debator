import { describe, expect, it } from 'vitest';
import type { ProviderAdapter } from '../../lib/types';

/**
 * checkAdapter reads the DOM, so it is exercised for real in tests/driver. What matters
 * here is the state classification — specifically that "absent" is not automatically
 * "broken", because that distinction is the whole reason this feature is trustworthy.
 */

const adapter: ProviderAdapter = {
  id: 'x',
  label: 'X',
  urlPatterns: ['https://x.test/*'],
  composer: { selectors: ['#c'], kind: 'auto' },
  submit: { strategy: 'auto', buttonSelectors: ['#s'] },
  generating: { stopSelectors: ['#stop'] },
  response: { selectors: ['.r'] },
};

describe('checkAdapter classification', () => {
  it('treats a missing composer as a hard failure', async () => {
    const { checkAdapter } = await withDom('<div></div>');
    const result = checkAdapter(adapter);

    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.concern === 'composer')!.state).toBe('fail');
  });

  it('treats a missing send button as unknown, not broken', async () => {
    // Claude has no send button at all; the driver presses Enter. Reporting that as a
    // failure would cry wolf on a provider that works fine.
    const { checkAdapter } = await withDom('<div id="c"></div>');
    const result = checkAdapter(adapter);

    expect(result.checks.find((c) => c.concern === 'send button')!.state).toBe('unknown');
    expect(result.ok).toBe(true);
  });

  it('treats an absent stop button as unknown — it only exists mid-reply', async () => {
    const { checkAdapter } = await withDom('<div id="c"></div>');
    const result = checkAdapter(adapter);
    expect(result.checks.find((c) => c.concern === 'stop button')!.state).toBe('unknown');
  });

  it('treats zero replies as unknown, since a fresh thread has none', async () => {
    const { checkAdapter } = await withDom('<div id="c"></div>');
    const responses = (await withDom('<div id="c"></div>')).checkAdapter(adapter).checks
      .find((c) => c.concern === 'responses')!;

    expect(responses.state).toBe('unknown');
    expect(responses.note).toContain('the selectors are wrong');
    expect(checkAdapter(adapter).ok).toBe(true);
  });

  it('reports the matching selector and count when replies are present', async () => {
    const { checkAdapter } = await withDom(
      '<div id="c"></div><div class="r">a</div><div class="r">b</div>',
    );
    const responses = checkAdapter(adapter).checks.find((c) => c.concern === 'responses')!;

    expect(responses.state).toBe('ok');
    expect(responses.matched).toBe('.r');
    expect(responses.count).toBe(2);
  });
});

/**
 * A minimal DOM stub. checkAdapter goes through deepQueryAll + isVisible, so the stub has to
 * satisfy getBoundingClientRect and getComputedStyle — the very APIs that make jsdom
 * unsuitable for the driver itself. Here we only classify counts, so a stub is honest.
 */
async function withDom(html: string) {
  const elements: Element[] = [];
  const parse = (source: string) => {
    for (const m of source.matchAll(/<div([^>]*)>/g)) {
      const attrs = m[1] ?? '';
      const id = /id="([^"]+)"/.exec(attrs)?.[1] ?? '';
      const cls = /class="([^"]+)"/.exec(attrs)?.[1] ?? '';
      elements.push({ id, className: cls } as unknown as Element);
    }
  };
  parse(html);

  const matches = (sel: string) =>
    elements.filter((e) =>
      sel.startsWith('#')
        ? (e as unknown as { id: string }).id === sel.slice(1)
        : sel.startsWith('.')
          ? (e as unknown as { className: string }).className.split(' ').includes(sel.slice(1))
          : false,
    );

  const g = globalThis as Record<string, unknown>;
  g.document = {
    querySelectorAll: (sel: string) => matches(sel),
    createTreeWalker: () => ({ nextNode: () => null }),
  };
  g.location = { href: 'https://x.test/thread' };
  g.getComputedStyle = () => ({ visibility: 'visible', display: 'block', opacity: '1' });
  g.NodeFilter = { SHOW_ELEMENT: 1 };
  for (const el of elements) {
    Object.assign(el, {
      isConnected: true,
      getBoundingClientRect: () => ({ width: 10, height: 10 }),
    });
  }

  const { checkAdapter } = await import('../../lib/selector-check');
  return { checkAdapter };
}
