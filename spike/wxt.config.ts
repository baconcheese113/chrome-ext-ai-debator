import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'AI Debator Spike',
    description: 'Throwaway spike: can a content script drive LLM web UIs reliably?',
    version: '0.0.1',
    permissions: ['tabs', 'scripting', 'storage'],
    host_permissions: [
      'https://claude.ai/*',
      'https://chatgpt.com/*',
      'https://gemini.google.com/*',
      'https://grok.com/*',
    ],
  },
});
