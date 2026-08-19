import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { createServer, type MarketScopeServer } from '../../apps/server/src/app.js';

describe('compiled web app serving', () => {
  let server: MarketScopeServer | undefined;
  let directory: string | undefined;

  afterEach(async () => {
    if (server !== undefined) await server.app.close();
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
  });

  test('serves the first-run shell, static assets, and SPA routes with safe cache headers', async () => {
    directory = mkdtempSync(join(tmpdir(), 'marketscope-web-'));
    const web = join(directory, 'web');
    mkdirSync(join(web, 'assets'), { recursive: true });
    writeFileSync(join(web, 'index.html'), '<!doctype html><title>MarketScope</title>');
    writeFileSync(join(web, 'sw.js'), 'self.addEventListener("fetch", () => {});');
    writeFileSync(join(web, 'assets', 'app.js'), 'document.title = "MarketScope";');
    server = await createServer({
      databasePath: join(directory, 'marketscope.db'),
      webDirectory: web,
      startRetention: false,
      startNotifications: false,
      thumbnailDirectory: join(directory, 'thumbnails'),
    });

    const root = await server.app.inject({ method: 'GET', url: '/' });
    expect(root.statusCode).toBe(200);
    expect(root.body).toContain('MarketScope');
    const route = await server.app.inject({ method: 'GET', url: '/watchlists/new' });
    expect(route.statusCode).toBe(200);
    expect(route.body).toContain('MarketScope');
    const worker = await server.app.inject({ method: 'GET', url: '/sw.js' });
    expect(worker.headers['cache-control']).toBe('no-cache');
    expect(worker.headers['service-worker-allowed']).toBe('/');
    const asset = await server.app.inject({ method: 'GET', url: '/assets/app.js' });
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    const api = await server.app.inject({ method: 'GET', url: '/api/listings' });
    expect(api.statusCode).toBe(428);
  });
});
