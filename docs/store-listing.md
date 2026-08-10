# Store listing

Everything the three dashboards ask for, written once so the answers stay identical across
them. Copy from here rather than retyping — inconsistent answers between stores are a
reviewer's first reason to look harder.

Privacy policy URL (required by Chrome, requested by the others):
<https://baconcheese113.github.io/chrome-ext-ai-debator/privacy.html>

Homepage: <https://baconcheese113.github.io/chrome-ext-ai-debator/>

---

## Single purpose

> AI Debator runs a structured brainstorming panel across AI chat tabs the user already has
> open, by placing the user's prompt into each chat's composer and reading the reply back.

That is the whole extension. It does one thing on a fixed list of sites.

## Short description (132 char limit)

> Run a brainstorming panel across Claude, ChatGPT, Gemini and more — using the chat tabs you
> already have open. No API keys.

(126 characters.)

## Detailed description

> AI Debator turns the AI chat tabs you already have open into a panel that thinks together.
>
> Each round, every model is shown what every other model just said, and answers all of them
> at once. It keeps going until the panel converges, until it runs out of rounds, or until you
> stop it — and then it writes a plain-language summary of what actually happened.
>
> HOW IT WORKS
> • Open each model in its own tab and pick the model you want. The extension claims those
>   tabs as seats and reuses the same thread every round, so your history stays tidy.
> • Seat one model as a narrator. It never argues. It summarises each round in plain language,
>   tracks what the panel agreed on, what it contested, and what is still open, and calls when
>   the discussion has stopped making progress.
> • Drop a note between rounds to steer the conversation — a correction, a missing angle, a
>   source the models would not reach on their own. Every model sees it at the start of the
>   next round, marked as coming from you.
>
> IT DOES NOT RE-RENDER THE REPLIES
> Each provider renders its own output better than any third party would, and that formatting
> is part of the answer. The dashboard is a conductor's console — agreement, disagreement, and
> what is stuck — with one click through to each model's own tab for the full reply.
>
> PRIVACY
> No server, no accounts, no analytics, and no networking code at all. Everything stays in
> your browser's extension storage until you delete it.
>
> Uses the subscriptions you already pay for. No API keys. Open source, MIT licensed.
>
> Supports Claude, ChatGPT, Gemini, Grok, Kimi, Qwen and DeepSeek.

Category: **Productivity** (Chrome, Edge) / **Other** (Firefox)

---

## Permission justifications

Answer these verbatim. Chrome requires one per permission; Edge and Firefox ask more loosely,
but reviewers compare across stores.

### `tabs`

> To find the AI chat tabs the user already has open so they can be assigned seats in the
> panel, and to bring the tab currently being driven to the foreground. Chrome only renders
> the active tab of a window; a chat left in the background produces truncated replies, so the
> extension activates each tab for its turn. The extension reads tab URLs only to recognise
> which of the supported chat sites a tab belongs to.

### `scripting`

> To inject the extension's own content script into a supported chat tab that was already open
> before the extension was installed, updated, or reloaded. Chrome does not apply declared
> content scripts to pre-existing tabs, and without this the user would have to manually
> reload every chat tab. It only ever injects the extension's own bundled script, and only
> into the supported chat sites.

### `storage`

> To keep the current panel run — the topic, the replies collected so far, the round summaries
> and an activity log — in local extension storage, so the dashboard survives closing the tab
> or restarting the browser. Local storage only; nothing is synced or transmitted.

### Host permissions (the supported AI chat sites)

> The extension works by typing into the message box of an AI chat page the user is already
> signed into, and reading the reply back out of the page. That requires content-script access
> to each supported site. The list is explicit and closed — claude.ai, chatgpt.com,
> chat.openai.com, gemini.google.com, grok.com, chat.qwen.ai, kimi.com, chat.deepseek.com —
> and the extension requests no access to any other site.

### Remote code

> None. The extension bundles all of its own code. It makes no network requests of any kind
> and contains no networking code.

### Data collection disclosure

Chrome's "Data usage" section — tick nothing, and certify all three statements:

| Question | Answer |
|---|---|
| Personally identifiable information | No |
| Health, financial, authentication information | No |
| Personal communications | **No** — the extension reads replies from the page into local storage on the user's own machine, and transmits nothing anywhere. Nothing is collected in the sense the form means: collection is transfer off the device, and there is none. |
| Location, web history, user activity | No |
| Website content | No — read locally, never transmitted |
| Not being sold to third parties | Certify |
| Not being used for unrelated purposes | Certify |
| Not being used to determine creditworthiness | Certify |

Firefox `data_collection_permissions` is declared in the manifest as `{"required": ["none"]}`.

---

## Assets

| Asset | Size | File |
|---|---|---|
| Store icon | 128×128 | `public/icon/128.png` |
| Master icon | 1024×1024 | `store-assets/icon-master-1024.png` |
| Small promo tile | 440×280 | `store-assets/promo-small-440x280.png` |
| Screenshots | 1280×800, 1–5 | **still needed** |

Screenshots worth taking, in order of how well they explain the product:

1. A running panel with a narrator summary open — the whole idea in one frame.
2. The steering box with a note queued for the next round.
3. The closing summary at the end of a run.
4. The setup screen with several tabs seated and Check adapters green.
5. An incident banner, showing the failure policy is deliberate rather than a crash.

---

## Publishing

Versions come from `package.json`; the manifest and both zips follow it, and the release
workflow refuses to build if the git tag disagrees.

```bash
npm version patch          # or minor / major
git push --follow-tags     # tag push builds and attaches all three zips
```

| Store | Account | Upload |
|---|---|---|
| Chrome Web Store | one-time $5 registration | `ai-debator-<version>-chrome.zip` |
| Edge Add-ons | free, Partner Center | the same Chrome zip |
| Firefox AMO | free | `ai-debator-<version>-firefox.zip` **and** `-sources.zip` |

Firefox ships as MV2, which is what WXT produces for that target and what AMO accepts. Two
API differences are absorbed in `lib/browser.ts`: MV2 has `browserAction` rather than
`action`, and `tabs.executeScript` rather than `scripting.executeScript`. The same file also
prefers the promise-based `browser` namespace over `chrome`, which is callback-only on Firefox
and would make every awaited call in this codebase resolve to `undefined`.

The sources zip is required because the shipped code is bundled. It is trimmed to what is
needed to rebuild — captures and binaries are excluded via `zip.excludeSources` — and it must
build with `npm ci && npm run build` on a clean checkout.
