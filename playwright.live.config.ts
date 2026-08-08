import { defineConfig } from '@playwright/test';

/**
 * L5 — the ONLY layer that talks to real providers, and the only one that can detect
 * selector rot. Deliberately a separate config so it can never be picked up by `npm test`,
 * `npm run test:e2e`, or CI.
 *
 * Requires `npm run test:live:login` first. Uses real subscription quota. Expect flakiness:
 * that is the nature of driving someone else's UI, not a defect in the test.
 */
export default defineConfig({
  testDir: './tests/live',
  testMatch: ['**/*.spec.ts'],
  fullyParallel: false,
  workers: 1,
  // Real models take real time, and a rate limit may make it take longer still.
  timeout: 300_000,
  expect: { timeout: 60_000 },
  retries: 0,
  reporter: 'list',
  use: { trace: 'retain-on-failure' },
});
