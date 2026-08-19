import { expect, test } from '@playwright/test';

import { signIn } from './helpers.js';

test('replaces a stale cached app shell on navigation', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop',
    'The service-worker update regression runs once.',
  );
  await signIn(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller === null) {
      await new Promise<void>((resolve) => {
        navigator.serviceWorker.addEventListener(
          'controllerchange',
          () => resolve(),
          { once: true },
        );
      });
    }
    const names = await caches.keys();
    const shellName = names.find((name) =>
      name.startsWith('marketscope-shell-'),
    );
    if (shellName === undefined) throw new Error('App shell cache is missing');
    const cache = await caches.open(shellName);
    await cache.put(
      '/',
      new Response(
        '<!doctype html><title>Stale</title><h1>Stale MarketScope shell</h1>',
        { headers: { 'content-type': 'text/html' } },
      ),
    );
  });

  await page.goto('/#/blocked');

  await expect(page.getByRole('heading', { name: 'Blocked' })).toBeVisible();
  await expect(page.getByText('Stale MarketScope shell')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Clear blocked results' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Details', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'List', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tiles' })).toBeVisible();
});
