import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

interface FetchEventLike {
  request: { url: string; mode: string };
  respondWith(response: Promise<Response>): void;
}

describe('PWA service worker', () => {
  it('uses a fresh app shell for navigations and updates the fallback', async () => {
    const source = readFileSync(
      new URL('../public/sw.js', import.meta.url),
      'utf8',
    );
    let fetchListener: ((event: FetchEventLike) => void) | undefined;
    const put = vi.fn(async () => undefined);
    const fetchFresh = vi.fn(async () => new Response('fresh shell'));
    runInNewContext(source, {
      URL,
      Error,
      fetch: fetchFresh,
      caches: {
        match: vi.fn(async () => new Response('stale shell')),
        open: vi.fn(async () => ({ put })),
      },
      self: {
        addEventListener: (
          type: string,
          listener: (event: FetchEventLike) => void,
        ) => {
          if (type === 'fetch') fetchListener = listener;
        },
        skipWaiting: vi.fn(),
        location: { origin: 'http://127.0.0.1:3000' },
        clients: { claim: vi.fn() },
      },
    });
    if (fetchListener === undefined)
      throw new Error('Fetch listener is missing');
    let response: Promise<Response> | undefined;

    fetchListener({
      request: { url: 'http://127.0.0.1:3000/', mode: 'navigate' },
      respondWith: (value) => {
        response = value;
      },
    });

    expect(response).toBeDefined();
    expect(await (await response)?.text()).toBe('fresh shell');
    expect(fetchFresh).toHaveBeenCalledOnce();
    expect(put).toHaveBeenCalledOnce();
  });
});
