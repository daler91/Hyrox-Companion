import { defineConfig } from 'vitest/config';
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
      include: ['client/src/**', 'server/**', 'shared/**'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
