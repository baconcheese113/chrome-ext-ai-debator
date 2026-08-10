import { defineConfig } from 'wxt';

/** E2E builds additionally drive the local mock provider. See lib/adapters/mock.ts. */
const E2E = process.env.WXT_E2E === 'true';

export default defineConfig({
  modules: ['@wxt-dev/module-svelte'],
  manifest: {
    name: 'AI Debator',
    description: 'Run multi-model brainstorming panels across your existing LLM subscriptions.',
    version: '0.1.0',
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
    action: {
      default_title: 'AI Debator',
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
      },
    },
  },
});
