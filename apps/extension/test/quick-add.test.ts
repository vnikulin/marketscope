import { describe, expect, it } from 'vitest';

import { watchlistEditorUrl } from '../src/quick-add.js';

const connection = {
  serverUrl: 'http://127.0.0.1:3000/',
  extensionToken: 'test-token',
};

describe('watchlistEditorUrl', () => {
  it('opens the local editor with the complete Marketplace URL', () => {
    const source =
      'https://www.facebook.com/marketplace/search/?query=garmin+1042+xsv&exact=false';
    const target = new URL(watchlistEditorUrl(connection, source));

    expect(target.origin).toBe('http://127.0.0.1:3000');
    expect(target.searchParams.get('sourceUrl')).toBe(source);
    expect(target.hash).toBe('#/watchlists/new');
  });

  it('rejects pages outside Facebook Marketplace', () => {
    expect(() =>
      watchlistEditorUrl(connection, 'https://example.com/marketplace/search'),
    ).toThrow('Quick add requires a Facebook Marketplace page');
  });
});
