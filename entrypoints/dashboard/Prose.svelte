<script lang="ts">
  import { channelColor } from '../../lib/channels';
  import { parseProse, parseSpans, type Span } from '../../lib/prose';
  import type { RunState } from '../../lib/types';

  let {
    text,
    run,
    /** Render a single line of spans with no block wrapper — for list items and captions. */
    inline: inlineOnly = false,
  }: { text: string; run: RunState; inline?: boolean } = $props();

  const participants = $derived(run.seats.filter((s) => s.role === 'participant'));
  const names = $derived(participants.map((s) => s.displayName));

  const blocks = $derived(inlineOnly ? [] : parseProse(text, names));
  const lineSpans = $derived(inlineOnly ? parseSpans(text, names) : []);

  /**
   * Only the NAME is coloured, never the surrounding claim. Colouring whole claims turns a
   * five-channel panel into a highlighter accident, and forces an arbitrary choice whenever
   * a claim has two authors ("Claude cited Sober, ChatGPT accepted it").
   */
  function colorFor(name: string): string {
    const seat = participants.find((s) => s.displayName === name);
    return seat ? channelColor(run, seat.seatId) : 'inherit';
  }
</script>

<!-- Built from parsed blocks, never {@html}: model output inside a privileged page. -->
{#if inlineOnly}
  {@render inline(lineSpans)}
{:else}
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
{/if}

{#snippet inline(spans: Span[])}
  {#each spans as s, i (i)}{#if s.agent}<span
        class="agent"
        class:bold={s.bold}
        style:color={colorFor(s.agent)}>{s.text}</span
      >{:else if s.bold}<strong>{s.text}</strong>{:else}{s.text}{/if}{/each}
{/snippet}

<style>
  h3 { font-size: 13px; letter-spacing: .1em; text-transform: uppercase; color: var(--accent); margin: 20px 0 8px; }
  h4 { font-size: 13px; margin: 16px 0 6px; }
  p { margin: 0 0 12px; line-height: 1.65; }
  ul, ol { margin: 0 0 12px; padding-left: 20px; display: grid; gap: 6px; }
  li { line-height: 1.6; }
  strong { color: var(--ink); font-weight: 600; }
  .agent { font-weight: 600; }
  .agent.bold { font-weight: 700; }
</style>
