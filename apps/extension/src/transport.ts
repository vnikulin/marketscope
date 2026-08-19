import type { MarketplaceListing } from '@marketscope/shared-types';

import type {
  ConnectionSettings,
  ExtensionPreferences,
  ExtensionState,
  ExtensionWatchlist,
} from './types.js';

const PENDING_KEY = 'pendingListingUploads';
const CONNECTION_KEY = 'connection';
const WATCHLIST_KEY = 'cachedWatchlists';
const PREFERENCES_KEY = 'preferences';
const BATCH_DELAY_MS = 2_000;
const RETRY_DELAY_MS = 30_000;
const MAX_THUMBNAIL_BYTES = 200 * 1_024;

export interface KeyValueStorage {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
}

export type RequestFunction = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

function listingKey(listing: MarketplaceListing): string {
  return listing.sourceListingId || listing.url;
}

function normalizedServerUrl(serverUrl: string): string {
  return serverUrl.replace(/\/+$/, '');
}

export class ListingUploadQueue {
  readonly #sessionStorage: KeyValueStorage;
  readonly #localStorage: KeyValueStorage;
  readonly #request: RequestFunction;
  readonly #scheduleWake: ((delay: number) => void) | undefined;
  readonly #onUploaded:
    ((listings: readonly MarketplaceListing[]) => Promise<void>) | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #operation: Promise<void> = Promise.resolve();

  public constructor(
    sessionStorage: KeyValueStorage,
    localStorage: KeyValueStorage,
    request: RequestFunction,
    scheduleWake?: (delay: number) => void,
    onUploaded?: (listings: readonly MarketplaceListing[]) => Promise<void>,
  ) {
    this.#sessionStorage = sessionStorage;
    this.#localStorage = localStorage;
    this.#request = request;
    this.#scheduleWake = scheduleWake;
    this.#onUploaded = onUploaded;
  }

  public async recover(): Promise<void> {
    const pending = await this.pending();
    if (pending.length > 0) this.#schedule(0);
  }

  public enqueue(listings: readonly MarketplaceListing[]): Promise<void> {
    this.#operation = this.#operation.then(async () => {
      const pending = await this.pending();
      const byKey = new Map(
        pending.map((listing) => [listingKey(listing), listing]),
      );
      for (const listing of listings) byKey.set(listingKey(listing), listing);
      await this.#sessionStorage.set(PENDING_KEY, Array.from(byKey.values()));
      this.#schedule(BATCH_DELAY_MS);
    });
    return this.#operation;
  }

  public async pending(): Promise<MarketplaceListing[]> {
    return (
      (await this.#sessionStorage.get<MarketplaceListing[]>(PENDING_KEY)) ?? []
    );
  }

  public flush(): Promise<void> {
    this.#operation = this.#operation.then(async () => {
      const pending = await this.pending();
      if (pending.length === 0) return;
      const connection =
        await this.#localStorage.get<ConnectionSettings>(CONNECTION_KEY);
      if (connection === undefined) {
        this.#schedule(RETRY_DELAY_MS);
        return;
      }
      const batch = pending.slice(0, 500);
      try {
        const response = await this.#request(
          `${normalizedServerUrl(connection.serverUrl)}/api/extension/listings`,
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${connection.extensionToken}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ listings: batch }),
          },
        );
        if (!response.ok)
          throw new Error(`listing ingest returned ${response.status}`);
        try {
          await this.#onUploaded?.(batch);
        } catch {
          console.warn('MarketScope could not cache listing thumbnails');
        }
        const sentKeys = new Set(batch.map(listingKey));
        const latest = await this.pending();
        await this.#sessionStorage.set(
          PENDING_KEY,
          latest.filter((listing) => !sentKeys.has(listingKey(listing))),
        );
        if ((await this.pending()).length > 0) this.#schedule(0);
      } catch (error) {
        console.warn(
          'MarketScope server is unavailable; listings remain queued',
          error,
        );
        this.#schedule(RETRY_DELAY_MS);
      }
    });
    return this.#operation;
  }

  #schedule(delay: number): void {
    if (delay >= RETRY_DELAY_MS && this.#scheduleWake !== undefined) {
      this.#scheduleWake(delay);
      return;
    }
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.flush();
    }, delay);
  }
}

function normalizedImageUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== 'https:' ||
      (hostname !== 'fbcdn.net' && !hostname.endsWith('.fbcdn.net'))
    ) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8_192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8_192));
  }
  return btoa(binary);
}

export class ThumbnailUploader {
  readonly #localStorage: KeyValueStorage;
  readonly #request: RequestFunction;

  public constructor(localStorage: KeyValueStorage, request: RequestFunction) {
    this.#localStorage = localStorage;
    this.#request = request;
  }

  public async upload(listings: readonly MarketplaceListing[]): Promise<void> {
    const connection =
      await this.#localStorage.get<ConnectionSettings>(CONNECTION_KEY);
    if (connection === undefined) return;
    for (const listing of listings) {
      const imageUrl =
        listing.imageUrl === undefined
          ? undefined
          : normalizedImageUrl(listing.imageUrl);
      if (imageUrl === undefined) continue;
      try {
        const imageResponse = await this.#request(imageUrl, {
          method: 'GET',
          credentials: 'omit',
        });
        const contentLength = Number(
          imageResponse.headers.get('content-length'),
        );
        if (
          !imageResponse.ok ||
          imageResponse.headers.get('content-type')?.split(';', 1)[0] !==
            'image/jpeg' ||
          (Number.isFinite(contentLength) &&
            contentLength > MAX_THUMBNAIL_BYTES)
        ) {
          continue;
        }
        const bytes = new Uint8Array(await imageResponse.arrayBuffer());
        if (bytes.byteLength > MAX_THUMBNAIL_BYTES) continue;
        const uploadResponse = await this.#request(
          `${normalizedServerUrl(connection.serverUrl)}/api/extension/thumbnails`,
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${connection.extensionToken}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              sourceListingId: listing.sourceListingId,
              url: listing.url,
              jpegBase64: bytesToBase64(bytes),
            }),
          },
        );
        if (!uploadResponse.ok) {
          console.warn('MarketScope could not cache a listing thumbnail');
        }
      } catch {
        console.warn('MarketScope could not cache a listing thumbnail');
      }
    }
  }
}

const DEFAULT_PREFERENCES: ExtensionPreferences = {
  displayMode: 'HIDE',
  showBlocked: false,
};

export async function getExtensionState(
  localStorage: KeyValueStorage,
  request: RequestFunction,
): Promise<ExtensionState> {
  const preferences =
    (await localStorage.get<ExtensionPreferences>(PREFERENCES_KEY)) ??
    DEFAULT_PREFERENCES;
  let watchlists =
    (await localStorage.get<ExtensionWatchlist[]>(WATCHLIST_KEY)) ?? [];
  const connection = await localStorage.get<ConnectionSettings>(CONNECTION_KEY);
  if (connection !== undefined) {
    try {
      const response = await request(
        `${normalizedServerUrl(connection.serverUrl)}/api/extension/watchlists`,
        { headers: { authorization: `Bearer ${connection.extensionToken}` } },
      );
      if (!response.ok)
        throw new Error(`watchlist request returned ${response.status}`);
      const body = (await response.json()) as { watchlists?: unknown };
      if (!Array.isArray(body.watchlists)) {
        throw new Error('watchlist response did not contain an array');
      }
      watchlists = body.watchlists as ExtensionWatchlist[];
      await localStorage.set(WATCHLIST_KEY, watchlists);
    } catch (error) {
      console.warn(
        'MarketScope is using cached watchlists while offline',
        error,
      );
    }
  }
  return { watchlists, preferences };
}

export async function setPreferences(
  localStorage: KeyValueStorage,
  preferences: ExtensionPreferences,
): Promise<void> {
  await localStorage.set(PREFERENCES_KEY, preferences);
}

export const transportKeys = {
  connection: CONNECTION_KEY,
  pending: PENDING_KEY,
  preferences: PREFERENCES_KEY,
  watchlists: WATCHLIST_KEY,
} as const;
