# AMO reviewer notes

Paste the block below into **Notes for Reviewers** on the AMO submission form. It answers the
two things a reviewer of this add-on will actually want: how to rebuild the bundle byte for
byte, and what the linter's `innerHTML` warning is.

---

```
BUILD INSTRUCTIONS

Environment
  Node.js 22 LTS (or newer), npm 10+
  Any OS — built and tested on Windows 11 and Ubuntu (GitHub Actions)
  No global tools, no native dependencies, no network access needed beyond `npm ci`

Reproduce the submitted package
  npm ci
  npx wxt zip -b firefox

  Output: .output/ai-debator-<version>-firefox.zip

  `npx wxt build -b firefox` alone produces the unpacked add-on in .output/firefox-mv2/
  if you would rather inspect the tree than the archive.

Verify it (optional)
  npm run check    # TypeScript + svelte-check
  npm test         # 83 unit and orchestrator tests
  npm run test:e2e # 30 Playwright tests, drives a local mock provider

What the build does
  WXT 0.21 (https://wxt.dev) orchestrates Vite 8. Vite bundles and minifies the TypeScript and
  Svelte 5 sources into the three entry points declared in the manifest: background.js, the
  content script, and the dashboard page. There is no code generation beyond the Svelte
  compiler and Vite's bundler, both open source and both invoked by the command above.

LINTER WARNING: "Unsafe assignment to innerHTML"

  This is Svelte 5's own template instantiation, not add-on code. At that offset the bundle
  reads:

    window.trustedTypes.createPolicy('svelte-trusted-html', { createHTML: e => e });
    function _r(e) { return gr?.createHTML(e) ?? e }
    function vr(e) { var t = fn('template'); return t.innerHTML = _r(e.replaceAll('<!>','<!---->')), t.content }

  It assigns compile-time-generated static markup to a detached <template> element to create
  a document fragment, and routes it through a Trusted Types policy. The input is a string
  literal emitted by the Svelte compiler; no runtime, user, or page-derived value reaches it.

  The add-on's own source never assigns innerHTML and never uses Svelte's {@html}. You can
  confirm this in the submitted source:

    grep -rn "innerHTML\|@html" lib entrypoints

  The only two hits READ .innerHTML in lib/driver.ts, storing a captured reply for export.

  Model output is deliberately never rendered as HTML. entrypoints/dashboard/Prose.svelte
  parses a restricted markdown subset into typed blocks and builds DOM nodes from them,
  specifically to avoid putting third-party text through an HTML sink in a privileged page.

WHAT THE ADD-ON DOES

  It automates AI chat pages the user is already signed into. The user opens e.g. Claude and
  ChatGPT in tabs, assigns them "seats", and the add-on places the same prompt into each
  chat's composer and reads the replies back out of the page, round by round, so several
  models can respond to each other.

  There is no server and no networking code of any kind — no fetch, XMLHttpRequest,
  WebSocket, or sendBeacon appears anywhere in the source. Everything is held in
  storage.local on the user's machine. Nothing is transmitted, and there are no analytics.

  Host permissions cover exactly the supported chat sites and nothing else. They are load
  bearing: typing into the composer and reading the reply IS the feature.

SOURCE

  https://github.com/baconcheese113/chrome-ext-ai-debator
  MIT licensed. The submitted sources zip is the repository minus captures, binaries and
  build artefacts (see `zip.excludeSources` in wxt.config.ts).
```

---

## Checked before submitting

```bash
# No networking code anywhere in the shipped extension
grep -rn "fetch(\|XMLHttpRequest\|WebSocket\|sendBeacon" lib entrypoints

# No innerHTML assignment, no {@html}
grep -rn "innerHTML\|@html" lib entrypoints

# The sources zip really does rebuild
mkdir /tmp/src && cd /tmp/src
unzip .../ai-debator-<version>-sources.zip
npm ci && npx wxt build -b firefox
```

The last one is the commonest source-review rejection, and it has been run against this zip.
