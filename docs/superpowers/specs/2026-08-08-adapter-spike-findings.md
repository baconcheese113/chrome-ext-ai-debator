# Adapter Spike — Findings

**Date:** 2026-08-08
**Source data:** `spike/spike-40-run.json` — 40 runs, 4 providers, status `done`
**Spec:** [2026-08-08-adapter-spike-design.md](./2026-08-08-adapter-spike-design.md)

## Headline

Driving these UIs from a content script **works**, and works from pure declarative config for
three of four providers. Two beliefs the spike was built on turned out to be wrong, one of
them a bug in the instrument itself.

| Question | Answer |
|---|---|
| E1 — adapter architecture | **C** (config + escape hatches), but only Claude needs the hatch |
| E2 — completion detection | **DOM quiescence only.** The button signals are unusable as built |
| E3 — extraction | Clean markdown-bearing HTML for 3/4. Claude blocked by artifacts |
| E4 — background windows | **Unfocused: fine. Minimized: broken.** Opposite of a clean pass |

## Correction to the raw `outcome` field

**The `outcome` values in the JSON overstate success.** The driver marked a run `pass`
whenever extraction came from a configured selector, without checking that the extracted text
was plausibly a complete response. A truncated 41-character fragment of a 700-word answer was
recorded as `pass`.

Re-scored by whether a ~700-word prompt actually produced a full response (>3000 chars):

| Provider | E2-long (focused) | E4-unfocused | E4-minimized |
|---|---|---|---|
| Claude | 0/3 | 0/2 | 0/2 |
| ChatGPT | 2/3 | 2/2 | **0/2** |
| Gemini | 3/3 | 2/2 | **0/2** |
| Grok | 3/3 | 2/2 | 2/2 |

Any future harness must validate response plausibility, not just selector match.

## E1 — Config coverage

Three of four providers were driven **entirely by declarative config, no overrides used in any
of the 40 runs**. Selectors that actually matched:

| Provider | Composer | Submit | Response |
|---|---|---|---|
| Claude | `div[contenteditable="true"].ProseMirror` | *(fell through to Enter key)* | ✗ none matched |
| ChatGPT | `div#prompt-textarea[contenteditable="true"]` | `button[data-testid="send-button"]` | `div[data-message-author-role="assistant"] .markdown` |
| Gemini | `rich-textarea div.ql-editor[contenteditable="true"]` | `button[aria-label*="Send message" i]` | `model-response message-content .markdown` |
| Grok | `div[contenteditable="true"]` | `button[type="submit"]` | `.message-bubble` |

Notable: **Gemini was not the hard case.** It was predicted to be the provider most likely to
need code — shadow DOM, Angular, custom elements — and it worked on first-guess config every
time. The shadow-piercing `deepQueryAll` may be why; that utility should carry forward.

Grok, expected to miss, matched on config too.

**Verdict: architecture C.** The escape hatch is justified — Claude needs one — but it is the
exception, not the norm. Adding a new provider is realistically a config entry.

### Claude is a genuine exception

`https://claude.ai/new` **redirects to Cowork mode** — observed URL
`https://claude.ai/cowork/cse_01VoQmcMzFX6f29bANLZwdqj`. In Cowork the thread carries only a
short activity summary while the real content goes into an artifact:

> "Done — the piece frames both approaches around the prevent-vs-detect distinction, then
> covers mechanisms, a seven-point trade-off list, a seven-row comparison table, a Java CAS
> loop…"

That is 278 characters standing in for a ~700-word answer. The conversation's total text was
865 characters across the whole page. Claude's response containers are
`li.font-claude-response-body` — the activity feed, not a reply body.

No send button appeared in the DOM at all; submission worked only because the driver fell
through to the Enter key.

**This is not a selector problem.** The text is not in the thread. Fixing Claude requires
landing in plain chat rather than Cowork, and/or reading artifact content.

## E2 — Completion detection

### `stopGoneAt` never fired. Not once, in 40 runs. That is an instrument bug.

`isGenerating()` treats a disabled send button as "busy":

```ts
if (cfg.generating.enabledSelectors?.length && !enabled) return true;
```

After submission the composer is empty, so the send button is disabled **permanently** — not
because the model is busy, but because there is nothing to send. `isGenerating()` therefore
never returned false, and the stop-button signal could never resolve.

The lesson generalises: *send-button-disabled* conflates "busy" with "empty composer" and must
never be used as a generation signal. Stop-button **presence** is a valid positive signal; the
send button's state is not.

### `sendEnabled` fires prematurely and must be discarded

It decided 7 of 40 runs, and it was wrong on the long ones:

- ChatGPT E2-long run 1 — decided at 9.7s, extracted **19 characters**.
- ChatGPT E4-minimized — decided at ~8s, extracted `"Here's a roughly 700-word comparison with"` (41 chars, cut mid-sentence).

Compare Grok on the same prompt: ~35s and ~6000 characters. Ten seconds was never plausible.

### Quiescence is the only trustworthy signal

It decided 33 of 40 runs and produced full responses whenever the window was not minimized.

Observed detection latency: `detect ≈ quiescenceAt + ~3000ms`, from requiring the quiet period
to hold at 3× `QUIESCENCE_MS`. That ~3s tax per turn is acceptable for a panel that already
waits 30–60s per response.

False-fire counts show how much churn the threshold absorbs:

| Provider | long-run false fires |
|---|---|
| Grok | 0 |
| Gemini | 4–7 |
| Claude | 0–1 |
| ChatGPT | **85–97** |

ChatGPT mutates its DOM almost continuously while streaming. It still resolved correctly, but
it has the least headroom — a shorter quiescence window would break ChatGPT first.

**Verdict: DOM quiescence, with stop-button presence as a secondary confirmation. Drop the
send-button signal entirely.** No provider needed SSE interception.

## E3 — Extraction fidelity

Where the config matched, extraction was clean and **structure survived intact** — code
blocks, lists, and tables all present in the HTML for every full ChatGPT, Gemini, and Grok
long-run response (5.1k–7.1k chars text, 7.6k–31k chars HTML).

Markdown-bearing HTML is available for all three. The narrator can consume either text or HTML.

**The artifact gap is the real finding.** Long replies frequently land in an artifact/canvas
panel rather than the thread — always on Claude in Cowork mode, and this is a general risk on
ChatGPT canvas too. Any extraction strategy that reads only the message body will silently
capture a summary instead of the content, and will report success while doing it.

## E4 — Background windows

**Unfocused works.** All three working providers returned full responses behind another window
(4.3k–6.7k chars). No degradation.

**Minimized is broken**, and fails silently:

- ChatGPT — 41 chars, truncated mid-sentence, both runs.
- Gemini — 227 chars, both runs; the captured text was *the user's own prompt echo*
  (`"You said / Write roughly 700 words comparing…"`), meaning the model had not yet rendered
  anything when the detector concluded.
- Gemini's quiescence timestamps were 9992ms and 9995ms — suspiciously identical, consistent
  with mutation delivery being throttled rather than generation actually stopping.
- Grok alone survived (6345 / 5493 chars).

The failure mode is the dangerous one: not an error, but a confident, truncated, *wrong*
answer.

**Verdict: the dedicated window must stay open and unfocused. It must never be minimized.**
The design should actively prevent minimizing, or detect it and pause the run.

## Consequences for Cycle 2

1. **Architecture C**, with config as the default path. `deepQueryAll` (shadow-piercing) is
   load-bearing and carries forward.
2. **Quiescence-only detection.** Delete the send-button signal. Keep stop-button presence as
   corroboration, after fixing `isGenerating`.
3. **Validate response plausibility** — length, and completion relative to the prompt — before
   accepting a turn. Silent truncation is the top risk this spike surfaced.
4. **Never minimize the run window.** Unfocused is safe; guard against minimize.
5. **Claude needs a route into plain chat, not Cowork** — unresolved, see open questions.
6. **Artifact extraction is required**, not optional, or the panel will trade summaries
   instead of arguments.
7. **One thread per provider, reused across rounds.** The spike created 40 throwaway threads
   and polluted real chat history — this was a spike artifact, but it confirms the persistent-
   thread design is also the *considerate* one.

## Open questions for Cycle 2

- **How to force plain Claude chat instead of Cowork?** URL, setting, or composer toggle —
  not determined by this spike.
- **How to read artifact content?** Separate panel selectors, or prompt models to avoid
  artifacts (e.g. "reply inline, do not create an artifact"), or both.
- **Model selection.** Reusing one thread means the model is whatever that thread was started
  with. Either the user pre-selects per tab, or the extension drives a model picker — which is
  a per-provider, frequently-breaking surface.
