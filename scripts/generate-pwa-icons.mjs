import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { chromium } from '@playwright/test';

const root = resolve('apps/web/public');
const icons = [
  ['icon-192.svg', 'icon-192.png', 192],
  ['icon-512.svg', 'icon-512.png', 512],
  ['icon-maskable.svg', 'icon-maskable.png', 512],
];
const browser = await chromium.launch({ headless: true });
try {
  for (const [source, target, size] of icons) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(await readFile(resolve(root, source), 'utf8'));
    await page.locator('svg').screenshot({ path: resolve(root, target), omitBackground: true });
    await page.close();
  }
} finally {
  await browser.close();
}
