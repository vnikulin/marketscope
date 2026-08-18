import { performance } from 'node:perf_hooks';

import { describe, expect, it } from 'vitest';

import { evaluateRegex } from '../../packages/filters/src/index.js';

describe('user regex isolation', () => {
  it('terminates catastrophic backtracking in under 200ms', async () => {
    const startedAt = performance.now();
    const result = await evaluateRegex('(a+)+$', `${'a'.repeat(4_095)}!`);
    const elapsedMilliseconds = performance.now() - startedAt;

    expect(result).toMatchObject({
      matched: false,
      timedOut: true,
      error: 'regex timeout',
    });
    expect(elapsedMilliseconds).toBeLessThan(200);
  });
});
