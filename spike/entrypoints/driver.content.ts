import { drive } from '../lib/driver';
import { collectDiagnostics } from '../lib/diagnostics';
import { PROVIDERS } from '../lib/providers';
import type { ProviderId } from '../lib/types';

export default defineContentScript({
  matches: [
    'https://claude.ai/*',
    'https://chatgpt.com/*',
    'https://gemini.google.com/*',
    'https://grok.com/*',
  ],
  runAt: 'document_idle',

  main() {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      // The background polls this until it answers, to know the script is actually live.
      if (msg?.type === 'PING') {
        sendResponse({ ok: true });
        return false;
      }

      if (msg?.type === 'DRIVE') {
        const cfg = PROVIDERS[msg.provider as ProviderId];
        drive({ cfg, prompt: msg.prompt })
          .then(sendResponse)
          .catch((err) =>
            sendResponse({
              outcome: 'fail',
              failureMode: `driver threw: ${String(err)}`,
              timings: {},
              matchedSelectors: {},
              usedOverrides: [],
              diagnostics: collectDiagnostics('driver threw'),
            }),
          );
        return true; // async response
      }

      if (msg?.type === 'DIAGNOSE') {
        sendResponse(collectDiagnostics('manual diagnose'));
        return false;
      }

      return false;
    });
  },
});
