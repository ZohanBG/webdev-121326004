import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    // each test file starts its own in-process PostgreSQL (PGlite), which takes a moment
    testTimeout: 20_000,
    hookTimeout: 30_000,
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/server.js'],
      // the gate from AGENTS.md: every rule tested, glue code mostly tested
      thresholds: {
        lines: 80,
        'src/services/**': { lines: 100, functions: 100, branches: 100, statements: 100 },
      },
    },
  },
});
