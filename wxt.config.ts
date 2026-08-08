import { defineConfig } from 'wxt';

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
    ],
    action: { default_title: 'AI Debator' },
  },
});
