import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';

import {
  listingLinks,
  parseListingLink,
} from '../../apps/extension/src/parser.js';
import { toMarketplaceListing } from '../../apps/extension/src/types.js';
import {
  closeTestServer,
  createAdmin,
  createExtensionToken,
  makeTestServer,
  type TestServer,
} from './helpers.js';

describe('extension to M3 ingest', () => {
  let testServer: TestServer | undefined;

  afterEach(async () => {
    if (testServer !== undefined) {
      await closeTestServer(testServer);
      testServer = undefined;
    }
  });

  it('stores a parsed real fixture through the extension API in SQLite', async () => {
    const fixture = readFileSync(
      resolve(import.meta.dirname, '../fixtures/marketplace/066-normal.html'),
      'utf8',
    );
    const dom = new JSDOM(fixture, {
      url: 'https://www.facebook.com/marketplace/search/',
    });
    const link = listingLinks(dom.window.document)[0];
    expect(link).toBeDefined();
    const parsed = parseListingLink(link as HTMLAnchorElement, 100);

    testServer = await makeTestServer();
    const admin = await createAdmin(testServer);
    const extension = await createExtensionToken(testServer, admin);
    const response = await testServer.server.app.inject({
      method: 'POST',
      url: '/api/extension/listings',
      headers: { authorization: `Bearer ${extension.token}` },
      payload: { listings: [toMarketplaceListing(parsed.listing)] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ observed: 1, newListings: 1 });
    expect(
      testServer.server.database
        .prepare('SELECT title, price_cents FROM listings')
        .get(),
    ).toEqual({ title: parsed.listing.title, price_cents: parsed.listing.price });
  });
});
