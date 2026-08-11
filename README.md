# AI Debator

A Chrome extension that runs **multi-model brainstorming panels** across LLM web UIs you're
already logged into. No API keys.

Every round, each model is shown what every *other* model just said and responds to all of
them at once. A narrator model summarises each round — key points, agreements, disagreements,
open questions — and the run ends when the panel converges or you stop it.

## What it is not

It does not re-render model responses. Anthropic, OpenAI, and Google render their own output
better than this ever would, and their formatting is the point. The dashboard is a
**conductor's console**: it shows you where the panel agrees, where it doesn't, and what's
stuck, with one click through to each model's own tab for the full reply.

## Install

Store listings are in review. Until they are live, install from
[Releases](https://github.com/baconcheese113/chrome-ext-ai-debator/releases).

### Chrome, Edge, Brave, Opera

1. Download `ai-debator-<version>-chrome.zip` and **unzip it** — a zip will not load.
2. Go to `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and choose the unzipped folder.

Two things to know before you do. Chrome shows a *"Disable developer mode extensions"* bubble
every time it starts; it is dismissible and harmless, but it is permanent until the store
listing goes live. And an unpacked extension **does not auto-update** — a new version means
repeating these steps. Installing a `.crx` from outside the Web Store is not an option;
Chrome has blocked that since Chrome 33.

A sideloaded build also gets a different extension ID than the eventual store build, so the
two are separate installs and no run history carries across.

### Firefox

Download `ai-debator-<version>-firefox.xpi` and open it in Firefox. It installs like any other
add-on and updates itself.

Release Firefox will not install an unsigned add-on, so `.zip` builds from source are
temporary-only: `about:debugging` → This Firefox → **Load Temporary Add-on** →
`.output/firefox-mv2/manifest.json`, which lasts until you restart.

## Build it yourself

Requires Node 22+.

```bash
npm ci
npm run build              # Chrome / Edge  → .output/chrome-mv3
npx wxt build -b firefox   # Firefox        → .output/firefox-mv2

npx wxt zip                # packaged, → .output/ai-debator-<version>-chrome.zip
npx wxt zip -b firefox     # packaged + sources zip for AMO
```

Then load the unpacked directory as above. Full reproduction notes for add-on reviewers are
in [`docs/amo-reviewer-notes.md`](docs/amo-reviewer-notes.md).

Then:

1. Open each model in its own tab and **pick the model you want** (o3 vs 4o, Opus vs Sonnet).
   The panel reuses these threads, so what you pick is who plays.
2. If a tab was already open before you loaded the extension, it still works — the extension
   injects on demand.
3. Click the toolbar icon to open the console.
4. Seat each tab as **Participant** or **Narrator**, name it something the other models will
   see, set a topic, and start.

Two or more participants are required. A narrator is optional unless you choose moderator
convergence.

## Running a panel

- **Stop when** — three interchangeable strategies:
  - *Every participant says it's done* — models end each reply with `CONVERGED: yes|no`.
  - *The narrator rules it converged* — the narrator's JSON carries the verdict.
  - *Only when I say so* — runs to max rounds unless you stop it.
- **When a model fails**, the run pauses and asks: try again, continue without it, or stop.
  Free tiers rate-limit, so this happens. Flip *auto-drop* on to skip the prompt.
- **Don't minimize the model windows.** Unfocused is fine. Minimized is throttled by Chrome
  and produces truncated replies that look successful — the extension restores a minimized
  window and logs a warning rather than let that corrupt a run.

## Adding a provider

Adapters are data, not code. Add an entry to [`lib/adapters/index.ts`](lib/adapters/index.ts):
URL patterns, composer selectors, submit strategy, stop-button selectors, response selectors.
Qwen, Kimi, and DeepSeek are already stubbed in this way but are **unverified**.

When a provider changes its markup, hit **Diagnose** next to that tab in the console. It
copies a list of candidate selectors — composers, labelled buttons, repeated message
containers — straight to your clipboard, each with a suggested selector that prefers test-ids
and aria-labels over hashed class names.

## How it works

| Piece | Role |
|---|---|
| [`lib/adapters/`](lib/adapters/) | Per-provider selectors. Declarative, with optional code hooks. |
| [`lib/driver.ts`](lib/driver.ts) | Runs in the page: inject → submit → wait → extract → validate. |
| [`lib/orchestrator.ts`](lib/orchestrator.ts) | The round loop. Lives in the service worker so runs survive the console being closed. |
| [`lib/prompts.ts`](lib/prompts.ts) | Panel rules, round prompts, narrator contract. |
| [`lib/convergence.ts`](lib/convergence.ts) | The three stop strategies behind one interface. |
| [`entrypoints/dashboard/`](entrypoints/dashboard/) | Svelte 5 console. |

Every design decision here is downstream of a 40-run experiment against live provider UIs.
The findings — including which completion signals are trustworthy and which silently lie —
are in [`docs/superpowers/specs/`](docs/superpowers/specs/).

Three that matter:

- **Completion is detected by DOM quiescence.** Send-button state is worthless: an empty
  composer disables the button permanently, which is indistinguishable from "busy".
- **Replies are validated, not just extracted.** A short reply or an echo of our own prompt is
  treated as a failure, because the observed failure mode isn't an error — it's a confident,
  truncated, wrong answer.
- **Models are told to reply inline.** Left alone, they put long answers in artifacts and
  leave a summary in the thread, and the panel ends up trading summaries instead of arguments.
  Artifact extraction exists as a backstop.

## Caveats

Driving these UIs programmatically is generally against the providers' terms of service, and
free tiers rate-limit quickly. This is a personal-use tool. Sends are paced and staggered.

## Development

```bash
npm run dev     # HMR, separate Chrome profile (you'll need to log in again there)
npm run check   # tsc + svelte-check
npm run build
```

## Tests

```bash
npm test          # unit + orchestrator + build integrity   (~15s, no browser)
npm run test:e2e  # driver + end-to-end in Chromium         (~2min, no accounts)
npm run test:all  # everything above, plus typecheck
```

Neither needs a provider account. The suite runs against a **mock provider** that reproduces,
on demand, every failure a real provider has actually inflicted on this project: replying
into an artifact instead of the thread, leaving an empty trailing message node, truncating
mid-stream, omitting the stop button, echoing the prompt back, going silent, and pausing long
enough mid-stream to fool a naive completion detector.

| Layer | What it proves | Where |
|---|---|---|
| Unit | Convergence, prompt and narrator parsing | [tests/unit/](tests/unit/) |
| Orchestrator | The round loop against a fake `chrome` | [tests/orchestrator/](tests/orchestrator/) |
| Driver | Real driver, real Chromium, real layout | [tests/driver/](tests/driver/) |
| End-to-end | The actual extension driving the actual dashboard | [tests/e2e/](tests/e2e/) |
| Build | The bundle is fresh and ships no localhost permission | [tests/build.spec.ts](tests/build.spec.ts) |

**What none of them prove: that a real provider's selectors still work.** Only the live smoke
test can tell you that, and it needs your own logged-in sessions:

```bash
npm run test:live:login   # one-time: log in, in a dedicated profile
npm run test:live         # one short prompt per provider
```

It uses real subscription quota, is expected to be occasionally flaky, and never runs in CI.
When it fails it prints the page's actual candidate selectors, so the adapter gets repaired
from evidence rather than a guess.
