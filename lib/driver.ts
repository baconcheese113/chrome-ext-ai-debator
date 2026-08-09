import { collectDiagnostics } from './diagnostics';
import { anyVisible, deepQueryAll, firstVisible, isVisible, readText, sleep } from './dom';
import type {
  Diagnostics,
  DriveFailure,
  DriveRequest,
  DriveResult,
  ProviderAdapter,
  TurnExtraction,
} from './types';

/**
 * Quiescence threshold. ChatGPT logged 85–97 mutation bursts inside a single long response,
 * so this has the least headroom there — shortening it breaks ChatGPT first.
 */
const QUIESCENCE_MS = 1800;
/**
 * How long the DOM must stay quiet when we have NO stop button to corroborate with. Only
 * used as the pessimistic path — a provider with a working stop button finishes far sooner.
 */
const QUIESCENCE_CONFIRM = 3;
/** Once a stop button has appeared and then gone, this much quiet is enough. */
const STOP_GONE_CONFIRM_MS = 900;
/**
 * How long a visible stop button is believed while the conversation DOM is completely static.
 *
 * Claude has been observed showing "Stop response" on an idle thread, which would otherwise
 * cost the whole detect timeout. But this is an escape hatch for a rare stuck button, NOT a
 * completion signal: at 15s it cut Grok off mid-think after 106 characters, because a model
 * pausing to reason produces no DOM changes either. Long enough that only a genuinely stuck
 * button trips it.
 */
const STALE_STOP_DEFAULT_MS = 120_000;

/**
 * Waiting periods, isolated so tests can shrink them. Two driver tests deliberately provoke
 * the no-reply timeout; at the production value they alone cost 90 seconds.
 */
export const driverTimings = {
  newMessageTimeoutMs: 45_000,
  detectTimeoutMs: 300_000,
  staleStopMs: STALE_STOP_DEFAULT_MS,
};

/** Outcome of phase 1. `before` is the pre-send message count, needed by phase 2. */
export interface SubmitResult {
  ok: boolean;
  before?: TurnKey;
  failure?: DriveFailure;
  detail?: string;
  warning?: string;
  timings: Record<string, number>;
  diagnostics?: Diagnostics;
}

class DriveError extends Error {
  constructor(readonly failure: DriveFailure, readonly detail: string) {
    super(`${failure}: ${detail}`);
  }
}

/**
 * Phase 1 of a turn: put the prompt in and send it, then return immediately.
 *
 * Split out so parallel mode can submit to every seat first and let them all generate at
 * once. `before` is the pre-send message count, which phase 2 needs to know which turn is
 * the new one.
 */
export async function submitTurn(
  adapter: ProviderAdapter,
  req: DriveRequest,
): Promise<SubmitResult> {
  const timings: Record<string, number> = {};
  const t = (k: string, from: number) => (timings[k] = Math.round(performance.now() - from));
  try {
    const before = lastTurnKey(adapter);

    let p = performance.now();
    const composer =
      (await waitFor(() => findComposer(adapter), 20_000)) ??
      raise('composer-not-found', adapter.composer.selectors.join(' | '));
    t('findComposer', p);

    p = performance.now();
    const injected =
      adapter.overrides?.injectText?.(composer, req.prompt, adapter) ??
      injectText(composer, req.prompt, adapter);
    const warning = injected ? undefined : 'composer read back empty after injection';
    await sleep(350);
    t('inject', p);

    p = performance.now();
    if (!(adapter.overrides?.submit?.(composer, adapter) ?? submit(composer, adapter))) {
      raise('submit-failed', 'no enabled send button and Enter had no effect');
    }
    t('submit', p);

    return { ok: true, before, timings, warning };
  } catch (err) {
    const de = err instanceof DriveError ? err : undefined;
    return {
      ok: false,
      failure: de?.failure ?? 'driver-error',
      detail: de?.detail ?? String(err),
      timings,
      diagnostics: collectDiagnostics(de ? de.failure : 'unexpected error'),
    };
  }
}

/** Phase 2 of a turn: wait for the reply to finish, then extract and validate it. */
export async function awaitTurn(
  adapter: ProviderAdapter,
  req: DriveRequest,
  before: TurnKey,
  priorTimings: Record<string, number> = {},
  warning?: string,
): Promise<DriveResult> {
  const timings: Record<string, number> = { ...priorTimings };
  const t = (k: string, from: number) => (timings[k] = Math.round(performance.now() - from));
  let extracted: TurnExtraction | undefined;

  try {
    let p = performance.now();
    const appeared = await waitFor(() => {
      const now = lastTurnKey(adapter);
      return now.key !== null && now.key !== before.key ? true : undefined;
    }, driverTimings.newMessageTimeoutMs);
    if (!appeared) {
      raise(
        'no-new-message',
        lastTurnKey(adapter).key === null
          ? 'no element on this page matched the response selectors — this adapter needs ' +
            'updating; use Diagnose on this tab'
          : 'the newest assistant turn never changed — the model may not have replied',
      );
    }
    t('firstToken', p);

    p = performance.now();
    await awaitQuiescence(adapter);
    t('detect', p);

    p = performance.now();
    extracted = extract(adapter, before.key);
    if (!extracted || extracted.text.trim().length === 0) {
      raise(
        'extract-empty',
        `a new turn appeared but held no text (selector: ${lastTurnKey(adapter).selector ?? 'none'}) — ` +
          'the reply may have gone to a canvas or artifact; use Diagnose on this tab',
      );
    }
    t('extract', p);

    validate(extracted, req);
    return { ok: true, extraction: extracted, timings, warning };
  } catch (err) {
    const de = err instanceof DriveError ? err : undefined;
    return {
      ok: false,
      failure: de?.failure ?? 'driver-error',
      detail: de?.detail ?? String(err),
      warning,
      extraction: extracted,
      timings,
      diagnostics: collectDiagnostics(de ? de.failure : 'unexpected error'),
    };
  }
}

/** Both phases back to back — serial mode, and what the driver tests exercise. */
export async function drive(
  adapter: ProviderAdapter,
  req: DriveRequest,
): Promise<DriveResult> {
  const submitted = await submitTurn(adapter, req);
  if (!submitted.ok) {
    return {
      ok: false,
      failure: submitted.failure,
      detail: submitted.detail,
      timings: submitted.timings,
      diagnostics: submitted.diagnostics,
    };
  }
  return awaitTurn(adapter, req, submitted.before!, submitted.timings, submitted.warning);
}

function raise(failure: DriveFailure, detail: string): never {
  throw new DriveError(failure, detail);
}

/**
 * The guard the spike itself was missing. It scored a 41-character fragment of a 700-word
 * answer as a pass, and scored Gemini echoing the user's own prompt as a pass. Both would
 * have poisoned a debate with confident nonsense.
 */
function validate(extraction: TurnExtraction, req: DriveRequest): void {
  const text = extraction.text.trim();

  // Echo is checked BEFORE length. An echoed prompt is usually also too short, and
  // "it handed back your own prompt" tells you what to do; "too short" sends you hunting
  // for a rate limit.
  //
  // Gemini under throttling returned "You said / <our prompt>". If what we captured is our
  // own prompt plus trimming, we grabbed the user's turn rather than the reply.
  //
  // Measured by what REMAINS after removing the prompt, not by a length ratio. A ratio
  // breaks the moment anything is appended (a CONVERGED footer was enough), and it also
  // misfires in later rounds where the prompt legitimately dwarfs the reply.
  const full = req.prompt.trim();
  const probe = full.slice(0, 80);
  const residue = (s: string) => text.split(s).join('').replace(/\s+/g, ' ').trim().length;

  if (full.length > 30 && text.includes(full) && residue(full) < 200) {
    raise('prompt-echo', 'extracted text is our prompt reproduced in full');
  }
  if (probe.length > 30 && text.includes(probe) && residue(probe) < 150) {
    raise('prompt-echo', 'extracted text is our own prompt with little else');
  }

  if (text.length < req.minChars) {
    raise(
      'implausible-response',
      `only ${text.length} chars, expected at least ${req.minChars} — likely truncated`,
    );
  }
}

/**
 * Identity of the newest assistant turn, rather than a count of rendered ones.
 *
 * ChatGPT virtualizes its thread: turns scrolled out of view are swapped for empty
 * placeholder divs (`data-is-intersecting="false"`). The number of rendered assistant
 * messages therefore does not grow with the conversation — it stays flat or drops — and
 * "wait for the count to increase" waits forever, reporting the perfectly true and utterly
 * misleading "assistant message count stayed at 3".
 *
 * Identity is virtualization-proof: whatever is unmounted, the newest turn is a different
 * turn than it was before we sent.
 */
export interface TurnKey {
  selector: string | null;
  key: string | null;
}

/**
 * Attributes that identify a turn, best first.
 *
 * `aria-posinset` is here because Claude exposes no per-message id at all — its turns are
 * only distinguished by their position in the `role="article"` list. `data-testid` is last
 * because it is the most likely to belong to a container rather than a turn.
 */
const TURN_ID_ATTRS = ['data-message-id', 'data-turn-id', 'aria-posinset', 'data-testid'];

/** How far up to look. Beyond this we are reading page furniture, not the turn. */
const ANCESTOR_LIMIT = 6;

function attrSignature(el: HTMLElement): string | null {
  for (const a of TURN_ID_ATTRS) {
    let node: HTMLElement | null = el;
    for (let depth = 0; node && depth <= ANCESTOR_LIMIT; depth++, node = node.parentElement) {
      const v = node.getAttribute(a);
      if (v) return `${a}=${v}`;
    }
  }
  return null;
}

const textSignature = (el: HTMLElement) => `text=${readText(el).slice(0, 160)}`;

interface TurnView {
  selector: string | null;
  els: HTMLElement[];
  keys: string[];
}

/**
 * Turns and their identities, with the identity scheme validated against the page.
 *
 * An unbounded `closest()` walk once resolved every Claude turn to the same page-level
 * `data-testid`, so "has the newest turn changed?" was permanently false and Claude looked
 * like it had stopped replying when it had not. Rather than trust a scheme, this checks it:
 * if the attributes do not yield a distinct key per turn, they are not identifying turns,
 * and it falls back to text.
 */
function turnView(adapter: ProviderAdapter): TurnView {
  for (const sel of adapter.response.selectors) {
    const els = deepQueryAll(sel).filter(isVisible) as HTMLElement[];
    if (!els.length) continue;

    const attrs = els.map(attrSignature);
    const usable =
      attrs.every((k): k is string => k !== null) && new Set(attrs).size === els.length;

    return { selector: sel, els, keys: usable ? (attrs as string[]) : els.map(textSignature) };
  }
  return { selector: null, els: [], keys: [] };
}

function lastTurnKey(adapter: ProviderAdapter): TurnKey {
  const view = turnView(adapter);
  return { selector: view.selector, key: view.keys[view.keys.length - 1] ?? null };
}

function findComposer(adapter: ProviderAdapter): HTMLElement | undefined {
  const o = adapter.overrides?.findComposer?.(adapter);
  if (o) return o;
  return firstVisible(adapter.composer.selectors)?.el;
}

function injectText(el: HTMLElement, text: string, adapter: ProviderAdapter): boolean {
  const kind =
    adapter.composer.kind === 'auto'
      ? el.tagName === 'TEXTAREA' || el.tagName === 'INPUT'
        ? 'textarea'
        : 'contenteditable'
      : adapter.composer.kind;

  el.focus();

  if (kind === 'textarea') {
    const input = el as HTMLTextAreaElement;
    // React swallows a direct .value assignment on the next render; the prototype setter is
    // what makes its value tracker notice.
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set;
    setter ? setter.call(input, text) : (input.value = text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return input.value.includes(text.slice(0, 20));
  }

  // execCommand keeps ProseMirror/Quill's internal model in sync. Setting textContent does
  // not, and the editor discards it on the next keystroke.
  if (!document.execCommand('insertText', false, text)) {
    el.textContent = text;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
  }
  return readText(el).includes(text.slice(0, 20));
}

function submit(composer: HTMLElement, adapter: ProviderAdapter): boolean {
  for (const sel of adapter.submit.strategy === 'enter' ? [] : adapter.submit.buttonSelectors ?? []) {
    const btn = deepQueryAll(sel).find(
      (b) =>
        isVisible(b) &&
        !(b as HTMLButtonElement).disabled &&
        b.getAttribute('aria-disabled') !== 'true',
    ) as HTMLElement | undefined;
    if (btn) {
      btn.click();
      return true;
    }
  }
  if (adapter.submit.strategy === 'click') return false;

  // Claude has no send button in the DOM at all — Enter is the only route there.
  for (const type of ['keydown', 'keypress', 'keyup'] as const) {
    composer.dispatchEvent(
      new KeyboardEvent(type, {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
      }),
    );
  }
  return true;
}

/**
 * The only completion signal the spike found trustworthy (33/40 decisions, correct whenever
 * the window was not minimized). Stop-button absence corroborates it — never send-button
 * state, which is disabled whenever the composer is empty and so cannot distinguish "busy"
 * from "idle".
 *
 * Scoped to the conversation container rather than document.body. Watching the whole page
 * means unrelated chrome — sidebars, autosave, blinking cursors — keeps resetting the quiet
 * timer, which is what made Gemini take far longer to register than it actually needed.
 */
async function awaitQuiescence(adapter: ProviderAdapter): Promise<void> {
  const deadline = performance.now() + driverTimings.detectTimeoutMs;
  let lastMutation = performance.now();

  const observer = new MutationObserver(() => {
    lastMutation = performance.now();
  });
  observer.observe(conversationRoot(adapter), {
    childList: true,
    subtree: true,
    characterData: true,
  });

  try {
    let sawStop = false;
    let stopGoneSince: number | null = null;

    while (performance.now() < deadline) {
      await sleep(250);
      const quietFor = performance.now() - lastMutation;

      const stopVisible = anyVisible(adapter.generating.stopSelectors);
      // A visible stop button normally means it is still working, whatever the DOM does —
      // but only while the conversation is actually changing. A stop button sitting over a
      // completely static thread is stale UI, and believing it costs the full timeout.
      const stopIsCredible = stopVisible && quietFor < driverTimings.staleStopMs;

      if (stopIsCredible) {
        sawStop = true;
        stopGoneSince = null;
        continue;
      }
      stopGoneSince ??= performance.now();

      // Fast path: generation demonstrably started and has demonstrably stopped.
      if (sawStop && performance.now() - stopGoneSince >= STOP_GONE_CONFIRM_MS) {
        if (quietFor >= QUIESCENCE_MS) return;
      } else if (quietFor >= QUIESCENCE_MS * QUIESCENCE_CONFIRM) {
        // Slow path: no usable stop button, so silence is all we have. Demand more of it.
        return;
      }
    }
    raise('detect-timeout', `no quiet period within ${driverTimings.detectTimeoutMs}ms`);
  } finally {
    observer.disconnect();
  }
}

/** The tightest element containing the conversation turns, so unrelated UI is ignored. */
function conversationRoot(adapter: ProviderAdapter): Node {
  for (const sel of adapter.response.selectors) {
    const matches = deepQueryAll(sel).filter(isVisible);
    const last = matches[matches.length - 1] as HTMLElement | undefined;
    if (last?.parentElement) return last.parentElement;
  }
  return document.querySelector('main') ?? document.body;
}

function extract(adapter: ProviderAdapter, excludeKey: string | null): TurnExtraction | undefined {
  const o = adapter.overrides?.extract?.(adapter);
  if (o) return o;

  const fromMessage = pickNewest(turnView(adapter), excludeKey);
  // Artifacts are a separate panel, not part of the turn sequence, so no identity guard.
  const fromArtifact = pickLast(adapter.artifact?.selectors ?? []);

  // Prefer whichever actually holds the content. Claude in Cowork puts a 278-char summary in
  // the thread and the real answer in the artifact, so "message exists" is not enough —
  // a substantially longer artifact wins.
  if (fromArtifact && (!fromMessage || fromArtifact.text.length > fromMessage.text.length * 1.5)) {
    return { ...fromArtifact, via: 'artifact' };
  }
  if (fromMessage) return { ...fromMessage, via: 'message' };
  return undefined;
}

/**
 * Last match with actual text, walking backwards but never past `minIndex`.
 *
 * ChatGPT can leave an empty trailing assistant element — a canvas card, or a shell whose
 * body moved elsewhere — so taking strictly the last node reports extract-empty for a reply
 * that is sitting right there. Walking back finds it. The floor is what stops that walk from
 * quietly returning the previous round's turn, which would corrupt the panel invisibly.
 */
/** Newest turn with text, never reaching back into the turn that predates our send. */
function pickNewest(
  view: TurnView,
  excludeKey: string | null,
): { text: string; html: string } | undefined {
  for (let i = view.els.length - 1; i >= 0; i--) {
    const el = view.els[i]!;
    // Walking back past an empty trailing node is necessary — ChatGPT's canvas leaves one.
    // Walking back INTO the turn that was already newest before we sent would hand back the
    // previous round's reply, so stop there.
    if (excludeKey !== null && view.keys[i] === excludeKey) break;
    const text = readText(el);
    if (text.trim().length > 0) return { text, html: el.innerHTML };
  }
  return undefined;
}

/** Last element with text across the given selectors. Used for artifact panels. */
function pickLast(selectors: string[]): { text: string; html: string } | undefined {
  for (const sel of selectors) {
    const matches = deepQueryAll(sel).filter(isVisible) as HTMLElement[];
    for (let i = matches.length - 1; i >= 0; i--) {
      const el = matches[i];
      if (!el) continue;
      const text = readText(el);
      if (text.trim().length > 0) return { text, html: el.innerHTML };
    }
  }
  return undefined;
}

async function waitFor<T>(fn: () => T | undefined, timeout: number): Promise<T | undefined> {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    const v = fn();
    if (v !== undefined) return v;
    await sleep(200);
  }
  return undefined;
}
