import type { DriveResult } from '../../lib/types';

/**
 * A fake `chrome` sufficient to run the orchestrator's round loop in node.
 *
 * Seat behaviour is *scripted*, not simulated: each tab gets a queue of DriveResults, so a
 * test states exactly what the page did rather than hoping a simulation reproduces it. The
 * last entry repeats once the queue drains, which keeps "always succeeds" cases short.
 */

export interface TabScript {
  /** Results returned in order. The final entry repeats forever. */
  results: DriveResult[];
  /** Simulates a tab that no longer exists — sendMessage rejects. */
  gone?: boolean;
  /** Simulates a tab whose content script never answers PING and cannot be injected. */
  uninjectable?: boolean;
  windowState?: 'normal' | 'minimized';
}

export interface FakeChrome {
  storage: { local: Record<string, unknown> };
  /** Every prompt sent to each tab, so tests can assert what a model was shown. */
  prompts: Map<number, string[]>;
  windowUpdates: Array<{ windowId: number; state?: string }>;
  injections: number[];
  install(): void;
  uninstall(): void;
}

export function ok(text: string, via: DriveResult['extraction'] extends undefined ? never : 'message' | 'artifact' = 'message'): DriveResult {
  return { ok: true, extraction: { text, html: `<p>${text}</p>`, via }, timings: {} };
}

export function fail(failure: DriveResult['failure'], detail = 'scripted failure'): DriveResult {
  return { ok: false, failure, detail, timings: {} };
}

export function createFakeChrome(scripts: Map<number, TabScript>): FakeChrome {
  const storage: Record<string, unknown> = {};
  const prompts = new Map<number, string[]>();
  const windowUpdates: Array<{ windowId: number; state?: string }> = [];
  const injections: number[] = [];
  const cursors = new Map<number, number>();
  const changeListeners: Array<(c: Record<string, unknown>, area: string) => void> = [];

  const nextResult = (tabId: number): DriveResult => {
    const script = scripts.get(tabId);
    if (!script) return fail('driver-error', `no script for tab ${tabId}`);
    const i = cursors.get(tabId) ?? 0;
    cursors.set(tabId, i + 1);
    return script.results[Math.min(i, script.results.length - 1)]!;
  };

  const api = {
    storage: {
      local: {
        async get(key: string) {
          return key in storage ? { [key]: storage[key] } : {};
        },
        async set(obj: Record<string, unknown>) {
          Object.assign(storage, obj);
          for (const l of changeListeners) l({}, 'local');
        },
      },
      onChanged: {
        addListener: (l: (c: Record<string, unknown>, a: string) => void) => changeListeners.push(l),
        removeListener: () => {},
      },
    },

    tabs: {
      async get(tabId: number) {
        if (scripts.get(tabId)?.gone) throw new Error('No tab with id');
        return { id: tabId, windowId: 100 + tabId };
      },
      async sendMessage(tabId: number, msg: { type: string; prompt?: string }) {
        const script = scripts.get(tabId);
        if (script?.gone) throw new Error('Could not establish connection. Receiving end does not exist.');
        if (msg.type === 'PING') {
          if (script?.uninjectable) throw new Error('Receiving end does not exist.');
          return { ok: true };
        }
        if (msg.type === 'DRIVE') {
          const list = prompts.get(tabId) ?? [];
          list.push(msg.prompt ?? '');
          prompts.set(tabId, list);
          return nextResult(tabId);
        }
        return undefined;
      },
      async update() {},
      async query() {
        return [];
      },
      async create() {},
    },

    windows: {
      async get(windowId: number) {
        const tabId = windowId - 100;
        return { id: windowId, state: scripts.get(tabId)?.windowState ?? 'normal' };
      },
      async update(windowId: number, info: { state?: string }) {
        windowUpdates.push({ windowId, ...info });
        const tabId = windowId - 100;
        const s = scripts.get(tabId);
        if (s && info.state === 'normal') s.windowState = 'normal';
      },
    },

    scripting: {
      async executeScript({ target }: { target: { tabId: number } }) {
        injections.push(target.tabId);
        if (scripts.get(target.tabId)?.uninjectable) throw new Error('Cannot access contents');
        return [];
      },
    },

    runtime: {
      async getPlatformInfo() {
        return { os: 'win' };
      },
      onMessage: { addListener: () => {} },
      getURL: (p: string) => p,
    },

    action: { onClicked: { addListener: () => {} } },
  };

  return {
    storage: { local: storage },
    prompts,
    windowUpdates,
    injections,
    install() {
      (globalThis as { chrome?: unknown }).chrome = api;
    },
    uninstall() {
      delete (globalThis as { chrome?: unknown }).chrome;
    },
  };
}
