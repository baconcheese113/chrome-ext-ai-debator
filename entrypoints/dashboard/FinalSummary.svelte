<script lang="ts">
  import type { FinalSummary, RunState } from '../../lib/types';
  import Prose from './Prose.svelte';

  let { summary, run }: { summary: FinalSummary; run: RunState } = $props();

  const REASON: Record<string, string> = {
    converged: 'the panel converged',
    'max-rounds': 'the round limit was reached',
    stopped: 'you stopped it',
    'too-few-participants': 'too few models remained',
    error: 'the run errored',
  };

  let copied = $state(false);
  async function copy() {
    await navigator.clipboard.writeText(summary.text);
    copied = true;
    setTimeout(() => (copied = false), 2500);
  }
</script>

<section class="card wrap">
  <header>
    <div>
      <h2>What happened</h2>
      <p class="meta data">
        {summary.roundsCompleted} round{summary.roundsCompleted === 1 ? '' : 's'} ·
        {REASON[summary.endReason] ?? summary.endReason}
      </p>
    </div>
    {#if summary.text}
      <button class="tiny" onclick={copy}>{copied ? 'Copied' : 'Copy'}</button>
    {/if}
  </header>

  {#if summary.unavailable}
    <p class="none">{summary.unavailable}</p>
  {:else}
    <div class="prose"><Prose text={summary.text} {run} /></div>
  {/if}
</section>

<style>
  .wrap { padding: 18px 20px; margin-bottom: 22px; border-left: 2px solid var(--accent); }
  header { display: flex; justify-content: space-between; align-items: start; gap: 16px; }
  h2 { font-size: 14px; letter-spacing: .14em; text-transform: uppercase; }
  .meta { color: var(--ink-faint); margin: 4px 0 0; font-size: 11px; }
  .tiny { padding: 5px 9px; font-size: 10px; }
  .none { color: var(--ink-dim); margin: 12px 0 0; }
  .prose { margin-top: 14px; max-width: 74ch; }
</style>
