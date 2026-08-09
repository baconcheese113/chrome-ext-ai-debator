import { ADAPTERS, ADAPTERS_BY_ID } from '../lib/adapters';
import { collectDiagnostics } from '../lib/diagnostics';
import { awaitTurn, drive, submitTurn } from '../lib/driver';
import { checkAdapter } from '../lib/selector-check';
import type { DriveResult } from '../lib/types';

export default defineContentScript({
  matches: ADAPTERS.flatMap((a) => a.urlPatterns),
  runAt: 'document_idle',

  main() {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type === 'PING') {
        sendResponse({ ok: true });
        return false;
      }

      if (msg?.type === 'DIAGNOSE') {
        sendResponse(collectDiagnostics('requested from dashboard'));
        return false;
      }

      if (msg?.type === 'CHECK_ADAPTER') {
        const adapter = ADAPTERS_BY_ID[msg.providerId];
        sendResponse(adapter ? checkAdapter(adapter) : null);
        return false;
      }

      // Parallel mode splits a turn: submit to every seat first so they all generate at
      // once, then harvest each. Serial mode uses DRIVE, which is both phases back to back.
      if (msg?.type === 'DRIVE_SUBMIT' || msg?.type === 'DRIVE_AWAIT') {
        const a = ADAPTERS_BY_ID[msg.providerId];
        if (!a) {
          sendResponse({ ok: false, failure: 'driver-error', detail: 'no adapter', timings: {} });
          return false;
        }
        const req = { providerId: msg.providerId, prompt: msg.prompt, minChars: msg.minChars };
        const work =
          msg.type === 'DRIVE_SUBMIT'
            ? submitTurn(a, req)
            : awaitTurn(a, req, msg.before, {}, msg.warning);
        work.then(sendResponse).catch((err) =>
          sendResponse({ ok: false, failure: 'driver-error', detail: String(err), timings: {} }),
        );
        return true;
      }

      if (msg?.type === 'DRIVE') {
        const adapter = ADAPTERS_BY_ID[msg.providerId];
        if (!adapter) {
          sendResponse({
            ok: false,
            failure: 'driver-error',
            detail: `no adapter for "${msg.providerId}"`,
            timings: {},
          } satisfies DriveResult);
          return false;
        }
        drive(adapter, { providerId: msg.providerId, prompt: msg.prompt, minChars: msg.minChars })
          .then(sendResponse)
          .catch((err) =>
            sendResponse({
              ok: false,
              failure: 'driver-error',
              detail: String(err),
              timings: {},
              diagnostics: collectDiagnostics('driver threw'),
            } satisfies DriveResult),
          );
        return true; // async
      }

      return false;
    });
  },
});
