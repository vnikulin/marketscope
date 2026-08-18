import { describe, expect, it } from 'vitest';

import { matchesTerms } from '../src/index.js';

describe('matchesTerms', () => {
  it('requires every term in ALL mode', () => {
    expect(
      matchesTerms('Garmin GPSMAP 1042xsv', ['garmin', '1042'], 'ALL'),
    ).toBe(true);
    expect(
      matchesTerms('Garmin GPSMAP 1042xsv', ['garmin', 'case'], 'ALL'),
    ).toBe(false);
  });

  it('accepts one matching term in ANY mode', () => {
    expect(
      matchesTerms('Garmin GPSMAP 1042xsv', ['case', 'gpsmap'], 'ANY'),
    ).toBe(true);
    expect(
      matchesTerms('Garmin GPSMAP 1042xsv', ['case', 'cover'], 'ANY'),
    ).toBe(false);
  });

  it('keeps word order in EXACT_PHRASE mode', () => {
    expect(
      matchesTerms(
        'Garmin GPSMAP 1042xsv chartplotter',
        ['gpsmap 1042xsv'],
        'EXACT_PHRASE',
      ),
    ).toBe(true);
    expect(
      matchesTerms('1042xsv Garmin GPSMAP', ['gpsmap 1042xsv'], 'EXACT_PHRASE'),
    ).toBe(false);
  });

  it('matches without case or accent sensitivity', () => {
    expect(matchesTerms('Québec GARMIN', ['quebec', 'garmin'], 'ALL')).toBe(
      true,
    );
  });
});
