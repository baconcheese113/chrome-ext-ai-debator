import { mockProvider } from './mock';
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
    // CONFIRMED 2026-08-08 from a live capture. The test id outlives the editor library,
    // so it leads; ProseMirror (confirmed 10/10 in the spike) is the fallback.
    selectors: [
      'div[data-testid="chat-input"]',
      'div[contenteditable="true"].ProseMirror',
      'div[enterkeyhint][contenteditable="true"]',
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
    // CONFIRMED 2026-08-08: `div.font-claude-response` is one element per assistant turn,
    // matching 1:1 against data-testid="user-message". `.font-claude-message` no longer
    // exists at all.
    //
    // Do NOT add `.font-claude-response-body`. It is applied per top-level BLOCK inside a
    // reply — a <p> in one thread, an <li> in another — so a reply containing five bullets
    // would read as five turns and extraction would return a single bullet.
    selectors: ['div.font-claude-response', '.font-claude-response'],
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
    // CONFIRMED (10/10 in the spike, re-confirmed 2026-08-08).
    selectors: [
      'div#prompt-textarea[contenteditable="true"]',
      'div[aria-label="Chat with ChatGPT"]',
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
    // CONFIRMED (10/10 in the spike, re-confirmed 2026-08-08). Reached through shadow roots
    // by deepQueryAll. The aria-label leads as the more durable of the two.
    selectors: [
      'div[aria-label="Enter a prompt for Gemini"]',
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
    // CONFIRMED 2026-08-08. The aria-label leads because a bare contenteditable can match
    // almost anything on the page.
    selectors: [
      'div[aria-label="Ask Grok anything"]',
      'div[aria-label*="Ask Grok" i]',
      'div[contenteditable="true"]',
      'textarea',
    ],
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
    // CONFIRMED 2026-08-08.
    //
    // `.message-bubble` is deliberately GONE. It matched 8 elements on a 4-exchange thread —
    // user turns as well as assistant turns. That made "a new message appeared" fire on the
    // echo of our own prompt rather than on the reply. It worked only by luck, and the luck
    // would have run out the first time a reply was slow.
    selectors: ['div[data-testid="assistant-message"]', '[data-testid="assistant-message"]'],
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
  // GUESS, mirroring the confirmed `msh-send-button` naming. Kimi is a reasoning model: it
  // renders a collapsed "Thinking" header and then leaves the DOM completely static while it
  // reasons, so without a generating signal the driver reads the header as the answer. The
  // driver also falls back to generic `*stop*` patterns, which should cover this either way.
  generating: {
    stopSelectors: [
      'button[data-testid="msh-stop-button"]',
      'button[data-testid*="stop" i]',
      'button[aria-label*="Stop" i]',
      'div.stop-icon',
    ],
  },
  // CONFIRMED 2026-08-10 from a captured page: `div.segment.segment-assistant` is one element
  // per assistant turn, matching 1:1 against `segment-user`.
  //
  // `markdown-container` used to lead, and that is the whole Kimi defect. It is applied per
  // BLOCK inside a reply — the same trap as Claude's `.font-claude-response-body` — so a reply
  // made of several blocks read as several turns and extraction returned a fragment. Nine
  // rounds of a real panel were recorded from a fragment before anything noticed.
  response: {
    selectors: [
      'div.segment.segment-assistant',
      'div[class*="segment-assistant"]',
      'div.markdown-container',
    ],
  },
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

const REAL_ADAPTERS: ProviderAdapter[] = [claude, chatgpt, gemini, grok, qwen, kimi, deepseek];

/**
 * The mock provider is compiled in only for E2E builds (`npm run build:e2e`). Keeping it out
 * of the shipped bundle means the published extension never asks for a localhost permission
 * it has no reason to hold.
 */
export const ADAPTERS: ProviderAdapter[] =
  import.meta.env.WXT_E2E === 'true' ? [...REAL_ADAPTERS, mockProvider] : REAL_ADAPTERS;

export const ADAPTERS_BY_ID: Record<string, ProviderAdapter> = Object.fromEntries(
  ADAPTERS.map((a) => [a.id, a]),
);

/**
 * Which adapter, if any, owns a URL. Used to turn open tabs into claimable seats.
 *
 * The port is stripped first, matching Chrome's own match-pattern semantics — a pattern's
 * host never carries a port, so `http://localhost/*` must match `http://localhost:5599/x`.
 */
export function adapterForUrl(url: string): ProviderAdapter | undefined {
  let normalized = url;
  try {
    const u = new URL(url);
    u.port = '';
    normalized = u.toString();
  } catch {
    // Not a parseable URL; fall through and match the raw string.
  }

  return ADAPTERS.find((a) =>
    a.urlPatterns.some((p) => {
      const rx = new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
      return rx.test(normalized);
    }),
  );
}
