import type { MarketplaceListing } from '@marketscope/shared-types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getExtensionState,
  type KeyValueStorage,
  ListingUploadQueue,
  transportKeys,
} from '../src/transport.js';
import type { ConnectionSettings, ExtensionWatchlist } from '../src/types.js';

class MemoryStorage implements KeyValueStorage {
  readonly values = new Map<string, unknown>();

  public async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  public async set<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }
}

function listing(id: string): MarketplaceListing {
  return {
    source: 'facebook',
    sourceListingId: id,
    url: `https://www.facebook.com/marketplace/item/${id}/`,
    title: `Listing ${id}`,
    sponsored: false,
    shipping: false,
    rawText: `Listing ${id}`,
    firstSeen: 1,
    lastSeen: 1,
  };
}

const connection: ConnectionSettings = {
  serverUrl: 'https://marketscope.example.ts.net/',
  extensionToken: 'secret-token',
};

describe('service worker transport', () => {
  afterEach(() => vi.useRealTimers());

  it('persists a batch before the two second upload debounce', async () => {
    vi.useFakeTimers();
    const session = new MemoryStorage();
    const local = new MemoryStorage();
    await local.set(transportKeys.connection, connection);
    const request = vi.fn(async () => new Response(null, { status: 200 }));
    const queue = new ListingUploadQueue(session, local, request);

    await queue.enqueue([listing('1')]);
    expect(await queue.pending()).toHaveLength(1);
    expect(request).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(request).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await queue.flush();
    expect(request).toHaveBeenCalledTimes(1);
    expect(await queue.pending()).toEqual([]);
  });

  it('recovers a pending upload after a service worker restart', async () => {
    vi.useFakeTimers();
    const session = new MemoryStorage();
    const local = new MemoryStorage();
    await local.set(transportKeys.connection, connection);
    const firstWorker = new ListingUploadQueue(
      session,
      local,
      async () => new Response(null, { status: 500 }),
    );
    await firstWorker.enqueue([listing('restart')]);

    const request = vi.fn(async () => new Response(null, { status: 200 }));
    const restartedWorker = new ListingUploadQueue(session, local, request);
    await restartedWorker.recover();
    await vi.advanceTimersByTimeAsync(0);
    await restartedWorker.flush();
    expect(request).toHaveBeenCalledTimes(1);
    expect(await restartedWorker.pending()).toEqual([]);
  });

  it('keeps queued listings and cached watchlists while offline', async () => {
    vi.useFakeTimers();
    const session = new MemoryStorage();
    const local = new MemoryStorage();
    await local.set(transportKeys.connection, connection);
    const cached = [{ id: 'cached', name: 'Cached', enabled: true }] as ExtensionWatchlist[];
    await local.set(transportKeys.watchlists, cached);
    const request = vi.fn(async () => {
      throw new Error('offline');
    });
    const queue = new ListingUploadQueue(session, local, request);
    await queue.enqueue([listing('offline')]);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await queue.pending()).toHaveLength(1);

    await expect(getExtensionState(local, request)).resolves.toMatchObject({
      watchlists: cached,
      preferences: { displayMode: 'HIDE', showBlocked: false },
    });
  });

  it('requests a persistent wakeup after an offline upload fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const session = new MemoryStorage();
    const local = new MemoryStorage();
    await local.set(transportKeys.connection, connection);
    const scheduleWake = vi.fn();
    const queue = new ListingUploadQueue(
      session,
      local,
      async () => {
        throw new Error('offline');
      },
      scheduleWake,
    );
    await queue.enqueue([listing('wake')]);
    await queue.flush();
    expect(scheduleWake).toHaveBeenCalledWith(30_000);
    expect(await queue.pending()).toHaveLength(1);
  });
});
