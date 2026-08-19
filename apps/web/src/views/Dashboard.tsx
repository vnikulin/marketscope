import { useEffect, useState, type ReactNode } from 'react';

import { request } from '../api.js';
import {
  EmptyState,
  ListingCard,
  PageHeader,
  StatusMessage,
} from '../components.js';
import type { Listing } from '../types.js';

interface DashboardData {
  activeWatchlists: number;
  matches: number;
  favorites: number;
  blocked: number;
  matchesLast24Hours: number;
  recentListings: Listing[];
}

export function Dashboard(): ReactNode {
  const [data, setData] = useState<DashboardData>();
  const [error, setError] = useState('');
  useEffect(() => {
    void request<DashboardData>('/api/dashboard')
      .then(setData)
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      );
  }, []);
  function replaceFavorite(id: string, favorite: boolean): void {
    setData((current) =>
      current === undefined
        ? current
        : {
            ...current,
            favorites: Math.max(0, current.favorites + (favorite ? 1 : -1)),
            recentListings: current.recentListings.map((listing) =>
              listing.id === id ? { ...listing, favorite } : listing,
            ),
          },
    );
  }
  return (
    <>
      <PageHeader
        eyebrow="Today"
        title="Your Marketplace signal"
        detail="Listings appear here only after you browse Marketplace yourself."
        action={
          <a className="button button-primary" href="#/watchlists/new">
            New watchlist
          </a>
        }
      />
      {error.length > 0 ? (
        <StatusMessage tone="error">{error}</StatusMessage>
      ) : null}
      {data === undefined ? (
        <div className="loading-grid" aria-label="Loading dashboard" />
      ) : (
        <>
          <section className="metric-grid" aria-label="Dashboard summary">
            <a href="#/watchlists">
              <strong>{data.activeWatchlists}</strong>
              <span>Active watchlists</span>
            </a>
            <a href="#/matches">
              <strong>{data.matches}</strong>
              <span>Matches</span>
            </a>
            <a href="#/favorites">
              <strong>{data.favorites}</strong>
              <span>Favorites</span>
            </a>
            <a href="#/blocked">
              <strong>{data.blocked}</strong>
              <span>Blocked</span>
            </a>
          </section>
          <section className="section-heading">
            <div>
              <p className="eyebrow">Last 24 hours</p>
              <h2>{data.matchesLast24Hours} matching listings</h2>
            </div>
            <a href="#/matches">View matches</a>
          </section>
          {data.recentListings.length === 0 ? (
            <EmptyState
              title="No matching listings yet"
              detail="Browse Marketplace normally. Listings that pass at least one active watchlist will appear here."
            />
          ) : (
            <div className="listing-grid">
              {data.recentListings.map((listing) => (
                <ListingCard
                  key={listing.id}
                  listing={listing}
                  onFavorite={(favorite) =>
                    replaceFavorite(listing.id, favorite)
                  }
                />
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
