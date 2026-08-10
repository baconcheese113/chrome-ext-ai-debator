<script lang="ts">
  import { api } from '../../lib/browser';
  import { onMount } from 'svelte';
  import { EMPTY_RUN, getRun } from '../../lib/store';
  import type { RunConfig, RunState, Seat } from '../../lib/types';
  import RunView from './RunView.svelte';
  import Setup from './Setup.svelte';

  let run = $state<RunState>(EMPTY_RUN);
  /** Until the stored run loads, rendering Setup would flash the wrong screen mid-run. */
  let loaded = $state(false);

  // storage.onChanged rather than polling: the orchestrator writes state as it goes, so the
  // console tracks the run without a timer. onMount, not $effect — this subscribes to an
  // external source and depends on no reactive state.
  onMount(() => {
    void getRun().then((r) => {
      run = r;
      loaded = true;
    });
    // `chrome` here is the ambient TYPE namespace from @types/chrome, not the global object —
    // types are identical across browsers, only the runtime differs. See lib/browser.ts.
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes.runState?.newValue) {
        run = changes.runState.newValue as RunState;
      }
    };
    api.storage.onChanged.addListener(listener);
    return () => api.storage.onChanged.removeListener(listener);
  });

  const showSetup = $derived(run.status === 'idle' || run.status === 'aborted' || !run.seats.length);

  function start(config: RunConfig, seats: Array<Omit<Seat, 'status'>>) {
    void api.runtime.sendMessage({ type: 'START_RUN', config, seats });
  }
  const send = (type: string, extra: object = {}) =>
    void api.runtime.sendMessage({ type, ...extra });

  let exported = $state(false);
  /**
   * The flight recorder, as one file. Every defect so far was diagnosed from a screenshot of
   * a truncated log plus guesswork; this is what replaces that.
   *
   * It contains prompt and reply excerpts from the run, and page markup for any failure —
   * i.e. your actual conversation content. It is written to your downloads and sent nowhere.
   */
  function exportRun() {
    const blob = new Blob([JSON.stringify(run, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ai-debator-run-${run.startedAt?.replace(/[:.]/g, '-') ?? 'latest'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    exported = true;
    setTimeout(() => (exported = false), 2500);
  }

  let copied = $state(false);
  /**
   * A broken adapter is fixed from the page's actual selectors. Putting them one click away
   * at the moment of failure is the difference between a fix and a guess.
   */
  async function copyDiagnostics() {
    if (!run.incident?.diagnostics) return;
    await navigator.clipboard.writeText(
      JSON.stringify(
        { failure: run.incident.failure, detail: run.incident.detail, ...run.incident.diagnostics },
        null,
        2,
      ),
    );
    copied = true;
    setTimeout(() => (copied = false), 2500);
  }

  /**
   * "X stopped responding" was wrong for the commonest failure by far, which is a reply we
   * read too early — the model had answered fine. Naming the fault accurately is what makes
   * "Check again" the obvious button rather than "Try again".
   */
  const incidentHeadline = $derived.by(() => {
    const i = run.incident;
    if (!i) return '';
    switch (i.failure) {
      case 'implausible-response':
      case 'extract-empty':
        return `Couldn't read a complete reply from ${i.displayName} in round ${i.round}.`;
      case 'incomplete-reply':
        return `${i.displayName}'s round ${i.round} reply stops partway through.`;
      case 'prompt-echo':
        return `${i.displayName} handed back our own prompt in round ${i.round}.`;
      case 'window-minimized':
      case 'tab-closed':
        return `Can't reach ${i.displayName}'s tab in round ${i.round}.`;
      default:
        return `${i.displayName} stopped responding in round ${i.round}.`;
    }
  });

  const statusText: Record<RunState['status'], string> = {
    idle: 'Ready',
    running: 'Running',
    paused: 'Paused',
    done: 'Finished',
    aborted: 'Stopped',
    error: 'Error',
  };
</script>

<div class="shell">
  <header class="top">
    <div class="brand">
      <span class="mark" aria-hidden="true"></span>
      <h1>AI Debator</h1>
    </div>

    {#if run.config.topic}
      <p class="topic" title={run.config.topic}>{run.config.topic}</p>
    {:else}
      <p class="topic muted">No panel seated</p>
    {/if}

    <div class="status">
      <span class="chip {run.status}">{statusText[run.status]}</span>
      {#if run.status === 'running' || run.status === 'paused'}
        <span class="data round">Round {run.round} / {run.config.maxRounds}</span>
        <!-- Armed, not fired. It takes effect minutes later, so the button has to keep
             showing that it is still going to happen, and let you take it back. -->
        <button
          class:armed={run.endAfterRound}
          aria-pressed={run.endAfterRound}
          title={run.endAfterRound
            ? 'The panel will wrap up once round ' + run.round + ' finishes. Click to keep going.'
            : 'Finish after the current round, then write the closing summary.'}
          onclick={() => send('MARK_CONVERGED', { on: !run.endAfterRound })}
        >
          {run.endAfterRound ? `Ending after round ${run.round} ✕` : 'End after this round'}
        </button>
        <button class="danger" onclick={() => send('STOP_RUN')}>Stop</button>
      {:else if !showSetup}
        <button onclick={() => send('RESET_RUN')}>New panel</button>
      {/if}
      {#if run.records?.length}
        <button onclick={exportRun}>{exported ? 'Saved' : 'Export run'}</button>
      {/if}
    </div>
  </header>

  {#if run.incident}
    <!-- The failure policy in the flesh: name the model, name the fault, offer the three
         choices. Never degrade silently. -->
    <div class="incident" role="alert">
      <div>
        <strong>{incidentHeadline}</strong>
        <span class="data why">{run.incident.failure} — {run.incident.detail}</span>
        {#if run.incident.extracted}
          <!-- The diagnosis, on sight. A clean opening sentence means we read too early. A
               heading or "Thinking…" means the selector is on the wrong element, and no
               amount of waiting or re-reading will fix that. -->
          <span class="read">We read: “{run.incident.extracted}”</span>
        {/if}
        {#if run.incident.canRecheck}
          <!-- Ordering is the advice: re-reading is free and usually right, sending again
               costs a message and buries the answer that is already on screen. -->
          <span class="advice">
            Give it a moment to finish, then <b>Read the page again</b> — nothing is sent.
            <b>Send it again</b> posts the prompt a second time.
          </span>
        {/if}
      </div>
      <div class="acts">
        {#if run.incident.canRecheck}
          <button class="primary" onclick={() => send('RESOLVE_INCIDENT', { action: 'recheck' })}>
            Read the page again
          </button>
        {/if}
        {#if run.incident.diagnostics}
          <button onclick={copyDiagnostics}>{copied ? 'Copied' : 'Copy page details'}</button>
        {/if}
        <button onclick={() => send('RESOLVE_INCIDENT', { action: 'retry' })}>Send it again</button>
        <button onclick={() => send('RESOLVE_INCIDENT', { action: 'drop' })}>Continue without it</button>
        <button class="danger" onclick={() => send('RESOLVE_INCIDENT', { action: 'abort' })}>Stop the panel</button>
      </div>
    </div>
  {/if}

  <div class="body">
    {#if !loaded}
      <p class="boot data">Loading…</p>
    {:else if showSetup}
      <Setup onstart={start} />
    {:else}
      <RunView {run} />
    {/if}
  </div>
</div>

<style>
  .shell { max-width: 1180px; margin: 0 auto; padding: 18px 20px 60px; }

  .top {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 18px; align-items: center;
    padding-bottom: 14px; margin-bottom: 18px;
    border-bottom: 1px solid var(--rule);
  }
  @media (max-width: 820px) { .top { grid-template-columns: 1fr; } }

  .brand { display: flex; align-items: center; gap: 10px; }
  /* Three offset bars: independent channels, slightly out of phase. */
  .mark {
    width: 16px; height: 16px;
    background:
      linear-gradient(var(--ch-1), var(--ch-1)) 0 2px / 4px 12px no-repeat,
      linear-gradient(var(--ch-2), var(--ch-2)) 6px 0 / 4px 16px no-repeat,
      linear-gradient(var(--ch-3), var(--ch-3)) 12px 5px / 4px 9px no-repeat;
  }
  h1 { font-size: 14px; letter-spacing: .18em; text-transform: uppercase; }

  .topic { margin: 0; color: var(--ink-dim); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .topic.muted { color: var(--ink-faint); }

  .status { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .chip {
    font: 600 11px var(--font-label); letter-spacing: .12em; text-transform: uppercase;
    padding: 4px 9px; border-radius: 999px; border: 1px solid var(--rule); color: var(--ink-dim);
  }
  .chip.running { color: var(--accent); border-color: #2a4d55; }
  .chip.paused { color: var(--open); border-color: #4a3f22; }
  .chip.done { color: var(--agree); border-color: #24483a; }
  .chip.error, .chip.aborted { color: var(--contest); border-color: #4a2b2b; }
  .round { color: var(--ink-faint); }

  /* An armed intention reads as a held switch, not a pressed button. */
  :global(button.armed) {
    color: var(--open);
    border-color: var(--open);
    background: color-mix(in srgb, var(--open) 12%, transparent);
  }

  .incident {
    display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap;
    background: #2a1f1d; border: 1px solid #5a3330; border-left: 3px solid var(--contest);
    border-radius: var(--r); padding: 12px 14px; margin-bottom: 18px;
  }
  .incident strong { display: block; font-weight: 600; }
  .why { display: block; color: var(--ink-dim); margin-top: 3px; font-size: 12px; }
  .read {
    display: block; margin-top: 6px; padding: 6px 9px; max-width: 78ch;
    font: 12px/1.5 var(--font-data); color: var(--ink-dim);
    background: var(--chassis); border-left: 2px solid var(--rule); border-radius: var(--r);
  }
  .advice { display: block; color: var(--ink-dim); margin-top: 7px; font-size: 12px; max-width: 62ch; }
  .advice b { color: var(--ink); font-weight: 600; }
  .acts { display: flex; gap: 8px; flex-wrap: wrap; }
  .boot { color: var(--ink-faint); }
</style>
