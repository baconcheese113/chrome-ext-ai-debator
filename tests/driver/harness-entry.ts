import { collectDiagnostics } from '../../lib/diagnostics';
import { drive, driverTimings } from '../../lib/driver';
import type { DriveRequest, ProviderAdapter } from '../../lib/types';

/**
 * Exposes the REAL driver to Playwright so L3 tests exercise shipped logic rather than a
 * reimplementation. Bundled separately because the content-script entrypoint immediately
 * registers a chrome.runtime listener and cannot run on a plain page.
 */
declare global {
  interface Window {
    __driver: {
      drive(adapter: ProviderAdapter, req: DriveRequest): ReturnType<typeof drive>;
      diagnose(note: string): ReturnType<typeof collectDiagnostics>;
      /** Lets a test shrink the production waits it deliberately provokes. */
      setTimeouts(t: Partial<typeof driverTimings>): void;
    };
  }
}

window.__driver = {
  drive: (adapter, req) => drive(adapter, req),
  diagnose: (note) => collectDiagnostics(note),
  setTimeouts: (t) => Object.assign(driverTimings, t),
};
