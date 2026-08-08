import type { ProviderConfig } from '../types';

export const claude: ProviderConfig = {
  id: 'claude',
  label: 'Claude',
  newChatUrl: 'https://claude.ai/new',

  composer: {
    // ProseMirror editor. The bare contenteditable is a fallback for when the class changes.
    selectors: [
      'div[contenteditable="true"].ProseMirror',
      'div[enterkeyhint][contenteditable="true"]',
      'div[contenteditable="true"]',
    ],
    kind: 'contenteditable',
  },

  submit: {
    strategy: 'auto',
    buttonSelectors: [
      'button[aria-label="Send message"]',
      'button[aria-label*="Send" i]',
      'button[type="submit"]',
    ],
  },

  generating: {
    presentSelectors: [
      // Claude marks the streaming message container itself — the most reliable tell here.
      'div[data-is-streaming="true"]',
      'button[aria-label="Stop response"]',
      'button[aria-label*="Stop" i]',
    ],
    enabledSelectors: ['button[aria-label="Send message"]', 'button[aria-label*="Send" i]'],
  },

  response: {
    selectors: [
      'div[data-is-streaming="false"] .font-claude-message',
      'div[data-is-streaming] .font-claude-message',
      '.font-claude-message',
      'div[data-testid="assistant-message"]',
    ],
  },
};
