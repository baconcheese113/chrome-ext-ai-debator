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
/** Quiet must hold this multiple of QUIESCENCE_MS before we call it done. */
const QUIESCENCE_CONFIRM = 3;
const NEW_MESSAGE_TIMEOUT_MS = 45_000;
const DETECT_TIMEOUT_MS = 300_000;

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
      () => (countMessages(adapter) > before ? true : undefined),
      NEW_MESSAGE_TIMEOUT_MS,
    );
    if (!appeared) raise('no-new-message', `assistant message count stayed at ${before}`);
    t('firstToken', p);

    p = performance.now();
    await awaitQuiescence(adapter);
    t('detect', p);

    p = performance.now();
    const extraction = extract(adapter);
    if (!extraction || extraction.text.trim().length === 0) {
      raise('extract-empty', 'no response selector yielded text');
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

  if (text.length < req.minChars) {
    raise(
      'implausible-response',
      `only ${text.length} chars, expected at least ${req.minChars} — likely truncated`,
    );
  }

  // Gemini under throttling returned "You said / <our prompt>". If most of what we got back
  // is our own prompt, we captured the user turn, not the reply.
  const probe = req.prompt.slice(0, 80).trim();
  if (probe.length > 30 && text.includes(probe) && text.length < req.prompt.length * 1.4) {
    raise('prompt-echo', 'extracted text is mostly our own prompt echoed back');
  }
}

function countMessages(adapter: ProviderAdapter): number {
  for (const sel of adapter.response.selectors) {
    const n = deepQueryAll(sel).filter(isVisible).length;
    if (n > 0) return n;
  }
  return 0;
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
 * the window was not minimized). Stop-button absence is used as corroboration only — never
 * send-button state, which is disabled whenever the composer is empty and so can never
 * distinguish "busy" from "idle".
 */
async function awaitQuiescence(adapter: ProviderAdapter): Promise<void> {
  const deadline = performance.now() + DETECT_TIMEOUT_MS;
  let lastMutation = performance.now();

  const observer = new MutationObserver(() => {
    lastMutation = performance.now();
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  try {
    while (performance.now() < deadline) {
      await sleep(250);
      const quietFor = performance.now() - lastMutation;
      const stopVisible = anyVisible(adapter.generating.stopSelectors);

      // A visible stop button means it's definitely still working, whatever the DOM is doing.
      if (stopVisible) continue;
      if (quietFor >= QUIESCENCE_MS * QUIESCENCE_CONFIRM) return;
    }
    raise('detect-timeout', `no quiet period within ${DETECT_TIMEOUT_MS}ms`);
  } finally {
    observer.disconnect();
  }
}

function extract(adapter: ProviderAdapter): TurnExtraction | undefined {
  const o = adapter.overrides?.extract?.(adapter);
  if (o) return o;

  const fromMessage = pickLast(adapter.response.selectors);
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

function pickLast(selectors: string[]): { text: string; html: string } | undefined {
  for (const sel of selectors) {
    const matches = deepQueryAll(sel).filter(isVisible);
    const el = matches[matches.length - 1] as HTMLElement | undefined;
    if (el && (el.innerText ?? '').trim().length > 0) {
      return { text: el.innerText, html: el.innerHTML };
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
