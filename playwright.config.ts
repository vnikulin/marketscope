import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node tests/e2e/server.mjs',
      url: 'http://127.0.0.1:3106/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      gracefulShutdown: { signal: 'SIGINT', timeout: 1_000 },
    },
    {
      command: 'node node_modules/vite/bin/vite.js preview apps/web --host 127.0.0.1',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      gracefulShutdown: { signal: 'SIGINT', timeout: 1_000 },
    },
  ],
  projects: [
    { name: 'iphone-portrait', use: { viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 3 } },
    { name: 'iphone-landscape', use: { viewport: { width: 844, height: 390 }, isMobile: true, deviceScaleFactor: 3 } },
    { name: 'android-portrait', use: { viewport: { width: 412, height: 915 }, isMobile: true, deviceScaleFactor: 2.625 } },
    { name: 'android-landscape', use: { viewport: { width: 915, height: 412 }, isMobile: true, deviceScaleFactor: 2.625 } },
    { name: 'tablet', use: { viewport: { width: 820, height: 1180 }, isMobile: true, deviceScaleFactor: 2 } },
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
  ],
});
