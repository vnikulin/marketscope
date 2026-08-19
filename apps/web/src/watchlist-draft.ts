import type { Listing } from './types.js';

const STORAGE_KEY = 'marketscope-watchlist-draft';

export interface ListingWatchlistDraft {
  name: string;
  searchUrl: string;
  requiredTerms: string;
  maxPrice: string;
  allowedCities: string;
  allowedStates: string;
}

function titleTerms(title: string): string[] {
  return title
    .split(/\s+/u)
    .map((term) => term.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(Boolean);
}

export function watchlistDraftFromListing(
  listing: Pick<Listing, 'title' | 'price' | 'location'>,
): ListingWatchlistDraft {
  const searchUrl = new URL('https://www.facebook.com/marketplace/search/');
  searchUrl.searchParams.set('query', listing.title);
  const locationParts = (listing.location ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const possibleState = locationParts.at(-1) ?? '';
  return {
    name: listing.title,
    searchUrl: searchUrl.toString(),
    requiredTerms: titleTerms(listing.title).join(', '),
    maxPrice:
      listing.price === undefined
        ? ''
        : (listing.price / 100).toFixed(listing.price % 100 === 0 ? 0 : 2),
    allowedCities: locationParts.length > 1 ? (locationParts[0] ?? '') : '',
    allowedStates: /^[a-z]{2}$/iu.test(possibleState) ? possibleState : '',
  };
}

export function saveListingWatchlistDraft(listing: Listing): void {
  window.sessionStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(watchlistDraftFromListing(listing)),
  );
}

export function consumeListingWatchlistDraft():
  ListingWatchlistDraft | undefined {
  const stored = window.sessionStorage.getItem(STORAGE_KEY);
  window.sessionStorage.removeItem(STORAGE_KEY);
  if (stored === null) return undefined;
  try {
    const value = JSON.parse(stored) as unknown;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return undefined;
    }
    const record = value as Record<string, unknown>;
    const keys: Array<keyof ListingWatchlistDraft> = [
      'name',
      'searchUrl',
      'requiredTerms',
      'maxPrice',
      'allowedCities',
      'allowedStates',
    ];
    if (!keys.every((key) => typeof record[key] === 'string')) return undefined;
    return {
      name: record.name as string,
      searchUrl: record.searchUrl as string,
      requiredTerms: record.requiredTerms as string,
      maxPrice: record.maxPrice as string,
      allowedCities: record.allowedCities as string,
      allowedStates: record.allowedStates as string,
    };
  } catch {
    return undefined;
  }
}
