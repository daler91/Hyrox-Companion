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
    // The suite runs in the SHIPPED configuration: nutrition is ON by default at
    // runtime (server/env.ts, client/src/lib/featureFlags.ts), so it is ON here
    // too — otherwise the flag-ON wiring (route gate pass-through, Fuelling tab,
    // workout fuelling panel, onboarding fuelling step) only ever ran in
    // production. Tests that are ABOUT the OFF state pin it themselves
    // (the nutrition route flag-gate test, OnboardingWizard.test.tsx); never
    // flip this back to 'false' to make a flag-conditional test pass.
    // (vitest exposes test.env on both process.env and import.meta.env.)
    env: { NUTRITION_ENABLED: 'true', VITE_NUTRITION_ENABLED: 'true' },
    exclude: ['**/*.integration.test.ts', '**/smoke.test.ts', '**/node_modules/**', '**/dist/**', '**/cypress/**'],
    // 15s, not vitest's 5s default. Nothing here is meant to take seconds: the
    // component tests that come closest (the LogFoodDialog portion flows, which
    // drive a Radix select plus character-by-character userEvent typing) run in
    // ~0.5s on an idle machine. But the suite runs across many worker processes
    // in parallel, and under that CPU contention those same tests have been
    // measured at 6s — timing out with vitest's opaque `STACK_TRACE_ERROR`
    // rather than any real failure (issue #1710). The headroom buys contention
    // tolerance only; a genuinely hung test still fails, just 10s later.
    testTimeout: 15000,
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
        // Browser bootstrap — mounts the root and registers the service worker,
        // only exercised by a real page load. It was already missing from the
        // totals by accident: its virtual:pwa-register import has no resolver
        // under this config, so the coverage remapper fell back to the raw TSX,
        // could not parse it, and logged "Failed to parse … main.tsx. Excluding
        // it from coverage" on every coverage run. Exclude it on purpose.
        'client/src/main.tsx',
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
