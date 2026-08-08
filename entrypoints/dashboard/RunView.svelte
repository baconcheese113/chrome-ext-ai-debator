<script lang="ts">
  import { channelColor, seatStatusLabel } from '../../lib/channels';
  import type { RunState } from '../../lib/types';
  import ConvergenceRail from './ConvergenceRail.svelte';
  import NarratorCard from './NarratorCard.svelte';

  let { run }: { run: RunState } = $props();

  const narratorId = $derived(run.seats.find((s) => s.role === 'narrator')?.seatId);

  /** Newest round first — the live edge is what you're watching. */
  const rounds = $derived.by(() => {
    const out: number[] = [];
    for (let r = run.round; r >= 1; r--) out.push(r);
    return out;
  });

  function turnsFor(round: number) {
    return run.turns.filter((t) => t.round === round && t.seatId !== narratorId);
  }
  function summaryFor(round: number) {
    return run.summaries.find((s) => s.round === round);
  }
  function focusTab(tabId: number) {
    void chrome.tabs.update(tabId, { active: true });
  }
</script>

<div class="console">
  <aside class="card side">
    <div class="channels">
      <div class="label">Channels</div>
      <ul>
        {#each run.seats as seat (seat.seatId)}
          <li class:dropped={seat.status === 'dropped'}>
            <span class="swatch" style:background={channelColor(run, seat.seatId)}></span>
            <button class="jump" onclick={() => focusTab(seat.tabId)} title="Open this model's tab">
              {seat.displayName}
            </button>
            <span
              class="state data"
              class:live={seat.status === 'waiting' || seat.status === 'sending'}
              class:bad={seat.status === 'failed'}
            >{seatStatusLabel(seat)}</span>
            {#if seat.role === 'narrator'}<span class="role label">Narrator</span>{/if}
          </li>
        {/each}
      </ul>
    </div>
    <ConvergenceRail {run} />
  </aside>

  <main>
    {#if !rounds.length}
      <p class="waiting">Seeding the panel. The first round appears once every model replies.</p>
    {/if}

    {#each rounds as r (r)}
      {@const turns = turnsFor(r)}
      {@const summary = summaryFor(r)}
      <section class="round">
        <header>
          <h3>Round {r}</h3>
          <span class="rule"></span>
          <span class="data count">{turns.length} of {run.seats.filter((s) => s.role === 'participant').length} replied</span>
        </header>

        {#if summary}
          <NarratorCard {summary} />
        {:else if r === run.round && run.status === 'running'}
          <p class="pending data">Waiting on this round…</p>
        {/if}

        <div class="turns">
          {#each turns as t (t.seatId + t.round)}
            <article class="card turn" style:--ch={channelColor(run, t.seatId)}>
              <header class="th">
                <span class="who">{t.displayName}</span>
                <span class="data meta">
                  {t.wordCount}w
                  {#if t.converged === true}<span class="settled">· settled</span>
                  {:else if t.converged === null}<span class="novote">· no verdict</span>{/if}
                  {#if t.via === 'artifact'}<span class="art">· from artifact</span>{/if}
                </span>
              </header>
              <details>
                <summary>Read what it said</summary>
                <p class="body">{t.text}</p>
              </details>
            </article>
          {/each}
        </div>
      </section>
    {/each}

    {#if run.log.length}
      <details class="log">
        <summary>Activity</summary>
        <ul>
          {#each [...run.log].reverse() as e, i (e.at + i)}
            <li class="data" class:warn={e.level === 'warn'} class:error={e.level === 'error'}>
              <span class="ts">{e.at.slice(11, 19)}</span>{e.message}
            </li>
          {/each}
        </ul>
      </details>
    {/if}
  </main>
</div>

<style>
  .console { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 16px; align-items: start; }
  @media (max-width: 900px) { .console { grid-template-columns: 1fr; } }

  .side { position: sticky; top: 16px; }
  .channels { padding: 14px 16px; border-bottom: 1px solid var(--rule); }
  .channels ul { list-style: none; margin: 10px 0 0; padding: 0; display: grid; gap: 8px; }
  .channels li { display: grid; grid-template-columns: 8px 1fr auto; gap: 8px; align-items: center; }
  .channels li.dropped { opacity: .4; }
  .swatch { width: 8px; height: 8px; border-radius: 50%; }
  .jump {
    all: unset; cursor: pointer; font-size: 13px; color: var(--ink);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .jump:hover { color: var(--accent); text-decoration: underline; }
  .jump:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .state { color: var(--ink-faint); font-size: 11px; }
  .state.live { color: var(--accent); animation: pulse 1.6s ease-in-out infinite; }
  .state.bad { color: var(--contest); }
  .role { grid-column: 2 / -1; font-size: 10px; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .45; } }

  main { display: grid; gap: 22px; }
  .round header { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
  h3 { font-size: 13px; letter-spacing: .14em; text-transform: uppercase; }
  .rule { flex: 1; height: 1px; background: var(--rule); }
  .count { color: var(--ink-faint); }

  .turns { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; margin-top: 10px; }
  .turn { padding: 10px 12px; border-left: 2px solid var(--ch); }
  .th { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
  .who { font: 600 12px var(--font-label); letter-spacing: .08em; }
  .meta { color: var(--ink-faint); font-size: 11px; }
  .settled { color: var(--agree); }
  .novote { color: var(--open); }
  .art { color: var(--open); }
  details summary { cursor: pointer; color: var(--ink-dim); font-size: 12px; margin-top: 6px; }
  .body { white-space: pre-wrap; font-size: 13px; color: var(--ink-dim); margin: 8px 0 0; }

  .pending, .waiting { color: var(--ink-faint); }

  .log { border-top: 1px solid var(--rule); padding-top: 12px; }
  .log summary { cursor: pointer; color: var(--ink-dim); font: 600 11px var(--font-label); letter-spacing: .12em; text-transform: uppercase; }
  .log ul { list-style: none; margin: 10px 0 0; padding: 0; display: grid; gap: 3px; max-height: 260px; overflow: auto; }
  .log li { color: var(--ink-faint); font-size: 11px; }
  .log li.warn { color: var(--open); }
  .log li.error { color: var(--contest); }
  .ts { color: var(--ink-faint); margin-right: 8px; }
</style>
