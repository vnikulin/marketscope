import { expect, test } from '@playwright/test';

import { signIn } from './helpers.js';

test('renders every primary view without horizontal overflow', async ({ page }) => {
  await signIn(page);
  for (const route of ['/', '/matches', '/favorites', '/history', '/blocked', '/watchlists', '/settings', '/diagnostics']) {
    await page.goto(`/#${route}`);
    await expect(page.locator('main')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${route} horizontal overflow`).toBeLessThanOrEqual(1);
  }
});
