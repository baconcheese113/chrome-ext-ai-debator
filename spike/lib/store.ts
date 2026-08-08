import type { RunResult } from './types';

export interface SuiteState {
  status: 'idle' | 'running' | 'done' | 'error';
  startedAt: string | null;
  finishedAt: string | null;
  /** Human-readable current step, so the popup can show progress after being reopened. */
  current: string;
  completed: number;
  total: number;
  results: RunResult[];
  error?: string;
}

const KEY = 'suiteState';

export const EMPTY: SuiteState = {
  status: 'idle',
  startedAt: null,
  finishedAt: null,
  current: '',
  completed: 0,
  total: 0,
  results: [],
};

export async function getState(): Promise<SuiteState> {
  const got = await chrome.storage.local.get(KEY);
  return (got[KEY] as SuiteState) ?? EMPTY;
}

export async function setState(state: SuiteState): Promise<void> {
  await chrome.storage.local.set({ [KEY]: state });
}

export async function patchState(patch: Partial<SuiteState>): Promise<SuiteState> {
  const next = { ...(await getState()), ...patch };
  await setState(next);
  return next;
}
