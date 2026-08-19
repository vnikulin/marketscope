import type {
  ListingTypeRules,
  LocationRules,
  OptionalTerm,
  PriceRules,
  RegexRule,
  TermMode,
} from '@marketscope/filters';

import type { IngestListing, WatchlistInput } from './types.js';

export class ValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(
  record: Record<string, unknown>,
  field: string,
): string {
  const value = record[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(`${field} must be a non-empty string`);
  }
  return value;
}

function optionalString(
  record: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = record[field];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} must be a string`);
  }
  return value;
}

function booleanValue(
  record: Record<string, unknown>,
  field: string,
  defaultValue?: boolean,
): boolean {
  const value = record[field];
  if (value === undefined && defaultValue !== undefined) {
    return defaultValue;
  }
  if (typeof value !== 'boolean') {
    throw new ValidationError(`${field} must be a boolean`);
  }
  return value;
}

function finiteNumber(
  record: Record<string, unknown>,
  field: string,
): number | undefined {
  const value = record[field];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ValidationError(`${field} must be a finite number`);
  }
  return value;
}

function stringArray(value: unknown, field: string): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === 'string')
  ) {
    throw new ValidationError(`${field} must be an array of strings`);
  }
  return value;
}

function recordValue(
  record: Record<string, unknown>,
  field: string,
): Record<string, unknown> {
  const value = record[field];
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    throw new ValidationError(`${field} must be an object`);
  }
  return value;
}

function optionalBoolean(
  record: Record<string, unknown>,
  field: string,
): boolean | undefined {
  const value = record[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    throw new ValidationError(`${field} must be a boolean`);
  }
  return value;
}

function optionalNonNegativeInteger(
  record: Record<string, unknown>,
  field: string,
): number | undefined {
  const value = finiteNumber(record, field);
  if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
    throw new ValidationError(`${field} must be a non-negative integer`);
  }
  return value;
}

function unknownPolicy(
  record: Record<string, unknown>,
  field: string,
): 'ALLOW' | 'BLOCK' | 'FLAG' | undefined {
  const value = record[field];
  if (value === undefined) {
    return undefined;
  }
  if (value !== 'ALLOW' && value !== 'BLOCK' && value !== 'FLAG') {
    throw new ValidationError(`${field} must be ALLOW, BLOCK, or FLAG`);
  }
  return value;
}

function parsePriceRules(value: Record<string, unknown>): PriceRules {
  const minCents = optionalNonNegativeInteger(value, 'minCents');
  const maxCents = optionalNonNegativeInteger(value, 'maxCents');
  if (minCents !== undefined && maxCents !== undefined && minCents > maxCents) {
    throw new ValidationError('priceRules minCents cannot exceed maxCents');
  }
  const includeFree = optionalBoolean(value, 'includeFree');
  const excludeFree = optionalBoolean(value, 'excludeFree');
  if (includeFree === true && excludeFree === true) {
    throw new ValidationError(
      'priceRules cannot include and exclude free listings',
    );
  }
  const policy = unknownPolicy(value, 'unknownPolicy');
  return {
    ...(minCents === undefined ? {} : { minCents }),
    ...(maxCents === undefined ? {} : { maxCents }),
    ...(includeFree === undefined ? {} : { includeFree }),
    ...(excludeFree === undefined ? {} : { excludeFree }),
    ...(policy === undefined ? {} : { unknownPolicy: policy }),
  };
}

function optionalStringArray(
  record: Record<string, unknown>,
  field: string,
): string[] | undefined {
  const value = record[field];
  return value === undefined ? undefined : stringArray(value, field);
}

function parseLocationRules(value: Record<string, unknown>): LocationRules {
  const allowedCities = optionalStringArray(value, 'allowedCities');
  const blockedCities = optionalStringArray(value, 'blockedCities');
  const allowedStates = optionalStringArray(value, 'allowedStates');
  const blockedStates = optionalStringArray(value, 'blockedStates');
  const maxDistanceMiles = finiteNumber(value, 'maxDistanceMiles');
  if (maxDistanceMiles !== undefined && maxDistanceMiles < 0) {
    throw new ValidationError('maxDistanceMiles must be non-negative');
  }
  const policy = unknownPolicy(value, 'unknownPolicy');
  return {
    ...(allowedCities === undefined ? {} : { allowedCities }),
    ...(blockedCities === undefined ? {} : { blockedCities }),
    ...(allowedStates === undefined ? {} : { allowedStates }),
    ...(blockedStates === undefined ? {} : { blockedStates }),
    ...(maxDistanceMiles === undefined ? {} : { maxDistanceMiles }),
    ...(policy === undefined ? {} : { unknownPolicy: policy }),
  };
}

function parseListingTypeRules(
  value: Record<string, unknown>,
): ListingTypeRules {
  const output: ListingTypeRules = {};
  for (const field of [
    'sponsored',
    'shipping',
    'localPickup',
    'dealer',
    'sold',
    'pending',
  ] as const) {
    const policy = value[field];
    if (policy === undefined) {
      continue;
    }
    if (policy !== 'ALLOW' && policy !== 'BLOCK') {
      throw new ValidationError(`${field} must be ALLOW or BLOCK`);
    }
    output[field] = policy;
  }
  return output;
}

function validateSearchUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ValidationError('searchUrl must be a valid URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ValidationError('searchUrl must use HTTP or HTTPS');
  }
  return value;
}

function validateOptionalTerms(value: unknown): OptionalTerm[] {
  if (!Array.isArray(value)) {
    throw new ValidationError('optionalTerms must be an array');
  }
  for (const term of value) {
    if (typeof term === 'string') {
      continue;
    }
    if (
      !isRecord(term) ||
      typeof term.value !== 'string' ||
      (term.weight !== undefined &&
        (typeof term.weight !== 'number' ||
          !Number.isFinite(term.weight) ||
          term.weight <= 0)) ||
      (term.match !== undefined &&
        term.match !== 'LOOSE' &&
        term.match !== 'EXACT_PHRASE')
    ) {
      throw new ValidationError('optionalTerms contains an invalid term');
    }
  }
  return value as OptionalTerm[];
}

function validateRegexPatterns(value: unknown): RegexRule[] {
  if (!Array.isArray(value)) {
    throw new ValidationError('regexPatterns must be an array');
  }
  for (const pattern of value) {
    if (typeof pattern === 'string') {
      continue;
    }
    if (
      !isRecord(pattern) ||
      typeof pattern.pattern !== 'string' ||
      (pattern.flags !== undefined && typeof pattern.flags !== 'string')
    ) {
      throw new ValidationError('regexPatterns contains an invalid pattern');
    }
  }
  return value as RegexRule[];
}

export function parseWatchlistInput(value: unknown): WatchlistInput {
  if (!isRecord(value)) {
    throw new ValidationError('watchlist must be an object');
  }
  const termMode = requiredString(value, 'termMode');
  if (!['ALL', 'ANY', 'EXACT_PHRASE', 'BOOLEAN'].includes(termMode)) {
    throw new ValidationError('termMode is invalid');
  }
  const relevanceThreshold = finiteNumber(value, 'relevanceThreshold') ?? 0;
  if (
    !Number.isInteger(relevanceThreshold) ||
    relevanceThreshold < 0 ||
    relevanceThreshold > 100
  ) {
    throw new ValidationError(
      'relevanceThreshold must be an integer from 0 to 100',
    );
  }
  const ignoreOlderThanDays = finiteNumber(value, 'ignoreOlderThanDays');
  if (
    ignoreOlderThanDays !== undefined &&
    (!Number.isInteger(ignoreOlderThanDays) || ignoreOlderThanDays <= 0)
  ) {
    throw new ValidationError('ignoreOlderThanDays must be a positive integer');
  }
  const alertOnPriceChange = value.alertOnPriceChange ?? 'NEVER';
  if (!['DECREASE', 'ANY', 'NEVER'].includes(String(alertOnPriceChange))) {
    throw new ValidationError('alertOnPriceChange is invalid');
  }

  return {
    name: requiredString(value, 'name'),
    searchUrl: validateSearchUrl(requiredString(value, 'searchUrl')),
    termMode: termMode as TermMode,
    requiredTerms: stringArray(value.requiredTerms ?? [], 'requiredTerms'),
    ...(optionalString(value, 'booleanExpression') === undefined
      ? {}
      : { booleanExpression: optionalString(value, 'booleanExpression') }),
    optionalTerms: validateOptionalTerms(value.optionalTerms ?? []),
    excludedTerms: stringArray(value.excludedTerms ?? [], 'excludedTerms'),
    regexPatterns: validateRegexPatterns(value.regexPatterns ?? []),
    priceRules: parsePriceRules(recordValue(value, 'priceRules')),
    locationRules: parseLocationRules(recordValue(value, 'locationRules')),
    listingTypeRules: parseListingTypeRules(
      recordValue(value, 'listingTypeRules'),
    ),
    relevanceThreshold,
    emailEnabled: booleanValue(value, 'emailEnabled', false),
    enabled: booleanValue(value, 'enabled', true),
    ...(ignoreOlderThanDays === undefined ? {} : { ignoreOlderThanDays }),
    alertOnPriceChange:
      alertOnPriceChange as WatchlistInput['alertOnPriceChange'],
  };
}

export function canonicalFacebookUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ValidationError('listing url must be valid');
  }
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== 'https:' ||
    (hostname !== 'facebook.com' && !hostname.endsWith('.facebook.com'))
  ) {
    throw new ValidationError('listing url must be an HTTPS facebook.com URL');
  }
  url.search = '';
  url.hash = '';
  return url.toString();
}

export interface ThumbnailUpload {
  sourceListingId?: string;
  url: string;
  jpegBase64: string;
}

export function parseThumbnailUpload(value: unknown): ThumbnailUpload {
  if (!isRecord(value)) {
    throw new ValidationError('thumbnail upload must be an object');
  }
  const sourceListingId = optionalString(value, 'sourceListingId')?.trim();
  const jpegBase64 = requiredString(value, 'jpegBase64');
  if (
    jpegBase64.length > 275_000 ||
    jpegBase64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(jpegBase64)
  ) {
    throw new ValidationError('jpegBase64 must be valid base64 under 200KB');
  }
  return {
    ...(sourceListingId === undefined || sourceListingId.length === 0
      ? {}
      : { sourceListingId }),
    url: canonicalFacebookUrl(requiredString(value, 'url')),
    jpegBase64,
  };
}

export function parseIngestListing(value: unknown): IngestListing {
  if (!isRecord(value)) {
    throw new ValidationError('listing must be an object');
  }
  if (value.source !== 'facebook') {
    throw new ValidationError('source must be facebook');
  }
  const sourceListingId = optionalString(value, 'sourceListingId')?.trim();
  const price = finiteNumber(value, 'price');
  if (price !== undefined && (!Number.isInteger(price) || price < 0)) {
    throw new ValidationError('price must be non-negative integer cents');
  }
  const distanceMiles = finiteNumber(value, 'distanceMiles');
  const postedAtEstimate = finiteNumber(value, 'postedAtEstimate');
  if (distanceMiles !== undefined && distanceMiles < 0) {
    throw new ValidationError('distanceMiles must be non-negative');
  }
  if (postedAtEstimate !== undefined && !Number.isInteger(postedAtEstimate)) {
    throw new ValidationError('postedAtEstimate must be epoch milliseconds');
  }
  return {
    source: 'facebook',
    ...(sourceListingId === undefined || sourceListingId.length === 0
      ? {}
      : { sourceListingId }),
    url: canonicalFacebookUrl(requiredString(value, 'url')),
    title: requiredString(value, 'title'),
    ...(optionalString(value, 'description') === undefined
      ? {}
      : { description: optionalString(value, 'description') }),
    ...(price === undefined ? {} : { price }),
    ...(optionalString(value, 'priceText') === undefined
      ? {}
      : { priceText: optionalString(value, 'priceText') }),
    ...(optionalString(value, 'location') === undefined
      ? {}
      : { location: optionalString(value, 'location') }),
    ...(distanceMiles === undefined ? {} : { distanceMiles }),
    ...(optionalString(value, 'imageUrl') === undefined
      ? {}
      : { imageUrl: optionalString(value, 'imageUrl') }),
    ...(optionalString(value, 'imageHash') === undefined
      ? {}
      : { imageHash: optionalString(value, 'imageHash') }),
    ...(optionalString(value, 'sellerName') === undefined
      ? {}
      : { sellerName: optionalString(value, 'sellerName') }),
    sponsored: booleanValue(value, 'sponsored'),
    shipping: booleanValue(value, 'shipping'),
    ...(value.localPickup === undefined
      ? {}
      : { localPickup: booleanValue(value, 'localPickup') }),
    ...(optionalString(value, 'postedAtText') === undefined
      ? {}
      : { postedAtText: optionalString(value, 'postedAtText') }),
    ...(postedAtEstimate === undefined ? {} : { postedAtEstimate }),
    rawText: requiredString(value, 'rawText'),
  };
}
