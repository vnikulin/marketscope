import { describe, expect, it } from 'vitest';

import { evaluateBooleanAst, parseBooleanExpression } from '../src/index.js';

describe('Boolean expressions', () => {
  it('parses phrases, parentheses, and NOT into an evaluable AST', () => {
    const result = parseBooleanExpression(
      '("GPSMAP 1042xsv" OR 1042xsv) AND Garmin AND NOT case',
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(evaluateBooleanAst(result.ast, 'Garmin GPSMAP 1042xsv unit')).toBe(
        true,
      );
      expect(evaluateBooleanAst(result.ast, 'Garmin GPSMAP 1042xsv case')).toBe(
        false,
      );
    }
  });

  it('applies NOT before AND and AND before OR', () => {
    const result = parseBooleanExpression('garmin OR humminbird AND NOT case');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(evaluateBooleanAst(result.ast, 'Garmin chartplotter')).toBe(true);
      expect(evaluateBooleanAst(result.ast, 'Humminbird case')).toBe(false);
    }
  });

  it.each([
    ['Garmin AND )', 11],
    ['"unterminated', 0],
    ['garmin case', 7],
    ['', 0],
  ])('returns an offset for malformed input %j', (expression, offset) => {
    const result = parseBooleanExpression(expression);

    expect(result).toMatchObject({ ok: false, error: { offset } });
  });

  it('rejects input beyond 1,000 characters', () => {
    const result = parseBooleanExpression('a'.repeat(1_001));

    expect(result).toMatchObject({ ok: false, error: { offset: 1_000 } });
  });

  it('accepts AST depth 20 and rejects depth 21', () => {
    const allowed = parseBooleanExpression(`${'NOT '.repeat(19)}garmin`);
    const rejected = parseBooleanExpression(`${'NOT '.repeat(20)}garmin`);

    expect(allowed.ok).toBe(true);
    expect(rejected).toMatchObject({
      ok: false,
      error: { message: 'Boolean expression exceeds depth 20' },
    });
  });
});
