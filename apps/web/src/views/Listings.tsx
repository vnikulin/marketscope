import { useEffect, useState, type ReactNode } from 'react';

import { request } from '../api.js';
import { EmptyState, ListingCard, PageHeader, StatusMessage } from '../components.js';
import { ListingLayoutToggle, useListingLayout } from '../listing-layout.js';
import type { Listing } from '../types.js';

const COPY = {
  matches: ['Matches', 'Listings that passed at least one watchlist.', 'No matches yet', 'Matching listings appear after the extension observes them.'],
  favorites: ['Favorites', 'The listings you marked for a closer look.', 'No favorites yet', 'Use the star on any listing to save it here.'],
  history: ['History', 'Every listing observed while you browsed Marketplace.', 'No history yet', 'Your observed listing history will appear here.'],
  blocked: ['Blocked', 'Listings rejected by every watchlist, with their full WHY result.', 'Nothing blocked', 'Rejected listings appear here with the exact checks that failed.'],
} as const;

export function ListingsView({ view }: { view: keyof typeof COPY }): ReactNode {
  const [layout, setLayout] = useListingLayout();
  const [listings, setListings] = useState<Listing[]>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const copy = COPY[view];
  useEffect(() => {
    setListings(undefined);
    setError('');
    void request<{ listings: Listing[] }>(`/api/listings?view=${view}`).then((response) => setListings(response.listings)).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [view]);
  const visible = (listings ?? []).filter((listing) => `${listing.title} ${listing.location ?? ''} ${listing.sellerName ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()));
  function replaceFavorite(id: string, favorite: boolean): void {
    setListings((current) => (current ?? []).flatMap((listing) => listing.id !== id ? [listing] : view === 'favorites' && !favorite ? [] : [{ ...listing, favorite }]));
  }
  async function clearBlocked(): Promise<void> {
    if (!window.confirm('Permanently delete all blocked listings except favorites?')) return;
    setError('');
    setNotice('');
    try {
      const result = await request<{ deleted: number; preservedFavorites: number }>('/api/listings/blocked', { method: 'DELETE' });
      setListings((current) => (current ?? []).filter((listing) => listing.favorite));
      const kept = result.preservedFavorites === 0 ? '' : ` Kept ${result.preservedFavorites} favorite${result.preservedFavorites === 1 ? '' : 's'}.`;
      setNotice(`Cleared ${result.deleted} blocked listing${result.deleted === 1 ? '' : 's'}.${kept}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }
  return <>
    <PageHeader title={copy[0]} detail={copy[1]} action={<div className="page-actions"><label className="search-box"><span className="sr-only">Search listings</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search listings" /></label><ListingLayoutToggle layout={layout} onChange={setLayout} />{view === 'blocked' ? <button className="button button-danger" type="button" onClick={() => void clearBlocked()} disabled={(listings ?? []).length === 0}>Clear blocked results</button> : null}</div>} />
    {error.length > 0 ? <StatusMessage tone="error">{error}</StatusMessage> : null}
    {notice.length > 0 ? <StatusMessage tone="success">{notice}</StatusMessage> : null}
    {listings === undefined ? <div className="loading-grid" aria-label={`Loading ${view}`} /> : visible.length === 0 ? <EmptyState title={search.length > 0 ? 'No results' : copy[2]} detail={search.length > 0 ? 'Try a different title, seller, or location.' : copy[3]} /> : <div className={`listing-grid listing-grid-${layout}`}>{visible.map((listing) => <ListingCard key={listing.id} listing={listing} onFavorite={(favorite) => replaceFavorite(listing.id, favorite)} />)}</div>}
  </>;
}
