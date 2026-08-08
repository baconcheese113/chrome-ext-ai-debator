import { collectDiagnostics } from './diagnostics';
import { anyVisible, deepQueryAll, firstVisible, isVisible, sleep } from './dom';
import type {
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
 * How long a visible stop button is believed while the conversation DOM is completely
 * static. Claude has been observed showing "Stop response" on an idle thread; without this
 * the seat waits out the entire detect timeout. A model that is genuinely generating mutates
 * the DOM, so prolonged silence beneath a stop button means the button is stale.
 */
const STALE_STOP_MS = 15_000;

/**
 * Waiting periods, isolated so tests can shrink them. Two driver tests deliberately provoke
 * the no-reply timeout; at the production value they alone cost 90 seconds.
 */
export const driverTimings = {
  newMessageTimeoutMs: 45_000,
  detectTimeoutMs: 300_000,
};

class DriveError extends Error {
  constructor(readonly failure: DriveFailure, readonly detail: string) {
    super(`${failure}: ${detail}`);
  }
}

export async function drive(
  adapter: ProviderAdapter,
  req: DriveRequest,
): Promise<DriveResult> {
  const timings: Record<string, number> = {};
  const t = (k: string, from: number) => (timings[k] = Math.round(performance.now() - from));

  try {
    // Count existing assistant messages BEFORE sending. Waiting for this count to grow is
    // both our "generation started" signal and our guarantee that we extract the new turn
    // rather than re-reading the previous one — which matters now that threads persist.
    const before = countMessages(adapter);

    let p = performance.now();
    const composer =
      (await waitFor(() => findComposer(adapter), 20_000)) ??
      raise('composer-not-found', adapter.composer.selectors.join(' | '));
    t('findComposer', p);

    p = performance.now();
    if (!(adapter.overrides?.injectText?.(composer, req.prompt, adapter) ??
          injectText(composer, req.prompt, adapter))) {
      raise('inject-failed', 'composer did not accept the text');
    }
    await sleep(350); // let framework state settle so the send button enables
    t('inject', p);

    p = performance.now();
    if (!(adapter.overrides?.submit?.(composer, adapter) ?? submit(composer, adapter))) {
      raise('submit-failed', 'no enabled send button and Enter had no effect');
    }
    t('submit', p);

    p = performance.now();
    const appeared = await waitFor(
      () => (countMessages(adapter).count > before.count ? true : undefined),
      driverTimings.newMessageTimeoutMs,
    );
    if (!appeared) {
      // "Count stayed at 0" has two very different causes, and conflating them sends you
      // hunting for a rate limit when the real problem is that no selector matches the page.
      raise(
        'no-new-message',
        countMessages(adapter).count === 0
          ? 'no element on this page matched the response selectors — this adapter needs ' +
            'updating; use Diagnose on this tab'
          : `assistant message count stayed at ${before.count}`,
      );
    }
    t('firstToken', p);

    p = performance.now();
    await awaitQuiescence(adapter);
    t('detect', p);

    p = performance.now();
    // Only consider messages at or after the pre-send count, so a blank new turn can never
    // silently resolve to the previous round's reply.
    const after = countMessages(adapter);
    const minIndex = after.selector === before.selector ? before.count : 0;
    const extraction = extract(adapter, minIndex);
    if (!extraction || extraction.text.trim().length === 0) {
      raise(
        'extract-empty',
        `a new message appeared but held no text (selector: ${after.selector ?? 'none'}) — ` +
          'the reply may have gone to a canvas or artifact; use Diagnose on this tab',
      );
    }
    t('extract', p);

    validate(extraction!, req);

    return { ok: true, extraction, timings };
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

interface MessageCount {
  selector: string | null;
  count: number;
}

function countMessages(adapter: ProviderAdapter): MessageCount {
  for (const sel of adapter.response.selectors) {
    const n = deepQueryAll(sel).filter(isVisible).length;
    if (n > 0) return { selector: sel, count: n };
  }
  return { selector: null, count: 0 };
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
  return (el.innerText ?? '').includes(text.slice(0, 20));
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
      const stopIsCredible = stopVisible && quietFor < STALE_STOP_MS;

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

function extract(adapter: ProviderAdapter, minIndex = 0): TurnExtraction | undefined {
  const o = adapter.overrides?.extract?.(adapter);
  if (o) return o;

  const fromMessage = pickLast(adapter.response.selectors, minIndex);
  // Artifacts are a separate panel, not part of the turn sequence, so no index guard.
  const fromArtifact = pickLast(adapter.artifact?.selectors ?? [], 0);

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
function pickLast(
  selectors: string[],
  minIndex: number,
): { text: string; html: string } | undefined {
  for (const sel of selectors) {
    const matches = deepQueryAll(sel).filter(isVisible) as HTMLElement[];
    for (let i = matches.length - 1; i >= minIndex; i--) {
      const el = matches[i];
      if (el && (el.innerText ?? '').trim().length > 0) {
        return { text: el.innerText, html: el.innerHTML };
      }
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
