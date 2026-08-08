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
   * Stop-button presence only. The spike proved send-button state is worthless here: an
   * empty composer disables the send button permanently, which is indistinguishable from
   * "busy" and made the signal never resolve in any of 40 runs.
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
}

export type DriveFailure =
  | 'composer-not-found'
  | 'inject-failed'
  | 'submit-failed'
  | 'no-new-message'
  | 'detect-timeout'
  | 'extract-empty'
  | 'implausible-response'
  | 'prompt-echo'
  | 'driver-error';

export interface DriveResult {
  ok: boolean;
  failure?: DriveFailure;
  detail?: string;
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

export type ConvergenceStrategy = 'self-report' | 'moderator' | 'manual';

export type RunStatus = 'idle' | 'running' | 'paused' | 'done' | 'aborted' | 'error';

export interface Incident {
  seatId: string;
  displayName: string;
  round: number;
  failure: DriveFailure | 'window-minimized' | 'tab-closed';
  detail: string;
  at: string;
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

export interface RunConfig {
  topic: string;
  maxRounds: number;
  convergence: ConvergenceStrategy;
  /** Continue past a failed participant instead of pausing to ask. */
  autoDrop: boolean;
  /** Per-response word budget written into the panel rules. */
  wordBudget: number;
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
  | { type: 'RESOLVE_INCIDENT'; action: 'retry' | 'drop' | 'abort' }
  | { type: 'STOP_RUN' }
  | { type: 'MARK_CONVERGED' }
  | { type: 'RESET_RUN' }
  | { type: 'DIAGNOSE_TAB'; tabId: number };
