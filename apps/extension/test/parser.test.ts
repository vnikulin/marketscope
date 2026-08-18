import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { listingLinks, parseListingLink } from '../src/parser.js';

const FIXTURE_DIRECTORY = resolve(
  import.meta.dirname,
  '../../../tests/fixtures/marketplace',
);

describe('Marketplace fixture parser', () => {
  it('parses at least 95 percent of the real fixture corpus', () => {
    const fixtures = readdirSync(FIXTURE_DIRECTORY)
      .filter((name) => name.endsWith('.html'))
      .sort();
    let parsed = 0;
    const failures: string[] = [];

    for (const fixture of fixtures) {
      const html = readFileSync(resolve(FIXTURE_DIRECTORY, fixture), 'utf8');
      const dom = new JSDOM(html, {
        url: 'https://www.facebook.com/marketplace/search/',
      });
      const link = listingLinks(dom.window.document)[0];
      if (link === undefined) {
        failures.push(`${fixture}: no item link`);
        continue;
      }
      try {
        const { listing } = parseListingLink(link, 1_755_536_400_000);
        expect(listing.title.length).toBeGreaterThan(0);
        expect(listing.url).toMatch(
          /^https:\/\/www\.facebook\.com\/marketplace\/item\/[^/?#]+\/$/,
        );
        expect(listing).toHaveProperty('price');
        expect(listing.price === null || Number.isInteger(listing.price)).toBe(true);
        parsed += 1;
      } catch (error) {
        failures.push(
          `${fixture}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const rate = parsed / fixtures.length;
    console.info(
      `Marketplace fixture parse rate: ${parsed}/${fixtures.length} (${(
        rate * 100
      ).toFixed(1)}%); failures: ${failures.join('; ') || 'none'}`,
    );
    expect(rate).toBeGreaterThanOrEqual(0.95);
  });

  it('canonicalizes item URLs and rejects non-fbcdn images', () => {
    const dom = new JSDOM(
      '<main><div><a href="https://www.facebook.com/marketplace/item/123/?tracking=1" aria-label="Safe title, $12, Albany, NY"><img src="javascript:alert(1)"><span>$12</span><span aria-hidden="true">Safe title</span><span aria-hidden="true">Albany, NY</span></a></div></main>',
      { url: 'https://www.facebook.com/marketplace/' },
    );
    const link = listingLinks(dom.window.document)[0];
    expect(link).toBeDefined();
    const { listing } = parseListingLink(link as HTMLAnchorElement, 100);
    expect(listing.url).toBe('https://www.facebook.com/marketplace/item/123/');
    expect(listing.price).toBe(1_200);
    expect(listing.imageUrl).toBeUndefined();
  });
});
