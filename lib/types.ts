// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

/**
 * Architecture C, as settled by the spike: providers are data, with optional code hooks.
 * Three of four providers needed zero overrides across 40 runs, so config is the default
 * path and an override is a signal that something unusual is going on.
 */
export interface ProviderAdapter {
  id: string;
  label: string;
  /** Used to recognise a tab the user has opened as belonging to this provider. */
  urlPatterns: string[];

  composer: {
    selectors: string[];
    kind: 'textarea' | 'contenteditable' | 'auto';
  };

  submit: {
    strategy: 'enter' | 'click' | 'auto';
    buttonSelectors?: string[];
  };

  /**
   * How to tell the model is still writing.
   *
   * `stopSelectors` name the stop control where it is nameable. But the primary signal is not
   * these selectors at all — it is that the composer's action control *swaps identity*
   * between send and stop for exactly the duration of a reply, which the driver watches
   * generically. Kimi's control is an unlabelled icon that no selector will ever name, and
   * watching it change is the only thing that works there.
   *
   * What the spike actually proved worthless was the send button's *disabled* state: an empty
   * composer disables it permanently, so "disabled" cannot distinguish busy from idle. That
   * is a narrower finding than "the button is useless", and reading it too broadly cost us
   * the best signal on the page.
   */
  generating: {
    stopSelectors?: string[];
  };

  response: {
    /** Assistant message bodies. Counting these is how we detect a new turn arriving. */
    selectors: string[];
  };

  /**
   * Artifact / canvas panel, when the model puts its answer outside the thread. Required for
   * Claude, and a live risk on ChatGPT canvas.
   */
  artifact?: {
    selectors: string[];
  };

  overrides?: DriverOverrides;
}

export interface DriverOverrides {
  findComposer?(a: ProviderAdapter): HTMLElement | undefined;
  injectText?(el: HTMLElement, text: string, a: ProviderAdapter): boolean | undefined;
  submit?(el: HTMLElement, a: ProviderAdapter): boolean | undefined;
  isGenerating?(a: ProviderAdapter): boolean | undefined;
  extract?(a: ProviderAdapter): TurnExtraction | undefined;
}

export interface TurnExtraction {
  text: string;
  html: string;
  via: 'message' | 'artifact' | 'override' | 'heuristic';
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

export interface DriveRequest {
  providerId: string;
  prompt: string;
  /** Minimum plausible reply length. Guards against the silent-truncation failure mode. */
  minChars: number;
  /**
   * A marker the finished reply must contain — in practice the CONVERGED footer every
   * participant is told to end with.
   *
   * A length floor cannot catch a fragment: Kimi returned 968 believable characters that
   * stopped mid-word ("…the missing layer is a **campaign"), cleared the 120-char floor, and
   * was committed to the panel as that round's contribution — nine rounds running, with its
   * convergence vote silently missing from every one. The end of the reply is the only thing
   * whose absence proves we did not get all of it.
   */
  requireTail?: string;
}

export type DriveFailure =
  | 'composer-not-found'
  | 'inject-failed'
  | 'submit-failed'
  | 'no-new-message'
  | 'detect-timeout'
  | 'extract-empty'
  | 'implausible-response'
  /** Believable length, but the reply's own closing line is missing — a fragment. */
  | 'incomplete-reply'
  | 'prompt-echo'
  | 'driver-error';

/**
 * Identity of the newest assistant turn at some moment — a count would be wrong, see
 * `turnView` in lib/driver.ts. Carried out of the page so a later re-read can be scoped:
 * "the newest turn, but not the one that was already newest before we sent".
 */
export interface TurnKey {
  selector: string | null;
  key: string | null;
}

export interface DriveResult {
  ok: boolean;
  failure?: DriveFailure;
  detail?: string;
  /**
   * The newest turn as it stood before we sent. Returned on success and on failure so the
   * orchestrator can re-read the page later without sending anything again.
   */
  before?: TurnKey;
  /** Non-fatal oddity worth recording, e.g. the composer read back empty after injection. */
  warning?: string;
  /**
   * Present on success, and on failures where something WAS extracted and then rejected.
   * A rejected reply is the evidence for the rejection.
   */
  extraction?: TurnExtraction;
  timings: Record<string, number>;
  diagnostics?: Diagnostics;
}

// ---------------------------------------------------------------------------
// Run model
// ---------------------------------------------------------------------------

export type SeatRole = 'participant' | 'narrator';

export type SeatStatus =
  | 'idle'
  | 'sending'
  | 'waiting'
  | 'done'
  | 'failed'
  | 'dropped';

export interface Seat {
  seatId: string;
  tabId: number;
  providerId: string;
  /** Shown to the other models by name, so keep it meaningful — e.g. "Claude Opus 4.5". */
  displayName: string;
  role: SeatRole;
  status: SeatStatus;
  lastError?: string;
}

export interface Turn {
  round: number;
  seatId: string;
  displayName: string;
  text: string;
  html: string;
  /** Parsed from the CONVERGED footer; null when absent or unparseable. */
  converged: boolean | null;
  via: TurnExtraction['via'];
  wordCount: number;
  at: string;
}

export interface RoundSummary {
  round: number;
  /** Plain-language account of the round, for a reader who is not in the field. */
  plainSummary: string;
  keyPoints: Array<{ agent: string; points: string[] }>;
  agreements: string[];
  disagreements: string[];
  openQuestions: string[];
  converged: boolean;
  rationale: string;
  /** Kept so a parse failure is still inspectable rather than silently empty. */
  raw: string;
  parseError?: string;
}

/**
 * A note you inject between rounds — a correction, a new angle, a source the panel missed.
 *
 * Ten rounds of cross-examination narrows relentlessly: each round stress-tests the positions
 * already on the table rather than widening the field. Steering is the only way to introduce
 * something the models did not think of themselves.
 */
export interface Steer {
  /** The round this note was delivered into. */
  round: number;
  text: string;
  at: string;
}

export interface FinalSummary {
  text: string;
  /** Why the run ended, so the reader knows whether the panel finished or was cut off. */
  endReason: string;
  roundsCompleted: number;
  at: string;
  /** Set when no summary could be produced, explaining why rather than showing nothing. */
  unavailable?: string;
}

export type ConvergenceStrategy = 'self-report' | 'moderator' | 'manual';

export type RunStatus = 'idle' | 'running' | 'paused' | 'done' | 'aborted' | 'error';

/**
 * What to do about a failed seat.
 *
 * 'recheck' exists because the commonest failure is not a model that stopped — it is a reply
 * we read too early. Sending again costs a message, pollutes the thread, and throws away an
 * answer that is already on screen; re-reading the page costs nothing.
 */
export type IncidentAction = 'recheck' | 'retry' | 'drop' | 'abort';

export interface Incident {
  seatId: string;
  displayName: string;
  round: number;
  failure: DriveFailure | 'window-minimized' | 'tab-closed';
  detail: string;
  at: string;
  /**
   * Whether the prompt is known to have gone in, so re-reading the page is meaningful. False
   * when we never got as far as sending — there, "check again" could only return the previous
   * round's reply, which would corrupt the panel while looking like a fix.
   */
  canRecheck: boolean;
  /**
   * The text that was actually read, when something was read and then rejected.
   *
   * Shown in the banner because it settles the diagnosis on sight: a clean opening sentence
   * means we looked while the model was still writing, whereas "Thinking…" or a heading means
   * the selector is pointed at the wrong element and no amount of waiting will help.
   */
  extracted?: string;
  /**
   * Candidate selectors captured from the failing page. Carried all the way to the UI so a
   * failure is directly actionable — a broken adapter is fixed from this, not from guessing.
   */
  diagnostics?: Diagnostics;
}

export interface LogEntry {
  at: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

/**
 * One recorded attempt to drive a seat — the flight recorder.
 *
 * The dashboard's activity log is a human summary and loses everything that matters for
 * diagnosis: which selector matched, how long each phase took, what was actually extracted,
 * and what the page looked like when it failed. Every defect in this project so far was
 * diagnosed from a screenshot plus guesswork; this exists so the next one is diagnosed from
 * the recording.
 */
export interface TurnRecord {
  at: string;
  round: number;
  seatId: string;
  displayName: string;
  providerId: string;
  attempt: number;
  /** 'recheck' re-read the page without sending anything — the prompt went in earlier. */
  mode: 'send' | 'recheck';
  outcome: 'ok' | 'failed';
  failure?: string;
  detail?: string;
  warning?: string;
  timings: Record<string, number>;
  /** Trimmed: enough to see what was asked without carrying whole transcripts. */
  promptChars: number;
  promptHead: string;
  extractedChars?: number;
  extractedVia?: TurnExtraction['via'];
  extractedHead?: string;
  convergedVote?: boolean | null;
  /** Present on failure only. Contains page markup — never leaves the machine unbidden. */
  diagnostics?: Diagnostics;
}

export interface RunConfig {
  topic: string;
  maxRounds: number;
  convergence: ConvergenceStrategy;
  /** Continue past a failed participant instead of pausing to ask. */
  autoDrop: boolean;
  /** Per-response word budget written into the panel rules. */
  wordBudget: number;
  /**
   * 'serial'   — front each tab, drive it to completion, move on. Slowest, most reliable.
   * 'parallel' — front each tab just long enough to submit, so every model generates at the
   *              same time, then harvest each in turn. Roughly one generation per round
   *              instead of N, at the cost of relying on background tabs behaving while
   *              they stream.
   */
  turnMode: 'serial' | 'parallel';
}

export interface RunState {
  id: string;
  config: RunConfig;
  status: RunStatus;
  round: number;
  seats: Seat[];
  turns: Turn[];
  summaries: RoundSummary[];
  incident: Incident | null;
  log: LogEntry[];
  /** Flight recorder. Bounded, and exportable as a single file for diagnosis. */
  records: TurnRecord[];
  /** The narrator's closing account, requested however the run ended. */
  finalSummary: FinalSummary | null;
  /** Notes already delivered, shown in the timeline so interventions are visible. */
  steers: Steer[];
  /** Queued note, delivered at the start of the next round. */
  pendingSteer: string | null;
  /** True while the run is holding at a round boundary waiting for you. */
  awaitingSteer: boolean;
  /**
   * Armed intentions for the end of the current round, held in state rather than in the
   * worker's memory so the console can show them and take them back. A button that changes
   * nothing visible is indistinguishable from a button that did not register.
   */
  endAfterRound: boolean;
  pauseAfterRound: boolean;
  startedAt: string | null;
  finishedAt: string | null;
}

// ---------------------------------------------------------------------------
// Diagnostics — kept from the spike. Selectors rot; this is how we re-derive them
// without another discovery cycle.
// ---------------------------------------------------------------------------

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
  suggestedSelector: string;
}

export interface Diagnostics {
  url: string;
  title: string;
  candidateComposers: ElementSketch[];
  candidateButtons: ElementSketch[];
  candidateResponseContainers: ElementSketch[];
  /**
   * Markup of the conversation region, so a broken page can be replayed as a test fixture.
   * Contains the user's own conversation text — it goes to the clipboard, never off-device.
   */
  conversationHtml?: string;
  /**
   * Markup of the block around the composer — the send and stop controls, whatever they are
   * made of. Kimi's send control is neither a <button> nor a [role="button"], so no amount of
   * sketching buttons will ever find it; three separate captures failed to show it. Markup
   * shows it. Contains no conversation text.
   */
  composerHtml?: string;
  note: string;
}

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

export interface CandidateTab {
  tabId: number;
  windowId: number;
  providerId: string;
  providerLabel: string;
  title: string;
  url: string;
  /** True when this tab is already assigned a seat in the current run. */
  claimed: boolean;
}

export type BgMessage =
  | { type: 'LIST_TABS' }
  | { type: 'START_RUN'; config: RunConfig; seats: Array<Omit<Seat, 'status'>> }
  | { type: 'RESOLVE_INCIDENT'; action: IncidentAction }
  | { type: 'STOP_RUN' }
  /** `on: false` takes the intention back — both of these are armed, not fired. */
  | { type: 'MARK_CONVERGED'; on?: boolean }
  | { type: 'RESET_RUN' }
  | { type: 'QUEUE_STEER'; text: string }
  | { type: 'PAUSE_AFTER_ROUND'; on?: boolean }
  | { type: 'RESUME_RUN' }
  | { type: 'CHECK_ADAPTERS' }
  | { type: 'DIAGNOSE_TAB'; tabId: number }
  /** Arms a capture in the tab; it fires by itself once the model starts answering. */
  | { type: 'DIAGNOSE_WHEN_BUSY'; tabId: number; providerId: string };
