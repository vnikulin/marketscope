import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';
import { evaluate } from '@marketscope/filters';
import type {
  FilterVerdict,
  MarketplaceListing,
} from '@marketscope/shared-types';

import type { IngestListing, Watchlist } from './types.js';
import { toFilterDefinition } from './types.js';
import type { WatchlistRepository } from './watchlists.js';
import {
  enqueueNotification,
  shouldAlertOnPriceChange,
} from './notifications.js';

const DAY_MS = 24 * 60 * 60 * 1_000;

interface ExistingListingRow {
  id: string;
  price_cents: number | null;
}

interface EvaluatedListing {
  input: IngestListing;
  verdicts: Map<string, FilterVerdict>;
}

export interface IngestResult {
  observed: number;
  newListings: number;
  priceChanges: number;
  seededWatchlists: Array<{
    id: string;
    name: string;
    observed: number;
    message: string;
  }>;
}

function filterListing(input: IngestListing, now: number): MarketplaceListing {
  return {
    ...input,
    sourceListingId: input.sourceListingId ?? '',
    firstSeen: now,
    lastSeen: now,
  };
}

async function verdictFor(
  input: IngestListing,
  watchlist: Watchlist,
  now: number,
): Promise<FilterVerdict> {
  const verdict = await evaluate(
    filterListing(input, now),
    toFilterDefinition(watchlist),
  );
  if (
    watchlist.ignoreOlderThanDays === undefined ||
    input.postedAtEstimate === undefined
  ) {
    return verdict;
  }
  const passed =
    input.postedAtEstimate >= now - watchlist.ignoreOlderThanDays * DAY_MS;
  const ageCheck = {
    rule: `Posted within ${watchlist.ignoreOlderThanDays} days`,
    passed,
    detail: passed ? 'listing is recent enough' : 'listing is too old',
  };
  const checks = [...verdict.checks, ageCheck];
  const firstFailure = checks.find((check) => !check.passed);
  return {
    passed: firstFailure === undefined,
    checks,
    relevance: verdict.relevance,
    ...(firstFailure === undefined ? {} : { failedOn: firstFailure.rule }),
  };
}

async function evaluateListings(
  listings: readonly IngestListing[],
  watchlists: readonly Watchlist[],
  now: number,
): Promise<EvaluatedListing[]> {
  const results: EvaluatedListing[] = [];
  for (const input of listings) {
    const verdicts = new Map<string, FilterVerdict>();
    for (const watchlist of watchlists) {
      verdicts.set(watchlist.id, await verdictFor(input, watchlist, now));
    }
    results.push({ input, verdicts });
  }
  return results;
}

function storedListingValues(input: IngestListing): readonly unknown[] {
  return [
    input.sourceListingId ?? null,
    input.url,
    input.title,
    input.description ?? null,
    input.price ?? null,
    input.priceText ?? null,
    input.location ?? null,
    input.distanceMiles ?? null,
    input.imageUrl ?? null,
    input.imageHash ?? null,
    input.sellerName ?? null,
    Number(input.sponsored),
    Number(input.shipping),
    input.localPickup === undefined ? null : Number(input.localPickup),
    input.postedAtText ?? null,
    input.postedAtEstimate ?? null,
    input.rawText,
  ];
}

export async function ingestListings(
  database: Database.Database,
  watchlistRepository: WatchlistRepository,
  listings: readonly IngestListing[],
  now: number,
): Promise<IngestResult> {
  const watchlists = watchlistRepository.list(true);
  const evaluated = await evaluateListings(listings, watchlists, now);
  let newListings = 0;
  let priceChanges = 0;

  database.transaction(() => {
    const findExisting = database.prepare(
      `SELECT id, price_cents FROM listings
       WHERE source = 'facebook' AND (listing_key = ? OR canonical_url = ?)
       ORDER BY CASE WHEN listing_key = ? THEN 0 ELSE 1 END
       LIMIT 1`,
    );
    const insertListing = database.prepare(
      `INSERT INTO listings (
        id, source, listing_key, source_listing_id, canonical_url, title,
        description, price_cents, price_text, location, distance_miles,
        image_url, image_hash, seller_name, sponsored, shipping, local_pickup,
        posted_at_text, posted_at_estimate, raw_text, first_seen, last_seen
      ) VALUES (?, 'facebook', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const updateListing = database.prepare(
      `UPDATE listings SET
        listing_key = ?, source_listing_id = ?, canonical_url = ?, title = ?,
        description = ?, price_cents = ?, price_text = ?, location = ?,
        distance_miles = ?, image_url = ?, image_hash = ?, seller_name = ?,
        sponsored = ?, shipping = ?, local_pickup = ?, posted_at_text = ?,
        posted_at_estimate = ?, raw_text = ?, last_seen = ?
       WHERE id = ?`,
    );
    const insertPrice = database.prepare(
      `INSERT INTO listing_price_history (listing_id, price_cents, observed_at)
       VALUES (?, ?, ?)`,
    );
    const upsertMatch = database.prepare(
      `INSERT INTO watchlist_matches (
        watchlist_id, listing_id, verdict_json, relevance, first_seen,
        last_seen, initial_seed
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(watchlist_id, listing_id) DO UPDATE SET
        verdict_json = excluded.verdict_json,
        relevance = excluded.relevance,
        last_seen = excluded.last_seen`,
    );

    for (const item of evaluated) {
      const listingKey = item.input.sourceListingId
        ? `id:${item.input.sourceListingId}`
        : `url:${item.input.url}`;
      const existing = findExisting.get(
        listingKey,
        item.input.url,
        listingKey,
      ) as ExistingListingRow | undefined;
      const listingId = existing?.id ?? randomUUID();
      const priceCents = item.input.price ?? null;

      if (existing === undefined) {
        insertListing.run(
          listingId,
          listingKey,
          ...storedListingValues(item.input),
          now,
          now,
        );
        if (priceCents !== null) {
          insertPrice.run(listingId, priceCents, now);
        }
        newListings += 1;
      } else {
        updateListing.run(
          listingKey,
          ...storedListingValues(item.input),
          now,
          listingId,
        );
        if (existing.price_cents !== priceCents) {
          insertPrice.run(listingId, priceCents, now);
          priceChanges += 1;
        }
      }

      for (const watchlist of watchlists) {
        const verdict = item.verdicts.get(watchlist.id);
        if (verdict === undefined) {
          throw new Error(`Missing verdict for watchlist ${watchlist.id}`);
        }
        upsertMatch.run(
          watchlist.id,
          listingId,
          JSON.stringify(verdict),
          verdict.relevance,
          now,
          now,
          Number(!watchlist.seeded),
        );
      }

      const alertWatchlists = watchlists.flatMap((watchlist) => {
        const verdict = item.verdicts.get(watchlist.id);
        if (
          verdict === undefined ||
          !watchlist.seeded ||
          !watchlist.emailEnabled ||
          !verdict.passed
        ) {
          return [];
        }
        const shouldAlert =
          existing === undefined ||
          shouldAlertOnPriceChange(watchlist, existing.price_cents, priceCents);
        return shouldAlert
          ? [
              {
                id: watchlist.id,
                name: watchlist.name,
                relevance: verdict.relevance,
              },
            ]
          : [];
      });
      enqueueNotification(
        database,
        listingId,
        item.input,
        alertWatchlists,
        now,
      );
    }

    if (listings.length > 0) {
      watchlistRepository.markSeeded(
        watchlists
          .filter((watchlist) => !watchlist.seeded)
          .map((watchlist) => watchlist.id),
      );
    }
  })();

  return {
    observed: listings.length,
    newListings,
    priceChanges,
    seededWatchlists: watchlists
      .filter((watchlist) => !watchlist.seeded && listings.length > 0)
      .map((watchlist) => ({
        id: watchlist.id,
        name: watchlist.name,
        observed: listings.length,
        message: `Seeded ${listings.length} listings. Notifications begin with the next new match.`,
      })),
  };
}
