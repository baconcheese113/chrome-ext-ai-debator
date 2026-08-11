import { defineConfig } from 'wxt';

/** E2E builds additionally drive the local mock provider. See lib/adapters/mock.ts. */
const E2E = process.env.WXT_E2E === 'true';

const HOMEPAGE = 'https://baconcheese113.github.io/chrome-ext-ai-debator/';

export default defineConfig({
  modules: ['@wxt-dev/module-svelte'],

  zip: {
    // AMO requires the source of any bundled add-on, so this zip has to build cleanly on
    // their machine. Everything excluded here is either an artefact, a large binary that is
    // not needed to build, or a capture that could contain real conversation text.
    excludeSources: [
      'docs/**',
      'store-assets/**',
      'test-results/**',
      'playwright-report/**',
      'site/**',
      '.playwright-mcp/**',
      // NOT public/icon/*.png — the build needs those, and a sources zip that cannot build
      // is the single most common reason an AMO source review comes back.
    ],
  },
  manifest: {
    name: 'AI Debator',
    description: 'Run multi-model brainstorming panels across your existing LLM subscriptions.',
    // No `version` here on purpose: WXT takes it from package.json, and three stores plus a
    // git tag plus a manifest is already enough places for one number to disagree with itself.
    homepage_url: HOMEPAGE,

    // Justifications for each of these are in docs/store-listing.md, which is where the
    // reviewer-facing wording lives so it stays consistent across three stores.
    permissions: ['tabs', 'scripting', 'storage'],
    host_permissions: [
      'https://claude.ai/*',
      'https://chatgpt.com/*',
      'https://chat.openai.com/*',
      'https://gemini.google.com/*',
      'https://grok.com/*',
      'https://chat.qwen.ai/*',
      'https://kimi.com/*',
      'https://www.kimi.com/*',
      'https://chat.deepseek.com/*',
      ...(E2E ? ['http://localhost/*', 'http://127.0.0.1/*'] : []),
    ],
    action: { default_title: 'AI Debator' },

    browser_specific_settings: {
      gecko: {
        // A stable add-on ID is required for MV3 on Firefox and strongly recommended on MV2.
        // Once published this can never change without becoming a different add-on.
        id: 'ai-debator@baconcheese113.github.io',
        // 140, not 128, because `data_collection_permissions` below only exists from Firefox
        // 140. Claiming 128 makes AMO warn that the key would be silently ignored on
        // 128–139 — declaring a minimum older than the features you declare is a promise the
        // build cannot keep.
        strict_min_version: '140.0',
        // Required for new AMO submissions since 3 November 2025. The panel keeps everything
        // in local extension storage and contacts no server of ours, so there is nothing to
        // declare — but the declaration itself is mandatory.
        data_collection_permissions: { required: ['none'] },
      },
      // Android shipped the same key two releases later than desktop.
      gecko_android: { strict_min_version: '142.0' },
    },
  },
});
