import { defineConfig } from '@playwright/test';

export const MOCK_PORT = 5599;
export const MOCK_URL = `http://localhost:${MOCK_PORT}`;

export default defineConfig({
  testDir: './tests',
  // L1/L2 belong to vitest; L5 talks to real providers and must never run by default.
  testMatch: ['driver/**/*.spec.ts', 'e2e/**/*.spec.ts'],
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: MOCK_URL,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npx http-server tests/mock-provider -p ${MOCK_PORT} -s -c-1`,
    url: MOCK_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
