import { describe, expect, it } from 'vitest';

import type { MarketplaceListing } from '@marketscope/shared-types';

import { evaluate, type FilterableListing } from '../src/index.js';

function listing(
  overrides: Partial<FilterableListing> = {},
): FilterableListing {
  const base: MarketplaceListing = {
    source: 'facebook',
    sourceListingId: '123',
    url: 'https://www.facebook.com/marketplace/item/123',
    title: 'Garmin GPSMAP 1042xsv',
    description: 'Marine chartplotter',
    price: 45_000,
    location: 'Freeport, NY',
    distanceMiles: 12,
    sponsored: false,
    shipping: false,
    localPickup: true,
    rawText: 'Garmin GPSMAP 1042xsv Marine chartplotter',
    firstSeen: 1,
    lastSeen: 1,
  };
  return { ...base, ...overrides };
}

describe('evaluate', () => {
  it('returns a complete passing verdict', async () => {
    const verdict = await evaluate(listing(), {
      termMode: 'ALL',
      requiredTerms: ['Garmin', '1042xsv'],
      optionalTerms: ['GPSMAP'],
      excludedTerms: ['case'],
      regexPatterns: ['gpsmap\\s+1042xsv'],
      price: { maxCents: 70_000, excludeFree: true },
      location: {
        allowedCities: ['Freeport'],
        allowedStates: ['NY'],
        maxDistanceMiles: 25,
      },
      relevanceThreshold: 90,
    });

    expect(verdict.passed).toBe(true);
    expect(verdict.relevance).toBe(100);
    expect(verdict.failedOn).toBeUndefined();
    expect(verdict.checks.every((check) => check.passed)).toBe(true);
  });

  it('runs later checks and keeps the first failure', async () => {
    const verdict = await evaluate(
      listing({
        title: 'Garmin GPSMAP 1042xsv case',
        price: 80_000,
        shipping: true,
      }),
      {
        termMode: 'ALL',
        requiredTerms: ['Garmin'],
        optionalTerms: ['missing optional term'],
        excludedTerms: ['case'],
        price: { maxCents: 70_000 },
        relevanceThreshold: 50,
      },
    );

    expect(verdict.passed).toBe(false);
    expect(verdict.failedOn).toBe('Excluded: case');
    expect(verdict.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: 'Excluded: case', passed: false }),
        expect.objectContaining({ rule: 'Price', passed: false }),
        expect.objectContaining({ rule: 'Shipping', passed: false }),
        expect.objectContaining({ rule: 'Relevance >= 50', passed: false }),
      ]),
    );
  });

  it('returns Boolean parse errors inside the verdict', async () => {
    const verdict = await evaluate(listing(), {
      termMode: 'BOOLEAN',
      booleanExpression: 'Garmin AND )',
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.checks[0]).toMatchObject({
      rule: 'Required: Boolean expression',
      passed: false,
      detail: expect.stringContaining('offset 11'),
    });
  });

  it('reports invalid regex and flagged unknown values without throwing', async () => {
    const verdict = await evaluate(
      listing({ price: undefined, location: undefined }),
      {
        termMode: 'ALL',
        regexPatterns: ['['],
        price: { unknownPolicy: 'FLAG' },
        location: {
          allowedStates: ['NY'],
          unknownPolicy: 'FLAG',
        },
      },
    );

    expect(verdict.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: 'Regex: [',
          passed: false,
          detail: expect.stringMatching(/^invalid regex:/u),
        }),
        expect.objectContaining({
          rule: 'Price',
          passed: true,
          detail: 'price unknown; flagged',
        }),
        expect.objectContaining({
          rule: 'Location',
          passed: true,
          detail: 'location unknown; flagged',
        }),
      ]),
    );
  });
});
