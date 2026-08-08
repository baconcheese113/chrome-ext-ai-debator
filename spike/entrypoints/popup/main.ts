import { EXPERIMENTS } from '../../lib/experiments';
import { PROVIDERS, PROVIDER_IDS } from '../../lib/providers';
import { getState } from '../../lib/store';
import type { ProviderId } from '../../lib/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const providersEl = $<HTMLDivElement>('providers');
const startBtn = $<HTMLButtonElement>('start');
const diagnoseBtn = $<HTMLButtonElement>('diagnose');
const resetBtn = $<HTMLButtonElement>('reset');
const copyBtn = $<HTMLButtonElement>('copy');
const downloadBtn = $<HTMLButtonElement>('download');
const bar = $<HTMLProgressElement>('bar');
const statusEl = $<HTMLParagraphElement>('status');
const out = $<HTMLTextAreaElement>('out');

for (const id of PROVIDER_IDS) {
  const label = document.createElement('label');
  label.innerHTML = `<input type="checkbox" value="${id}" checked /> ${PROVIDERS[id].label}`;
  providersEl.appendChild(label);
}

const selectedProviders = (): ProviderId[] =>
  Array.from(providersEl.querySelectorAll<HTMLInputElement>('input:checked')).map(
    (i) => i.value as ProviderId,
  );

startBtn.addEventListener('click', async () => {
  const providers = selectedProviders();
  if (!providers.length) {
    statusEl.textContent = 'Pick at least one provider.';
    return;
  }
  const runs = EXPERIMENTS.reduce((n, e) => n + e.runs, 0) * providers.length;
  statusEl.textContent = `Starting ${runs} runs…`;
  await chrome.runtime.sendMessage({ type: 'START_SUITE', providers });
  void refresh();
});

resetBtn.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'RESET' });
  out.value = '';
  void refresh();
});

/**
 * Escape hatch for when the configured selectors miss: open the provider, click this, and
 * get a pasteable list of candidate elements without burning a suite run on it.
 */
diagnoseBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    const diag = await chrome.tabs.sendMessage(tab.id, { type: 'DIAGNOSE' });
    out.value = JSON.stringify(diag, null, 2);
    statusEl.textContent = 'Diagnostics for active tab.';
  } catch {
    statusEl.textContent = 'No content script on that tab — is it one of the four providers?';
  }
});

copyBtn.addEventListener('click', () => {
  out.select();
  void navigator.clipboard.writeText(out.value);
  statusEl.textContent = 'Copied.';
});

downloadBtn.addEventListener('click', () => {
  const blob = new Blob([out.value], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'spike-results.json';
  a.click();
  URL.revokeObjectURL(a.href);
});

async function refresh(): Promise<void> {
  const s = await getState();
  bar.max = Math.max(1, s.total);
  bar.value = s.completed;

  if (s.status === 'running') {
    statusEl.textContent = `Running ${s.completed}/${s.total} — ${s.current}`;
    startBtn.disabled = true;
  } else if (s.status === 'done') {
    statusEl.textContent = `Done. ${s.results.length} runs. Copy the JSON below.`;
    startBtn.disabled = false;
  } else if (s.status === 'error') {
    statusEl.textContent = `Error: ${s.error}`;
    startBtn.disabled = false;
  } else {
    statusEl.textContent = 'Idle.';
    startBtn.disabled = false;
  }

  if (s.results.length) out.value = JSON.stringify(summarise(s), null, 2);
}

/** Trim the payload to what the findings doc actually needs. */
function summarise(s: Awaited<ReturnType<typeof getState>>) {
  return {
    startedAt: s.startedAt,
    finishedAt: s.finishedAt,
    status: s.status,
    results: s.results,
  };
}

void refresh();
setInterval(() => void refresh(), 1000);
