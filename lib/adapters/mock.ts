import type { ProviderAdapter } from '../types';

/**
 * Adapter for the local mock provider used by the E2E suite.
 *
 * Included ONLY in `WXT_E2E` builds. The shipped extension must not carry a localhost host
 * permission it has no use for.
 */
export const mockProvider: ProviderAdapter = {
  id: 'mock',
  label: 'Mock',
  // No port: Chrome match patterns exclude the port entirely, and including one can make the
  // whole pattern invalid. adapterForUrl strips ports to match those semantics.
  urlPatterns: ['http://localhost/*', 'http://127.0.0.1/*'],

  composer: {
    selectors: ['#composer[contenteditable="true"]'],
    kind: 'contenteditable',
  },

  submit: {
    strategy: 'click',
    buttonSelectors: ['button[data-testid="send-button"]'],
  },

  generating: {
    stopSelectors: ['button[data-testid="stop-button"]'],
  },

  response: {
    selectors: ['.msg.assistant'],
  },

  artifact: {
    selectors: ['#artifact.open .artifact-body'],
  },
};
