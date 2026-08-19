import { statfsSync, statSync } from 'node:fs';

import type Database from 'better-sqlite3';
import type { FilterVerdict } from '@marketscope/shared-types';

import type { EmailSettingsRepository } from './email.js';
import type { ThumbnailCache } from './thumbnails.js';

interface ListingRow {
  id: string;
  source: 'facebook';
  sourceListingId: string | null;
  url: string;
  title: string;
  description: string | null;
  price: number | null;
  priceText: string | null;
  location: string | null;
  distanceMiles: number | null;
  imageHash: string | null;
  sellerName: string | null;
  sponsored: number;
  shipping: number;
  localPickup: number | null;
  firstSeen: number;
  lastSeen: number;
  lastAlerted: number | null;
  favorite: number;
}

interface MatchRow {
  listingId: string;
  watchlistId: string;
  watchlistName: string;
  verdictJson: string;
  firstSeen: number;
  lastSeen: number;
}

export interface PwaListing {
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
  evaluations: Array<{
    watchlistId: string;
    watchlistName: string;
    verdict: FilterVerdict;
    firstSeen: number;
    lastSeen: number;
  }>;
}

function optional<T>(value: T | null): T | undefined {
  return value === null ? undefined : value;
}

export function listPwaListings(database: Database.Database): PwaListing[] {
  const listings = database
    .prepare(
      `SELECT l.id, l.source, l.source_listing_id AS sourceListingId,
         l.canonical_url AS url, l.title, l.description,
         l.price_cents AS price, l.price_text AS priceText, l.location,
         l.distance_miles AS distanceMiles, l.image_hash AS imageHash,
         l.seller_name AS sellerName, l.sponsored, l.shipping,
         l.local_pickup AS localPickup, l.first_seen AS firstSeen,
         l.last_seen AS lastSeen, l.last_alerted AS lastAlerted,
         CASE WHEN f.listing_id IS NULL THEN 0 ELSE 1 END AS favorite
       FROM listings l
       LEFT JOIN favorites f ON f.listing_id = l.id
       ORDER BY l.first_seen DESC, l.id`,
    )
    .all() as ListingRow[];
  const matches = database
    .prepare(
      `SELECT m.listing_id AS listingId, m.watchlist_id AS watchlistId,
         w.name AS watchlistName, m.verdict_json AS verdictJson,
         m.first_seen AS firstSeen, m.last_seen AS lastSeen
       FROM watchlist_matches m
       JOIN watchlists w ON w.id = m.watchlist_id
       ORDER BY w.created_at, w.id`,
    )
    .all() as MatchRow[];
  const byListing = new Map<string, MatchRow[]>();
  for (const match of matches) {
    const existing = byListing.get(match.listingId) ?? [];
    existing.push(match);
    byListing.set(match.listingId, existing);
  }
  return listings.map((listing) => ({
    id: listing.id,
    source: listing.source,
    ...(optional(listing.sourceListingId) === undefined
      ? {}
      : { sourceListingId: optional(listing.sourceListingId) }),
    url: listing.url,
    title: listing.title,
    ...(optional(listing.description) === undefined
      ? {}
      : { description: optional(listing.description) }),
    ...(optional(listing.price) === undefined
      ? {}
      : { price: optional(listing.price) }),
    ...(optional(listing.priceText) === undefined
      ? {}
      : { priceText: optional(listing.priceText) }),
    ...(optional(listing.location) === undefined
      ? {}
      : { location: optional(listing.location) }),
    ...(optional(listing.distanceMiles) === undefined
      ? {}
      : { distanceMiles: optional(listing.distanceMiles) }),
    ...(listing.imageHash === null
      ? {}
      : { thumbnailUrl: `/api/thumbnails/${listing.imageHash}.jpg` }),
    ...(optional(listing.sellerName) === undefined
      ? {}
      : { sellerName: optional(listing.sellerName) }),
    sponsored: listing.sponsored === 1,
    shipping: listing.shipping === 1,
    ...(listing.localPickup === null
      ? {}
      : { localPickup: listing.localPickup === 1 }),
    firstSeen: listing.firstSeen,
    lastSeen: listing.lastSeen,
    ...(optional(listing.lastAlerted) === undefined
      ? {}
      : { lastAlerted: optional(listing.lastAlerted) }),
    favorite: listing.favorite === 1,
    evaluations: (byListing.get(listing.id) ?? []).map((match) => ({
      watchlistId: match.watchlistId,
      watchlistName: match.watchlistName,
      verdict: JSON.parse(match.verdictJson) as FilterVerdict,
      firstSeen: match.firstSeen,
      lastSeen: match.lastSeen,
    })),
  }));
}

export function setFavorite(
  database: Database.Database,
  listingId: string,
  favorite: boolean,
  now: number,
): boolean {
  const exists = database
    .prepare('SELECT 1 FROM listings WHERE id = ?')
    .get(listingId);
  if (exists === undefined) return false;
  if (favorite) {
    database
      .prepare(
        'INSERT OR IGNORE INTO favorites (listing_id, created_at) VALUES (?, ?)',
      )
      .run(listingId, now);
  } else {
    database.prepare('DELETE FROM favorites WHERE listing_id = ?').run(listingId);
  }
  return true;
}

function count(database: Database.Database, sql: string, ...values: unknown[]): number {
  const row = database.prepare(sql).get(...values) as { value: number };
  return row.value;
}

export function diagnostics(
  database: Database.Database,
  databasePath: string,
  emailSettings: EmailSettingsRepository,
  thumbnailCache: ThumbnailCache,
  startedAt: number,
  now: number,
): Record<string, unknown> {
  const smtp = emailSettings.get();
  const lastListing = database
    .prepare('SELECT MAX(last_seen) AS value FROM listings')
    .get() as { value: number | null };
  const lastSend = database
    .prepare("SELECT MAX(updated_at) AS value FROM notifications WHERE state = 'sent'")
    .get() as { value: number | null };
  const migrations = database
    .prepare('SELECT version, name, applied_at AS appliedAt FROM schema_migrations ORDER BY version')
    .all();
  const thumbnails = thumbnailCache.stats();
  const databaseBytes = databasePath === ':memory:' ? 0 : statSync(databasePath).size;
  const disk = databasePath === ':memory:' ? undefined : statfsSync(databasePath);
  return {
    serverVersion: '0.0.0',
    extensionVersion: '0.0.0',
    database: {
      status: 'ok',
      bytes: databaseBytes,
      journalMode: String(database.pragma('journal_mode', { simple: true })),
      migrations,
    },
    lastListingIngestedAt: lastListing.value,
    listingsLast24Hours: count(
      database,
      'SELECT COUNT(*) AS value FROM listings WHERE last_seen >= ?',
      now - 24 * 60 * 60 * 1_000,
    ),
    parser: { sampledCards: 0, successRate: null },
    smtp: {
      configured: smtp?.verifiedAt !== undefined,
      lastSendAt: lastSend.value,
      lastError: smtp?.lastTestError ?? null,
    },
    notificationQueueDepth: count(
      database,
      "SELECT COUNT(*) AS value FROM notifications WHERE state IN ('queued', 'failed', 'retrying')",
    ),
    thumbnailCache: thumbnails,
    diskFreeBytes:
      disk === undefined ? null : Number(disk.bavail) * Number(disk.bsize),
    uptimeMs: Math.max(0, now - startedAt),
    generatedAt: now,
  };
}
