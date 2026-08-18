export interface MarketplaceListing {
  source: 'facebook';
  sourceListingId: string;
  url: string; // canonical, query string stripped
  title: string;
  description?: string;
  price?: number; // cents, integer
  priceText?: string; // raw, as displayed
  location?: string;
  distanceMiles?: number;
  imageUrl?: string; // fbcdn, expires
  imageHash?: string; // sha256 of cached bytes, V1: unused
  sellerName?: string;
  sponsored: boolean;
  shipping: boolean;
  localPickup?: boolean;
  postedAtText?: string; // "Listed 2 hours ago"
  postedAtEstimate?: number; // epoch ms, derived, may be null
  rawText: string;
  firstSeen: number; // epoch ms UTC
  lastSeen: number;
}

export interface FilterVerdict {
  passed: boolean;
  checks: FilterCheck[];
  relevance: number; // 0-100
  failedOn?: string; // human readable, first failing check
}

export interface FilterCheck {
  rule: string; // "Required: Garmin"
  passed: boolean;
  detail?: string;
}
