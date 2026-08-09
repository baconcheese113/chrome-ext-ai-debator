import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IncidentAction, RunConfig, RunState, Seat } from '../../lib/types';
import {
  createFakeChrome,
  fail,
  failBeforeSend,
  ok,
  type FakeChrome,
  type TabScript,
} from './fake-chrome';

/**
 * The orchestrator holds module-level state (running, stopRequested, incidentResolver), so
 * each test needs a fresh copy. resetModules clears the registry; a query-string cache
 * buster would make Vite lose the .ts extension and fail to transform.
 *
 * `chrome` must be installed before the module is evaluated.
 */
async function loadOrchestrator() {
  vi.resetModules();
  const mod = await import('../../lib/orchestrator');
  // Real delays would make this suite spend all its time asleep, so nobody would run it.
  Object.assign(mod.timings, {
    sendStaggerMs: 0,
    roundPauseMs: 0,
    roundPauseJitterMs: 0,
    injectSettleMs: 0,
    windowRestoreMs: 0,
  });
  return mod;
}

const CONFIG: RunConfig = {
  topic: 'test topic',
  maxRounds: 2,
  convergence: 'self-report',
  autoDrop: false,
  wordBudget: 100,
  turnMode: 'serial',
};

const seat = (tabId: number, name: string, role: Seat['role'] = 'participant') => ({
  seatId: `seat-${tabId}`,
  tabId,
  providerId: 'chatgpt',
  displayName: name,
  role,
});

/** A reply long enough to clear the plausibility floor, with a convergence footer. */
const reply = (body: string, converged: 'yes' | 'no' = 'no') =>
  ok(`${body} ${'padding word '.repeat(20)}\nCONVERGED: ${converged} — because`);

const NARRATOR_JSON = ok(
  '```json\n' +
    JSON.stringify({
      keyPoints: [],
      agreements: ['a'],
      disagreements: [],
      openQuestions: [],
      converged: false,
      rationale: 'still going',
    }) +
    '\n```',
);

let fake: FakeChrome;

function setup(scripts: Map<number, TabScript>) {
  fake = createFakeChrome(scripts);
  fake.install();
}

afterEach(() => fake?.uninstall());

const getRunState = () => fake.storage.local.runState as RunState;

/** Polls until a condition holds, or gives up. Returns whether it held. */
async function waitFor(cond: () => boolean, tries = 400): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 5));
  }
  return false;
}

/** Queue a note the way the background message handler does. */
async function patchPending(text: string): Promise<void> {
  const run = getRunState();
  await (globalThis as unknown as { chrome: typeof chrome }).chrome.storage.local.set({
    runState: { ...run, pendingSteer: text },
  });
}

/** Waits for the run to pause on an incident, then answers it. */
async function answerIncident(
  orch: typeof import('../../lib/orchestrator'),
  action: IncidentAction,
) {
  for (let i = 0; i < 200; i++) {
    if (getRunState()?.incident) {
      orch.resolveIncident(action);
      return true;
    }
    await new Promise((r) => setTimeout(r, 5));
  }
  return false;
}

describe('re-reading a page instead of re-sending', () => {
  it('recovers a reply that was read too early, without sending anything again', async () => {
    // The commonest real failure, by a distance: a reasoning model pauses, the driver reads
    // the page during the pause, and an answer that is sitting right there is reported as
    // truncated. "Try again" costs a message and buries it; a second read costs nothing.
    setup(
      new Map([
        [1, { results: [fail('implausible-response', 'only 86 chars'), reply('alpha')] }],
        [2, { results: [reply('beta')] }],
      ]),
    );
    const orch = await loadOrchestrator();
    const done = orch.startRun({ ...CONFIG, maxRounds: 1 }, [seat(1, 'A'), seat(2, 'B')]);
    expect(await answerIncident(orch, 'recheck')).toBe(true);
    await done;

    // One prompt reached the model, and the turn still landed.
    expect(fake.prompts.get(1)).toHaveLength(1);
    expect(fake.rechecks).toEqual([1]);
    expect(getRunState().turns.filter((t) => t.seatId === 'seat-1')).toHaveLength(1);
  });

  it('does not offer a re-read when the prompt never went in', async () => {
    // Without a baseline turn, re-reading can only return the PREVIOUS round's reply — a
    // silent corruption that would look like a repair. So the option is withheld.
    setup(
      new Map([
        [1, { results: [failBeforeSend('composer-not-found', 'no composer on the page')] }],
        [2, { results: [reply('beta')] }],
      ]),
    );
    const orch = await loadOrchestrator();
    const done = orch.startRun({ ...CONFIG, maxRounds: 1 }, [seat(1, 'A'), seat(2, 'B')]);

    expect(await waitFor(() => Boolean(getRunState()?.incident))).toBe(true);
    expect(getRunState().incident!.canRecheck).toBe(false);
    orch.resolveIncident('drop');
    await done;
  });

  it('re-reads rather than re-submitting in parallel mode too', async () => {
    setup(
      new Map([
        [1, { results: [fail('extract-empty', 'no text yet'), reply('alpha')] }],
        [2, { results: [reply('beta')] }],
      ]),
    );
    const orch = await loadOrchestrator();
    const done = orch.startRun({ ...CONFIG, maxRounds: 1, turnMode: 'parallel' }, [
      seat(1, 'A'),
      seat(2, 'B'),
    ]);
    expect(await answerIncident(orch, 'recheck')).toBe(true);
    await done;

    // Exactly one DRIVE_SUBMIT for this seat — the re-read reused it.
    expect(fake.submits.filter((t) => t === 1)).toHaveLength(1);
    expect(fake.rechecks).toEqual([1]);
    expect(getRunState().turns.filter((t) => t.seatId === 'seat-1')).toHaveLength(1);
  });
});

describe('run loop', () => {
  it('runs rounds, records turns, and finishes', async () => {
    setup(
      new Map([
        [1, { results: [reply('alpha')] }],
        [2, { results: [reply('beta')] }],
      ]),
    );
    const orch = await loadOrchestrator();
    await orch.startRun(CONFIG, [seat(1, 'A'), seat(2, 'B')]);

    const run = getRunState();
    expect(run.status).toBe('done');
    expect(run.round).toBe(2);
    expect(run.turns.filter((t) => t.round === 1)).toHaveLength(2);
  });

  it('stops as soon as every participant self-reports convergence', async () => {
    setup(
      new Map([
        [1, { results: [reply('alpha', 'yes')] }],
        [2, { results: [reply('beta', 'yes')] }],
      ]),
    );
    const orch = await loadOrchestrator();
    await orch.startRun({ ...CONFIG, maxRounds: 5 }, [seat(1, 'A'), seat(2, 'B')]);

    const run = getRunState();
    expect(run.status).toBe('done');
    expect(run.round).toBe(1);
  });

  it('shows each participant the others\' turns but never its own', async () => {
    setup(
      new Map([
        [1, { results: [reply('ALPHA_MARKER')] }],
        [2, { results: [reply('BETA_MARKER')] }],
      ]),
    );
    const orch = await loadOrchestrator();
    await orch.startRun(CONFIG, [seat(1, 'A'), seat(2, 'B')]);

    const round2PromptToA = fake.prompts.get(1)![1]!;
    expect(round2PromptToA).toContain('BETA_MARKER');
    expect(round2PromptToA).not.toContain('ALPHA_MARKER');
  });
});

describe('failure handling', () => {
  it('auto-drop continues without pausing for the user', async () => {
    setup(
      new Map([
        [1, { results: [fail('detect-timeout')] }],
        [2, { results: [reply('beta')] }],
        [3, { results: [reply('gamma')] }],
      ]),
    );
    const orch = await loadOrchestrator();
    await orch.startRun({ ...CONFIG, autoDrop: true }, [seat(1, 'A'), seat(2, 'B'), seat(3, 'C')]);

    const run = getRunState();
    expect(run.status).toBe('done');
    expect(run.seats.find((s) => s.tabId === 1)!.status).toBe('dropped');
    expect(run.incident).toBeNull();
  });

  it('retry re-sends and can succeed', async () => {
    setup(
      new Map([
        [1, { results: [fail('extract-empty'), reply('recovered')] }],
        [2, { results: [reply('beta')] }],
      ]),
    );
    const orch = await loadOrchestrator();
    const running = orch.startRun({ ...CONFIG, maxRounds: 1 }, [seat(1, 'A'), seat(2, 'B')]);
    expect(await answerIncident(orch, 'retry')).toBe(true);
    await running;

    const run = getRunState();
    expect(run.status).toBe('done');
    expect(run.turns.some((t) => t.text.includes('recovered'))).toBe(true);
  });

  it('marks the run error when every participant fails', async () => {
    setup(
      new Map([
        [1, { results: [fail('detect-timeout')] }],
        [2, { results: [fail('detect-timeout')] }],
      ]),
    );
    const orch = await loadOrchestrator();
    await orch.startRun({ ...CONFIG, autoDrop: true }, [seat(1, 'A'), seat(2, 'B')]);
    expect(getRunState().status).toBe('error');
  });

  it('restores a minimized window rather than trusting its output', async () => {
    // Regression guard for the spike's sharpest finding: minimized windows are throttled and
    // return confident, truncated answers.
    setup(
      new Map([
        [1, { results: [reply('alpha')], windowState: 'minimized' }],
        [2, { results: [reply('beta')] }],
      ]),
    );
    const orch = await loadOrchestrator();
    await orch.startRun({ ...CONFIG, maxRounds: 1 }, [seat(1, 'A'), seat(2, 'B')]);

    expect(fake.windowUpdates).toContainEqual({ windowId: 101, state: 'normal', focused: false });
    expect(getRunState().status).toBe('done');
  });

  it('injects the content script into a tab that has not got one', async () => {
    setup(
      new Map([
        [1, { results: [reply('alpha')] }],
        [2, { results: [reply('beta')] }],
      ]),
    );
    const orch = await loadOrchestrator();
    await orch.startRun({ ...CONFIG, maxRounds: 1 }, [seat(1, 'A'), seat(2, 'B')]);
    // PING succeeds in the fake, so no injection is needed. Asserting the negative keeps the
    // next test honest about what triggers injection.
    expect(fake.injections).toEqual([]);
  });

  it('reports a tab it cannot inject into instead of hanging', async () => {
    setup(
      new Map([
        [1, { results: [reply('alpha')], uninjectable: true }],
        [2, { results: [reply('beta')] }],
        [3, { results: [reply('gamma')] }],
      ]),
    );
    const orch = await loadOrchestrator();
    await orch.startRun({ ...CONFIG, autoDrop: true, maxRounds: 1 }, [
      seat(1, 'A'),
      seat(2, 'B'),
      seat(3, 'C'),
    ]);

    expect(fake.injections).toContain(1);
    expect(getRunState().seats.find((s) => s.tabId === 1)!.status).toBe('dropped');
  });
});

describe('narrator', () => {
  it('summarises each round', async () => {
    setup(
      new Map([
        [1, { results: [reply('alpha')] }],
        [2, { results: [reply('beta')] }],
        [9, { results: [ok('READY'), NARRATOR_JSON] }],
      ]),
    );
    const orch = await loadOrchestrator();
    await orch.startRun({ ...CONFIG, maxRounds: 1 }, [
      seat(1, 'A'),
      seat(2, 'B'),
      seat(9, 'N', 'narrator'),
    ]);

    const run = getRunState();
    expect(run.summaries).toHaveLength(1);
    expect(run.summaries[0]!.agreements).toEqual(['a']);
  });

  it('REGRESSION: accepts the one-word READY acknowledgement from the seed', async () => {
    // The narrator seed asks for exactly "READY", then the reply was validated against the
    // 40-char summary floor and rejected as truncated. The narrator was dropped on every
    // single run, and the failure read as a Claude problem rather than as our own.
    setup(
      new Map([
        [1, { results: [reply('alpha')] }],
        [2, { results: [reply('beta')] }],
        [9, { results: [ok('READY'), NARRATOR_JSON] }],
      ]),
    );
    const orch = await loadOrchestrator();
    await orch.startRun({ ...CONFIG, maxRounds: 1 }, [
      seat(1, 'A'),
      seat(2, 'B'),
      seat(9, 'N', 'narrator'),
    ]);

    // The floor sent with the seed is the thing under test. The driver enforces it inside
    // the page, so asserting on the surviving narrator alone would pass against broken code —
    // the fake returns scripted results and never validates anything.
    const [seedFloor, summaryFloor] = fake.minChars.get(9)!;
    expect(seedFloor).toBeLessThanOrEqual('READY'.length);
    expect(summaryFloor).toBeGreaterThan(seedFloor!);

    const run = getRunState();
    expect(run.seats.find((s) => s.tabId === 9)!.status).not.toBe('dropped');
    expect(run.summaries).toHaveLength(1);
    expect(run.incident).toBeNull();
  });

  it('REGRESSION: dropping the narrator does not end the panel', async () => {
    // This exact sequence left the console stuck on "Running / Round 0" with every
    // participant on standby, because sendTo returned a bare false for both "seat dropped"
    // and "stop the run".
    setup(
      new Map([
        [1, { results: [reply('alpha')] }],
        [2, { results: [reply('beta')] }],
        [9, { results: [fail('no-new-message')] }],
      ]),
    );
    const orch = await loadOrchestrator();
    const running = orch.startRun({ ...CONFIG, maxRounds: 1 }, [
      seat(1, 'A'),
      seat(2, 'B'),
      seat(9, 'N', 'narrator'),
    ]);
    expect(await answerIncident(orch, 'drop')).toBe(true);
    await running;

    const run = getRunState();
    expect(run.status).toBe('done');
    expect(run.round).toBe(1);
    expect(run.turns.filter((t) => t.round === 1)).toHaveLength(2);
  });

  it('REGRESSION: moderator convergence falls back to self-report without a narrator', async () => {
    // Otherwise the panel can never converge and silently runs to maxRounds.
    setup(
      new Map([
        [1, { results: [reply('alpha', 'yes')] }],
        [2, { results: [reply('beta', 'yes')] }],
        [9, { results: [fail('no-new-message')] }],
      ]),
    );
    const orch = await loadOrchestrator();
    const running = orch.startRun({ ...CONFIG, convergence: 'moderator', maxRounds: 5 }, [
      seat(1, 'A'),
      seat(2, 'B'),
      seat(9, 'N', 'narrator'),
    ]);
    expect(await answerIncident(orch, 'drop')).toBe(true);
    await running;

    const run = getRunState();
    expect(run.config.convergence).toBe('self-report');
    expect(run.round).toBe(1);
    expect(run.status).toBe('done');
  });
});

describe('turn modes', () => {
  it('serial drives one seat fully before starting the next', async () => {
    setup(
      new Map([
        [1, { results: [reply('alpha')] }],
        [2, { results: [reply('beta')] }],
      ]),
    );
    const orch = await loadOrchestrator();
    await orch.startRun({ ...CONFIG, maxRounds: 1, turnMode: 'serial' }, [
      seat(1, 'A'),
      seat(2, 'B'),
    ]);

    // Serial never uses the split phases.
    expect(fake.submits).toEqual([]);
    expect(fake.harvests).toEqual([]);
    expect(getRunState().turns).toHaveLength(2);
  });

  it('parallel submits to everyone before harvesting anyone', async () => {
    setup(
      new Map([
        [1, { results: [reply('alpha')] }],
        [2, { results: [reply('beta')] }],
        [3, { results: [reply('gamma')] }],
      ]),
    );
    const orch = await loadOrchestrator();
    await orch.startRun({ ...CONFIG, maxRounds: 1, turnMode: 'parallel' }, [
      seat(1, 'A'),
      seat(2, 'B'),
      seat(3, 'C'),
    ]);

    // The whole point: every prompt is in flight before the first reply is collected.
    expect(fake.submits).toEqual([1, 2, 3]);
    expect(fake.harvests).toEqual([1, 2, 3]);
    expect(getRunState().turns).toHaveLength(3);
    expect(getRunState().status).toBe('done');
  });

  it('parallel still applies the failure policy when a harvest fails', async () => {
    setup(
      new Map([
        [1, { results: [fail('detect-timeout')] }],
        [2, { results: [reply('beta')] }],
        [3, { results: [reply('gamma')] }],
      ]),
    );
    const orch = await loadOrchestrator();
    await orch.startRun({ ...CONFIG, maxRounds: 1, turnMode: 'parallel', autoDrop: true }, [
      seat(1, 'A'),
      seat(2, 'B'),
      seat(3, 'C'),
    ]);

    const run = getRunState();
    expect(run.seats.find((s) => s.tabId === 1)!.status).toBe('dropped');
    expect(run.turns).toHaveLength(2);
    expect(run.status).toBe('done');
  });
});

describe('steering', () => {
  it('delivers a queued note to every participant, and only once', async () => {
    setup(
      new Map([
        [1, { results: [reply('alpha')] }],
        [2, { results: [reply('beta')] }],
      ]),
    );
    const orch = await loadOrchestrator();
    // Queued before the run starts, so it lands in round 1.
    await orch.startRun({ ...CONFIG, maxRounds: 2 }, [seat(1, 'A'), seat(2, 'B')]);

    const run = getRunState();
    expect(run.steers).toEqual([]);
    // Nothing queued, so no note text should reach anyone.
    expect(fake.prompts.get(1)![0]).not.toContain('MODERATOR');
  });

  it('injects the note into round prompts for all seats simultaneously', async () => {
    setup(
      new Map([
        [1, { results: [reply('alpha')] }],
        [2, { results: [reply('beta')] }],
      ]),
    );
    const orch = await loadOrchestrator();
    const running = orch.startRun({ ...CONFIG, maxRounds: 2 }, [seat(1, 'A'), seat(2, 'B')]);

    // Queue mid-run; it must land at the next round boundary, not the current one.
    await waitFor(() => (getRunState()?.round ?? 0) >= 1);
    await patchPending('Bring in non-Western sources.');
    await running;

    const run = getRunState();
    expect(run.steers).toHaveLength(1);
    expect(run.steers[0]!.round).toBe(2);
    expect(run.pendingSteer).toBeNull();

    // Both participants received it, in round 2's prompt.
    for (const tabId of [1, 2]) {
      const round2 = fake.prompts.get(tabId)![1]!;
      expect(round2).toContain('NOTE FROM THE MODERATOR');
      expect(round2).toContain('non-Western sources');
    }
    // And it is not repeated once consumed.
    expect(fake.prompts.get(1)![0]).not.toContain('NOTE FROM THE MODERATOR');
  });

  it('holds at the round boundary when asked, and resumes', async () => {
    setup(
      new Map([
        [1, { results: [reply('alpha')] }],
        [2, { results: [reply('beta')] }],
      ]),
    );
    const orch = await loadOrchestrator();
    const running = orch.startRun({ ...CONFIG, maxRounds: 2 }, [seat(1, 'A'), seat(2, 'B')]);

    orch.pauseAfterRound();
    expect(await waitFor(() => getRunState()?.awaitingSteer === true)).toBe(true);

    // The run must genuinely be held — round 2 has not begun.
    expect(getRunState().round).toBe(1);

    orch.resumeRun();
    await running;

    expect(getRunState().awaitingSteer).toBe(false);
    expect(getRunState().round).toBe(2);
    expect(getRunState().status).toBe('done');
  });
});

describe('armed intentions', () => {
  /**
   * Both of these take effect at the end of the round — minutes after the click. Held only in
   * the worker's memory, they changed nothing visible, which is indistinguishable from a
   * click that never registered, and there was no way to change your mind.
   *
   * The run is parked on an incident throughout: a point where the loop is provably not
   * writing state, so the toggles can be exercised without racing it.
   */
  it('mirrors "end after this round" into state and gives it back when clicked again', async () => {
    setup(
      new Map([
        [1, { results: [fail('driver-error'), reply('alpha')] }],
        [2, { results: [reply('beta')] }],
      ]),
    );
    const orch = await loadOrchestrator();
    const running = orch.startRun({ ...CONFIG, maxRounds: 2 }, [seat(1, 'A'), seat(2, 'B')]);
    expect(await waitFor(() => Boolean(getRunState()?.incident))).toBe(true);

    orch.markConverged();
    expect(await waitFor(() => getRunState().endAfterRound === true)).toBe(true);

    orch.markConverged(false);
    expect(await waitFor(() => getRunState().endAfterRound === false)).toBe(true);

    orch.resolveIncident('retry');
    await running;

    // Revoked in substance, not just in the label: round 2 still ran.
    expect(getRunState().round).toBe(2);
  });

  it('mirrors "pause after this round" into state and gives it back when clicked again', async () => {
    setup(
      new Map([
        [1, { results: [fail('driver-error'), reply('alpha')] }],
        [2, { results: [reply('beta')] }],
      ]),
    );
    const orch = await loadOrchestrator();
    const running = orch.startRun({ ...CONFIG, maxRounds: 2 }, [seat(1, 'A'), seat(2, 'B')]);
    expect(await waitFor(() => Boolean(getRunState()?.incident))).toBe(true);

    orch.pauseAfterRound();
    expect(await waitFor(() => getRunState().pauseAfterRound === true)).toBe(true);

    orch.pauseAfterRound(false);
    expect(await waitFor(() => getRunState().pauseAfterRound === false)).toBe(true);

    orch.resolveIncident('retry');
    await running;

    // Never held: the run reached its own end rather than waiting for a Resume.
    expect(getRunState().awaitingSteer).toBe(false);
    expect(getRunState().status).toBe('done');
  });
});

describe('closing summary', () => {
  const LONG = ok('## What happened\n\n' + 'A real closing account. '.repeat(30));

  it('is requested when the panel converges', async () => {
    setup(
      new Map([
        [1, { results: [reply('alpha', 'yes')] }],
        [2, { results: [reply('beta', 'yes')] }],
        [9, { results: [ok('READY'), NARRATOR_JSON, LONG] }],
      ]),
    );
    const orch = await loadOrchestrator();
    await orch.startRun({ ...CONFIG, maxRounds: 5 }, [
      seat(1, 'A'),
      seat(2, 'B'),
      seat(9, 'N', 'narrator'),
    ]);

    const run = getRunState();
    expect(run.finalSummary?.endReason).toBe('converged');
    expect(run.finalSummary?.text).toContain('What happened');
    expect(run.finalSummary?.roundsCompleted).toBe(1);
  });

  it('is requested when the round limit is reached, not only on convergence', async () => {
    // The case that prompted this: ten rounds of work, then the run just stopped.
    setup(
      new Map([
        [1, { results: [reply('alpha')] }],
        [2, { results: [reply('beta')] }],
        [9, { results: [ok('READY'), NARRATOR_JSON, NARRATOR_JSON, LONG] }],
      ]),
    );
    const orch = await loadOrchestrator();
    await orch.startRun({ ...CONFIG, maxRounds: 2 }, [
      seat(1, 'A'),
      seat(2, 'B'),
      seat(9, 'N', 'narrator'),
    ]);

    expect(getRunState().finalSummary?.endReason).toBe('max-rounds');
    expect(getRunState().finalSummary?.text.length).toBeGreaterThan(300);
  });

  it('does not leave the summary sitting in the transcript as a round turn', async () => {
    setup(
      new Map([
        [1, { results: [reply('alpha', 'yes')] }],
        [2, { results: [reply('beta', 'yes')] }],
        [9, { results: [ok('READY'), NARRATOR_JSON, LONG] }],
      ]),
    );
    const orch = await loadOrchestrator();
    await orch.startRun({ ...CONFIG, maxRounds: 5 }, [
      seat(1, 'A'),
      seat(2, 'B'),
      seat(9, 'N', 'narrator'),
    ]);

    expect(getRunState().turns.some((t) => t.text.includes('What happened'))).toBe(false);
  });

  it('explains its absence rather than showing nothing when there is no narrator', async () => {
    setup(
      new Map([
        [1, { results: [reply('alpha', 'yes')] }],
        [2, { results: [reply('beta', 'yes')] }],
      ]),
    );
    const orch = await loadOrchestrator();
    await orch.startRun({ ...CONFIG, maxRounds: 5 }, [seat(1, 'A'), seat(2, 'B')]);

    expect(getRunState().finalSummary?.unavailable).toContain('No narrator');
  });
});

describe('flight recorder', () => {
  it('records every attempt, with diagnostics on failures only', async () => {
    setup(
      new Map([
        [1, { results: [fail('extract-empty', 'nothing there'), reply('recovered')] }],
        [2, { results: [reply('beta')] }],
      ]),
    );
    const orch = await loadOrchestrator();
    const running = orch.startRun({ ...CONFIG, maxRounds: 1 }, [seat(1, 'A'), seat(2, 'B')]);
    await answerIncident(orch, 'retry');
    await running;

    const records = getRunState().records;
    // Two attempts for seat A (fail then success), one for seat B.
    expect(records).toHaveLength(3);

    const failed = records.find((r) => r.outcome === 'failed')!;
    expect(failed.failure).toBe('extract-empty');
    expect(failed.detail).toBe('nothing there');
    expect(failed.attempt).toBe(1);
    expect(failed.promptChars).toBeGreaterThan(0);

    const succeeded = records.find((r) => r.outcome === 'ok' && r.seatId === 'seat-1')!;
    expect(succeeded.attempt).toBe(2);
    expect(succeeded.extractedChars).toBeGreaterThan(0);
    expect(succeeded.extractedHead).toContain('recovered');
    expect(succeeded.convergedVote).toBe(false);
    // Diagnostics are page markup; carrying them for successes would bloat every export.
    expect(succeeded.diagnostics).toBeUndefined();
  });
});

describe('terminal state', () => {
  /**
   * The worst observed failure was a console that said "Running" forever. This asserts the
   * property directly across every shape of run, rather than trusting each exit path.
   */
  const scenarios: Array<[string, Map<number, TabScript>, Partial<RunConfig>, 'retry' | 'drop' | 'abort' | null]> = [
    ['all succeed', new Map([[1, { results: [reply('a')] }], [2, { results: [reply('b')] }]]), {}, null],
    ['all fail', new Map([[1, { results: [fail('detect-timeout')] }], [2, { results: [fail('detect-timeout')] }]]), { autoDrop: true }, null],
    ['tab gone', new Map([[1, { results: [reply('a')], gone: true }], [2, { results: [reply('b')] }]]), { autoDrop: true }, null],
    ['user aborts', new Map([[1, { results: [fail('extract-empty')] }], [2, { results: [reply('b')] }]]), {}, 'abort'],
    ['user drops', new Map([[1, { results: [fail('extract-empty')] }], [2, { results: [reply('b')] }]]), {}, 'drop'],
  ];

  for (const [name, scripts, cfg, action] of scenarios) {
    it(`never ends on "running" — ${name}`, async () => {
      setup(scripts);
      const orch = await loadOrchestrator();
      const running = orch.startRun({ ...CONFIG, maxRounds: 1, ...cfg }, [seat(1, 'A'), seat(2, 'B')]);
      if (action) await answerIncident(orch, action);
      await running;

      const run = getRunState();
      expect(run.status).not.toBe('running');
      expect(run.status).not.toBe('paused');
      expect(run.incident).toBeNull();
      expect(run.finishedAt).toBeTruthy();
    });
  }
});
