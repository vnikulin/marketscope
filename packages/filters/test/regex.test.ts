import { describe, expect, it } from 'vitest';

import { evaluateRegex } from '../src/index.js';

describe('evaluateRegex', () => {
  it('returns a match from an isolated worker', async () => {
    await expect(
      evaluateRegex('gpsmap\\s+1042', 'Garmin GPSMAP 1042'),
    ).resolves.toMatchObject({
      matched: true,
      timedOut: false,
      inputTruncated: false,
    });
  });

  it('returns invalid syntax as a failed check', async () => {
    const result = await evaluateRegex('[', 'Garmin GPSMAP');

    expect(result.matched).toBe(false);
    expect(result.error).toMatch(/^invalid regex:/u);
  });

  it('caps worker input at 4KB', async () => {
    const result = await evaluateRegex('Z$', `${'a'.repeat(4_096)}Z`);

    expect(result).toMatchObject({
      matched: false,
      inputTruncated: true,
      timedOut: false,
    });
  });
});
