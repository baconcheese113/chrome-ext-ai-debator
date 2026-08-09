import type { LogEntry, RunState, TurnRecord } from './types';

const KEY = 'runState';

export const EMPTY_RUN: RunState = {
  id: '',
  config: {
    topic: '',
    maxRounds: 6,
    convergence: 'self-report',
    autoDrop: false,
    wordBudget: 400,
    turnMode: 'serial',
  },
  status: 'idle',
  round: 0,
  seats: [],
  turns: [],
  summaries: [],
  incident: null,
  log: [],
  records: [],
  finalSummary: null,
  steers: [],
  pendingSteer: null,
  awaitingSteer: false,
  endAfterRound: false,
  pauseAfterRound: false,
  startedAt: null,
  finishedAt: null,
};

export async function getRun(): Promise<RunState> {
  const got = await chrome.storage.local.get(KEY);
  return (got[KEY] as RunState) ?? EMPTY_RUN;
}

export async function setRun(state: RunState): Promise<void> {
  await chrome.storage.local.set({ [KEY]: state });
}

export async function patchRun(patch: Partial<RunState>): Promise<RunState> {
  const next = { ...(await getRun()), ...patch };
  await setRun(next);
  return next;
}

/** Bounded so a long run cannot grow storage without limit. */
const MAX_RECORDS = 200;

export async function appendRecord(record: TurnRecord): Promise<void> {
  const run = await getRun();
  await setRun({ ...run, records: [...(run.records ?? []), record].slice(-MAX_RECORDS) });
}

export async function appendLog(
  level: LogEntry['level'],
  message: string,
): Promise<void> {
  const run = await getRun();
  // Bounded so a long run can't grow storage without limit.
  const log = [...run.log, { at: new Date().toISOString(), level, message }].slice(-300);
  await setRun({ ...run, log });
}
