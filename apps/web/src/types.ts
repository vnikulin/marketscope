import type { FilterVerdict } from '@marketscope/shared-types';

export type UnknownPolicy = 'ALLOW' | 'BLOCK' | 'FLAG';
export type TermMode = 'ALL' | 'ANY' | 'EXACT_PHRASE' | 'BOOLEAN';
export type ListingPolicy = 'ALLOW' | 'BLOCK';

export interface WatchlistInput {
  name: string;
  searchUrl: string;
  termMode: TermMode;
  requiredTerms: string[];
  booleanExpression?: string;
  optionalTerms: Array<string | { value: string; weight?: number; match?: 'LOOSE' | 'EXACT_PHRASE' }>;
  excludedTerms: string[];
  regexPatterns: Array<string | { pattern: string; flags?: string }>;
  priceRules: {
    minCents?: number;
    maxCents?: number;
    includeFree?: boolean;
    excludeFree?: boolean;
    unknownPolicy?: UnknownPolicy;
  };
  locationRules: {
    allowedCities?: string[];
    blockedCities?: string[];
    allowedStates?: string[];
    blockedStates?: string[];
    maxDistanceMiles?: number;
    unknownPolicy?: UnknownPolicy;
  };
  listingTypeRules: {
    sponsored?: ListingPolicy;
    shipping?: ListingPolicy;
    localPickup?: ListingPolicy;
    dealer?: ListingPolicy;
    sold?: ListingPolicy;
    pending?: ListingPolicy;
  };
  relevanceThreshold: number;
  emailEnabled: boolean;
  enabled: boolean;
  ignoreOlderThanDays?: number;
  alertOnPriceChange: 'DECREASE' | 'ANY' | 'NEVER';
}

export interface Watchlist extends WatchlistInput {
  id: string;
  seeded: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ListingEvaluation {
  watchlistId: string;
  watchlistName: string;
  verdict: FilterVerdict;
  firstSeen: number;
  lastSeen: number;
}

export interface Listing {
  id: string;
  source: 'facebook';
  sourceListingId?: string;
  url: string;
  title: string;
  description?: string;
  price?: number;
  priceText?: string;
  location?: string;
  distanceMiles?: number;
  thumbnailUrl?: string;
  sellerName?: string;
  sponsored: boolean;
  shipping: boolean;
  localPickup?: boolean;
  firstSeen: number;
  lastSeen: number;
  lastAlerted?: number;
  favorite: boolean;
  evaluations: ListingEvaluation[];
}

export interface EmailSettings {
  configured: boolean;
  preset?: 'GMAIL' | 'MICROSOFT_365' | 'CUSTOM';
  hostname?: string;
  port?: number;
  security?: 'TLS' | 'STARTTLS' | 'NONE';
  username?: string;
  sender?: string;
  recipients?: string[];
  passwordConfigured?: boolean;
  verifiedAt?: number;
  lastTestError?: string;
}

export interface Diagnostics {
  serverVersion: string;
  extensionVersion: string;
  database: {
    status: string;
    bytes: number;
    journalMode: string;
    migrations: Array<{ version: number; name: string; appliedAt: number }>;
  };
  lastListingIngestedAt: number | null;
  listingsLast24Hours: number;
  parser: { sampledCards: number; successRate: number | null };
  smtp: { configured: boolean; lastSendAt: number | null; lastError: string | null };
  notificationQueueDepth: number;
  thumbnailCache: { files: number; bytes: number };
  diskFreeBytes: number | null;
  uptimeMs: number;
  generatedAt: number;
}
