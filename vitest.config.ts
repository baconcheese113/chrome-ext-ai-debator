import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Playwright owns tests/driver, tests/e2e and tests/live; vitest must not try to run them.
    include: ['tests/unit/**/*.test.ts', 'tests/orchestrator/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15_000,
  },
});
