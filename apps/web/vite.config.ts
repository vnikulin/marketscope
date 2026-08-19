import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/health': 'http://127.0.0.1:3000',
    },
  },
  preview: {
    port: 4173,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:3106',
      '/health': 'http://127.0.0.1:3106',
    },
  },
});
