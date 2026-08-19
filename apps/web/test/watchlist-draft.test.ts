import { describe, expect, it } from 'vitest';

import { watchlistDraftFromListing } from '../src/watchlist-draft.js';

describe('watchlistDraftFromListing', () => {
  it('prefills search terms, price, city, and state from a listing', () => {
    expect(
      watchlistDraftFromListing({
        title: 'Garmin GPSMAP 1042xsv',
        price: 150_050,
        location: 'Freeport, NY',
      }),
    ).toEqual({
      name: 'Garmin GPSMAP 1042xsv',
      searchUrl:
        'https://www.facebook.com/marketplace/search/?query=Garmin+GPSMAP+1042xsv',
      requiredTerms: 'Garmin, GPSMAP, 1042xsv',
      maxPrice: '1500.50',
      allowedCities: 'Freeport',
      allowedStates: 'NY',
    });
  });
});
