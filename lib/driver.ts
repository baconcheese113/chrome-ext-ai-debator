import { collectDiagnostics } from './diagnostics';
import { anyVisible, deepQueryAll, firstVisible, isVisible, readText, sleep } from './dom';
import type {
  Diagnostics,
  DriveFailure,
  DriveRequest,
  DriveResult,
  ProviderAdapter,
  TurnExtraction,
  TurnKey,
} from './types';

export type { TurnKey };

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
 * Failures that mean "we may simply have looked too early", as opposed to "this is broken".
 *
 * A reasoning model produces a long stretch of *completely static DOM* between accepting the
 * prompt and writing its answer — Kimi renders a collapsed "Thinking" header and then goes
 * silent while it reasons server-side. Silence is our completion signal, so the driver called
 * the turn finished and extracted the header: a confident 86-character answer to a question
 * the model had not started answering.
 *
 * The honest response to these two failures is not to fail, it is to look again after longer.
 */
const SETTLE_RETRYABLE: readonly DriveFailure[] = [
  'implausible-response',
  'incomplete-reply',
  'extract-empty',
];

/**
 * The E2E build drives a local mock that replies in milliseconds, so the production waits are
 * pure dead time there — they were most of a five-minute suite. Compressed as a set, keeping
 * every ratio the logic depends on, so the behaviour under test is the same behaviour.
 */
const E2E = import.meta.env.WXT_E2E === 'true';

/**
 * Every waiting period, in one place, so tests can shrink them instead of enduring them.
 *
 * These are not arbitrary. Each one is a scar: see the comments on the defaults below, and on
 * `staleStopMs` above.
 */
export const driverTimings = {
  newMessageTimeoutMs: E2E ? 3_000 : 45_000,
  detectTimeoutMs: E2E ? 30_000 : 300_000,
  staleStopMs: E2E ? 5_000 : STALE_STOP_DEFAULT_MS,
  /**
   * Quiescence threshold. ChatGPT logged 85–97 mutation bursts inside a single long response,
   * so this has the least headroom there — shortening it breaks ChatGPT first.
   */
  quiescenceMs: E2E ? 250 : 1_800,
  /**
   * Multiplier applied when we have NO generating signal to corroborate with, so silence is
   * all we have. The pessimistic path; anything with a working stop control finishes sooner.
   */
  quiescenceConfirm: 3,
  /** Once generation has demonstrably started and stopped, this much quiet is enough. */
  stopGoneConfirmMs: E2E ? 150 : 900,
  /** How often the waiting loops look at the page. */
  pollMs: E2E ? 80 : 250,
  /**
   * Silence demanded on each successive re-look after a truncation-shaped result. Escalating
   * rather than fixed: the first re-look catches a short thinking pause cheaply, the second
   * survives a model that reasons for half a minute before typing. Bounded, because a reply
   * that is still too short after this really is too short.
   */
  settleQuietMs: (E2E ? [700, 1_400] : [12_000, 30_000]) as number[],
};

/** Outcome of phase 1. `before` is the pre-send message count, needed by phase 2. */
export interface SubmitResult {
  ok: boolean;
  before?: TurnKey;
  /** The composer controls as they looked ready-to-send, so a swap back means "finished". */
  idleAction?: string | null;
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

    // Photographed with the prompt in the box and before the click, so this is the control's
    // "ready to send" state — the state it returns to when the reply is finished.
    const idleAction = actionSignature(adapter);

    p = performance.now();
    if (!(adapter.overrides?.submit?.(composer, adapter) ?? submit(composer, adapter))) {
      raise('submit-failed', 'no enabled send button and Enter had no effect');
    }
    t('submit', p);

    return { ok: true, before, idleAction, timings, warning };
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
  idleAction?: string | null,
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

    // Look, judge, and if the answer merely looks unfinished, wait longer and look again.
    for (let look = 0; ; look++) {
      const extraQuiet = look === 0 ? 0 : (driverTimings.settleQuietMs[look - 1] ?? 0);

      p = performance.now();
      await awaitQuiescence(adapter, extraQuiet, idleAction);
      t(look === 0 ? 'detect' : `settle${look}`, p);

      p = performance.now();
      extracted = extract(adapter, before.key);
      const problem = judge(extracted, req, adapter);
      t(look === 0 ? 'extract' : `extract${look}`, p);

      if (!problem) break;
      if (look >= driverTimings.settleQuietMs.length || !SETTLE_RETRYABLE.includes(problem.failure)) {
        throw problem;
      }
    }

    return { ok: true, extraction: extracted, before, timings, warning };
  } catch (err) {
    const de = err instanceof DriveError ? err : undefined;
    return {
      ok: false,
      failure: de?.failure ?? 'driver-error',
      detail: de?.detail ?? String(err),
      before,
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
      // Undefined: nothing went in, so there is nothing for a later re-read to find except
      // the previous round's reply. The orchestrator uses this to decide whether re-reading
      // is even offered.
      before: submitted.before,
      timings: submitted.timings,
      diagnostics: submitted.diagnostics,
    };
  }
  return awaitTurn(
    adapter,
    req,
    submitted.before!,
    submitted.timings,
    submitted.warning,
    submitted.idleAction,
  );
}

function raise(failure: DriveFailure, detail: string): never {
  throw new DriveError(failure, detail);
}

/**
 * Everything wrong with what we just read, as a value rather than a throw — so a caller can
 * decide whether it is worth waiting and reading again.
 */
function judge(
  extraction: TurnExtraction | undefined,
  req: DriveRequest,
  adapter: ProviderAdapter,
): DriveError | undefined {
  if (!extraction || extraction.text.trim().length === 0) {
    return new DriveError(
      'extract-empty',
      `a new turn appeared but held no text (selector: ${lastTurnKey(adapter).selector ?? 'none'}) — ` +
        'the reply may have gone to a canvas or artifact; use Diagnose on this tab',
    );
  }
  try {
    validate(extraction, req);
  } catch (err) {
    if (err instanceof DriveError) return err;
    throw err;
  }
  return undefined;
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

  // The end of the reply is the only thing whose absence proves we did not get all of it.
  // A length floor cannot: Kimi cleared it with 968 characters that stopped mid-word, every
  // round of every run, and the panel recorded the fragment as its contribution.
  if (req.requireTail && !text.includes(req.requireTail)) {
    const tail = text.slice(-60).replace(/\s+/g, ' ');
    raise(
      'incomplete-reply',
      `${text.length} chars, but the closing "${req.requireTail}" line is missing — ` +
        `this stops at "…${tail}", so it is a fragment rather than the whole reply`,
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
 *
 * The `TurnKey` shape itself lives in lib/types.ts, because it now crosses the page boundary:
 * the orchestrator holds one so it can ask the page to look again later.
 */

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
async function awaitQuiescence(
  adapter: ProviderAdapter,
  minQuietMs = 0,
  idleAction?: string | null,
): Promise<void> {
  const deadline = performance.now() + driverTimings.detectTimeoutMs;
  let lastMutation = performance.now();

  const observer = new MutationObserver(() => {
    lastMutation = performance.now();
  });
  const OBSERVE = { childList: true, subtree: true, characterData: true };
  let root = conversationRoot(adapter);
  observer.observe(root, OBSERVE);

  try {
    let sawStop = false;
    let stopGoneSince: number | null = null;
    /**
     * The control's appearance once it left its ready-to-send state. Latched once.
     *
     * Completion is "it changed back", not "it matches the ready state byte for byte" — a
     * control that comes to rest even slightly differently (a class that was absent before
     * the first send, say) would otherwise read as busy forever and cost the whole timeout.
     */
    let busyAction: string | null = null;

    while (performance.now() < deadline) {
      await sleep(driverTimings.pollMs);

      // A framework that re-renders the thread can swap out the node we are watching, leaving
      // the observer attached to a detached subtree. Every subsequent mutation is invisible,
      // the page looks instantly quiet, and a reply still being written reads as finished.
      if (!root.isConnected) {
        root = conversationRoot(adapter);
        observer.observe(root, OBSERVE);
        lastMutation = performance.now();
      }

      const quietFor = performance.now() - lastMutation;

      // The provider's own answer, and the primary signal: the composer's action control
      // left its ready-to-send state when generation began, and has not changed back.
      const sig = idleAction != null ? actionSignature(adapter) : null;
      if (sig != null && busyAction === null && sig !== idleAction) busyAction = sig;
      const actionBusy = busyAction !== null && sig === busyAction;
      const stopVisible = stopSignal(adapter) ?? (actionBusy ? 'composer action control' : null);
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

      // A re-look demands its own floor on top of whichever path fires. Without it, calling
      // this again while the page is already static returns instantly and re-reads exactly
      // the same half-finished answer.
      if (quietFor < minQuietMs) continue;

      // Fast path: generation demonstrably started and has demonstrably stopped.
      if (sawStop && performance.now() - stopGoneSince >= driverTimings.stopGoneConfirmMs) {
        if (quietFor >= driverTimings.quiescenceMs) return;
      } else if (quietFor >= driverTimings.quiescenceMs * driverTimings.quiescenceConfirm) {
        // Slow path: no usable stop button, so silence is all we have. Demand more of it.
        return;
      }
    }
    raise('detect-timeout', `no quiet period within ${driverTimings.detectTimeoutMs}ms`);
  } finally {
    observer.disconnect();
  }
}

/**
 * Last-resort stop-button patterns, tried only when an adapter's own selectors match nothing.
 *
 * Every provider names this control "stop" somewhere a screen reader or a test can find it,
 * because it has to. Kimi is the case in point: it has a perfectly good stop button, our
 * adapter did not know its selector, so the driver fell back to pure silence and mistook a
 * reasoning pause for a finished answer.
 *
 * Deliberately narrow — these match only elements that literally say "stop". A false match
 * here costs a wait, not a wrong answer, because a stop button over a static thread is
 * disbelieved after `staleStopMs`.
 */
const GENERIC_STOP_SELECTORS = [
  'button[data-testid*="stop" i]',
  'button[aria-label*="stop" i]',
  'button[title*="stop" i]',
  '[role="button"][aria-label*="stop" i]',
];

function stopSignal(adapter: ProviderAdapter): string | null {
  return anyVisible(adapter.generating.stopSelectors) ?? anyVisible(GENERIC_STOP_SELECTORS);
}

/** Things a composer's action control might be built from, in any of these UIs. */
const ACTION_CONTROLISH =
  'button, [role="button"], svg, [class*="btn" i], [class*="send" i], [class*="stop" i], [class*="submit" i]';

/**
 * A fingerprint of the controls sitting with the composer.
 *
 * Every one of these products answers "am I still writing?" in the same place: the composer's
 * action control turns from send into stop for exactly the duration of a reply, and back
 * again when it finishes. That is the provider's own signal, published for its own UI, and it
 * beats inferring completion from DOM silence — silence is also what a model reasoning
 * server-side looks like.
 *
 * Fingerprinted rather than matched by selector, because the control is not always nameable.
 * Kimi's is an unlabelled icon: no aria-label, no test id, nothing containing "stop". It is
 * invisible to every selector we could write, and perfectly visible as a change.
 *
 * Structural attributes only — no text. A token counter or model picker sitting in the same
 * row would otherwise read as the button changing.
 */
function actionSignature(adapter: ProviderAdapter): string | null {
  const composer = findComposer(adapter);
  if (!composer) return null;

  let region: Element = composer;
  for (let depth = 0; depth < 5; depth++) {
    const parent: Element | null = region.parentElement;
    if (!parent || parent === document.body || parent === document.documentElement) break;
    region = parent;
    if ((region.textContent?.length ?? 0) > 3000) break;
  }

  const parts: string[] = [];
  for (const el of Array.from(region.querySelectorAll(ACTION_CONTROLISH))) {
    if (el === composer || composer.contains(el)) continue;
    if (!isVisible(el)) continue;
    parts.push(
      [
        el.tagName,
        el.getAttribute('data-testid') ?? '',
        el.getAttribute('aria-label') ?? '',
        el.getAttribute('class') ?? '',
        // Deliberately NOT the disabled state. Sending empties the composer, which leaves the
        // send button disabled until you type again — so a signature including it never
        // returns to its pre-send value and the reply reads as never-ending. This is the
        // spike's original finding, and it would have come straight back in through here.
        // The icon itself. A send arrow and a stop square are different paths, and on an
        // unlabelled control this is the only thing that differs.
        (el.tagName === 'svg' ? el.querySelector('path')?.getAttribute('d') : '')?.slice(0, 48) ?? '',
      ].join('|'),
    );
  }
  return parts.length ? parts.join('\n') : null;
}

/**
 * Arm a capture and take it once the page starts answering.
 *
 * Some controls only exist for the seconds a model is generating — the stop button above all.
 * Asking someone to send a prompt and then reach a Diagnose button in another tab before the
 * model finishes is a stopwatch, not a workflow, and three captures in a row have come back
 * without the control we needed. So the page watches for itself.
 *
 * The trigger deliberately does NOT depend on knowing the stop selector, since not knowing it
 * is the reason we are here. A new turn appearing, or the page simply gaining text, is enough.
 */
export async function diagnoseWhenBusy(
  adapter: ProviderAdapter,
  timeoutMs = 90_000,
): Promise<Diagnostics> {
  const mainText = () =>
    (document.querySelector('main') ?? document.body)?.textContent?.length ?? 0;

  const baselineKey = lastTurnKey(adapter).key;
  const baselineLen = mainText();
  const deadline = performance.now() + timeoutMs;

  while (performance.now() < deadline) {
    await sleep(driverTimings.pollMs);
    const started =
      lastTurnKey(adapter).key !== baselineKey ||
      stopSignal(adapter) !== null ||
      mainText() - baselineLen > 40;

    if (started) {
      // Let the composer swap into its generating state before photographing it.
      await sleep(1500);
      return collectDiagnostics('captured while the model was answering');
    }
  }
  return collectDiagnostics(
    'armed, but the page never started answering within the time limit — captured as-is',
  );
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
    await sleep(driverTimings.pollMs);
  }
  return undefined;
}
