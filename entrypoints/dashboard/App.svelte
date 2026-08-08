<script lang="ts">
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
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes.runState?.newValue) {
        run = changes.runState.newValue as RunState;
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  });

  const showSetup = $derived(run.status === 'idle' || run.status === 'aborted' || !run.seats.length);

  function start(config: RunConfig, seats: Array<Omit<Seat, 'status'>>) {
    void chrome.runtime.sendMessage({ type: 'START_RUN', config, seats });
  }
  const send = (type: string, extra: object = {}) =>
    void chrome.runtime.sendMessage({ type, ...extra });

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
        <button onclick={() => send('MARK_CONVERGED')}>End after this round</button>
        <button class="danger" onclick={() => send('STOP_RUN')}>Stop</button>
      {:else if !showSetup}
        <button onclick={() => send('RESET_RUN')}>New panel</button>
      {/if}
    </div>
  </header>

  {#if run.incident}
    <!-- The failure policy in the flesh: name the model, name the fault, offer the three
         choices. Never degrade silently. -->
    <div class="incident" role="alert">
      <div>
        <strong>{run.incident.displayName} stopped responding in round {run.incident.round}.</strong>
        <span class="data why">{run.incident.failure} — {run.incident.detail}</span>
      </div>
      <div class="acts">
        <button onclick={() => send('RESOLVE_INCIDENT', { action: 'retry' })}>Try again</button>
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

  .incident {
    display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap;
    background: #2a1f1d; border: 1px solid #5a3330; border-left: 3px solid var(--contest);
    border-radius: var(--r); padding: 12px 14px; margin-bottom: 18px;
  }
  .incident strong { display: block; font-weight: 600; }
  .why { display: block; color: var(--ink-dim); margin-top: 3px; font-size: 12px; }
  .acts { display: flex; gap: 8px; flex-wrap: wrap; }
  .boot { color: var(--ink-faint); }
</style>
