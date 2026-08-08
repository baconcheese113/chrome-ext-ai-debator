# Test Strategy — Design

**Date:** 2026-08-08
**Status:** Approved
**Motivation:** Every defect so far was found by the user running the extension by hand.

## Why

Four defects have shipped to the user during development. Each points at a different layer,
and only one of them needed a real provider session to detect:

| Defect | Layer | Would a live-session test have found it? |
|---|---|---|
| Dropping the narrator ended the run; status stuck on `running` | Orchestrator | No — never touched a browser |
| Quiescence observed `document.body`, so Gemini crawled | Driver | Only incidentally |
| Extraction took the last node; ChatGPT's empty trailing node broke it | Driver | Only incidentally |
| `wxt build` failed with `EBUSY`; a stale bundle shipped | Build | No |
| Claude's response selectors match nothing | Adapter | **Yes — only this one** |

Pointing Playwright at claude.ai for everything would be slow, flaky, consume the user's
subscription quota, and still miss the orchestrator bug entirely. The layers need different
instruments.

## Non-goals

- **CI will not test real providers.** No provider credentials in Actions secrets.
- **No test proves an adapter's selectors are currently valid** except the live smoke test,
  run manually. This limit is stated here so it is not rediscovered as a surprise.

## Layers

### L1 — Pure unit tests (Vitest, node)

No DOM, no chrome, no browser.

- `evaluateConvergence` for all three strategies, including the case where a participant's
  footer is unparseable (must **not** count as agreement).
- `parseNarratorSummary` against fenced JSON, bare JSON, JSON wrapped in prose, and malformed
  input (must degrade to `parseError`, never throw).
- `parseConverged` / `stripConverged`: present, absent, `yes`/`no`, multiple occurrences
  (last wins).
- `adapterForUrl`: wildcard matching, near-miss hosts, unknown hosts.
- `participantRound`: includes every other participant's turn, excludes the seat's own.

### L2 — Orchestrator tests (Vitest + fake `chrome`)

The highest-value layer, because it covers the class of bug that has cost the most.

A fake `chrome` global provides in-memory `storage.local`, plus `tabs`, `windows`,
`scripting`, and `runtime`. Seat behaviour is programmable: each seat gets a queue of
`DriveResult`s, so failures and recoveries are scripted rather than simulated.

Required cases, each an explicit regression test:

- Happy path: participants plus narrator, multiple rounds, converges and stops.
- **Narrator fails and is dropped → the panel continues** (regression: this ended runs).
- **Moderator convergence with no narrator falls back to self-report** (regression: would
  otherwise never converge).
- **No scenario leaves `status === 'running'` after `startRun` resolves** — asserted across
  every scenario, since a stuck console is the worst observed failure.
- Participant fails → retry → succeeds.
- `autoDrop` skips the incident prompt entirely.
- Every participant fails in a round → status `error`.
- A minimized window is restored via `windows.update` and logged.
- Round prompts exclude the recipient's own previous turn.

### L3 — Driver tests in real Chromium (Playwright)

`isVisible` depends on `getBoundingClientRect` and `getComputedStyle`. jsdom returns zeroes
for both, so it would report confident, wrong answers — the exact failure mode this project
keeps hitting. These run in real Chromium against static pages.

A test-only bundle exposes `window.__driver.drive(adapter, request)`. Subjects are the mock
provider pages and captured real-provider HTML fixtures.

Cases: normal extraction; artifact preferred when the thread holds only a summary; empty
trailing node walked past; extraction floored at the pre-send index so a blank new turn never
resolves to the previous round; prompt-echo rejected; truncated reply rejected by `minChars`;
completion detected without a stop button (slow path) and with one (fast path).

### L4 — End-to-end against a mock provider (Playwright + the real extension)

A local static site imitating a chat UI: composer, send button, a stop button present only
while streaming, and tokens appended over time. Behaviour is switchable per tab by query
string:

| Mode | Simulates |
|---|---|
| `normal` | A well-behaved provider |
| `artifact` | Content goes to a side panel; thread gets a summary (Claude Cowork) |
| `empty-tail` | Reply lands, trailing message node is empty (ChatGPT canvas) |
| `truncate` | Streaming stops mid-sentence (minimized-window throttling) |
| `no-stop` | No stop button, forcing the slow quiescence path |
| `echo` | Echoes the prompt back instead of replying (Gemini under throttling) |
| `slow` | Long pauses mid-stream, to attack false-positive completion |

Playwright launches a persistent context with the unpacked extension, opens mock tabs, drives
the **real dashboard UI** to seat them, and asserts rounds render, narrator summaries parse,
convergence ends the run, and the incident banner offers the right recovery. This exercises
dashboard → background → orchestrator → content script → page.

### L5 — Live smoke (local, opt-in, never CI)

`npm run test:live:login` opens a dedicated Playwright profile for a one-time manual login.
`npm run test:live` then sends one short prompt per provider and asserts extraction is
non-empty, plausible, and not a prompt echo.

This is the only layer that detects selector rot. It is slow, consumes real quota, and is
expected to be run occasionally — not on every change.

### L6 — Build integrity

Runs the production build and asserts the output exists and contains marker strings present
in source. A build that fails silently, or output that predates the sources, fails the test.

Directly motivated by shipping a stale bundle when `wxt build` failed with `EBUSY` and the
error was lost in unrelated output.

## Production changes required

Three, each justified by testability and small enough not to distort the design:

1. **Injectable timings.** `SEND_STAGGER_MS` and inter-round pacing move into an exported
   mutable config so tests can zero them. Without this, orchestrator tests spend most of
   their runtime asleep.
2. **`e2e` build mode.** `wxt build --mode e2e` registers a `localhost` mock adapter and the
   matching host permission. The shipped extension gains nothing and stays clean.
3. **Diagnose captures HTML.** The existing Diagnose action also returns the conversation
   root's markup, so a broken provider page becomes an L3 fixture instead of a one-off
   debugging session. This closes the loop on selector rot: capture, fix, and the fixture
   prevents the regression returning.

## CI

GitHub Actions on push and pull request: install, `npm run check`, L1, L2, L6, then
`playwright install chromium` and L3, L4 in Chrome's new headless mode.

L5 is excluded and must not be added.

Requires a GitHub remote, which does not yet exist. Repository creation and visibility are
the user's call — **private is recommended**, since the tool automates provider UIs contrary
to their terms of service.

## Layout

```
tests/
  unit/           L1 — convergence, prompts, adapters
  orchestrator/   L2 — round loop against a fake chrome
    fake-chrome.ts
  driver/         L3 — Playwright, real Chromium
    fixtures/     captured provider HTML
  e2e/            L4 — full extension against the mock provider
  live/           L5 — opt-in, real sessions
  mock-provider/  static fake chat site shared by L3 and L4
  build.spec.ts   L6
```

## Order of work

Value lands earliest first, so the suite is useful before it is complete:

1. Testability changes (blocks everything else)
2. L1 + L2 — catches the worst class of bug, no browser needed
3. L6 — cheap, prevents a repeat of the stale-build incident
4. Mock provider, then L3, then L4
5. L5
6. CI

## Success criteria

- `npm test` runs L1, L2, L6 in under ~10 seconds.
- `npm run test:e2e` runs L3 and L4 headless without a logged-in session.
- Every defect listed in the "Why" table has a test that fails when the fix is reverted.
- CI is green on a clean checkout.
