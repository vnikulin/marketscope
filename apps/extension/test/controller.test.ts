import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MarketplaceController } from '../src/controller.js';
import { listingLinks } from '../src/parser.js';

describe('Marketplace controller', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('processes each listing ID once and batches uploads', async () => {
    const dom = new JSDOM(
      '<body><a href="/marketplace/item/42/"><span>$5</span><span aria-hidden="true">First title</span></a><a href="/marketplace/item/42/"><span>$5</span><span aria-hidden="true">Duplicate title</span></a></body>',
      { url: 'https://www.facebook.com/marketplace/' },
    );
    const uploads: unknown[][] = [];
    const controller = new MarketplaceController(
      dom.window.document,
      { displayMode: 'HIDE', showBlocked: false },
      { sendListings: (listings) => uploads.push(listings), now: () => 100 },
    );
    controller.enqueueLinks(listingLinks(dom.window.document));
    await controller.flush();
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toHaveLength(1);
  });

  it('finishes the current batch, then stops when failures exceed 40 percent', async () => {
    const dom = new JSDOM(
      '<body><a href="https://example.com/marketplace/item/bad/">Bad</a><a href="/marketplace/item/good/"><span>$5</span><span aria-hidden="true">Good title</span></a></body>',
      { url: 'https://www.facebook.com/marketplace/' },
    );
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const uploads: unknown[][] = [];
    const controller = new MarketplaceController(
      dom.window.document,
      { displayMode: 'HIDE', showBlocked: false },
      { sendListings: (listings) => uploads.push(listings) },
    );
    const links = Array.from(dom.window.document.querySelectorAll('a'));
    controller.enqueueLinks(links);
    await controller.flush();
    expect(uploads[0]).toHaveLength(1);
    expect(
      dom.window.document.querySelector('[data-marketscope-parser-warning]'),
    ).not.toBeNull();
  });

  it('cancels pending observation when disabled', async () => {
    vi.useFakeTimers();
    const dom = new JSDOM(
      '<body><a href="/marketplace/item/42/"><span>$5</span><span aria-hidden="true">Listing</span></a></body>',
      { url: 'https://www.facebook.com/marketplace/' },
    );
    const uploads: unknown[][] = [];
    const controller = new MarketplaceController(
      dom.window.document,
      { displayMode: 'HIDE', showBlocked: false },
      { sendListings: (listings) => uploads.push(listings) },
    );

    controller.enqueueLinks(listingLinks(dom.window.document));
    controller.stop();
    await vi.advanceTimersByTimeAsync(150);

    expect(uploads).toEqual([]);
  });
});
