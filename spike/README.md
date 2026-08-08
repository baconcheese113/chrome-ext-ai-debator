# Adapter Spike — how to run it

Throwaway. See `docs/superpowers/specs/2026-08-08-adapter-spike-design.md` for why it exists.

## Before you start

Log into **claude.ai, chatgpt.com, gemini.google.com, grok.com** in this Chrome profile.
A provider you aren't logged into will fail at the `navigate` phase with a login-wall note —
that's recorded correctly, but it wastes the run.

## Load it

```bash
cd spike
npm install      # if you haven't
npm run build
```

Then in Chrome: `chrome://extensions` → enable **Developer mode** → **Load unpacked** →
select `spike/.output/chrome-mv3`.

(For live-reload development use `npm run dev` instead, which opens its own Chrome profile —
but you'd have to log in again there, so `build` + load-unpacked into your normal profile is
the better path for this spike.)

## Run the suite

Click the extension icon → **Run full suite**.

- 10 runs per provider (3 short, 3 long, 2 unfocused, 2 minimized) = **40 runs** for all four.
- It opens and closes a window per run. Leave the machine alone while it runs.
- **You can close the popup** — the suite runs in the service worker and keeps going. Reopen
  to see progress.
- Expect 20–40 minutes for the full four-provider suite, mostly spent waiting on long
  generations plus deliberate pacing between runs.

Deselect providers to run a subset — worth doing one provider first to confirm things work
before committing to the whole suite.

## Get the results out

When status reads `Done`, click **Copy JSON** (or **Download JSON**) and hand the contents back.

## If a provider fails

Failure is data, not a problem — the JSON includes a `diagnostics` block with pasteable
candidate selectors whenever something isn't found. Grok is the most likely to miss.

For a faster loop on one provider: open that provider's tab, click **Diagnose active tab**,
and copy the output. That dumps candidate composers, buttons, and response containers without
spending a suite run.
