import { defineConfig } from 'vitest/config';

// Cross-origin isolation (COOP/COEP) headers were evaluated at T16 as a way to unlock
// onnxruntime-web's built-in WASM threading and reduce main-thread blocking during
// inference. Rejected: (1) GitHub Pages, the deploy target, cannot set custom response
// headers at all, making this a dev-only affordance with no production path; (2) even in
// dev, enabling it broke model loading entirely — the threaded build's spawned pthread
// workers throw `ReferenceError: document is not defined`, a bundler/runtime
// incompatibility between this exact onnxruntime-web build and Vite's worker bundling.
// See docs/adr/0006-performance-checkpoint.md.

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
  },
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
