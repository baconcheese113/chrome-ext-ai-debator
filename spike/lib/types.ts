/**
 * THE ARTEFACT UNDER TEST.
 *
 * Experiment E1 asks: can a provider be driven by data alone? Every field here is a bet
 * that some aspect of "drive a chat UI" is expressible as configuration. `overrides` is the
 * escape hatch, and every override a provider is forced to use is a point against
 * architecture A (pure config) and for architecture C (config + code hooks).
 *
 * Do NOT quietly generalise the driver to absorb a provider's weirdness. Put the weirdness
 * in an override so it shows up in the findings.
 */

export type ProviderId = 'claude' | 'chatgpt' | 'gemini' | 'grok';

export interface ProviderConfig {
  id: ProviderId;
  label: string;

  /** URL that lands on a brand-new, empty chat. */
  newChatUrl: string;

  /** How to find the box we type into. Selectors are tried in order; first visible match wins. */
  composer: {
    selectors: string[];
    /** 'auto' inspects the found node rather than trusting the config. */
    kind: 'textarea' | 'contenteditable' | 'auto';
  };

  /** How to send the prompt once typed. */
  submit: {
    /** 'auto' tries the button first, falls back to Enter. */
    strategy: 'enter' | 'click' | 'auto';
    buttonSelectors?: string[];
  };

  /**
   * Signals that the model is still generating. All are evaluated every poll and recorded
   * independently, so E2 can compare which signal is actually trustworthy per provider.
   */
  generating: {
    /** If any of these EXISTS and is visible, the model is generating (e.g. a stop button). */
    presentSelectors?: string[];
    /** If any of these is MISSING or disabled, the model is generating (e.g. the send button). */
    enabledSelectors?: string[];
  };

  /** Where the assistant's reply lands. The LAST match is treated as the current reply. */
  response: {
    selectors: string[];
  };

  /** Code escape hatches. Presence of any of these is itself a finding. */
  overrides?: DriverOverrides;
}

/**
 * Every override receives the config so it can still lean on the declarative parts.
 * Returning `undefined` from a hook means "fall through to the generic implementation".
 */
export interface DriverOverrides {
  findComposer?(cfg: ProviderConfig): HTMLElement | undefined;
  injectText?(el: HTMLElement, text: string, cfg: ProviderConfig): boolean | undefined;
  submit?(el: HTMLElement, cfg: ProviderConfig): boolean | undefined;
  isGenerating?(cfg: ProviderConfig): boolean | undefined;
  extract?(cfg: ProviderConfig): ExtractedResponse | undefined;
}

export interface ExtractedResponse {
  text: string;
  html: string;
  /** How the text was obtained — 'selector' means the config worked; anything else is a miss. */
  via: 'selector' | 'override' | 'text-delta-heuristic';
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export type Phase = 'navigate' | 'findComposer' | 'inject' | 'submit' | 'detect' | 'extract';

export type Outcome = 'pass' | 'partial' | 'fail';

/**
 * Timestamps (ms since submit) at which each completion signal first indicated "done".
 * Recorded independently and ALL reported, because the point of E2 is finding out which
 * signal to trust — not confirming a guess.
 */
export interface CompletionSignals {
  /** Stop-button-like element disappeared. */
  stopGoneAt: number | null;
  /** Send button became enabled again. */
  sendEnabledAt: number | null;
  /** No DOM mutations under the response root for QUIESCENCE_MS. */
  quiescenceAt: number | null;
  /** Timestamp of the final mutation observed. The "true" end of streaming. */
  lastMutationAt: number | null;
  /** Times the detector would have fired "done" but then more content arrived. */
  falseFires: number;
  /** Which signal the driver actually acted on. */
  decidedBy: 'stopGone' | 'sendEnabled' | 'quiescence' | 'timeout' | 'none';
}

export interface RunResult {
  provider: ProviderId;
  experiment: string;
  run: number;
  outcome: Outcome;
  /** Phase that failed, if any. */
  failedPhase?: Phase;
  failureMode?: string;
  timings: Partial<Record<Phase, number>>;
  signals?: CompletionSignals;
  /** Which config selector matched, per phase — tells us what to keep and what to delete. */
  matchedSelectors: Record<string, string | null>;
  /** True if any override hook was used. Central to E1. */
  usedOverrides: string[];
  extraction?: {
    via: ExtractedResponse['via'];
    textLength: number;
    htmlLength: number;
    textSample: string;
    /** E3: did structure survive? */
    hasCodeBlock: boolean;
    hasList: boolean;
    hasTable: boolean;
  };
  /** Populated whenever something wasn't found, so a failed run is still useful data. */
  diagnostics?: Diagnostics;
  windowState: 'focused' | 'unfocused' | 'minimized';
}

export interface Diagnostics {
  url: string;
  title: string;
  candidateComposers: ElementSketch[];
  candidateButtons: ElementSketch[];
  candidateResponseContainers: ElementSketch[];
  note: string;
}

export interface ElementSketch {
  tag: string;
  id: string;
  classes: string;
  ariaLabel: string;
  testId: string;
  role: string;
  contentEditable: string;
  disabled: boolean;
  visible: boolean;
  textLength: number;
  /** A best-effort unique-ish selector, so we can paste it straight into a config. */
  suggestedSelector: string;
}

export interface ProbeRequest {
  provider: ProviderId;
  prompt: string;
  experiment: string;
  run: number;
  windowState: 'focused' | 'unfocused' | 'minimized';
}
