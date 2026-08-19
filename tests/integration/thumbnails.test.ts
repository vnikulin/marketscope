import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ThumbnailCache } from '../../apps/server/src/thumbnails.js';
import {
  closeTestServer,
  createAdmin,
  createExtensionToken,
  listing,
  makeTestServer,
  type TestServer,
} from './helpers.js';

const JPEG_ONE = Buffer.from([0xff, 0xd8, 0xff, 0x01, 0xd9]);
const JPEG_TWO = Buffer.from([0xff, 0xd8, 0xff, 0x02, 0xd9]);

describe('thumbnail cache', () => {
  let testServer: TestServer | undefined;

  afterEach(async () => {
    if (testServer !== undefined) {
      await closeTestServer(testServer);
      testServer = undefined;
    }
  });

  it('stores extension-uploaded JPEGs by hash and serves them locally', async () => {
    testServer = await makeTestServer();
    const session = await createAdmin(testServer);
    const extension = await createExtensionToken(testServer, session);
    const headers = { authorization: `Bearer ${extension.token}` };
    const observed = await testServer.server.app.inject({
      method: 'POST',
      url: '/api/extension/listings',
      headers,
      payload: { listings: [listing('thumbnail')] },
    });
    expect(observed.statusCode).toBe(200);

    const uploaded = await testServer.server.app.inject({
      method: 'POST',
      url: '/api/extension/thumbnails',
      headers,
      payload: {
        sourceListingId: 'thumbnail',
        url: 'https://www.facebook.com/marketplace/item/thumbnail/?tracking=1',
        jpegBase64: JPEG_ONE.toString('base64'),
      },
    });
    const hash = createHash('sha256').update(JPEG_ONE).digest('hex');
    expect(uploaded.statusCode).toBe(201);
    expect(uploaded.json()).toEqual({ hash });
    expect(
      testServer.server.database
        .prepare('SELECT image_hash AS imageHash FROM listings')
        .get(),
    ).toEqual({ imageHash: hash });

    const served = await testServer.server.app.inject({
      method: 'GET',
      url: `/api/thumbnails/${hash}.jpg`,
    });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toContain('image/jpeg');
    expect(served.rawPayload).toEqual(JPEG_ONE);
  });

  it('evicts the least recently used file when the cache exceeds its cap', () => {
    const directory = mkdtempSync(join(tmpdir(), 'marketscope-thumbnails-'));
    try {
      const cache = new ThumbnailCache(directory, JPEG_ONE.byteLength);
      const firstHash = cache.store(JPEG_ONE);
      const secondHash = cache.store(JPEG_TWO);
      expect(existsSync(cache.path(firstHash))).toBe(false);
      expect(cache.read(secondHash)).toEqual(JPEG_TWO);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
