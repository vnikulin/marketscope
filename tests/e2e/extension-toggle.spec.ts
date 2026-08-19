import { chromium, expect, test } from '@playwright/test';
import { resolve } from 'node:path';

test('the toolbar popup disables and enables Marketplace filtering', async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe('chromium');
  test.skip(
    testInfo.project.name !== 'desktop',
    'The unpacked extension needs one Chromium packaging check.',
  );

  const extensionPath = resolve(import.meta.dirname, '../../apps/extension');
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    const serviceWorker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker', { timeout: 5_000 }));
    const extensionId = new URL(serviceWorker.url()).host;
    await context.route('https://www.facebook.com/marketplace/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><body><main>Marketplace fixture</main></body></html>',
      }),
    );

    const marketplace = await context.newPage();
    await marketplace.goto(
      'https://www.facebook.com/marketplace/search/?query=garmin',
    );
    await expect(
      marketplace.locator('[data-marketscope-controls]'),
    ).toHaveCount(1);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    const toggle = popup.getByRole('switch');
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await expect(
      marketplace.locator('[data-marketscope-controls]'),
    ).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toBeChecked();
    await expect(
      marketplace.locator('[data-marketscope-controls]'),
    ).toHaveCount(1);
  } finally {
    await context.close();
  }
});
