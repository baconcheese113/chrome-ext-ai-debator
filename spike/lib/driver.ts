import { collectDiagnostics } from './diagnostics';
import { anyEnabled, anyVisible, deepQueryAll, firstVisible, isVisible, lastVisible, sleep } from './dom';
import type {
  CompletionSignals,
  ExtractedResponse,
  Phase,
  ProviderConfig,
  RunResult,
} from './types';

/** No mutations for this long under the response root => quiescent. */
const QUIESCENCE_MS = 1500;
/** Signals must hold this long before we believe them — catches mid-stream flickers. */
const CONFIRM_MS = 700;

const TIMEOUTS: Record<Phase, number> = {
  navigate: 30_000,
  findComposer: 30_000,
  inject: 30_000,
  submit: 30_000,
  detect: 180_000,
  extract: 30_000,
};

class PhaseError extends Error {
  constructor(readonly phase: Phase, readonly mode: string) {
    super(`${phase}: ${mode}`);
  }
}

export interface DriveOptions {
  cfg: ProviderConfig;
  prompt: string;
}

export async function drive(
  { cfg, prompt }: DriveOptions,
): Promise<Omit<RunResult, 'provider' | 'experiment' | 'run' | 'windowState'>> {
  const timings: Partial<Record<Phase, number>> = {};
  const matchedSelectors: Record<string, string | null> = {};
  const usedOverrides: string[] = [];
  const mark = (p: Phase, from: number) => {
    timings[p] = Math.round(performance.now() - from);
  };

  let signals: CompletionSignals | undefined;
  let extraction: RunResult['extraction'];

  try {
    // --- findComposer -------------------------------------------------------
    let tp = performance.now();
    const composer = await waitFor(
      () => {
        if (cfg.overrides?.findComposer) {
          const el = cfg.overrides.findComposer(cfg);
          if (el) {
            if (!usedOverrides.includes('findComposer')) usedOverrides.push('findComposer');
            matchedSelectors.composer = '<override>';
            return el;
          }
        }
        const hit = firstVisible(cfg.composer.selectors);
        if (hit) {
          matchedSelectors.composer = hit.selector;
          return hit.el;
        }
        return undefined;
      },
      TIMEOUTS.findComposer,
    );
    if (!composer) throw new PhaseError('findComposer', 'no selector matched a visible element');
    mark('findComposer', tp);

    // --- inject -------------------------------------------------------------
    tp = performance.now();
    const injected =
      cfg.overrides?.injectText?.(composer, prompt, cfg) ?? injectText(composer, prompt, cfg);
    if (cfg.overrides?.injectText) usedOverrides.push('injectText');
    if (!injected) throw new PhaseError('inject', 'composer did not accept text');
    // Frameworks debounce; give the send button a moment to enable.
    await sleep(300);
    mark('inject', tp);

    // --- submit -------------------------------------------------------------
    tp = performance.now();
    const submitted = cfg.overrides?.submit?.(composer, cfg) ?? submit(composer, cfg, matchedSelectors);
    if (cfg.overrides?.submit) usedOverrides.push('submit');
    if (!submitted) throw new PhaseError('submit', 'no send button and Enter had no effect');
    mark('submit', tp);

    // --- detect -------------------------------------------------------------
    tp = performance.now();
    signals = await awaitCompletion(cfg, usedOverrides);
    mark('detect', tp);
    if (signals.decidedBy === 'timeout') {
      return {
        outcome: 'partial',
        failedPhase: 'detect',
        failureMode: 'timeout:detect (response may still have arrived — see extraction)',
        timings,
        signals,
        matchedSelectors,
        usedOverrides,
        extraction: safeExtract(cfg, matchedSelectors, usedOverrides),
        diagnostics: collectDiagnostics('detect timed out'),
      };
    }

    // --- extract ------------------------------------------------------------
    tp = performance.now();
    extraction = safeExtract(cfg, matchedSelectors, usedOverrides);
    mark('extract', tp);
    if (!extraction || extraction.textLength === 0) {
      throw new PhaseError('extract', 'response selectors matched nothing with text');
    }

    return {
      outcome: extraction.via === 'selector' ? 'pass' : 'partial',
      timings,
      signals,
      matchedSelectors,
      usedOverrides,
      extraction,
      // A heuristic fallback means the config was wrong — capture what it should have been.
      diagnostics: extraction.via === 'selector' ? undefined : collectDiagnostics('extracted via fallback'),
    };
  } catch (err) {
    const pe = err instanceof PhaseError ? err : undefined;
    return {
      outcome: 'fail',
      failedPhase: pe?.phase,
      failureMode: pe?.mode ?? String(err),
      timings,
      signals,
      matchedSelectors,
      usedOverrides,
      extraction,
      diagnostics: collectDiagnostics(pe ? `failed at ${pe.phase}` : 'unexpected error'),
    };
  }
}

// ---------------------------------------------------------------------------

async function waitFor<T>(fn: () => T | undefined, timeout: number): Promise<T | undefined> {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    const v = fn();
    if (v) return v;
    await sleep(200);
  }
  return undefined;
}

function injectText(el: HTMLElement, text: string, cfg: ProviderConfig): boolean {
  const kind =
    cfg.composer.kind === 'auto'
      ? el.tagName === 'TEXTAREA' || el.tagName === 'INPUT'
        ? 'textarea'
        : 'contenteditable'
      : cfg.composer.kind;

  el.focus();

  if (kind === 'textarea') {
    const input = el as HTMLTextAreaElement;
    // React tracks value on the DOM node; assigning .value directly is swallowed on the next
    // render. Going through the prototype setter is what makes React see the change.
    const setter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(input),
      'value',
    )?.set;
    setter ? setter.call(input, text) : (input.value = text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return input.value.includes(text.slice(0, 20));
  }

  // contenteditable: execCommand keeps ProseMirror/Quill's internal model in sync, which
  // setting textContent does not. Deprecated but still the only thing these editors respect.
  const ok = document.execCommand('insertText', false, text);
  if (!ok) {
    el.textContent = text;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
  }
  return (el.innerText ?? '').includes(text.slice(0, 20));
}

function submit(
  composer: HTMLElement,
  cfg: ProviderConfig,
  matched: Record<string, string | null>,
): boolean {
  const tryClick = () => {
    for (const sel of cfg.submit.buttonSelectors ?? []) {
      const btn = deepQueryAll(sel).find(
        (b) => isVisible(b) && !(b as HTMLButtonElement).disabled && b.getAttribute('aria-disabled') !== 'true',
      ) as HTMLElement | undefined;
      if (btn) {
        matched.submit = sel;
        btn.click();
        return true;
      }
    }
    return false;
  };

  const tryEnter = () => {
    matched.submit = '<Enter key>';
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
  };

  if (cfg.submit.strategy === 'click') return tryClick();
  if (cfg.submit.strategy === 'enter') return tryEnter();
  return tryClick() || tryEnter();
}

/**
 * E2's instrument. Every signal is tracked independently for the whole run and reported —
 * we act on the first one that holds steady, but the findings get all of them so we can see
 * which signal was actually correct.
 */
async function awaitCompletion(
  cfg: ProviderConfig,
  usedOverrides: string[],
): Promise<CompletionSignals> {
  const start = performance.now();
  const now = () => Math.round(performance.now() - start);

  const signals: CompletionSignals = {
    stopGoneAt: null,
    sendEnabledAt: null,
    quiescenceAt: null,
    lastMutationAt: null,
    falseFires: 0,
    decidedBy: 'none',
  };

  let lastMutation = performance.now();
  const observer = new MutationObserver(() => {
    lastMutation = performance.now();
    signals.lastMutationAt = now();
    // Content arrived after we'd already concluded a signal meant "done".
    if (signals.stopGoneAt !== null || signals.quiescenceAt !== null || signals.sendEnabledAt !== null) {
      signals.falseFires++;
      signals.stopGoneAt = null;
      signals.quiescenceAt = null;
      signals.sendEnabledAt = null;
    }
  });
  const root = lastVisible(cfg.response.selectors)?.el.closest('main') ?? document.body;
  observer.observe(root, { childList: true, subtree: true, characterData: true });

  // Generation must actually start before its absence means anything. Without this the
  // detector fires instantly, before the model has produced a single token.
  const genStartDeadline = performance.now() + 15_000;
  let started = false;
  while (performance.now() < genStartDeadline) {
    if (isGenerating(cfg, usedOverrides)) {
      started = true;
      break;
    }
    await sleep(150);
  }

  const deadline = performance.now() + TIMEOUTS.detect;
  let stopGoneSince: number | null = null;
  let sendEnabledSince: number | null = null;

  while (performance.now() < deadline) {
    await sleep(200);
    const generating = isGenerating(cfg, usedOverrides);

    if (!generating) {
      stopGoneSince ??= performance.now();
      if (performance.now() - stopGoneSince >= CONFIRM_MS) signals.stopGoneAt ??= now();
    } else {
      stopGoneSince = null;
    }

    if (anyEnabled(cfg.generating.enabledSelectors)) {
      sendEnabledSince ??= performance.now();
      if (performance.now() - sendEnabledSince >= CONFIRM_MS) signals.sendEnabledAt ??= now();
    } else {
      sendEnabledSince = null;
    }

    if (performance.now() - lastMutation >= QUIESCENCE_MS) signals.quiescenceAt ??= now();

    // Require quiescence alongside any button signal. A button flipping back mid-stream is
    // common; the DOM going quiet at the same time is not.
    const quiet = signals.quiescenceAt !== null;
    if (quiet && signals.stopGoneAt !== null && started) {
      signals.decidedBy = 'stopGone';
      break;
    }
    if (quiet && signals.sendEnabledAt !== null) {
      signals.decidedBy = 'sendEnabled';
      break;
    }
    // Nothing to observe but silence — accept a longer quiet period on its own.
    if (quiet && performance.now() - lastMutation >= QUIESCENCE_MS * 3) {
      signals.decidedBy = 'quiescence';
      break;
    }
  }

  if (signals.decidedBy === 'none') signals.decidedBy = 'timeout';
  observer.disconnect();
  return signals;
}

function isGenerating(cfg: ProviderConfig, usedOverrides: string[]): boolean {
  if (cfg.overrides?.isGenerating) {
    const v = cfg.overrides.isGenerating(cfg);
    if (v !== undefined) {
      if (!usedOverrides.includes('isGenerating')) usedOverrides.push('isGenerating');
      return v;
    }
  }
  if (anyVisible(cfg.generating.presentSelectors)) return true;
  // Send button disabled while text is present is the other common "busy" tell.
  const enabled = anyEnabled(cfg.generating.enabledSelectors);
  if (cfg.generating.enabledSelectors?.length && !enabled) return true;
  return false;
}

function safeExtract(
  cfg: ProviderConfig,
  matched: Record<string, string | null>,
  usedOverrides: string[],
): RunResult['extraction'] {
  let res: ExtractedResponse | undefined;
  if (cfg.overrides?.extract) {
    res = cfg.overrides.extract(cfg);
    if (res) usedOverrides.push('extract');
  }
  if (!res) {
    const hit = lastVisible(cfg.response.selectors);
    if (hit && (hit.el.innerText ?? '').trim().length > 0) {
      matched.response = hit.selector;
      res = { text: hit.el.innerText, html: hit.el.innerHTML, via: 'selector' };
    }
  }
  if (!res) {
    matched.response = null;
    res = textDeltaFallback();
  }
  if (!res) return undefined;

  return {
    via: res.via,
    textLength: res.text.length,
    htmlLength: res.html.length,
    textSample: res.text.slice(0, 600),
    hasCodeBlock: /<pre|<code/i.test(res.html),
    hasList: /<[uo]l\b/i.test(res.html),
    hasTable: /<table\b/i.test(res.html),
  };
}

/**
 * Last resort when the response selectors are wrong: find the tightest element holding a
 * large block of text that looks like a model reply. Produces `via: 'text-delta-heuristic'`,
 * which marks the run `partial` — the pipeline worked, the config didn't.
 */
function textDeltaFallback(): ExtractedResponse | undefined {
  let best: { el: Element; density: number } | undefined;
  for (const el of deepQueryAll('div, article, section, message-content, model-response')) {
    if (!isVisible(el)) continue;
    const text = (el as HTMLElement).innerText ?? '';
    if (text.length < 100) continue;
    const density = text.length / Math.max(1, el.querySelectorAll('*').length);
    if (!best || density > best.density) best = { el, density };
  }
  if (!best) return undefined;
  return {
    text: (best.el as HTMLElement).innerText,
    html: best.el.innerHTML,
    via: 'text-delta-heuristic',
  };
}
