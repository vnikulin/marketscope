import type { ConnectionSettings } from './types.js';

export const QUICK_ADD_MENU_ID = 'marketscope-add-current-search';

export function watchlistEditorUrl(
  connection: ConnectionSettings,
  marketplaceUrl: string,
): string {
  const source = new URL(marketplaceUrl);
  if (
    source.protocol !== 'https:' ||
    source.hostname !== 'www.facebook.com' ||
    !source.pathname.startsWith('/marketplace/')
  ) {
    throw new Error('Quick add requires a Facebook Marketplace page');
  }

  const target = new URL(`${connection.serverUrl.replace(/\/+$/, '')}/`);
  target.searchParams.set('sourceUrl', source.toString());
  target.hash = '/watchlists/new';
  return target.toString();
}
