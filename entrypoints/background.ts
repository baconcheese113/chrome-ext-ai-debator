import { ADAPTERS, ADAPTERS_BY_ID, adapterForUrl } from '../lib/adapters';
import type { AdapterCheck } from '../lib/selector-check';
import {
  markConverged,
  pauseAfterRound,
  resumeRun,
  reconcileOrphanedRun,
  requestStop,
  resolveIncident,
  startRun,
} from '../lib/orchestrator';
import { EMPTY_RUN, getRun, patchRun, setRun } from '../lib/store';
import type { BgMessage, CandidateTab } from '../lib/types';

export default defineBackground(() => {
  chrome.action.onClicked.addListener(() => void openDashboard());

  // The worker just started, so no run loop can be alive. Anything the stored state claims
  // is "running" is a leftover from a terminated worker.
  void reconcileOrphanedRun('The extension restarted while a panel was running.');

  chrome.runtime.onMessage.addListener((msg: BgMessage, _sender, sendResponse) => {
    switch (msg.type) {
      case 'LIST_TABS':
        void listCandidateTabs().then(sendResponse);
        return true;

      case 'START_RUN':
        // Not awaited: the dashboard must stay responsive, and the run has to outlive it.
        void startRun(msg.config, msg.seats);
        sendResponse({ started: true });
        return false;

      case 'RESOLVE_INCIDENT':
        resolveIncident(msg.action);
        sendResponse({ ok: true });
        return false;

      case 'STOP_RUN':
        requestStop();
        sendResponse({ ok: true });
        return false;

      case 'MARK_CONVERGED':
        markConverged(msg.on ?? true);
        sendResponse({ ok: true });
        return false;

      case 'RESET_RUN':
        void setRun(EMPTY_RUN).then(() => sendResponse({ ok: true }));
        return true;

      case 'QUEUE_STEER':
        // Stored rather than delivered now: the round loop consumes it at the next boundary
        // so every participant in a round gets the same instructions.
        void patchRun({ pendingSteer: msg.text.trim() || null }).then(() =>
          sendResponse({ ok: true }),
        );
        return true;

      case 'PAUSE_AFTER_ROUND':
        pauseAfterRound(msg.on ?? true);
        sendResponse({ ok: true });
        return false;

      case 'RESUME_RUN':
        resumeRun();
        sendResponse({ ok: true });
        return false;

      case 'CHECK_ADAPTERS':
        void checkAllTabs().then(sendResponse);
        return true;

      case 'DIAGNOSE_TAB':
        void chrome.tabs
          .sendMessage(msg.tabId, { type: 'DIAGNOSE' })
          .then(sendResponse)
          .catch((err) => sendResponse({ error: String(err) }));
        return true;

      default:
        return false;
    }
  });
});

/**
 * Read-only audit of every open provider tab. Sends nothing to any model, so it costs no
 * quota and adds nothing to any thread — it just reports which selectors still match.
 */
async function checkAllTabs(): Promise<Array<AdapterCheck & { tabId: number; title: string }>> {
  const tabs = await listCandidateTabs();
  const out: Array<AdapterCheck & { tabId: number; title: string }> = [];

  for (const tab of tabs) {
    const adapter = ADAPTERS_BY_ID[tab.providerId];
    if (!adapter) continue;

    let result: AdapterCheck | null = null;
    try {
      result = (await chrome.tabs.sendMessage(tab.tabId, {
        type: 'CHECK_ADAPTER',
        providerId: tab.providerId,
      })) as AdapterCheck | null;
    } catch {
      // Tabs opened before the extension loaded have no content script yet.
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.tabId },
          files: ['content-scripts/driver.js'],
        });
        result = (await chrome.tabs.sendMessage(tab.tabId, {
          type: 'CHECK_ADAPTER',
          providerId: tab.providerId,
        })) as AdapterCheck | null;
      } catch (err) {
        out.push({
          providerId: tab.providerId,
          providerLabel: tab.providerLabel,
          url: tab.url,
          ok: false,
          checks: [
            {
              concern: 'composer',
              state: 'fail',
              matched: null,
              count: 0,
              note: `Could not reach this tab: ${String(err)}. Reload it and try again.`,
            },
          ],
          tabId: tab.tabId,
          title: tab.title,
        });
        continue;
      }
    }

    if (result) out.push({ ...result, tabId: tab.tabId, title: tab.title });
  }

  return out;
}

async function openDashboard(): Promise<void> {
  const url = chrome.runtime.getURL('/dashboard.html');
  const existing = await chrome.tabs.query({ url });
  if (existing[0]?.id) {
    await chrome.tabs.update(existing[0].id, { active: true });
    if (existing[0].windowId) await chrome.windows.update(existing[0].windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url });
}

/**
 * Everything the user already has open that we know how to drive. This is the whole basis of
 * the claim-a-tab model: they pick the model and start the thread, we just take a seat.
 */
async function listCandidateTabs(): Promise<CandidateTab[]> {
  const run = await getRun();
  const claimed = new Set(run.seats.map((s) => s.tabId));
  const patterns = ADAPTERS.flatMap((a) => a.urlPatterns);
  const tabs = await chrome.tabs.query({ url: patterns });

  return tabs
    .filter((t) => t.id !== undefined && t.url)
    .map((t) => {
      const adapter = adapterForUrl(t.url!);
      return {
        tabId: t.id!,
        windowId: t.windowId,
        providerId: adapter?.id ?? 'unknown',
        providerLabel: adapter?.label ?? 'Unknown',
        title: t.title ?? '',
        url: t.url!,
        claimed: claimed.has(t.id!),
      };
    })
    .filter((c) => c.providerId !== 'unknown');
}
