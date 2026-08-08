import type { ProviderConfig } from '../types';

/**
 * The generality test, and the config I have least confidence in. Grok's UI changes often
 * and I am working from memory, so these selectors are deliberately broad and are EXPECTED
 * to partially miss. That is fine: a miss here produces a diagnostics dump with pasteable
 * candidate selectors, which is the actual deliverable for this provider.
 */
export const grok: ProviderConfig = {
  id: 'grok',
  label: 'Grok',
  newChatUrl: 'https://grok.com/',

  composer: {
    selectors: [
      'textarea[aria-label*="Ask" i]',
      'textarea[placeholder*="Ask" i]',
      'div[contenteditable="true"]',
      'textarea',
    ],
    kind: 'auto',
  },

  submit: {
    strategy: 'auto',
    buttonSelectors: [
      'button[type="submit"]',
      'button[aria-label*="Submit" i]',
      'button[aria-label*="Send" i]',
    ],
  },

  generating: {
    presentSelectors: ['button[aria-label*="Stop" i]', 'button[aria-label*="Cancel" i]'],
    enabledSelectors: ['button[type="submit"]', 'button[aria-label*="Submit" i]'],
  },

  response: {
    selectors: [
      'div[data-message-author="assistant"]',
      '.message-bubble',
      'div.response-content-markdown',
      'div.prose',
    ],
  },
};
