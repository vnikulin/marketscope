import { describe, expect, it } from 'vitest';

import {
  evaluateListingTypeRules,
  evaluateLocationRule,
  evaluatePriceRule,
} from '../src/index.js';

describe('price rules', () => {
  it('enforces minimum and maximum integer cents', () => {
    const rules = { minCents: 40_000, maxCents: 70_000 };

    expect(evaluatePriceRule(45_000, rules).passed).toBe(true);
    expect(evaluatePriceRule(30_000, rules).passed).toBe(false);
    expect(evaluatePriceRule(80_000, rules).passed).toBe(false);
  });

  it('allows or excludes free listings explicitly', () => {
    expect(
      evaluatePriceRule(0, { minCents: 100, includeFree: true }).passed,
    ).toBe(true);
    expect(evaluatePriceRule(0, { excludeFree: true }).passed).toBe(false);
  });

  it.each([
    ['ALLOW', true, false],
    ['BLOCK', false, false],
    ['FLAG', true, true],
  ] as const)('applies %s to an unknown price', (policy, passed, flagged) => {
    expect(
      evaluatePriceRule(undefined, { unknownPolicy: policy }),
    ).toMatchObject({ passed, flagged });
  });
});

describe('location rules', () => {
  it('enforces city, state, and distance rules without geocoding', () => {
    const rules = {
      allowedCities: ['Freeport'],
      allowedStates: ['NY'],
      maxDistanceMiles: 25,
    };

    expect(evaluateLocationRule('Freeport, NY', 12, rules).passed).toBe(true);
    expect(evaluateLocationRule('Boston, MA', 12, rules).passed).toBe(false);
    expect(evaluateLocationRule('Freeport, NY', 30, rules).passed).toBe(false);
  });

  it('blocks configured cities and states case-insensitively', () => {
    expect(
      evaluateLocationRule('Newark, NJ', 5, {
        blockedCities: ['NEWARK'],
      }).passed,
    ).toBe(false);
    expect(
      evaluateLocationRule('Hoboken, NJ', 5, {
        blockedStates: ['nj'],
      }).passed,
    ).toBe(false);
  });

  it('applies the unknown policy to missing rendered distance', () => {
    expect(
      evaluateLocationRule('Freeport, NY', undefined, {
        maxDistanceMiles: 25,
        unknownPolicy: 'FLAG',
      }),
    ).toMatchObject({ passed: true, flagged: true });
  });
});

describe('listing type rules', () => {
  it('blocks sponsored and shipping listings by default', () => {
    expect(
      evaluateListingTypeRules({ sponsored: true, shipping: false }).find(
        (result) => result.type === 'sponsored',
      )?.passed,
    ).toBe(false);
    expect(
      evaluateListingTypeRules({ sponsored: false, shipping: true }).find(
        (result) => result.type === 'shipping',
      )?.passed,
    ).toBe(false);
  });

  it('evaluates local pickup, dealer, sold, and pending independently', () => {
    const results = evaluateListingTypeRules(
      {
        sponsored: false,
        shipping: false,
        localPickup: true,
        dealer: true,
        sold: true,
        pending: true,
      },
      {
        localPickup: 'ALLOW',
        dealer: 'BLOCK',
        sold: 'BLOCK',
        pending: 'BLOCK',
      },
    );

    expect(
      results.find((result) => result.type === 'localPickup')?.passed,
    ).toBe(true);
    expect(results.filter((result) => !result.passed)).toHaveLength(3);
  });
});
