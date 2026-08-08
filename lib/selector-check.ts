import { deepQueryAll, isVisible } from './dom';
import type { ProviderAdapter } from './types';

/**
 * A read-only audit of whether an adapter's selectors still match the page.
 *
 * Sends nothing and changes nothing — no prompt, no new thread, no pollution. It cannot
 * verify streaming or extraction of a *new* message; only a real send can. What it does
 * catch is the failure that has actually cost us the most: selectors that match nothing at
 * all, which previously surfaced as the misleading "assistant message count stayed at 0".
 */

export type CheckState = 'ok' | 'fail' | 'unknown';

export interface SelectorCheck {
  concern: 'composer' | 'send button' | 'stop button' | 'responses' | 'artifact';
  state: CheckState;
  /** The selector that matched, when one did. */
  matched: string | null;
  count: number;
  note?: string;
}

export interface AdapterCheck {
  providerId: string;
  providerLabel: string;
  url: string;
  /** False when any required concern failed. */
  ok: boolean;
  checks: SelectorCheck[];
}

function probe(selectors: string[] | undefined): { matched: string | null; count: number } {
  for (const sel of selectors ?? []) {
    const n = deepQueryAll(sel).filter(isVisible).length;
    if (n > 0) return { matched: sel, count: n };
  }
  return { matched: null, count: 0 };
}

export function checkAdapter(adapter: ProviderAdapter): AdapterCheck {
  const checks: SelectorCheck[] = [];

  const composer = probe(adapter.composer.selectors);
  checks.push({
    concern: 'composer',
    state: composer.count > 0 ? 'ok' : 'fail',
    ...composer,
    note: composer.count > 0 ? undefined : 'Cannot type into this page.',
  });

  const send = probe(adapter.submit.buttonSelectors);
  checks.push({
    concern: 'send button',
    // Claude genuinely has no send button in the DOM; the driver falls back to the Enter
    // key. Absence is therefore informational, not a failure.
    state: send.count > 0 ? 'ok' : 'unknown',
    ...send,
    note: send.count > 0 ? undefined : 'None found — the driver will press Enter instead.',
  });

  const stop = probe(adapter.generating.stopSelectors);
  checks.push({
    concern: 'stop button',
    // Only present while generating, so an idle page showing none proves nothing.
    state: stop.count > 0 ? 'ok' : 'unknown',
    ...stop,
    note: stop.count > 0 ? undefined : 'Only appears while a model is replying.',
  });

  const responses = probe(adapter.response.selectors);
  checks.push({
    concern: 'responses',
    // A brand-new chat legitimately has no replies yet, which is indistinguishable from a
    // broken selector. Say so rather than guessing.
    state: responses.count > 0 ? 'ok' : 'unknown',
    ...responses,
    note:
      responses.count > 0
        ? undefined
        : 'No replies matched. If this thread already has replies, the selectors are wrong.',
  });

  if (adapter.artifact) {
    const artifact = probe(adapter.artifact.selectors);
    checks.push({
      concern: 'artifact',
      state: artifact.count > 0 ? 'ok' : 'unknown',
      ...artifact,
      note: artifact.count > 0 ? 'An artifact panel is open.' : 'No artifact panel open.',
    });
  }

  return {
    providerId: adapter.id,
    providerLabel: adapter.label,
    url: location.href,
    ok: !checks.some((c) => c.state === 'fail'),
    checks,
  };
}
