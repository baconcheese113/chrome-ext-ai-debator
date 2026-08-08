import { EXPERIMENTS, PACING_JITTER_MS, PACING_MS } from '../lib/experiments';
import { PROVIDERS } from '../lib/providers';
import { EMPTY, getState, patchState, setState } from '../lib/store';
import type { ProviderId, RunResult } from '../lib/types';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export default defineBackground(() => {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'START_SUITE') {
      // Deliberately not awaited: the popup must not block, and the suite has to survive
      // the popup closing (which it will, the moment an unfocused window steals focus).
      void runSuite(msg.providers as ProviderId[]);
      sendResponse({ started: true });
      return false;
    }
    if (msg?.type === 'RESET') {
      void setState(EMPTY).then(() => sendResponse({ ok: true }));
      return true;
    }
    return false;
  });
});

/**
 * MV3 service workers are killed after ~30s idle. A suite spends minutes waiting on network
 * and DOM, which from the worker's perspective looks exactly like idle. Touching a chrome
 * API on an interval resets the timer.
 */
function startKeepalive(): () => void {
  const id = setInterval(() => void chrome.runtime.getPlatformInfo(), 20_000);
  return () => clearInterval(id);
}

async function runSuite(providers: ProviderId[]): Promise<void> {
  const stopKeepalive = startKeepalive();
  const total = providers.length * EXPERIMENTS.reduce((n, e) => n + e.runs, 0);

  await setState({
    ...EMPTY,
    status: 'running',
    startedAt: new Date().toISOString(),
    total,
  });

  try {
    for (const experiment of EXPERIMENTS) {
      for (const provider of providers) {
        for (let run = 1; run <= experiment.runs; run++) {
          const label = `${provider} / ${experiment.name} / run ${run}`;
          await patchState({ current: label });

          const result = await probeOnce({
            provider,
            prompt: experiment.prompt,
            experiment: experiment.name,
            run,
            windowState: experiment.windowState,
          });

          const state = await getState();
          await setState({
            ...state,
            results: [...state.results, result],
            completed: state.completed + 1,
          });

          // Jittered pacing: these are subscription UIs with real rate limits, and a fixed
          // interval looks more like a bot than a varied one.
          await sleep(PACING_MS + Math.random() * PACING_JITTER_MS);
        }
      }
    }
    await patchState({ status: 'done', current: '', finishedAt: new Date().toISOString() });
  } catch (err) {
    await patchState({ status: 'error', error: String(err), finishedAt: new Date().toISOString() });
  } finally {
    stopKeepalive();
  }
}

interface ProbeArgs {
  provider: ProviderId;
  prompt: string;
  experiment: string;
  run: number;
  windowState: 'focused' | 'unfocused' | 'minimized';
}

async function probeOnce(args: ProbeArgs): Promise<RunResult> {
  const cfg = PROVIDERS[args.provider];
  const base: Pick<RunResult, 'provider' | 'experiment' | 'run' | 'windowState'> = {
    provider: args.provider,
    experiment: args.experiment,
    run: args.run,
    windowState: args.windowState,
  };

  let windowId: number | undefined;
  const navStart = Date.now();

  try {
    // Each run gets a fresh window and a fresh chat, so runs can't contaminate each other
    // via conversation history.
    const win = await chrome.windows.create({
      url: cfg.newChatUrl,
      focused: args.windowState === 'focused',
      state: 'normal',
      width: 1280,
      height: 900,
    });
    windowId = win?.id;
    const tabId = win?.tabs?.[0]?.id;
    if (!tabId) throw new Error('window created without a tab');

    await waitForTabComplete(tabId, 30_000);

    if (args.windowState === 'minimized' && windowId !== undefined) {
      await chrome.windows.update(windowId, { state: 'minimized' });
    }

    const ready = await waitForContentScript(tabId, 20_000);
    if (!ready) {
      return {
        ...base,
        outcome: 'fail',
        failedPhase: 'navigate',
        failureMode:
          'content script never responded to PING (page may have redirected to a login wall)',
        timings: { navigate: Date.now() - navStart },
        matchedSelectors: {},
        usedOverrides: [],
      };
    }

    const driven = (await chrome.tabs.sendMessage(tabId, {
      type: 'DRIVE',
      provider: args.provider,
      prompt: args.prompt,
    })) as Omit<RunResult, 'provider' | 'experiment' | 'run' | 'windowState'>;

    return {
      ...base,
      ...driven,
      timings: { navigate: Date.now() - navStart, ...driven.timings },
    };
  } catch (err) {
    return {
      ...base,
      outcome: 'fail',
      failureMode: `orchestration error: ${String(err)}`,
      timings: { navigate: Date.now() - navStart },
      matchedSelectors: {},
      usedOverrides: [],
    };
  } finally {
    if (windowId !== undefined) {
      try {
        await chrome.windows.remove(windowId);
      } catch {
        /* already gone */
      }
    }
  }
}

async function waitForTabComplete(tabId: number, timeout: number): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') return;
    await sleep(250);
  }
  throw new Error('timeout:navigate');
}

/**
 * A 'complete' tab does not imply an injected, listening content script — especially on SPAs
 * that redirect. Poll PING rather than assuming.
 */
async function waitForContentScript(tabId: number, timeout: number): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
      if (res?.ok) return true;
    } catch {
      /* not listening yet */
    }
    await sleep(400);
  }
  return false;
}
