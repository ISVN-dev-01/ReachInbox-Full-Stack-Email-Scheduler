import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: ['tests/integration/**'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 15000,
  },
});
