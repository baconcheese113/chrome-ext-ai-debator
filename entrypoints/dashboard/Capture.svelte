<script lang="ts">
  /**
   * Diagnostic capture for one tab, usable from anywhere.
   *
   * This lived only on the setup screen, which is the one screen you cannot see while a panel
   * is running — so the tool for diagnosing a mid-run failure was unreachable during exactly
   * the failure it was built for. It belongs wherever a tab is named.
   */
  let {
    tabId,
    providerId,
    label,
  }: { tabId: number; providerId: string; label: string } = $props();

  let armed = $state(false);
  let held = $state<{ json: string; note: string; summary: string } | null>(null);
  let copied = $state(false);
  let diagnosed = $state(false);

  async function diagnose() {
    const d = await chrome.runtime.sendMessage({ type: 'DIAGNOSE_TAB', tabId });
    const json = JSON.stringify(d, null, 2);
    held = { json, note: d?.error ?? 'captured now', summary: describe(d) };
    // Written directly rather than via copy(), which would also light up the held row's own
    // button and leave two controls both reading "Copied".
    await navigator.clipboard.writeText(json);
    diagnosed = true;
    setTimeout(() => (diagnosed = false), 2500);
  }

  async function arm() {
    armed = true;
    held = null;
    try {
      const d = await chrome.runtime.sendMessage({
        type: 'DIAGNOSE_WHEN_BUSY',
        tabId,
        providerId,
      });
      held = {
        json: JSON.stringify(d, null, 2),
        note: d?.error ?? d?.note ?? 'captured',
        summary: describe(d),
      };
    } finally {
      armed = false;
    }
  }

  async function copy() {
    if (!held) return;
    await navigator.clipboard.writeText(held.json);
    copied = true;
    setTimeout(() => (copied = false), 2500);
  }

  /**
   * Say whether the capture contains what it was armed for. "Captured" alone is not
   * reassuring when the reason for arming was that earlier captures came back without the
   * control we needed.
   */
  function describe(d: { candidateButtons?: unknown[]; composerHtml?: string }): string {
    const buttons = (d?.candidateButtons ?? []) as Array<{ ariaLabel?: string; testId?: string }>;
    const sawStop =
      buttons.some((b) => /stop/i.test(`${b.ariaLabel ?? ''} ${b.testId ?? ''}`)) ||
      /stop/i.test(d?.composerHtml ?? '');
    const parts = [`${buttons.length} controls`];
    if (d?.composerHtml) parts.push('composer markup');
    parts.push(sawStop ? 'including a stop control' : 'no stop control visible');
    return parts.join(', ');
  }
</script>

<div class="cap">
  <div class="btns">
    <button class="tiny" onclick={diagnose}>{diagnosed ? 'Copied' : 'Diagnose'}</button>
    <button
      class="tiny"
      class:armed
      disabled={armed}
      title="Arms a capture in {label}'s tab. It photographs itself as soon as it starts answering — use it for controls that only exist mid-reply, like the stop button."
      onclick={arm}
    >
      {armed ? 'Waiting…' : 'Catch it answering'}
    </button>
  </div>

  {#if armed}
    <p class="live">Armed. It fires by itself the moment {label} starts writing.</p>
  {/if}

  {#if held}
    <!-- Held rather than auto-copied: a background tab cannot write the clipboard, and an
         armed capture completes while you are deliberately looking somewhere else. -->
    <div class="held">
      <span>{held.note}. {held.summary}.</span>
      <button class="tiny" onclick={copy}>{copied ? 'Copied' : 'Copy capture'}</button>
    </div>
  {/if}
</div>

<style>
  .cap { display: grid; gap: 6px; }
  .btns { display: flex; gap: 6px; flex-wrap: wrap; }
  .tiny { padding: 5px 9px; font-size: 10px; }
  .tiny.armed {
    color: var(--open); border-color: var(--open);
    background: color-mix(in srgb, var(--open) 12%, transparent);
  }
  .live { margin: 0; color: var(--open); font-size: 11px; }
  .held {
    display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap;
    padding: 7px 9px; font-size: 12px; color: var(--ink-dim);
    background: var(--chassis); border: 1px solid var(--rule);
    border-left: 2px solid var(--agree); border-radius: var(--r);
  }
</style>
