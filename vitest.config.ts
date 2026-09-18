import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/**/*.test.ts', 'packages/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['apps/*/src/**/*.ts', 'packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts'],
      reporter: ['text', 'lcov', 'html'],
      thresholds: {
        lines: 70,
        'packages/ocpp/src/**': { lines: 85 },
        'apps/gateway/src/{session,pipeline,alerts}/**': { lines: 85 },
      },
    },
  },
});
