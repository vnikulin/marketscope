import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  adminHeaders,
  closeTestServer,
  createAdmin,
  createExtensionToken,
  createWatchlist,
  listing,
  makeTestServer,
  type AdminSession,
  type TestServer,
} from './helpers.js';

describe('PWA API', () => {
  let testServer: TestServer;
  let session: AdminSession;

  beforeEach(async () => {
    testServer = await makeTestServer();
    session = await createAdmin(testServer);
    await createWatchlist(testServer, session);
    const extension = await createExtensionToken(testServer, session);
    const response = await testServer.server.app.inject({
      method: 'POST',
      url: '/api/extension/listings',
      headers: { authorization: `Bearer ${extension.token}` },
      payload: {
        listings: [
          listing('pwa-pass'),
          listing('pwa-block', { title: 'Garmin case', rawText: 'Garmin case $120 Freeport, NY' }),
        ],
      },
    });
    expect(response.statusCode).toBe(200);
  });

  afterEach(async () => closeTestServer(testServer));

  test('projects matches, blocked listings, favorites, dashboard, and diagnostics', async () => {
    const matches = await testServer.server.app.inject({ method: 'GET', url: '/api/listings?view=matches', headers: adminHeaders(session) });
    expect(matches.statusCode).toBe(200);
    const matchedListings = matches.json<{ listings: Array<{ id: string; title: string; evaluations: Array<{ verdict: { passed: boolean } }> }> }>().listings;
    expect(matchedListings).toHaveLength(1);
    expect(matchedListings[0]?.title).toBe('Garmin GPSMAP 1042xsv');
    expect(matchedListings[0]?.evaluations[0]?.verdict.passed).toBe(true);

    const blocked = await testServer.server.app.inject({ method: 'GET', url: '/api/listings?view=blocked', headers: adminHeaders(session) });
    expect(blocked.json<{ listings: unknown[] }>().listings).toHaveLength(1);

    const listingId = matchedListings[0]?.id;
    expect(listingId).toBeDefined();
    const favorite = await testServer.server.app.inject({ method: 'PUT', url: `/api/listings/${listingId}/favorite`, headers: adminHeaders(session) });
    expect(favorite.statusCode).toBe(200);
    const favorites = await testServer.server.app.inject({ method: 'GET', url: '/api/listings?view=favorites', headers: adminHeaders(session) });
    expect(favorites.json<{ listings: unknown[] }>().listings).toHaveLength(1);

    const dashboard = await testServer.server.app.inject({ method: 'GET', url: '/api/dashboard', headers: adminHeaders(session) });
    expect(dashboard.json<{ matches: number; blocked: number; favorites: number }>()).toMatchObject({ matches: 1, blocked: 1, favorites: 1 });
    const diagnostics = await testServer.server.app.inject({ method: 'GET', url: '/api/diagnostics', headers: adminHeaders(session) });
    expect(diagnostics.json()).toMatchObject({ database: { status: 'ok', journalMode: 'wal' }, listingsLast24Hours: 2, notificationQueueDepth: 0 });
  });

  test('backs up without SMTP secrets and restores after a validated snapshot', async () => {
    const listings = await testServer.server.app.inject({ method: 'GET', url: '/api/listings?view=history', headers: adminHeaders(session) });
    const favoriteId = listings.json<{ listings: Array<{ id: string }> }>().listings[0]?.id;
    expect(favoriteId).toBeDefined();
    await testServer.server.app.inject({ method: 'PUT', url: `/api/listings/${favoriteId}/favorite`, headers: adminHeaders(session) });
    const email = await testServer.server.app.inject({
      method: 'PUT',
      url: '/api/settings/email',
      headers: adminHeaders(session),
      payload: {
        preset: 'CUSTOM', hostname: 'localhost', port: 1025, security: 'NONE', username: 'owner', password: 'smtp-secret-value', sender: 'marketscope@example.com', recipients: ['owner@example.com'],
      },
    });
    expect(email.statusCode).toBe(200);
    const backupResponse = await testServer.server.app.inject({ method: 'GET', url: '/api/backup?includeHistory=false', headers: adminHeaders(session) });
    expect(backupResponse.statusCode).toBe(200);
    expect(backupResponse.body).not.toContain('smtp-secret-value');
    const backup = backupResponse.json<Record<string, unknown>>();

    const invalid = await testServer.server.app.inject({ method: 'POST', url: '/api/restore', headers: adminHeaders(session), payload: { version: 99 } });
    expect(invalid.statusCode).toBe(400);

    const restored = await testServer.server.app.inject({ method: 'POST', url: '/api/restore', headers: adminHeaders(session), payload: backup });
    expect(restored.statusCode).toBe(200);
    const result = restored.json<{ restored: boolean; listings: number; snapshot: string }>();
    expect(result).toMatchObject({ restored: true, listings: 1, favorites: 1 });
    expect(existsSync(join(testServer.directory, 'backups', result.snapshot))).toBe(true);
    const history = await testServer.server.app.inject({ method: 'GET', url: '/api/listings?view=history', headers: adminHeaders(session) });
    expect(history.json<{ listings: unknown[] }>().listings).toHaveLength(1);
    const favorites = await testServer.server.app.inject({ method: 'GET', url: '/api/listings?view=favorites', headers: adminHeaders(session) });
    expect(favorites.json<{ listings: unknown[] }>().listings).toHaveLength(1);
  });
});
