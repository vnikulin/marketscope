import { describe, expect, it } from 'vitest';

import { extensionIsEnabled } from '../src/enabled.js';

describe('extension enabled state', () => {
  it('defaults existing installations to enabled', () => {
    expect(extensionIsEnabled(undefined)).toBe(true);
    expect(extensionIsEnabled(true)).toBe(true);
  });

  it('disables only for an explicit false value', () => {
    expect(extensionIsEnabled(false)).toBe(false);
  });
});
