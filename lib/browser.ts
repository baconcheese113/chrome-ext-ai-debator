/**
 * The extension API namespace, promise-based in every browser we ship to.
 *
 * This exists for Firefox. Firefox does expose a `chrome` namespace, but it is the old
 * callback-style one kept for compatibility — `await chrome.tabs.query(...)` there resolves to
 * `undefined` rather than a list of tabs. Promises live on `browser`. Chrome and Edge have no
 * `browser` at all, and their MV3 `chrome` namespace already returns promises.
 *
 * So: prefer `browser`, fall back to `chrome`, and the same awaited call works on all three.
 * Import this instead of touching either global directly.
 */
type ExtensionApi = typeof chrome;

const globals = globalThis as { browser?: ExtensionApi; chrome?: ExtensionApi };

/**
 * Resolved per property access rather than once at module load. The orchestrator tests
 * install a fake namespace and reset modules between cases, and a value captured at load
 * time would pin whichever fake happened to be installed first.
 */
export const api: ExtensionApi = new Proxy({} as ExtensionApi, {
  get(_target, prop) {
    const impl = globals.browser ?? globals.chrome;
    return impl?.[prop as keyof ExtensionApi];
  },
});

/**
 * The toolbar button. `action` under MV3, `browserAction` under MV2 — and Firefox builds as
 * MV2, where reaching for `action` would throw on startup and take the whole worker with it.
 */
export const action = (): typeof chrome.action =>
  api.action ?? (api as unknown as { browserAction: typeof chrome.action }).browserAction;

/**
 * Inject the content script into a tab that predates the extension.
 *
 * `scripting` is MV3-only. Under MV2 the equivalent is `tabs.executeScript`, which takes a
 * single file and the tab id positionally rather than a target object. Same effect, different
 * shape, so the difference is absorbed here rather than at all three call sites.
 */
export async function injectScript(tabId: number, file: string): Promise<void> {
  if (api.scripting?.executeScript) {
    await api.scripting.executeScript({ target: { tabId }, files: [file] });
    return;
  }
  const mv2 = api.tabs as unknown as {
    executeScript(tabId: number, details: { file: string }): Promise<unknown>;
  };
  await mv2.executeScript(tabId, { file });
}
