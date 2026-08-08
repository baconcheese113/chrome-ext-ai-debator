import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Playwright owns tests/driver, tests/e2e and tests/live; vitest must not try to run them.
    include: ['tests/unit/**/*.test.ts', 'tests/orchestrator/**/*.test.ts', 'tests/build.spec.ts'],
    environment: 'node',
    // The build-integrity test shells out to a real production build.
    testTimeout: 120_000,
  },
});
