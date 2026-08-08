<script lang="ts">
  import type { RunState } from '../../lib/types';

  let { run }: { run: RunState } = $props();

  /**
   * The one instrument on this page. Each node is a round; its ring fills with the share of
   * participants who reported nothing further to add, and the fill shifts coral → mint as
   * the panel aligns. It plots the exact quantity the tool exists to measure, which is why
   * it earns the space rather than a generic progress bar.
   */
  const rounds = $derived.by(() => {
    const participantIds = new Set(
      run.seats.filter((s) => s.role === 'participant').map((s) => s.seatId),
    );
    const out: Array<{ round: number; ratio: number; voted: number; total: number }> = [];
    for (let r = 1; r <= run.round; r++) {
      const turns = run.turns.filter((t) => t.round === r && participantIds.has(t.seatId));
      const total = turns.length;
      const voted = turns.filter((t) => t.converged === true).length;
      out.push({ round: r, ratio: total ? voted / total : 0, voted, total });
    }
    return out.reverse();
  });

  const R = 11;
  const C = 2 * Math.PI * R;

  function hue(ratio: number): string {
    if (ratio >= 0.999) return 'var(--agree)';
    if (ratio >= 0.5) return 'var(--open)';
    return 'var(--contest)';
  }
</script>

<div class="rail">
  <div class="label">Convergence</div>
  {#if !rounds.length}
    <p class="empty data">No rounds yet.</p>
  {:else}
    <ol>
      {#each rounds as r (r.round)}
        <li>
          <svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true">
            <circle cx="14" cy="14" r={R} fill="none" stroke="var(--rule)" stroke-width="2.5" />
            <circle
              cx="14" cy="14" r={R}
              fill="none"
              stroke={hue(r.ratio)}
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-dasharray="{C * r.ratio} {C}"
              transform="rotate(-90 14 14)"
            />
          </svg>
          <div class="meta">
            <span class="rn">R{r.round}</span>
            <span class="data ratio">{r.voted}/{r.total} settled</span>
          </div>
        </li>
      {/each}
    </ol>
  {/if}
</div>

<style>
  .rail { padding: 14px 16px; }
  ol { list-style: none; margin: 10px 0 0; padding: 0; }
  li {
    display: flex; align-items: center; gap: 10px;
    padding: 5px 0;
    position: relative;
  }
  /* Connective tissue between samples — reads as a signal trace, not a list. */
  li:not(:last-child)::after {
    content: '';
    position: absolute;
    left: 13.5px; top: 33px; bottom: -5px;
    width: 1px; background: var(--rule);
  }
  .meta { display: flex; flex-direction: column; line-height: 1.25; }
  .rn { font: 600 12px var(--font-label); letter-spacing: .08em; }
  .ratio { color: var(--ink-faint); font-size: 11px; }
  .empty { color: var(--ink-faint); margin: 8px 0 0; }
</style>
