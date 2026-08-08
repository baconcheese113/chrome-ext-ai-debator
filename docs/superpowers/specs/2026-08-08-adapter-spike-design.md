# Adapter Spike — Design

**Date:** 2026-08-08
**Status:** Approved, not yet implemented
**Cycle:** 1 of 2 (see [Decomposition](#decomposition))

## Purpose

Determine, empirically, whether a Chrome MV3 content script can reliably drive logged-in
LLM web UIs — inject a prompt, detect response completion, extract the response text —
and how much of that behavior can be expressed as declarative configuration rather than
per-provider code.

The deliverable of this cycle is a **findings document**, not shippable code. The spike
extension is throwaway and is deleted once findings are recorded.

## Decomposition

The overall project is "AI Debator", a Chrome extension that runs multi-model brainstorming
panels using the user's existing LLM subscriptions. It splits into two cycles:

| Cycle | Deliverable | Status |
|---|---|---|
| 1 | Adapter spike + findings doc | This spec |
| 2 | AI Debator proper | Spec written *after* Cycle 1, informed by its findings |

Cycle 2 is deliberately not specified yet. Two architectural decisions it depends on are
unanswered, and answering them by reasoning rather than measurement would compromise the
whole design. Those decisions are:

- **Adapter architecture** — declarative configs (A), hand-written module per provider (B),
  or declarative configs with optional code escape hatches (C).
- **Completion detection** — DOM observation, provider SSE stream interception, or DOM with
  per-provider SSE fallback.

If the spike finds that DOM-driving is unreliable across providers generally, Cycle 2's
design changes substantially. That is the reason this cycle exists.

## Target system (non-binding context)

Recorded so the decisions made during brainstorming are not lost. **None of this is in scope
for the spike.** It is re-opened for review at the start of Cycle 2.

- **Format:** a collaborative brainstorming *panel*, not an adversarial debate. Each round,
  every participant receives the latest response from every other participant and responds
  to all of them. Runs for N rounds or until convergence.
- **Context model:** one persistent chat thread per model, reused across rounds. Each model
  remembers its own prior reasoning natively; only the *other* models' latest responses are
  injected each round.
- **Convergence:** a pluggable strategy chosen per run — self-reported (models emit a
  machine-readable footer), moderator (the narrator rules on it), or manual (user stops the run).
- **Narrator:** one dedicated tab/thread on a user-chosen provider, observer only, never a
  participant. Each round it receives the round's responses and returns a structured summary:
  key points per agent, agreements, disagreements, open questions. Its structured output
  carries a `converged` field, which is what the moderator strategy reads. One component
  serves both purposes.
- **UI philosophy:** the extension does **not** re-render model responses. Each provider
  renders its own output better than we would. The dashboard is a *conductor view* — narrator
  summaries, run state, agreement/disagreement map — with deep links into each provider tab
  for the full formatted response.
- **Tab management:** on run start the extension opens one dedicated Chrome window containing
  a tab per participant plus the narrator. Window closes, run ends.
- **Failure policy:** on participant failure (rate limit, logged out, response never completes,
  selector broke) the run pauses at the round boundary and surfaces the failure with
  Retry / Drop agent / Abort. A per-run setting allows auto-dropping the agent and continuing
  without prompting.
- **Stack:** WXT + TypeScript + Svelte 5. WXT's built-in typed storage and typed messaging are
  used rather than adding separate libraries. Maximize reuse of existing open-source work.

### Prior art worth mining

- [prompt-queue-extension](https://github.com/pykrete67/prompt-queue-extension) — already
  auto-sends prompts to ChatGPT/Claude/Gemini/AI Studio and detects completion via UI state
  (stop button gone, send button re-enabled). Most directly relevant source of selectors and
  detection heuristics.
- [universal-prompt-library](https://github.com/carlosguadian/universal-prompt-library) —
  input-injection heuristics across ChatGPT/Claude/Gemini/Perplexity/DeepSeek. Useful for a
  generic fallback adapter.
- [ChatHub](https://github.com/witzwp/chathub) — multi-model side-by-side chat extension.
  Different product (no cross-talk, custom bots go through OpenAI-compatible APIs), but a
  reference for multi-provider extension structure.
- [WXT](https://github.com/wxt-dev/wxt) — extension framework; ships typed storage and messaging.

### Known constraint

Driving these web UIs programmatically is generally contrary to the providers' terms of
service, and free tiers rate-limit aggressively. This is accepted for a personal-use tool.
The design mitigates practical impact through paced sending with jitter and the
pause-on-failure flow, not through evasion.

## Scope

### In scope

A WXT + TypeScript extension with no UI framework and no styling. A popup containing a
provider dropdown, a prompt textarea, a Run button, and a `<pre>` for structured results.

Throwaway code quality is expected and acceptable.

### Out of scope

Multi-agent orchestration, narrator, convergence detection, persistence, run history,
Svelte, styling, error recovery beyond recording what failed, and any provider beyond the
four listed below. **If the spike grows any of these, it has failed its purpose.**

### Providers

Four, chosen to test range rather than completeness:

| Provider | URL | Rationale |
|---|---|---|
| Claude | claude.ai | Primary target |
| ChatGPT | chatgpt.com | Most common second subscription |
| Gemini | gemini.google.com | Structurally different (Angular, shadow DOM) — the hard case |
| Grok | grok.com | Long-tail generality test; actively changing UI |

Grok is present specifically to prevent the config schema from over-fitting to two similar
React apps.

## Architecture

Three components with deliberately clean seams. The seams are themselves under test: any
provider-specific hack we are forced to write should appear as an obvious wart rather than
disappear into a general-purpose module.

### `providers/*.ts` — candidate configs

One file per provider, each exporting an object conforming to a draft `ProviderConfig` type.
The draft type covers: URL match pattern, new-chat URL, composer locator, submit strategy,
"is generating" signal, and response extractor.

**How far each provider has to bend this type is the experiment.** Deviations are recorded,
not smoothed over.

### `driver.ts` — content script

Interprets a `ProviderConfig` and executes the sequence: locate composer → inject text →
submit → await completion → extract response. Provider-agnostic by construction.

Where a provider cannot be driven by config alone, the required code is written into the
provider's own file as an explicit override and recorded as a finding — it is never absorbed
into `driver.ts`.

### `probe.ts` — background orchestration

Opens a tab in a separate window, injects/messages the driver, times each phase, and returns
a structured result to the popup. Phase timings are part of the recorded data.

## Experiments

Each experiment is run against all four providers and produces a recorded result per provider.

### E1 — Config coverage

Attempt to drive the provider using configuration only. Record: succeeded on config alone
(yes/no); if no, what code was required and why the config schema could not express it.

*Settles:* adapter architecture A vs B vs C.

### E2 — Completion detection reliability

Run two prompts per provider, three times each:
- a short prompt (fast, single-burst response)
- a long streaming prompt (e.g. "write 800 words on X") that will contain natural pauses

Record: false "done" fires (detector reported completion mid-stream), timeouts, and
detection latency — measured as the gap between the last DOM mutation inside the response
node and the moment the detector reported completion.

*Settles:* DOM observation vs SSE interception.

### E3 — Extraction fidelity

Capture the extracted response as plain text, markdown, and raw HTML. Record which form is
cleanly obtainable and what a narrator model would actually need as input — specifically
whether code blocks, lists, and tables survive.

*Settles:* what the round-to-round message payload looks like in Cycle 2.

### E4 — Background tab viability

Repeat E2 with the containing window (a) unfocused behind another window, and (b) minimized.
Record whether injection, streaming, and detection still work, and any change in timing.

*Settles:* whether the "dedicated window" design in the target system is viable at all. This
is the experiment most likely to fail, and is the reason it is run during the spike rather
than discovered late in Cycle 2.

## Data recorded

Per provider per experiment, `probe.ts` returns and the popup displays:

```
provider, experiment, run #, outcome (pass | fail | partial),
phase timings (navigate, inject, submit, detect, extract),
failure mode if any, notes
```

Results are transcribed by hand into the findings document. No persistence layer is built.

## Error handling

The spike does not recover from errors — it **records** them. Every failure is captured as a
structured result with a failure mode rather than thrown away, because failures are the
primary data this cycle produces.

A hard per-phase timeout (30s navigate/inject/submit, 180s detect) prevents a hung provider
from blocking a run. A timeout is recorded as a `fail` outcome with mode `timeout:<phase>`.

## Testing

No automated test suite. The spike's execution *is* the test, and its subjects are live
third-party UIs that cannot be meaningfully mocked — a mock would test our assumptions about
those UIs, which is precisely the thing in question.

Manual verification is the four experiments above, run against real logged-in sessions.

## Exit criteria

The spike is complete when `docs/superpowers/specs/<date>-adapter-spike-findings.md`
exists (dated the day it is written) and contains:

1. A per-provider table of E1–E4 outcomes.
2. A recommendation on adapter architecture (A, B, or C) with the evidence supporting it.
3. A recommendation on completion detection (DOM, SSE, or hybrid) with measured false-fire
   and timeout rates.
4. An explicit answer on background-window viability, and if negative, what the alternative is.
5. A per-provider selector table, so Cycle 2 does not repeat the discovery work.

Once recorded, the spike code is deleted. Cycle 2 begins with a fresh brainstorming pass.
