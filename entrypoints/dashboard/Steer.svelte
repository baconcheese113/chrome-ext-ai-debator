<script lang="ts">
  import { api } from '../../lib/browser';
  import type { RunState } from '../../lib/types';

  let { run }: { run: RunState } = $props();

  let draft = $state('');
  const send = (type: string, extra: object = {}) =>
    void api.runtime.sendMessage({ type, ...extra });

  function queue() {
    if (!draft.trim()) return;
    send('QUEUE_STEER', { text: draft });
    draft = '';
  }

  function resume() {
    if (draft.trim()) queue();
    send('RESUME_RUN');
  }
</script>

<!--
  Ten rounds of cross-examination narrows: each round stress-tests what is already on the
  table. A note is the only way to widen it — to add a source, a discipline, or a correction
  the models would not reach on their own.
-->
<section class="card wrap" class:held={run.awaitingSteer}>
  <header>
    <span class="label">{run.awaitingSteer ? 'Paused for your note' : 'Steer the next round'}</span>
    {#if run.pendingSteer}
      <button class="tiny" onclick={() => send('QUEUE_STEER', { text: '' })}>Discard</button>
    {/if}
  </header>

  {#if run.pendingSteer}
    <p class="queued">
      <span class="tag">Queued for round {run.round + 1}</span>
      {run.pendingSteer}
    </p>
  {/if}

  <textarea
    bind:value={draft}
    rows="2"
    placeholder="e.g. You're all inside Western analytic philosophy — bring in non-Western sources."
    aria-label="Note for the next round"
  ></textarea>

  <div class="acts">
    <button onclick={queue} disabled={!draft.trim()}>
      {run.pendingSteer ? 'Replace note' : 'Add note'}
    </button>
    {#if run.awaitingSteer}
      <button class="primary" onclick={resume}>Resume</button>
    {:else}
      <button
        class:armed={run.pauseAfterRound}
        aria-pressed={run.pauseAfterRound}
        onclick={() => send('PAUSE_AFTER_ROUND', { on: !run.pauseAfterRound })}
      >
        {run.pauseAfterRound ? `Pausing after round ${run.round} ✕` : 'Pause after this round'}
      </button>
    {/if}
    <span class="hint">
      {#if run.pauseAfterRound && !run.awaitingSteer}
        The panel will stop and wait for you once round {run.round} is summarised.
      {:else}
        Every model sees it at the start of the next round, marked as coming from you.
      {/if}
    </span>
  </div>
</section>

<style>
  .wrap { padding: 12px 14px; margin-bottom: 18px; display: grid; gap: 8px; }
  .wrap.held { border-color: var(--open); border-left: 2px solid var(--open); }
  header { display: flex; justify-content: space-between; align-items: center; }
  .tiny { padding: 4px 8px; font-size: 10px; }
  textarea { resize: vertical; font-size: 13px; }
  .acts { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .hint { color: var(--ink-faint); font-size: 11px; }
  .queued {
    margin: 0; font-size: 13px; color: var(--ink);
    background: var(--chassis); border-left: 2px solid var(--open);
    padding: 8px 10px; border-radius: var(--r);
  }
  .tag {
    display: inline-block; margin-right: 8px; color: var(--open);
    font: 600 10px var(--font-label); letter-spacing: .1em; text-transform: uppercase;
  }
</style>
