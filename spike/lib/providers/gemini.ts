import type { ProviderConfig } from '../types';

/**
 * The structural outlier: Angular, custom elements, and open shadow roots. Deliberately
 * written WITHOUT overrides so E1 gets an honest answer about whether pure config can
 * reach it. If this one needs code, that is the strongest single argument for
 * architecture C over A.
 */
export const gemini: ProviderConfig = {
  id: 'gemini',
  label: 'Gemini',
  newChatUrl: 'https://gemini.google.com/app',

  composer: {
    selectors: [
      'rich-textarea div.ql-editor[contenteditable="true"]',
      'div.ql-editor[contenteditable="true"]',
      'rich-textarea [contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
    ],
    kind: 'contenteditable',
  },

  submit: {
    strategy: 'auto',
    buttonSelectors: [
      'button.send-button',
      'button[aria-label*="Send message" i]',
      'button[aria-label*="Send" i]',
    ],
  },

  generating: {
    presentSelectors: [
      'button[aria-label*="Stop" i]',
      '.stop-icon',
      'mat-icon[data-mat-icon-name="stop"]',
    ],
    enabledSelectors: ['button.send-button', 'button[aria-label*="Send" i]'],
  },

  response: {
    selectors: [
      'model-response message-content .markdown',
      'message-content.model-response-text',
      'model-response message-content',
      'model-response',
    ],
  },
};
