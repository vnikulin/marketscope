import { resolve } from 'node:path';

import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: 'dist',
    rollupOptions: {
      input: {
        content: resolve(import.meta.dirname, 'src/content.ts'),
        'service-worker': resolve(import.meta.dirname, 'src/service-worker.ts'),
        'assets/regex-worker': resolve(
          import.meta.dirname,
          'src/regex-worker.ts',
        ),
      },
      output: {
        entryFileNames: '[name].js',
      },
    },
    target: 'chrome120',
  },
});
