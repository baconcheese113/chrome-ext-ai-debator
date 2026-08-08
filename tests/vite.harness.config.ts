import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * Builds the driver into a plain IIFE that a Playwright page can load with addScriptTag.
 * Output lands beside the mock provider so the static server serves both.
 */
export default defineConfig({
  define: {
    // The driver's adapter list reads this; the harness never needs the mock adapter itself.
    'import.meta.env.WXT_E2E': JSON.stringify('false'),
  },
  build: {
    outDir: resolve(import.meta.dirname, 'mock-provider/dist'),
    emptyOutDir: true,
    lib: {
      entry: resolve(import.meta.dirname, 'driver/harness-entry.ts'),
      name: 'DriverHarness',
      formats: ['iife'],
      fileName: () => 'driver-harness.js',
    },
  },
});
