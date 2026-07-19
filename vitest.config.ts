import { coverageConfigDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client/src"),
      "@shared": path.resolve(__dirname, "shared"),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // Nutrition is ON by default at runtime now the module is complete, but tests
    // are pinned to the prior OFF value so the flag-gate test and flag-conditional
    // UI (Analytics Fuelling tab, workout fuelling panel) behave exactly as written.
    // (vitest exposes test.env on both process.env and import.meta.env.)
    env: { NUTRITION_ENABLED: 'false', VITE_NUTRITION_ENABLED: 'false' },
    exclude: ['**/*.integration.test.ts', '**/smoke.test.ts', '**/node_modules/**', '**/dist/**', '**/cypress/**'],
    globals: true,
    coverage: {
      // provider defaults to 'v8' (@vitest/coverage-v8 is installed)
      include: ['client/src/**', 'server/**', 'shared/**'],
      // 'text' for the CI log; 'lcovonly' emits coverage/lcov.info — the path
      // sonar-project.properties points at (only consumed if the repo later
      // switches from SonarCloud Automatic Analysis to the CI scanner).
      // lcovonly, not lcov: the full reporter also writes an HTML report whose
      // generated JS trips eslint's typed-parser sweep.
      reporter: ['text', 'lcovonly'],
      exclude: [
        ...coverageConfigDefaults.exclude,
        'server/index.ts', // process bootstrap — only exercised by a real boot
        '**/*.generated.ts', // committed data artifacts
      ],
      // Ratcheted to measured reality, NOT aspirational: measured 2026-07-19
      // (3,496 tests) — statements 68.32, branches 61.53, functions 63.40,
      // lines 69.74. Each gate sits ~1pt below its measurement so the suite is
      // green today and a coverage REGRESSION fails CI. Raise these as
      // coverage grows; never lower them to admit an untested change.
      thresholds: {
        lines: 68,
        functions: 62,
        branches: 60,
        statements: 67,
      },
    },
  },
});
