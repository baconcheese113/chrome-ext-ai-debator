import type { LogEntry, RunState } from './types';

const KEY = 'runState';

export const EMPTY_RUN: RunState = {
  id: '',
  config: {
    topic: '',
    maxRounds: 6,
    convergence: 'self-report',
    autoDrop: false,
    wordBudget: 400,
    isolateWindows: true,
  },
  status: 'idle',
  round: 0,
  seats: [],
  turns: [],
  summaries: [],
  incident: null,
  log: [],
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

export async function appendLog(
  level: LogEntry['level'],
  message: string,
): Promise<void> {
  const run = await getRun();
  // Bounded so a long run can't grow storage without limit.
  const log = [...run.log, { at: new Date().toISOString(), level, message }].slice(-300);
  await setRun({ ...run, log });
}
