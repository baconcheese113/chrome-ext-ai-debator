import type { ProviderConfig } from '../types';

export const chatgpt: ProviderConfig = {
  id: 'chatgpt',
  label: 'ChatGPT',
  newChatUrl: 'https://chatgpt.com/',

  composer: {
    // #prompt-textarea has been both a <textarea> and a contenteditable div across redesigns,
    // hence kind: 'auto' — the driver inspects the node rather than trusting this config.
    selectors: [
      'div#prompt-textarea[contenteditable="true"]',
      '#prompt-textarea',
      'textarea[data-testid="prompt-textarea"]',
      'div[contenteditable="true"]',
    ],
    kind: 'auto',
  },

  submit: {
    strategy: 'auto',
    buttonSelectors: [
      'button[data-testid="send-button"]',
      'button#composer-submit-button',
      'button[aria-label*="Send" i]',
    ],
  },

  generating: {
    presentSelectors: [
      'button[data-testid="stop-button"]',
      'button[aria-label*="Stop streaming" i]',
      'button[aria-label*="Stop" i]',
    ],
    enabledSelectors: ['button[data-testid="send-button"]', 'button#composer-submit-button'],
  },

  response: {
    selectors: [
      'div[data-message-author-role="assistant"] .markdown',
      'div[data-message-author-role="assistant"]',
      'div[data-testid^="conversation-turn"] .markdown',
    ],
  },
};
