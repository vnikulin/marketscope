import { describe, expect, it } from 'vitest';

import { normalizeText } from '../src/index.js';

describe('normalizeText', () => {
  it('folds case and removes accents with NFKD normalization', () => {
    expect(normalizeText('Café ÅNGSTRÖM')).toBe('cafe angstrom');
  });

  it('normalizes compatibility characters', () => {
    expect(normalizeText('ＧＡＲＭＩＮ')).toBe('garmin');
  });
});
