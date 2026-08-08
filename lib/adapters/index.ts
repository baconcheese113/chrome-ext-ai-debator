import type { ProviderAdapter } from '../types';

/**
 * Every selector marked CONFIRMED was the one that actually matched during the 40-run spike
 * (see docs/superpowers/specs/2026-08-08-adapter-spike-findings.md). Selectors marked GUESS
 * are unverified — they exist so a provider degrades to a diagnosable miss rather than a
 * hard failure. Keep these labels accurate; they are the difference between "this is known
 * to work" and "this looked right to someone once".
 */

const claude: ProviderAdapter = {
  id: 'claude',
  label: 'Claude',
  urlPatterns: ['https://claude.ai/*'],

  composer: {
    // CONFIRMED (10/10 runs)
    selectors: [
      'div[contenteditable="true"].ProseMirror',
      'div[enterkeyhint][contenteditable="true"]',
      'div[contenteditable="true"]',
    ],
    kind: 'contenteditable',
  },

  submit: {
    // CONFIRMED: no send button was present in the DOM at all; Enter is what worked.
    strategy: 'auto',
    buttonSelectors: ['button[aria-label="Send message"]', 'button[aria-label*="Send" i]'],
  },

  generating: {
    stopSelectors: [
      'div[data-is-streaming="true"]',
      'button[aria-label="Stop response"]',
      'button[aria-label*="Stop" i]',
    ],
  },

  response: {
    // GUESS for plain chat — the spike only ever saw Cowork mode, where the thread carries
    // an activity feed (li.font-claude-response-body) instead of a reply. Ordered so plain
    // chat wins if present, with the Cowork feed last as a diagnosable fallback.
    selectors: [
      '.font-claude-message',
      'div[data-testid="assistant-message"]',
      'div[data-is-streaming] .font-claude-message',
      'li.font-claude-response-body',
    ],
  },

  artifact: {
    // GUESS. Required because Cowork puts the real content here.
    selectors: [
      'div[aria-label="Preview"] .prose',
      'div[class*="artifact"] .prose',
      'div[aria-label="Preview"]',
      'iframe[title*="artifact" i]',
    ],
  },
};

const chatgpt: ProviderAdapter = {
  id: 'chatgpt',
  label: 'ChatGPT',
  urlPatterns: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],

  composer: {
    // CONFIRMED (10/10)
    selectors: [
      'div#prompt-textarea[contenteditable="true"]',
      '#prompt-textarea',
      'textarea[data-testid="prompt-textarea"]',
    ],
    kind: 'auto',
  },

  submit: {
    // CONFIRMED (10/10)
    strategy: 'auto',
    buttonSelectors: [
      'button[data-testid="send-button"]',
      'button#composer-submit-button',
      'button[aria-label*="Send" i]',
    ],
  },

  generating: {
    stopSelectors: ['button[data-testid="stop-button"]', 'button[aria-label*="Stop" i]'],
  },

  response: {
    // CONFIRMED (10/10)
    selectors: [
      'div[data-message-author-role="assistant"] .markdown',
      'div[data-message-author-role="assistant"]',
    ],
  },

  artifact: {
    // GUESS — canvas.
    selectors: ['div[data-testid="canvas-content"] .markdown', 'section[aria-label*="Canvas" i]'],
  },
};

const gemini: ProviderAdapter = {
  id: 'gemini',
  label: 'Gemini',
  urlPatterns: ['https://gemini.google.com/*'],

  composer: {
    // CONFIRMED (10/10). Reached through shadow roots by deepQueryAll.
    selectors: [
      'rich-textarea div.ql-editor[contenteditable="true"]',
      'div.ql-editor[contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
    ],
    kind: 'contenteditable',
  },

  submit: {
    // CONFIRMED (10/10)
    strategy: 'auto',
    buttonSelectors: [
      'button[aria-label*="Send message" i]',
      'button.send-button',
      'button[aria-label*="Send" i]',
    ],
  },

  generating: {
    stopSelectors: ['button[aria-label*="Stop" i]', '.stop-icon'],
  },

  response: {
    // CONFIRMED (8/8 where not minimized)
    selectors: [
      'model-response message-content .markdown',
      'message-content.model-response-text',
      'model-response message-content',
    ],
  },
};

const grok: ProviderAdapter = {
  id: 'grok',
  label: 'Grok',
  urlPatterns: ['https://grok.com/*'],

  composer: {
    // CONFIRMED (10/10)
    selectors: ['div[contenteditable="true"]', 'textarea[aria-label*="Ask" i]', 'textarea'],
    kind: 'auto',
  },

  submit: {
    // CONFIRMED (10/10)
    strategy: 'auto',
    buttonSelectors: ['button[type="submit"]', 'button[aria-label*="Submit" i]'],
  },

  generating: {
    stopSelectors: ['button[aria-label*="Stop" i]'],
  },

  response: {
    // CONFIRMED (10/10) — the only provider that survived every condition, including minimized.
    selectors: ['.message-bubble', 'div[data-message-author="assistant"]'],
  },
};

/**
 * Untested long-tail providers. These are GUESSES end to end and exist to prove the config
 * path is genuinely cheap to extend — adding one is this object, not a code change. Expect
 * to fix them via the dashboard's Diagnose button on first use.
 */
const qwen: ProviderAdapter = {
  id: 'qwen',
  label: 'Qwen',
  urlPatterns: ['https://chat.qwen.ai/*'],
  composer: { selectors: ['div[contenteditable="true"]', 'textarea#chat-input', 'textarea'], kind: 'auto' },
  submit: { strategy: 'auto', buttonSelectors: ['button#send-message-button', 'button[type="submit"]'] },
  generating: { stopSelectors: ['button[aria-label*="Stop" i]', 'button#stop-button'] },
  response: { selectors: ['div.markdown-content-container', 'div[class*="assistant"] .markdown'] },
};

const kimi: ProviderAdapter = {
  id: 'kimi',
  label: 'Kimi',
  urlPatterns: ['https://kimi.com/*', 'https://www.kimi.com/*'],
  composer: { selectors: ['div[contenteditable="true"]', 'textarea'], kind: 'auto' },
  submit: { strategy: 'auto', buttonSelectors: ['button[data-testid="msh-send-button"]', 'button[type="submit"]'] },
  generating: { stopSelectors: ['button[aria-label*="Stop" i]', 'div.stop-icon'] },
  response: { selectors: ['div.markdown-container', 'div[class*="segment-assistant"]'] },
};

const deepseek: ProviderAdapter = {
  id: 'deepseek',
  label: 'DeepSeek',
  urlPatterns: ['https://chat.deepseek.com/*'],
  composer: { selectors: ['textarea#chat-input', 'div[contenteditable="true"]', 'textarea'], kind: 'auto' },
  submit: { strategy: 'auto', buttonSelectors: ['div[role="button"][aria-disabled="false"]', 'button[type="submit"]'] },
  generating: { stopSelectors: ['div[aria-label*="Stop" i]', 'button[aria-label*="Stop" i]'] },
  response: { selectors: ['div.ds-markdown', 'div[class*="markdown"]'] },
};

export const ADAPTERS: ProviderAdapter[] = [
  claude,
  chatgpt,
  gemini,
  grok,
  qwen,
  kimi,
  deepseek,
];

export const ADAPTERS_BY_ID: Record<string, ProviderAdapter> = Object.fromEntries(
  ADAPTERS.map((a) => [a.id, a]),
);

/** Which adapter, if any, owns a URL. Used to turn open tabs into claimable seats. */
export function adapterForUrl(url: string): ProviderAdapter | undefined {
  return ADAPTERS.find((a) =>
    a.urlPatterns.some((p) => {
      const rx = new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
      return rx.test(url);
    }),
  );
}
