import { expect, test } from '@playwright/test';

import { signIn } from './helpers.js';

test('renders every primary view without horizontal overflow', async ({
  page,
}) => {
  await signIn(page);
  for (const route of [
    '/',
    '/matches',
    '/favorites',
    '/history',
    '/blocked',
    '/watchlists',
    '/settings',
    '/diagnostics',
  ]) {
    await page.goto(`/#${route}`);
    await expect(page.locator('main')).toBeVisible();
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow, `${route} horizontal overflow`).toBeLessThanOrEqual(1);
  }

  await page.goto('/#/matches');
  await page.getByRole('button', { name: 'Details', exact: true }).click();
  const card = page.locator('.listing-card').first();
  const detailsCard = await card.boundingBox();
  const detailsImage = await card.locator('.listing-image').boundingBox();

  await page.getByRole('button', { name: 'Tiles', exact: true }).click();
  const tileCard = await card.boundingBox();
  const tileImage = await card.locator('.listing-image').boundingBox();

  expect(detailsCard).not.toBeNull();
  expect(detailsImage).not.toBeNull();
  expect(tileCard).not.toBeNull();
  expect(tileImage).not.toBeNull();
  expect(tileCard?.width ?? Number.POSITIVE_INFINITY).toBeLessThan(
    (detailsCard?.width ?? 0) * 0.75,
  );
  expect(tileImage?.height ?? Number.POSITIVE_INFINITY).toBeLessThan(
    detailsImage?.height ?? 0,
  );
});
