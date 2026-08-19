import { expect, test } from '@playwright/test';

import { signIn } from './helpers.js';

test('covers the complete PWA workflow', async ({
  page,
  context,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop',
    'Full workflow runs once; viewport coverage has a focused test.',
  );
  await signIn(page);
  await expect(
    page.getByRole('link', { name: 'New watchlist' }),
  ).toHaveAttribute('href', '#/watchlists/new');

  await page.goto('/#/matches');
  await expect(
    page.getByRole('heading', { name: 'Garmin GPSMAP 1042xsv' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'WHY' }).click();
  await expect(page.getByText('Filter breakdown')).toBeVisible();
  await expect(page.getByText('FINAL')).toHaveCount(0);

  await page.goto('/#/blocked');
  await expect(
    page.getByRole('heading', {
      name: '<img src=x onerror=alert(1)> Garmin case',
    }),
  ).toBeVisible();
  await expect(page.locator('img[src="x"]')).toHaveCount(0);

  await page.goto('/#/history');
  const favorite = page
    .getByRole('heading', { name: 'Garmin GPSMAP 1042xsv' })
    .locator('xpath=ancestor::article')
    .getByRole('button', { name: 'Add to favorites' });
  await favorite.click();
  await page.goto('/#/favorites');
  await expect(
    page.getByRole('heading', { name: 'Garmin GPSMAP 1042xsv' }),
  ).toBeVisible();

  await page.goto('/#/watchlists/new');
  await page.getByLabel('Name').fill('Test boats');
  await page
    .getByLabel('Marketplace search URL')
    .fill('https://www.facebook.com/marketplace/search/?query=boat');
  await page
    .getByLabel('Required terms, comma separated')
    .fill('boat, trailer');
  await page.getByRole('button', { name: 'Save watchlist' }).click();
  await expect(page.getByRole('heading', { name: 'Test boats' })).toBeVisible();
  const card = page
    .getByRole('heading', { name: 'Test boats', exact: true })
    .locator('xpath=ancestor::article');
  await expect(card.getByRole('link', { name: 'Open search' })).toHaveAttribute(
    'href',
    'https://www.facebook.com/marketplace/search/?query=boat',
  );
  await card.getByRole('link', { name: 'Edit' }).click();
  await page.getByLabel('Name').fill('Test boats edited');
  await page.getByRole('button', { name: 'Save watchlist' }).click();
  const edited = page
    .getByRole('heading', { name: 'Test boats edited', exact: true })
    .locator('xpath=ancestor::article');
  await edited.getByRole('button', { name: 'Duplicate' }).click();
  await expect(
    page.getByRole('heading', { name: 'Test boats edited (copy)' }),
  ).toBeVisible();
  await edited.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByText('Watchlist paused.')).toBeVisible();
  await page
    .getByRole('heading', { name: 'Test boats edited', exact: true })
    .locator('xpath=ancestor::article')
    .getByRole('button', { name: 'Resume' })
    .click();
  await expect(page.getByText('Watchlist resumed.')).toBeVisible();
  page.on('dialog', (dialog) => void dialog.accept());
  await page
    .getByRole('heading', { name: 'Test boats edited (copy)', exact: true })
    .locator('xpath=ancestor::article')
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Test boats edited (copy)' }),
  ).toHaveCount(0);

  await page.goto('/#/settings');
  await page.getByLabel('Provider').selectOption('CUSTOM');
  await page.getByLabel('Hostname').fill('127.0.0.1');
  await page.getByLabel('Port').fill('1025');
  await page.getByLabel('Security').selectOption('NONE');
  await page.getByLabel('Sender').fill('marketscope@example.com');
  await page
    .getByLabel('Recipients, comma separated')
    .fill('owner@example.com');
  await page.getByRole('button', { name: 'Save email settings' }).click();
  await page.getByRole('button', { name: 'Send test email' }).click();
  await expect(page.getByText('Test email sent successfully.')).toBeVisible();

  await page.goto('/#/diagnostics');
  await expect(page.getByText('Notification queue')).toBeVisible();
  const diagnosticsDownload = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Export diagnostics' }).click();
  expect((await diagnosticsDownload).suggestedFilename()).toMatch(
    /^marketscope-diagnostics-/,
  );

  await page.goto('/#/settings');
  const backupDownload = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download backup' }).click();
  const download = await backupDownload;
  expect(download.suggestedFilename()).toMatch(/^marketscope-backup-/);
  const backupPath = await download.path();
  expect(backupPath).not.toBeNull();
  await page
    .getByLabel('MarketScope backup file')
    .setInputFiles(backupPath ?? '');
  await page.getByRole('button', { name: 'Restore backup' }).click();
  await expect(page.getByText('Backup restored.')).toBeVisible();

  const manifest = await page.request.get('/manifest.webmanifest');
  expect(manifest.ok()).toBeTruthy();
  const manifestBody = (await manifest.json()) as {
    display: string;
    icons: unknown[];
  };
  expect(manifestBody.display).toBe('standalone');
  expect(manifestBody.icons).toHaveLength(3);
  const registration = await page.evaluate(async () => {
    const existing = await navigator.serviceWorker.getRegistration();
    return existing?.active?.scriptURL ?? null;
  });
  expect(registration).toContain('/sw.js');
  expect(await context.cookies()).toContainEqual(
    expect.objectContaining({
      name: 'marketscope_session',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    }),
  );
});
