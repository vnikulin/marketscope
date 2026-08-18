import type {
  FilterDefinition,
  ListingTypeRules,
  LocationRules,
  OptionalTerm,
  PriceRules,
  RegexRule,
  TermMode,
} from '@marketscope/filters';
import type { MarketplaceListing } from '@marketscope/shared-types';

export type AlertOnPriceChange = 'DECREASE' | 'ANY' | 'NEVER';

export interface WatchlistInput {
  name: string;
  searchUrl: string;
  termMode: TermMode;
  requiredTerms: string[];
  booleanExpression?: string;
  optionalTerms: OptionalTerm[];
  excludedTerms: string[];
  regexPatterns: RegexRule[];
  priceRules: PriceRules;
  locationRules: LocationRules;
  listingTypeRules: ListingTypeRules;
  relevanceThreshold: number;
  emailEnabled: boolean;
  enabled: boolean;
  ignoreOlderThanDays?: number;
  alertOnPriceChange: AlertOnPriceChange;
}

export interface Watchlist extends WatchlistInput {
  id: string;
  seeded: boolean;
  createdAt: number;
  updatedAt: number;
}

export type IngestListing = Omit<
  MarketplaceListing,
  'sourceListingId' | 'firstSeen' | 'lastSeen'
> & {
  sourceListingId?: string;
};

export interface StoredListing extends MarketplaceListing {
  id: string;
  listingKey: string;
  lastAlerted?: number;
}

export function toFilterDefinition(watchlist: Watchlist): FilterDefinition {
  return {
    termMode: watchlist.termMode,
    requiredTerms: watchlist.requiredTerms,
    ...(watchlist.booleanExpression === undefined
      ? {}
      : { booleanExpression: watchlist.booleanExpression }),
    optionalTerms: watchlist.optionalTerms,
    excludedTerms: watchlist.excludedTerms,
    regexPatterns: watchlist.regexPatterns,
    price: watchlist.priceRules,
    location: watchlist.locationRules,
    listingTypes: watchlist.listingTypeRules,
    relevanceThreshold: watchlist.relevanceThreshold,
  };
}
