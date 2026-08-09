<script lang="ts">
  import type { RoundSummary, RunState } from '../../lib/types';
  import Prose from './Prose.svelte';

  let { summary, run }: { summary: RoundSummary; run: RunState } = $props();
</script>

<div class="card narr">
  {#if summary.parseError}
    <p class="err">
      The narrator didn't return usable JSON, so there's no summary for this round.
      <span class="data">{summary.parseError}</span>
    </p>
    <details><summary>Show what it sent</summary><pre class="data">{summary.raw}</pre></details>
  {:else}
    <!-- Plain account first: the three columns below stay as technical as they need to be,
         but the round should be followable without already knowing the subject. -->
    {#if summary.plainSummary}
      <div class="plain"><Prose text={summary.plainSummary} {run} /></div>
    {:else if summary.rationale}
      <p class="rationale">{summary.rationale}</p>
    {/if}

    <div class="cols">
      <section class="agree">
        <h4 class="label">Agreed</h4>
        {#if summary.agreements.length}
          <ul>{#each summary.agreements as a, i (i)}<li><Prose text={a} {run} inline /></li>{/each}</ul>
        {:else}<p class="none">Nothing yet.</p>{/if}
      </section>

      <section class="contest">
        <h4 class="label">Contested</h4>
        {#if summary.disagreements.length}
          <ul>{#each summary.disagreements as d, i (i)}<li><Prose text={d} {run} inline /></li>{/each}</ul>
        {:else}<p class="none">Nothing yet.</p>{/if}
      </section>

      <section class="open">
        <h4 class="label">Unresolved</h4>
        {#if summary.openQuestions.length}
          <ul>{#each summary.openQuestions as q, i (i)}<li><Prose text={q} {run} inline /></li>{/each}</ul>
        {:else}<p class="none">Nothing yet.</p>{/if}
      </section>
    </div>

    {#if summary.plainSummary && summary.rationale}
      <p class="rationale tail">{summary.rationale}</p>
    {/if}

    {#if summary.keyPoints.length}
      <details class="points">
        <summary>Points by model</summary>
        {#each summary.keyPoints as kp, i (kp.agent + i)}
          <div class="kp"><span class="who">{kp.agent}</span>
            <ul>{#each kp.points as p, j (j)}<li>{p}</li>{/each}</ul>
          </div>
        {/each}
      </details>
    {/if}
  {/if}
</div>

<style>
  .narr { padding: 14px 16px; }
  .rationale { margin: 0 0 12px; color: var(--ink); }
  .rationale.tail { margin: 14px 0 0; color: var(--ink-dim); font-size: 12px; }
  .plain { margin-bottom: 14px; max-width: 74ch; }
  .plain :global(p:last-child) { margin-bottom: 0; }
  .cols { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
  @media (max-width: 860px) { .cols { grid-template-columns: 1fr; } }

  section { border-left: 2px solid var(--rule); padding-left: 10px; }
  .agree { border-left-color: var(--agree); }
  .contest { border-left-color: var(--contest); }
  .open { border-left-color: var(--open); }

  ul { margin: 8px 0 0; padding-left: 16px; display: grid; gap: 5px; }
  li { font-size: 13px; }
  .none { color: var(--ink-faint); font-size: 12px; margin: 8px 0 0; }

  details { margin-top: 12px; }
  summary { cursor: pointer; color: var(--ink-dim); font: 600 11px var(--font-label); letter-spacing: .12em; text-transform: uppercase; }
  .kp { margin-top: 10px; }
  .who { font: 600 12px var(--font-label); letter-spacing: .08em; }
  pre { white-space: pre-wrap; background: var(--chassis); padding: 10px; border-radius: var(--r); max-height: 240px; overflow: auto; }
  .err { color: var(--open); margin: 0; display: grid; gap: 4px; }
</style>
