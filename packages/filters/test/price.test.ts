import { describe, expect, it } from 'vitest';

import { normalizePrice } from '../src/index.js';

describe('normalizePrice', () => {
  it.each([
    ['$500', 50_000],
    ['$1,200', 120_000],
    ['1.2K', 120_000],
    ['$1.2k', 120_000],
    ['500', 50_000],
    ['Free', 0],
    ['FREE', 0],
    ['Price on request', null],
    ['', null],
    ['not a price', null],
  ])('normalizes %j to %j cents', (input, expected) => {
    expect(normalizePrice(input)).toBe(expected);
  });
});
