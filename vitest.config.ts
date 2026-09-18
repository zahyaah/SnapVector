import { defineConfig } from 'vitest/config';

// Vitest keeps its own config rather than sharing vite.config.ts: vitest 3 bundles an
// older Vite major than the one this app builds with, so a shared `defineConfig` would
// type-check against two incompatible Vite versions. Unit tests here are pure functions
// over plain data and need none of the app's build config anyway.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**'],
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
});
