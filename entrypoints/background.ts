import { ADAPTERS, adapterForUrl } from '../lib/adapters';
import {
  markConverged,
  reconcileOrphanedRun,
  requestStop,
  resolveIncident,
  startRun,
} from '../lib/orchestrator';
import { EMPTY_RUN, getRun, setRun } from '../lib/store';
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
        markConverged();
        sendResponse({ ok: true });
        return false;

      case 'RESET_RUN':
        void setRun(EMPTY_RUN).then(() => sendResponse({ ok: true }));
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
