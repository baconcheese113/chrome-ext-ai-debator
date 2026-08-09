<script lang="ts">
  import { channelColor } from '../../lib/channels';
  import { parseProse, type Span } from '../../lib/prose';
  import type { FinalSummary, RunState } from '../../lib/types';

  let { summary, run }: { summary: FinalSummary; run: RunState } = $props();

  const participants = $derived(run.seats.filter((s) => s.role === 'participant'));
  const blocks = $derived(parseProse(summary.text, participants.map((s) => s.displayName)));

  /** Same colour the seat carries everywhere else, so attribution is readable at a glance. */
  function colorFor(name: string): string {
    const seat = participants.find((s) => s.displayName === name);
    return seat ? channelColor(run, seat.seatId) : 'inherit';
  }

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

<!-- Rendered from parsed blocks, never {@html}: this text comes from a model and the console
     is a privileged extension page. -->
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
    <div class="prose">
      {#each blocks as b, i (i)}
        {#if b.kind === 'heading' && b.level === 2}
          <h3>{@render inline(b.spans)}</h3>
        {:else if b.kind === 'heading'}
          <h4>{@render inline(b.spans)}</h4>
        {:else if b.kind === 'list' && b.ordered}
          <ol>{#each b.items as item, j (j)}<li>{@render inline(item)}</li>{/each}</ol>
        {:else if b.kind === 'list'}
          <ul>{#each b.items as item, j (j)}<li>{@render inline(item)}</li>{/each}</ul>
        {:else if b.kind === 'paragraph'}
          <p>{@render inline(b.spans)}</p>
        {/if}
      {/each}
    </div>
  {/if}
</section>

{#snippet inline(spans: Span[])}
  {#each spans as s, i (i)}{#if s.agent}<span class="agent" style:color={colorFor(s.agent)} class:bold={s.bold}>{s.text}</span>{:else if s.bold}<strong>{s.text}</strong>{:else}{s.text}{/if}{/each}
{/snippet}

<style>
  .wrap { padding: 18px 20px; margin-bottom: 22px; border-left: 2px solid var(--accent); }
  header { display: flex; justify-content: space-between; align-items: start; gap: 16px; }
  h2 { font-size: 14px; letter-spacing: .14em; text-transform: uppercase; }
  .meta { color: var(--ink-faint); margin: 4px 0 0; font-size: 11px; }
  .tiny { padding: 5px 9px; font-size: 10px; }
  .none { color: var(--ink-dim); margin: 12px 0 0; }

  .prose { margin-top: 14px; max-width: 74ch; }
  .prose :global(h3) { font-size: 13px; letter-spacing: .1em; text-transform: uppercase; color: var(--accent); margin: 20px 0 8px; }
  .prose :global(h4) { font-size: 13px; margin: 16px 0 6px; }
  .prose p { margin: 0 0 12px; line-height: 1.65; }
  .prose ul, .prose ol { margin: 0 0 12px; padding-left: 20px; display: grid; gap: 6px; }
  .prose li { line-height: 1.6; }
  .prose :global(strong) { color: var(--ink); font-weight: 600; }
  .prose :global(.agent) { font-weight: 600; }
  .prose :global(.agent.bold) { font-weight: 700; }
</style>
