<script lang="ts">
  import { onMount } from 'svelte';
  import type { AdapterCheck } from '../../lib/selector-check';
  import type { CandidateTab, ConvergenceStrategy, RunConfig, Seat } from '../../lib/types';

  let { onstart }: { onstart: (c: RunConfig, s: Array<Omit<Seat, 'status'>>) => void } = $props();

  let tabs = $state<CandidateTab[]>([]);
  let loading = $state(true);
  /** tabId -> assignment. Absent means the tab sits this run out. */
  let roles = $state<Record<number, 'participant' | 'narrator' | 'none'>>({});
  let names = $state<Record<number, string>>({});

  let topic = $state('');
  let maxRounds = $state(6);
  let convergence = $state<ConvergenceStrategy>('self-report');
  let autoDrop = $state(false);
  let isolateWindows = $state(true);
  let wordBudget = $state(400);

  let loadError = $state<string | null>(null);

  async function load() {
    loading = true;
    loadError = null;
    try {
      // sendMessage resolves to undefined when the service worker has no listener yet.
      // Without this guard the iteration below throws and the screen hangs on "Scanning".
      const res = await chrome.runtime.sendMessage({ type: 'LIST_TABS' });
      if (!Array.isArray(res)) throw new Error('the extension background did not respond');
      tabs = res;
      for (const t of tabs) {
        roles[t.tabId] ??= 'none';
        names[t.tabId] ??= t.providerLabel;
      }
    } catch (err) {
      tabs = [];
      loadError = String(err instanceof Error ? err.message : err);
    } finally {
      loading = false;
    }
  }

  async function diagnose(tabId: number) {
    const d = await chrome.runtime.sendMessage({ type: 'DIAGNOSE_TAB', tabId });
    // Copying beats rendering here: the output's only job is to be pasted somewhere useful.
    await navigator.clipboard.writeText(JSON.stringify(d, null, 2));
    diagnosed = tabId;
    setTimeout(() => (diagnosed = null), 2500);
  }
  let diagnosed = $state<number | null>(null);

  type TabCheck = AdapterCheck & { tabId: number; title: string };
  let checks = $state<TabCheck[] | null>(null);
  let checking = $state(false);

  /**
   * Read-only audit: does each adapter's selectors still match its page? Sends no prompt, so
   * it costs no quota and leaves no trace in any thread.
   */
  async function checkAdapters() {
    checking = true;
    try {
      checks = await chrome.runtime.sendMessage({ type: 'CHECK_ADAPTERS' });
    } finally {
      checking = false;
    }
  }

  async function copyChecks() {
    await navigator.clipboard.writeText(JSON.stringify(checks, null, 2));
    checksCopied = true;
    setTimeout(() => (checksCopied = false), 2500);
  }
  let checksCopied = $state(false);

  const participants = $derived(tabs.filter((t) => roles[t.tabId] === 'participant'));
  const narrators = $derived(tabs.filter((t) => roles[t.tabId] === 'narrator'));

  const problem = $derived.by(() => {
    if (!topic.trim()) return 'Give the panel a topic.';
    if (participants.length < 2) return 'Seat at least two participants.';
    if (narrators.length > 1) return 'Only one narrator.';
    if (convergence === 'moderator' && narrators.length === 0)
      return 'Moderator convergence needs a narrator seat.';
    return null;
  });

  function start() {
    const seats = [...participants, ...narrators].map((t) => ({
      seatId: `seat-${t.tabId}`,
      tabId: t.tabId,
      providerId: t.providerId,
      displayName: names[t.tabId]?.trim() || t.providerLabel,
      role: roles[t.tabId] as 'participant' | 'narrator',
    }));
    onstart(
      { topic: topic.trim(), maxRounds, convergence, autoDrop, wordBudget, isolateWindows },
      seats,
    );
  }

  // onMount, not $effect: load() writes to state it also reads, and an effect would risk
  // re-running itself.
  onMount(load);
</script>

<div class="wrap">
  <section class="card patch">
    <header>
      <div>
        <h2>Seat the panel</h2>
        <p class="hint">
          Open each model in its own tab and pick the model you want before seating it. The panel
          reuses these threads for every round, so nothing new clutters your history.
        </p>
      </div>
      <div class="hdr-acts">
        <button onclick={checkAdapters} disabled={checking}>
          {checking ? 'Checking…' : 'Check adapters'}
        </button>
        <button onclick={load}>Rescan</button>
      </div>
    </header>

    {#if checks}
      <div class="checks">
        <div class="checks-head">
          <span class="label">Selector check — nothing was sent to any model</span>
          <button class="tiny" onclick={copyChecks}>{checksCopied ? 'Copied' : 'Copy report'}</button>
        </div>
        {#each checks as c (c.tabId)}
          <div class="chk" class:bad={!c.ok}>
            <span class="chk-name">{c.providerLabel}</span>
            <div class="chk-items">
              {#each c.checks as k, i (i)}
                <span class="pill {k.state}" title={k.note ?? k.matched ?? ''}>
                  {k.concern}{#if k.count}<span class="n">{k.count}</span>{/if}
                </span>
              {/each}
            </div>
          </div>
          {#each c.checks.filter((k) => k.state !== 'ok' && k.note) as k, i (i)}
            <p class="chk-note {k.state}">{k.concern}: {k.note}</p>
          {/each}
        {/each}
      </div>
    {/if}

    {#if loading}
      <p class="empty data">Scanning open tabs…</p>
    {:else if loadError}
      <p class="loaderr">Couldn't read your open tabs — {loadError}. Reload this page, then Rescan.</p>
    {:else if !tabs.length}
      <p class="empty">
        No chat tabs open yet. Open Claude, ChatGPT, Gemini, or Grok in this window, then Rescan.
      </p>
    {:else}
      <ul>
        {#each tabs as t (t.tabId)}
          <li class:seated={roles[t.tabId] !== 'none'}>
            <div class="who">
              <span class="prov">{t.providerLabel}</span>
              <span class="title" title={t.title}>{t.title || t.url}</span>
            </div>
            <input
              class="name"
              bind:value={names[t.tabId]}
              aria-label="Name shown to the other models"
              placeholder="Name shown to others"
            />
            <select bind:value={roles[t.tabId]} aria-label="Seat role">
              <option value="none">Not in panel</option>
              <option value="participant">Participant</option>
              <option value="narrator">Narrator</option>
            </select>
            <button class="diag" onclick={() => diagnose(t.tabId)}>
              {diagnosed === t.tabId ? 'Copied' : 'Diagnose'}
            </button>
          </li>
        {/each}
      </ul>
      <p class="foot">
        Diagnose copies this page's candidate selectors to your clipboard — use it when a provider
        stops responding after a redesign.
      </p>
    {/if}
  </section>

  <section class="card config">
    <h2>Run</h2>

    <div class="field">
      <label class="label" for="topic">Topic</label>
      <textarea id="topic" bind:value={topic} rows="3" placeholder="What should the panel brainstorm?"
      ></textarea>
    </div>

    <div class="grid">
      <div class="field">
        <label class="label" for="rounds">Max rounds</label>
        <input id="rounds" type="number" min="1" max="20" bind:value={maxRounds} />
      </div>
      <div class="field">
        <label class="label" for="budget">Words per reply</label>
        <input id="budget" type="number" min="80" max="2000" step="20" bind:value={wordBudget} />
      </div>
    </div>

    <div class="field">
      <label class="label" for="conv">Stop when</label>
      <select id="conv" bind:value={convergence}>
        <option value="self-report">Every participant says it's done</option>
        <option value="moderator">The narrator rules it converged</option>
        <option value="manual">Only when I say so</option>
      </select>
    </div>

    <label class="check">
      <input type="checkbox" bind:checked={autoDrop} />
      <span>Drop a failing model and keep going, instead of pausing to ask</span>
    </label>

    <label class="check">
      <input type="checkbox" bind:checked={isolateWindows} />
      <span>
        Give each model its own window
        <em>Chrome stops rendering background tabs, so seats sharing a window stall forever.
        Leave this on unless you know you need it off.</em>
      </span>
    </label>

    <div class="go">
      <button class="primary" disabled={!!problem} onclick={start}>Start panel</button>
      {#if problem}<span class="problem">{problem}</span>{/if}
    </div>
  </section>
</div>

<style>
  .wrap { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(300px, .85fr); gap: 16px; align-items: start; }
  @media (max-width: 900px) { .wrap { grid-template-columns: 1fr; } }

  section { padding: 16px 18px; }
  header { display: flex; justify-content: space-between; align-items: start; gap: 16px; margin-bottom: 14px; }
  h2 { font-size: 15px; letter-spacing: .06em; text-transform: uppercase; }
  .hint { color: var(--ink-dim); margin: 6px 0 0; max-width: 62ch; font-size: 13px; }

  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 170px 150px auto;
    gap: 8px; align-items: center;
    padding: 8px; border: 1px solid transparent; border-radius: var(--r);
    background: var(--chassis);
  }
  li.seated { border-color: var(--rule); background: var(--panel-hi); }
  @media (max-width: 720px) { li { grid-template-columns: 1fr; } }

  .who { display: flex; flex-direction: column; min-width: 0; }
  .prov { font: 600 12px var(--font-label); letter-spacing: .1em; text-transform: uppercase; }
  .title { color: var(--ink-faint); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .name { font-size: 13px; }
  .diag { padding: 7px 10px; font-size: 11px; }
  .foot { color: var(--ink-faint); font-size: 12px; margin: 12px 0 0; }
  .empty { color: var(--ink-dim); margin: 0; }
  .loaderr { color: var(--contest); margin: 0; }

  .hdr-acts { display: flex; gap: 8px; flex-shrink: 0; }
  .tiny { padding: 5px 9px; font-size: 10px; }

  .checks {
    border: 1px solid var(--rule); border-radius: var(--r);
    padding: 10px 12px; margin-bottom: 14px; background: var(--chassis);
  }
  .checks-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .chk { display: flex; gap: 10px; align-items: center; padding: 3px 0; flex-wrap: wrap; }
  .chk-name { font: 600 11px var(--font-label); letter-spacing: .1em; text-transform: uppercase; min-width: 78px; }
  .chk-items { display: flex; gap: 5px; flex-wrap: wrap; }
  .pill {
    font: 11px var(--font-data); padding: 2px 7px; border-radius: 999px;
    border: 1px solid var(--rule); color: var(--ink-faint);
  }
  .pill.ok { color: var(--agree); border-color: #24483a; }
  .pill.fail { color: var(--contest); border-color: #4a2b2b; }
  .pill.unknown { color: var(--open); border-color: #4a3f22; }
  .pill .n { opacity: .6; margin-left: 5px; }
  .chk-note { font-size: 11px; margin: 2px 0 6px 88px; color: var(--ink-faint); }
  .chk-note.fail { color: var(--contest); }
  .chk-note.unknown { color: var(--open); }

  .config { display: grid; gap: 14px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .check { display: flex; gap: 8px; align-items: start; color: var(--ink-dim); font-size: 13px; }
  .check input { width: auto; margin-top: 2px; }
  .check em { display: block; font-style: normal; color: var(--ink-faint); font-size: 11px; margin-top: 3px; }
  .go { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .problem { color: var(--open); font-size: 12px; }
</style>
