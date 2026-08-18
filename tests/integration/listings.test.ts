import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import {
  pruneListings,
  setRetentionDays,
} from '../../apps/server/src/retention.js';
import {
  closeTestServer,
  createAdmin,
  createExtensionToken,
  createWatchlist,
  listing,
  makeTestServer,
  type TestServer,
} from './helpers.js';

describe('listing ingest and retention', () => {
  let testServer: TestServer | undefined;

  afterEach(async () => {
    if (testServer !== undefined) {
      await closeTestServer(testServer);
      testServer = undefined;
    }
  });

  it('deduplicates listings, records price history, and seeds silently', async () => {
    testServer = await makeTestServer();
    const session = await createAdmin(testServer);
    const watchlist = await createWatchlist(testServer, session);
    const extension = await createExtensionToken(testServer, session);
    const headers = { authorization: `Bearer ${extension.token}` };

    const first = await testServer.server.app.inject({
      method: 'POST',
      url: '/api/extension/listings',
      headers,
      payload: {
        listings: [
          listing('1001'),
          listing('1002', {
            title: 'Protective case only',
            rawText: 'Garmin protective case only $25 Freeport, NY',
            price: 2_500,
          }),
        ],
      },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({
      observed: 2,
      newListings: 2,
      priceChanges: 0,
      seededWatchlists: [
        {
          id: watchlist.id,
          name: watchlist.name,
          observed: 2,
          message:
            'Seeded 2 listings. Notifications begin with the next new match.',
        },
      ],
    });
    expect(
      testServer.server.database.prepare('SELECT seeded FROM watchlists').get(),
    ).toEqual({ seeded: 1 });
    expect(
      testServer.server.database
        .prepare('SELECT COUNT(*) AS count FROM notifications')
        .get(),
    ).toEqual({ count: 0 });
    expect(
      testServer.server.database
        .prepare('SELECT COUNT(*) AS count FROM watchlist_matches')
        .get(),
    ).toEqual({ count: 2 });
    const verdicts = testServer.server.database
      .prepare('SELECT verdict_json FROM watchlist_matches ORDER BY listing_id')
      .all()
      .map(
        (row) =>
          JSON.parse((row as { verdict_json: string }).verdict_json) as {
            passed: boolean;
          },
      );
    expect(verdicts.map((verdict) => verdict.passed).sort()).toEqual([
      false,
      true,
    ]);

    testServer.clock.now += 60_000;
    const second = await testServer.server.app.inject({
      method: 'POST',
      url: '/api/extension/listings',
      headers,
      payload: {
        listings: [
          listing('1001', {
            url: 'https://www.facebook.com/marketplace/item/1001/?different=tracking',
            price: 45_000,
            priceText: '$450',
          }),
        ],
      },
    });
    expect(second.json()).toMatchObject({
      observed: 1,
      newListings: 0,
      priceChanges: 1,
      seededWatchlists: [],
    });
    expect(
      testServer.server.database
        .prepare('SELECT COUNT(*) AS count FROM listings')
        .get(),
    ).toEqual({ count: 2 });

    const stored = testServer.server.database
      .prepare(
        `SELECT id, canonical_url, first_seen, last_seen
         FROM listings WHERE source_listing_id = '1001'`,
      )
      .get() as {
      id: string;
      canonical_url: string;
      first_seen: number;
      last_seen: number;
    };
    expect(stored.canonical_url).toBe(
      'https://www.facebook.com/marketplace/item/1001/',
    );
    expect(stored.last_seen - stored.first_seen).toBe(60_000);
    expect(
      testServer.server.database
        .prepare(
          'SELECT price_cents AS price FROM listing_price_history WHERE listing_id = ? ORDER BY id',
        )
        .all(stored.id),
    ).toEqual([{ price: 50_000 }, { price: 45_000 }]);
  });

  it('uses the canonical URL fallback when a source ID is unavailable', async () => {
    testServer = await makeTestServer();
    const session = await createAdmin(testServer);
    const extension = await createExtensionToken(testServer, session);
    const headers = { authorization: `Bearer ${extension.token}` };

    for (const tracking of ['one', 'two']) {
      const response = await testServer.server.app.inject({
        method: 'POST',
        url: '/api/extension/listings',
        headers,
        payload: {
          listings: [
            listing(undefined, {
              url: `https://www.facebook.com/marketplace/item/fallback/?tracking=${tracking}`,
            }),
          ],
        },
      });
      expect(response.statusCode).toBe(200);
    }
    expect(
      testServer.server.database
        .prepare('SELECT COUNT(*) AS count FROM listings')
        .get(),
    ).toEqual({ count: 1 });
  });

  it('prunes expired listings except favorites and ignore-rule references', async () => {
    testServer = await makeTestServer();
    const database = testServer.server.database;
    const old = testServer.clock.now - 31 * 24 * 60 * 60 * 1_000;
    const recent = testServer.clock.now - 29 * 24 * 60 * 60 * 1_000;

    const insert = database.prepare(
      `INSERT INTO listings (
        id, source, listing_key, canonical_url, title, sponsored, shipping,
        raw_text, first_seen, last_seen
      ) VALUES (?, 'facebook', ?, ?, ?, 0, 0, ?, ?, ?)`,
    );
    const ids = {
      expired: randomUUID(),
      favorite: randomUUID(),
      ignored: randomUUID(),
      recent: randomUUID(),
    };
    for (const [kind, id] of Object.entries(ids)) {
      const timestamp = kind === 'recent' ? recent : old;
      insert.run(
        id,
        `id:${id}`,
        `https://www.facebook.com/marketplace/item/${id}/`,
        kind,
        kind,
        timestamp,
        timestamp,
      );
    }
    database
      .prepare('INSERT INTO favorites (listing_id, created_at) VALUES (?, ?)')
      .run(ids.favorite, testServer.clock.now);
    database
      .prepare(
        'INSERT INTO ignore_rules (id, listing_id, rule_json, created_at) VALUES (?, ?, ?, ?)',
      )
      .run(randomUUID(), ids.ignored, '{}', testServer.clock.now);

    setRetentionDays(database, 30, testServer.clock.now);
    expect(pruneListings(database, testServer.clock.now)).toBe(1);
    const remaining = database
      .prepare('SELECT id FROM listings ORDER BY id')
      .all()
      .map((row) => (row as { id: string }).id);
    expect(remaining).toEqual([ids.favorite, ids.ignored, ids.recent].sort());

    setRetentionDays(database, null, testServer.clock.now);
    expect(pruneListings(database, testServer.clock.now)).toBe(0);
  });
});
