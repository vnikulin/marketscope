import type {
  FilterDefinition,
  ListingTypeRules,
  LocationRules,
  OptionalTerm,
  PriceRules,
  RegexRule,
  TermMode,
} from '@marketscope/filters/browser';
import type {
  FilterVerdict,
  MarketplaceListing,
} from '@marketscope/shared-types';

export type DisplayMode = 'HIDE' | 'DIM' | 'SHOW_WITH_WARNING';

export interface ParsedMarketplaceListing
  extends Omit<MarketplaceListing, 'price'> {
  price: number | null;
}

export interface ExtensionWatchlist {
  id: string;
  name: string;
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
  enabled: boolean;
}

export interface WatchlistEvaluation {
  watchlistId: string;
  watchlistName: string;
  verdict: FilterVerdict;
}

export interface ExtensionPreferences {
  displayMode: DisplayMode;
  showBlocked: boolean;
}

export interface ConnectionSettings {
  serverUrl: string;
  extensionToken: string;
}

export type ContentMessage =
  | { type: 'GET_STATE' }
  | { type: 'QUEUE_LISTINGS'; listings: MarketplaceListing[] }
  | { type: 'SET_PREFERENCES'; preferences: ExtensionPreferences };

export interface ExtensionState {
  watchlists: ExtensionWatchlist[];
  preferences: ExtensionPreferences;
}

export function toFilterDefinition(
  watchlist: ExtensionWatchlist,
): FilterDefinition {
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

export function toMarketplaceListing(
  parsed: ParsedMarketplaceListing,
): MarketplaceListing {
  const { price, ...listing } = parsed;
  return price === null ? listing : { ...listing, price };
}
