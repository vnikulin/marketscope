import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import type Database from 'better-sqlite3';

import type { EmailSettingsRepository } from './email.js';
import { getRetentionDays } from './retention.js';
import type { IngestListing } from './types.js';
import {
  parseIngestListing,
  parseWatchlistInput,
  ValidationError,
} from './validation.js';
import type { WatchlistRepository } from './watchlists.js';

interface BackupListing extends IngestListing {
  id: string;
  firstSeen: number;
  lastSeen: number;
  lastAlerted?: number;
}

interface MarketScopeBackup {
  version: 1;
  exportedAt: number;
  settings: {
    retentionDays: 7 | 30 | 90 | null;
    email?: Record<string, unknown>;
  };
  watchlists: unknown[];
  favorites: string[];
  ignoreRules: Array<{
    id: string;
    listingId?: string;
    rule: unknown;
    createdAt: number;
  }>;
  history?: {
    listings: BackupListing[];
    priceHistory: Array<{
      listingId: string;
      price?: number;
      observedAt: number;
    }>;
  };
}

function listingRows(database: Database.Database): BackupListing[] {
  const rows = database
    .prepare(
      `SELECT id, source_listing_id AS sourceListingId, canonical_url AS url,
         title, description, price_cents AS price, price_text AS priceText,
         location, distance_miles AS distanceMiles, image_url AS imageUrl,
         image_hash AS imageHash, seller_name AS sellerName, sponsored,
         shipping, local_pickup AS localPickup, posted_at_text AS postedAtText,
         posted_at_estimate AS postedAtEstimate, raw_text AS rawText,
         first_seen AS firstSeen, last_seen AS lastSeen,
         last_alerted AS lastAlerted
       FROM listings ORDER BY first_seen, id`,
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const listing = parseIngestListing({
      source: 'facebook',
      ...row,
      sponsored: row.sponsored === 1,
      shipping: row.shipping === 1,
      ...(row.localPickup === null
        ? { localPickup: undefined }
        : { localPickup: row.localPickup === 1 }),
    });
    return {
      id: String(row.id),
      ...listing,
      firstSeen: Number(row.firstSeen),
      lastSeen: Number(row.lastSeen),
      ...(row.lastAlerted === null
        ? {}
        : { lastAlerted: Number(row.lastAlerted) }),
    };
  });
}

export function createBackup(
  database: Database.Database,
  watchlists: WatchlistRepository,
  emailSettings: EmailSettingsRepository,
  now: number,
  includeHistory: boolean,
): MarketScopeBackup {
  const email = emailSettings.get();
  const safeEmail = email === undefined ? undefined : { ...email };
  if (safeEmail !== undefined) {
    delete safeEmail.password;
    delete safeEmail.verifiedAt;
    delete safeEmail.lastTestError;
  }
  const favorites = database
    .prepare(
      'SELECT listing_id AS listingId FROM favorites ORDER BY created_at, listing_id',
    )
    .all() as Array<{ listingId: string }>;
  const ignoreRules = database
    .prepare(
      `SELECT id, listing_id AS listingId, rule_json AS ruleJson,
         created_at AS createdAt FROM ignore_rules ORDER BY created_at, id`,
    )
    .all() as Array<{
    id: string;
    listingId: string | null;
    ruleJson: string;
    createdAt: number;
  }>;
  const favoriteIds = new Set(favorites.map((favorite) => favorite.listingId));
  const selectedListings = listingRows(database).filter(
    (listing) => includeHistory || favoriteIds.has(listing.id),
  );
  const selectedIds = new Set(selectedListings.map((listing) => listing.id));
  const history =
    selectedListings.length > 0
      ? {
          listings: selectedListings,
          priceHistory: (
            database
              .prepare(
                `SELECT listing_id AS listingId, price_cents AS price,
                 observed_at AS observedAt
               FROM listing_price_history ORDER BY observed_at, id`,
              )
              .all() as Array<{
              listingId: string;
              price: number | null;
              observedAt: number;
            }>
          )
            .filter((entry) => selectedIds.has(entry.listingId))
            .map((entry) => ({
              listingId: entry.listingId,
              ...(entry.price === null ? {} : { price: entry.price }),
              observedAt: entry.observedAt,
            })),
        }
      : undefined;
  return {
    version: 1,
    exportedAt: now,
    settings: {
      retentionDays: getRetentionDays(database),
      ...(safeEmail === undefined ? {} : { email: safeEmail }),
    },
    watchlists: watchlists.list().map((watchlist) => {
      const input: Record<string, unknown> = { ...watchlist };
      delete input.id;
      delete input.seeded;
      delete input.createdAt;
      delete input.updatedAt;
      return input;
    }),
    favorites: favorites.map((favorite) => favorite.listingId),
    ignoreRules: ignoreRules.map((rule) => ({
      id: rule.id,
      ...(rule.listingId === null ? {} : { listingId: rule.listingId }),
      rule: JSON.parse(rule.ruleJson) as unknown,
      createdAt: rule.createdAt,
    })),
    ...(history === undefined ? {} : { history }),
  };
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValidationError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function integer(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new ValidationError(`${name} must be a non-negative integer`);
  }
  return value;
}

function validateBackup(value: unknown): MarketScopeBackup {
  const body = record(value, 'backup');
  if (body.version !== 1) throw new ValidationError('backup version must be 1');
  const settings = record(body.settings, 'backup settings');
  const retentionDays = settings.retentionDays;
  if (![7, 30, 90, null].includes(retentionDays as 7 | 30 | 90 | null)) {
    throw new ValidationError('backup retentionDays is invalid');
  }
  if (
    !Array.isArray(body.watchlists) ||
    !Array.isArray(body.favorites) ||
    !Array.isArray(body.ignoreRules)
  ) {
    throw new ValidationError('backup collections are invalid');
  }
  const watchlists = body.watchlists.map(parseWatchlistInput);
  if (!body.favorites.every((id) => typeof id === 'string')) {
    throw new ValidationError('backup favorites are invalid');
  }
  const ignoreRules = body.ignoreRules.map((item) => {
    const rule = record(item, 'ignore rule');
    if (
      typeof rule.id !== 'string' ||
      (rule.listingId !== undefined && typeof rule.listingId !== 'string')
    ) {
      throw new ValidationError('backup ignore rule identifier is invalid');
    }
    return {
      id: rule.id,
      ...(rule.listingId === undefined ? {} : { listingId: rule.listingId }),
      rule: rule.rule,
      createdAt: integer(rule.createdAt, 'ignore rule createdAt'),
    };
  });
  let history: MarketScopeBackup['history'];
  if (body.history !== undefined) {
    const source = record(body.history, 'backup history');
    if (
      !Array.isArray(source.listings) ||
      !Array.isArray(source.priceHistory)
    ) {
      throw new ValidationError('backup history collections are invalid');
    }
    const listings = source.listings.map((item) => {
      const raw = record(item, 'backup listing');
      if (typeof raw.id !== 'string' || raw.id.length === 0) {
        throw new ValidationError('backup listing id is invalid');
      }
      return {
        id: raw.id,
        ...parseIngestListing(raw),
        firstSeen: integer(raw.firstSeen, 'listing firstSeen'),
        lastSeen: integer(raw.lastSeen, 'listing lastSeen'),
        ...(raw.lastAlerted === undefined
          ? {}
          : { lastAlerted: integer(raw.lastAlerted, 'listing lastAlerted') }),
      };
    });
    const ids = new Set(listings.map((listing) => listing.id));
    const priceHistory = source.priceHistory.map((item) => {
      const raw = record(item, 'price history');
      if (typeof raw.listingId !== 'string' || !ids.has(raw.listingId)) {
        throw new ValidationError(
          'price history references an unknown listing',
        );
      }
      const price =
        raw.price === undefined
          ? undefined
          : integer(raw.price, 'price history price');
      return {
        listingId: raw.listingId,
        ...(price === undefined ? {} : { price }),
        observedAt: integer(raw.observedAt, 'price history observedAt'),
      };
    });
    history = { listings, priceHistory };
  }
  const email =
    settings.email === undefined
      ? undefined
      : record(settings.email, 'email settings');
  if (email?.password !== undefined) {
    throw new ValidationError('backup must not contain an SMTP password');
  }
  return {
    version: 1,
    exportedAt: integer(body.exportedAt, 'backup exportedAt'),
    settings: {
      retentionDays: retentionDays as 7 | 30 | 90 | null,
      ...(email === undefined ? {} : { email }),
    },
    watchlists,
    favorites: body.favorites as string[],
    ignoreRules,
    ...(history === undefined ? {} : { history }),
  };
}

export async function restoreBackup(
  database: Database.Database,
  watchlists: WatchlistRepository,
  backupDirectory: string,
  value: unknown,
  now: number,
): Promise<{
  watchlists: number;
  listings: number;
  favorites: number;
  snapshot: string;
}> {
  const backup = validateBackup(value);
  mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
  const snapshot = `pre-restore-${now}.db`;
  await database.backup(join(backupDirectory, snapshot));
  const listings = backup.history?.listings ?? [];
  const listingIds = new Set(listings.map((listing) => listing.id));
  database.transaction(() => {
    database.prepare('DELETE FROM notification_watchlists').run();
    database.prepare('DELETE FROM notifications').run();
    database.prepare('DELETE FROM watchlist_matches').run();
    database.prepare('DELETE FROM listing_price_history').run();
    database.prepare('DELETE FROM favorites').run();
    database.prepare('DELETE FROM ignore_rules').run();
    database.prepare('DELETE FROM listings').run();
    database.prepare('DELETE FROM watchlists').run();
    database.prepare("DELETE FROM settings WHERE key = 'smtp'").run();
    database
      .prepare(
        `INSERT INTO settings (key, value_json, updated_at) VALUES ('retentionDays', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .run(JSON.stringify(backup.settings.retentionDays), now);
    if (backup.settings.email !== undefined) {
      database
        .prepare(
          'INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)',
        )
        .run('smtp', JSON.stringify(backup.settings.email), now);
    }
    for (const input of backup.watchlists)
      watchlists.create(parseWatchlistInput(input));
    const insertListing = database.prepare(
      `INSERT INTO listings (
        id, source, listing_key, source_listing_id, canonical_url, title,
        description, price_cents, price_text, location, distance_miles,
        image_url, image_hash, seller_name, sponsored, shipping, local_pickup,
        posted_at_text, posted_at_estimate, raw_text, first_seen, last_seen,
        last_alerted
      ) VALUES (?, 'facebook', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const listing of listings) {
      const key = listing.sourceListingId
        ? `id:${listing.sourceListingId}`
        : `url:${listing.url}`;
      insertListing.run(
        listing.id,
        key,
        listing.sourceListingId ?? null,
        listing.url,
        listing.title,
        listing.description ?? null,
        listing.price ?? null,
        listing.priceText ?? null,
        listing.location ?? null,
        listing.distanceMiles ?? null,
        listing.imageUrl ?? null,
        listing.imageHash ?? null,
        listing.sellerName ?? null,
        Number(listing.sponsored),
        Number(listing.shipping),
        listing.localPickup === undefined ? null : Number(listing.localPickup),
        listing.postedAtText ?? null,
        listing.postedAtEstimate ?? null,
        listing.rawText,
        listing.firstSeen,
        listing.lastSeen,
        listing.lastAlerted ?? null,
      );
    }
    const insertPrice = database.prepare(
      'INSERT INTO listing_price_history (listing_id, price_cents, observed_at) VALUES (?, ?, ?)',
    );
    for (const entry of backup.history?.priceHistory ?? []) {
      insertPrice.run(entry.listingId, entry.price ?? null, entry.observedAt);
    }
    const insertFavorite = database.prepare(
      'INSERT INTO favorites (listing_id, created_at) VALUES (?, ?)',
    );
    for (const id of backup.favorites) {
      if (listingIds.has(id)) insertFavorite.run(id, now);
    }
    const insertIgnore = database.prepare(
      'INSERT INTO ignore_rules (id, listing_id, rule_json, created_at) VALUES (?, ?, ?, ?)',
    );
    for (const rule of backup.ignoreRules) {
      insertIgnore.run(
        rule.id,
        rule.listingId !== undefined && listingIds.has(rule.listingId)
          ? rule.listingId
          : null,
        JSON.stringify(rule.rule),
        rule.createdAt,
      );
    }
  })();
  return {
    watchlists: backup.watchlists.length,
    listings: listings.length,
    favorites: backup.favorites.filter((id) => listingIds.has(id)).length,
    snapshot,
  };
}
