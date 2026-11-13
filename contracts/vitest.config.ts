import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Bez coverage: kontrakty spouštějí kód služeb, ale nesmí měnit jejich prahy.
export default defineConfig({
  resolve: {
    // Frontendové API moduly se importují tak, jak je sestavuje Vite.
    alias: {
      '@': fileURLToPath(new URL('../apps/frontend/src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
