import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    environmentMatchGlobs: [['tests/server/**', 'node'], ['tests/e2e/**', 'node']],
    globals: false,
  },
});
