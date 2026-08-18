import { describe, expect, it } from 'vitest';

import type { MarketplaceListing } from '@marketscope/shared-types';

import { calculateRelevance } from '../src/index.js';

function listing(
  overrides: Partial<MarketplaceListing> = {},
): MarketplaceListing {
  return {
    source: 'facebook',
    sourceListingId: '123',
    url: 'https://www.facebook.com/marketplace/item/123',
    title: 'Garmin chartplotter',
    sponsored: false,
    shipping: false,
    rawText: '',
    firstSeen: 1,
    lastSeen: 1,
    ...overrides,
  };
}

describe('calculateRelevance', () => {
  it('weights a title match three times a body match', () => {
    expect(calculateRelevance(listing(), ['garmin'])).toBe(100);
    expect(
      calculateRelevance(
        listing({ title: 'Marine display', description: 'Garmin included' }),
        ['garmin'],
      ),
    ).toBe(33);
  });

  it('weights an exact phrase twice a loose term', () => {
    const exactOnly = calculateRelevance(
      listing({
        title: 'Marine display',
        description: 'GPSMAP 1042 included',
      }),
      [
        { value: 'garmin', match: 'LOOSE' },
        { value: 'gpsmap 1042', match: 'EXACT_PHRASE' },
      ],
    );
    const looseOnly = calculateRelevance(
      listing({ title: 'Marine display', description: 'Garmin included' }),
      [
        { value: 'garmin', match: 'LOOSE' },
        { value: 'gpsmap 1042', match: 'EXACT_PHRASE' },
      ],
    );

    expect(exactOnly).toBe(22);
    expect(looseOnly).toBe(11);
  });

  it('applies per-term weights', () => {
    expect(
      calculateRelevance(listing(), [
        { value: 'garmin', weight: 2 },
        { value: 'humminbird', weight: 1 },
      ]),
    ).toBe(67);
  });

  it('returns zero when there are no optional terms', () => {
    expect(calculateRelevance(listing(), [])).toBe(0);
  });
});
