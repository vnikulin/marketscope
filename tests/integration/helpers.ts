import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { LightMyRequestResponse } from 'fastify';

import {
  createServer,
  type MarketScopeServer,
} from '../../apps/server/src/app.js';
import type { SendMail } from '../../apps/server/src/email.js';
import type { WatchlistInput } from '../../apps/server/src/types.js';

export interface TestServer {
  server: MarketScopeServer;
  directory: string;
  databasePath: string;
  clock: { now: number };
}

export interface AdminSession {
  cookie: string;
  csrfToken: string;
}

export const VALID_WATCHLIST: WatchlistInput = {
  name: 'Garmin chartplotters',
  searchUrl: 'https://www.facebook.com/marketplace/search/?query=garmin',
  termMode: 'ALL',
  requiredTerms: ['garmin'],
  optionalTerms: ['gpsmap'],
  excludedTerms: ['case'],
  regexPatterns: [],
  priceRules: { maxCents: 100_000, unknownPolicy: 'BLOCK' },
  locationRules: { allowedStates: ['NY'], unknownPolicy: 'BLOCK' },
  listingTypeRules: { sponsored: 'BLOCK', shipping: 'ALLOW' },
  relevanceThreshold: 0,
  emailEnabled: true,
  enabled: true,
  ignoreOlderThanDays: 30,
  alertOnPriceChange: 'DECREASE',
};

export function responseCookie(response: LightMyRequestResponse): string {
  const header = response.headers['set-cookie'];
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined) {
    throw new Error('Response did not set a cookie');
  }
  const cookie = value.split(';', 1)[0];
  if (cookie === undefined) {
    throw new Error('Response cookie was empty');
  }
  return cookie;
}

export async function makeTestServer(
  initialNow = Date.UTC(2026, 7, 18, 16, 0, 0),
  options: { sendMail?: SendMail } = {},
): Promise<TestServer> {
  const directory = mkdtempSync(join(tmpdir(), 'marketscope-integration-'));
  const databasePath = join(directory, 'marketscope.db');
  const clock = { now: initialNow };
  const server = await createServer({
    databasePath,
    now: () => clock.now,
    startRetention: false,
    startNotifications: false,
    thumbnailDirectory: join(directory, 'thumbnails'),
    ...options,
  });
  return { server, directory, databasePath, clock };
}

export async function closeTestServer(testServer: TestServer): Promise<void> {
  await testServer.server.app.close();
  rmSync(testServer.directory, { recursive: true, force: true });
}

export async function preflight(testServer: TestServer): Promise<string> {
  const response = await testServer.server.app.inject({
    method: 'GET',
    url: '/api/auth/preflight',
  });
  if (response.statusCode !== 200) {
    throw new Error(`Preflight failed with ${response.statusCode}`);
  }
  return response.json<{ csrfToken: string }>().csrfToken;
}

export async function createAdmin(
  testServer: TestServer,
): Promise<AdminSession> {
  const response = await testServer.server.app.inject({
    method: 'POST',
    url: '/api/setup',
    headers: { 'x-csrf-token': await preflight(testServer) },
    payload: {
      username: 'admin',
      password: 'correct horse battery staple',
    },
  });
  if (response.statusCode !== 201) {
    throw new Error(
      `Admin setup failed with ${response.statusCode}: ${response.body}`,
    );
  }
  return {
    cookie: responseCookie(response),
    csrfToken: response.json<{ csrfToken: string }>().csrfToken,
  };
}

export function adminHeaders(session: AdminSession): Record<string, string> {
  return {
    cookie: session.cookie,
    'x-csrf-token': session.csrfToken,
  };
}

export async function createWatchlist(
  testServer: TestServer,
  session: AdminSession,
  input: WatchlistInput = VALID_WATCHLIST,
): Promise<{ id: string; seeded: boolean; enabled: boolean; name: string }> {
  const response = await testServer.server.app.inject({
    method: 'POST',
    url: '/api/watchlists',
    headers: adminHeaders(session),
    payload: input,
  });
  if (response.statusCode !== 201) {
    throw new Error(`Watchlist create failed: ${response.body}`);
  }
  return response.json();
}

export async function createExtensionToken(
  testServer: TestServer,
  session: AdminSession,
): Promise<{ id: string; token: string }> {
  const response = await testServer.server.app.inject({
    method: 'POST',
    url: '/api/extension-tokens',
    headers: adminHeaders(session),
    payload: { name: 'Test browser' },
  });
  if (response.statusCode !== 201) {
    throw new Error(`Extension token create failed: ${response.body}`);
  }
  return response.json();
}

export function listing(
  sourceListingId: string | undefined,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    source: 'facebook',
    ...(sourceListingId === undefined ? {} : { sourceListingId }),
    url:
      sourceListingId === undefined
        ? 'https://www.facebook.com/marketplace/item/fallback/?tracking=1'
        : `https://www.facebook.com/marketplace/item/${sourceListingId}/?tracking=1`,
    title: 'Garmin GPSMAP 1042xsv',
    description: 'Excellent condition',
    price: 50_000,
    priceText: '$500',
    location: 'Freeport, NY',
    distanceMiles: 8,
    sellerName: 'Seller',
    sponsored: false,
    shipping: false,
    localPickup: true,
    postedAtText: 'Listed 2 hours ago',
    postedAtEstimate: Date.UTC(2026, 7, 18, 14, 0, 0),
    rawText: 'Garmin GPSMAP 1042xsv $500 Freeport, NY',
    ...overrides,
  };
}
