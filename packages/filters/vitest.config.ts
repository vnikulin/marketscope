import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      thresholds: {
        lines: 90,
      },
    },
    exclude: ['dist/**', 'node_modules/**'],
    name: '@marketscope/filters',
    passWithNoTests: true,
  },
});
