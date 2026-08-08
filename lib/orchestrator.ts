import { evaluateConvergence, parseNarratorSummary } from './convergence';
import {
  narratorRound,
  narratorSeed,
  parseConverged,
  participantRound,
  participantSeed,
  stripConverged,
} from './prompts';
import { appendLog, getRun, patchRun, setRun } from './store';
import type {
  Diagnostics,
  DriveResult,
  Incident,
  RunConfig,
  RunState,
  Seat,
  Turn,
} from './types';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Minimum plausible reply length. Below this we assume truncation, not brevity. */
const MIN_REPLY_CHARS = 120;
const MIN_NARRATOR_CHARS = 40;

/**
 * Deliberate delays, isolated so tests can zero them. Without this, orchestrator tests spend
 * almost all their runtime asleep and nobody runs them.
 */
export const timings = {
  /** Small stagger so N tabs don't submit on the same tick. */
  sendStaggerMs: 700,
  /** Jittered gap between rounds, to be less obviously a bot against rate limits. */
  roundPauseMs: 1500,
  roundPauseJitterMs: 1500,
  /** How long to wait after injecting a content script before pinging again. */
  injectSettleMs: 400,
  /** Pause after restoring a minimized window, so the page can un-throttle. */
  windowRestoreMs: 1000,
};

/** Set while a run is in flight so the service worker isn't killed mid-round. */
let keepaliveTimer: ReturnType<typeof setInterval> | undefined;
/** Resolves when the user answers an incident prompt. */
let incidentResolver: ((action: 'retry' | 'drop' | 'abort') => void) | undefined;
let stopRequested = false;
let manualConverge = false;

export function resolveIncident(action: 'retry' | 'drop' | 'abort'): void {
  incidentResolver?.(action);
  incidentResolver = undefined;
}

export function requestStop(): void {
  stopRequested = true;
  incidentResolver?.('abort');
  // If no loop is alive, there is nobody to observe the flag — finalise directly so Stop
  // always works, including after a service-worker restart orphaned the stored state.
  if (!running) void reconcileOrphanedRun('Stopped.');
}

/**
 * MV3 can terminate the service worker at any time. When it comes back, stored state may
 * claim a run is in flight while no loop exists. Called on startup and by Stop.
 */
export async function reconcileOrphanedRun(reason: string): Promise<void> {
  if (running) return;
  const run = await getRun();
  if (run.status !== 'running' && run.status !== 'paused') return;
  await patchRun({ status: 'aborted', incident: null, finishedAt: new Date().toISOString() });
  await appendLog('warn', reason);
}

export function markConverged(): void {
  manualConverge = true;
}

let running = false;

export const isRunning = () => running;

export async function startRun(
  config: RunConfig,
  seatSpecs: Array<Omit<Seat, 'status'>>,
): Promise<void> {
  // A second START_RUN while one is in flight would interleave two round loops over the
  // same tabs and the same stored state.
  if (running) return;
  running = true;
  stopRequested = false;
  manualConverge = false;

  const seats: Seat[] = seatSpecs.map((s) => ({ ...s, status: 'idle' }));
  await setRun({
    id: `run-${new Date().toISOString()}`,
    config,
    status: 'running',
    round: 0,
    seats,
    turns: [],
    summaries: [],
    incident: null,
    log: [],
    startedAt: new Date().toISOString(),
    finishedAt: null,
  });

  keepaliveTimer = setInterval(() => void chrome.runtime.getPlatformInfo(), 20_000);
  try {
    await runLoop();
  } catch (err) {
    await appendLog('error', `run aborted: ${String(err)}`);
    await patchRun({ status: 'error', finishedAt: new Date().toISOString() });
  } finally {
    clearInterval(keepaliveTimer);
    keepaliveTimer = undefined;
    running = false;
    // Backstop: no exit path may leave the console showing a run that is no longer running.
    // A stuck "Running" with nothing happening is worse than any honest terminal state.
    const final = await getRun();
    if (final.status === 'running' || final.status === 'paused') {
      await patchRun({
        status: 'aborted',
        incident: null,
        finishedAt: new Date().toISOString(),
      });
      await appendLog('warn', 'Run ended without reaching a normal finish.');
    }
  }
}

async function runLoop(): Promise<void> {
  let run = await getRun();
  const participants = () => run.seats.filter((s) => s.role === 'participant' && s.status !== 'dropped');
  const narrator = () => run.seats.find((s) => s.role === 'narrator' && s.status !== 'dropped');

  // --- seeding ------------------------------------------------------------
  await appendLog('info', `Seeding ${participants().length} participants.`);
  const names = participants().map((s) => s.displayName);

  const nar = narrator();
  if (nar) {
    const seeded = await sendTo(nar, narratorSeed(run.config, names), MIN_NARRATOR_CHARS, 0);
    if (seeded === 'aborted') return;
    // The narrator is an observer. Losing it costs us round summaries, not the panel —
    // ending the run here would throw away every participant the user set up.
    if (seeded === 'dropped') {
      await appendLog('warn', 'Narrator unavailable. Continuing without round summaries.');
      run = await getRun();
      if (run.config.convergence === 'moderator') {
        await appendLog(
          'warn',
          'Moderator convergence needs a narrator — falling back to participant self-reports.',
        );
        run = await patchRun({ config: { ...run.config, convergence: 'self-report' } });
      }
    }
  }

  for (let round = 1; round <= run.config.maxRounds; round++) {
    run = await patchRun({ round });
    await appendLog('info', `--- Round ${round} ---`);

    const active = participants();
    if (active.length < 2) {
      await appendLog('warn', 'Fewer than two participants remain. Ending run.');
      break;
    }

    // Every participant is prompted with all other participants' latest turns, then they all
    // generate at once. That simultaneity is what makes this a panel rather than a relay.
    const prompts = new Map<string, string>();
    for (const seat of active) {
      prompts.set(
        seat.seatId,
        round === 1
          ? participantSeed(
              run.config,
              seat.displayName,
              active.filter((s) => s.seatId !== seat.seatId).map((s) => s.displayName),
            )
          : participantRound(run.config, round, previousTurns(run, round - 1, seat.seatId)),
      );
    }

    const results = await Promise.all(
      active.map(async (seat, i) => {
        await sleep(i * timings.sendStaggerMs);
        const outcome = await sendTo(seat, prompts.get(seat.seatId)!, MIN_REPLY_CHARS, round);
        return { seat, ok: outcome === 'ok' };
      }),
    );

    if (stopRequested) break;
    run = await getRun();
    if (results.every((r) => !r.ok)) {
      await appendLog('error', 'Every participant failed this round. Stopping.');
      await patchRun({ status: 'error', finishedAt: new Date().toISOString() });
      return;
    }

    // --- narration --------------------------------------------------------
    const roundTurns = run.turns.filter((t) => t.round === round);
    const n = narrator();
    let summary = undefined;
    if (n && roundTurns.length) {
      const narrated = await sendTo(n, narratorRound(round, roundTurns), MIN_NARRATOR_CHARS, round);
      run = await getRun();
      if (narrated === 'aborted') break;
      if (narrated === 'ok') {
        const narratorTurn = run.turns.filter((t) => t.round === round && t.seatId === n.seatId).pop();
        if (narratorTurn) {
          summary = parseNarratorSummary(round, narratorTurn.text);
          await setRun({ ...run, summaries: [...run.summaries, summary] });
          run = await getRun();
          if (summary.parseError) {
            await appendLog('warn', `Narrator output did not parse: ${summary.parseError}`);
          }
        }
      }
    }

    // --- convergence ------------------------------------------------------
    if (manualConverge) {
      await appendLog('info', 'You marked the panel converged.');
      break;
    }
    const verdict = evaluateConvergence(
      run.config.convergence,
      roundTurns.filter((t) => t.seatId !== n?.seatId),
      summary,
    );
    await appendLog('info', `Convergence (${run.config.convergence}): ${verdict.reason}`);
    if (verdict.converged) break;
    if (stopRequested) break;

    // Jittered gap before the next round. These are subscription UIs with real rate limits,
    // and a perfectly regular cadence is both harder on them and more obviously automated.
    await sleep(timings.roundPauseMs + Math.random() * timings.roundPauseJitterMs);
  }

  await patchRun({
    status: stopRequested ? 'aborted' : 'done',
    finishedAt: new Date().toISOString(),
  });
  await appendLog('info', 'Run finished.');
}

/** Turns from `round` by everyone except `exceptSeatId` — what a participant is shown. */
function previousTurns(run: RunState, round: number, exceptSeatId: string): Turn[] {
  const narratorIds = new Set(run.seats.filter((s) => s.role === 'narrator').map((s) => s.seatId));
  return run.turns.filter(
    (t) => t.round === round && t.seatId !== exceptSeatId && !narratorIds.has(t.seatId),
  );
}

/**
 * Drive one seat, recording the turn. On failure this applies the policy the user chose:
 * pause and ask, unless auto-drop is on.
 *
 * Returns a three-way outcome rather than a boolean. "This seat is out" and "stop the whole
 * run" are different events, and collapsing them into false is what let a dropped narrator
 * silently kill an entire panel.
 */
type SendOutcome = 'ok' | 'dropped' | 'aborted';

async function sendTo(
  seat: Seat,
  prompt: string,
  minChars: number,
  round: number,
): Promise<SendOutcome> {
  for (;;) {
    if (stopRequested) return 'aborted';

    await updateSeat(seat.seatId, { status: 'sending' });

    const guard = await guardWindow(seat);
    if (guard) {
      const action = await raiseIncident(seat, round, 'window-minimized', guard);
      if (action !== 'retry') return action === 'abort' ? 'aborted' : 'dropped';
      continue;
    }

    const ready = await ensureContentScript(seat.tabId);
    if (!ready) {
      const action = await raiseIncident(
        seat,
        round,
        'tab-closed',
        'content script not reachable — reload the tab and retry',
      );
      if (action !== 'retry') return action === 'abort' ? 'aborted' : 'dropped';
      continue;
    }

    let result: DriveResult;
    try {
      await updateSeat(seat.seatId, { status: 'waiting' });
      result = (await chrome.tabs.sendMessage(seat.tabId, {
        type: 'DRIVE',
        providerId: seat.providerId,
        prompt,
        minChars,
      })) as DriveResult;
    } catch (err) {
      const action = await raiseIncident(seat, round, 'tab-closed', String(err));
      if (action !== 'retry') return action === 'abort' ? 'aborted' : 'dropped';
      continue;
    }

    if (result?.ok && result.extraction) {
      const text = result.extraction.text;
      const turn: Turn = {
        round,
        seatId: seat.seatId,
        displayName: seat.displayName,
        text: stripConverged(text),
        html: result.extraction.html,
        converged: parseConverged(text),
        via: result.extraction.via,
        wordCount: text.trim().split(/\s+/).length,
        at: new Date().toISOString(),
      };
      const run = await getRun();
      await setRun({ ...run, turns: [...run.turns, turn] });
      await updateSeat(seat.seatId, { status: 'done', lastError: undefined });
      if (turn.via === 'artifact') {
        await appendLog('warn', `${seat.displayName} answered in an artifact; read from the panel.`);
      }
      return 'ok';
    }

    const action = await raiseIncident(
      seat,
      round,
      result?.failure ?? 'driver-error',
      result?.detail ?? 'no detail',
      result?.diagnostics,
    );
    if (action !== 'retry') return action === 'abort' ? 'aborted' : 'dropped';
  }
}

/**
 * Chrome does not inject declared content scripts into tabs that were already open when the
 * extension loaded or reloaded. Without this, seating a tab you opened first fails with a
 * baffling "receiving end does not exist". Ping, and inject on demand if nobody answers.
 */
async function ensureContentScript(tabId: number): Promise<boolean> {
  const ping = async () => {
    try {
      return (await chrome.tabs.sendMessage(tabId, { type: 'PING' }))?.ok === true;
    } catch {
      return false;
    }
  };

  if (await ping()) return true;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-scripts/driver.js'],
    });
  } catch (err) {
    await appendLog('warn', `Could not inject into tab ${tabId}: ${String(err)}`);
    return false;
  }
  await sleep(timings.injectSettleMs);
  return ping();
}

/**
 * The spike's sharpest finding: a minimized window yields confident, truncated, wrong
 * answers rather than an error. Unfocused is fine. So we restore rather than refuse — the
 * alternative is silently corrupting the panel.
 */
async function guardWindow(seat: Seat): Promise<string | undefined> {
  try {
    const tab = await chrome.tabs.get(seat.tabId);
    const win = await chrome.windows.get(tab.windowId);
    if (win.state === 'minimized') {
      await chrome.windows.update(tab.windowId, { state: 'normal', focused: false });
      await appendLog(
        'warn',
        `${seat.displayName}'s window was minimized — restored it. Minimized windows are throttled and produce truncated responses.`,
      );
      await sleep(timings.windowRestoreMs);
    }
    return undefined;
  } catch (err) {
    return `tab or window unavailable: ${String(err)}`;
  }
}

async function raiseIncident(
  seat: Seat,
  round: number,
  failure: Incident['failure'],
  detail: string,
  diagnostics?: Diagnostics,
): Promise<'retry' | 'drop' | 'abort'> {
  await updateSeat(seat.seatId, { status: 'failed', lastError: `${failure}: ${detail}` });
  await appendLog('error', `${seat.displayName} failed (${failure}): ${detail}`);

  const run = await getRun();
  if (run.config.autoDrop) {
    await appendLog('warn', `Auto-drop is on — continuing without ${seat.displayName}.`);
    await updateSeat(seat.seatId, { status: 'dropped' });
    return 'drop';
  }

  const incident: Incident = {
    seatId: seat.seatId,
    displayName: seat.displayName,
    round,
    failure,
    detail,
    at: new Date().toISOString(),
    diagnostics,
  };
  await patchRun({ status: 'paused', incident });

  const action = await new Promise<'retry' | 'drop' | 'abort'>((resolve) => {
    incidentResolver = resolve;
  });

  await patchRun({ status: action === 'abort' ? 'aborted' : 'running', incident: null });
  if (action === 'drop') await updateSeat(seat.seatId, { status: 'dropped' });
  if (action === 'abort') stopRequested = true;
  return action;
}

async function updateSeat(seatId: string, patch: Partial<Seat>): Promise<void> {
  const run = await getRun();
  await setRun({
    ...run,
    seats: run.seats.map((s) => (s.seatId === seatId ? { ...s, ...patch } : s)),
  });
}
