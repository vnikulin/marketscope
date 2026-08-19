import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';

import type { EmailMessage, SendMail } from './email.js';
import { EmailSettingsRepository, sendSmtpMail } from './email.js';
import type { IngestListing, Watchlist } from './types.js';

const BACKOFF_MS = [60_000, 300_000, 900_000, 3_600_000, 21_600_000] as const;
const DEFAULT_POLL_MS = 1_000;

export interface NotificationWatchlist {
  id: string;
  name: string;
  relevance: number;
}

interface NotificationPayload {
  title: string;
  url: string;
  price?: number;
  priceText?: string;
  location?: string;
  firstSeen: number;
}

interface NotificationRow {
  id: string;
  listing_id: string;
  attempt_count: number;
  payload_json: string;
}

interface NotificationWatchlistRow {
  watchlist_name: string;
  relevance: number;
}

export function enqueueNotification(
  database: Database.Database,
  listingId: string,
  listing: IngestListing,
  watchlists: readonly NotificationWatchlist[],
  now: number,
): string | undefined {
  if (watchlists.length === 0) return undefined;
  const id = randomUUID();
  const payload: NotificationPayload = {
    title: listing.title,
    url: listing.url,
    ...(listing.price === undefined ? {} : { price: listing.price }),
    ...(listing.priceText === undefined
      ? {}
      : { priceText: listing.priceText }),
    ...(listing.location === undefined ? {} : { location: listing.location }),
    firstSeen: now,
  };
  database
    .prepare(
      `INSERT INTO notifications (
        id, listing_id, state, attempt_count, next_attempt_at, last_error,
        created_at, updated_at, payload_json
      ) VALUES (?, ?, 'queued', 0, ?, NULL, ?, ?, ?)`,
    )
    .run(id, listingId, now, now, now, JSON.stringify(payload));
  const insertWatchlist = database.prepare(
    `INSERT INTO notification_watchlists (
      notification_id, watchlist_id, watchlist_name, relevance
    ) VALUES (?, ?, ?, ?)`,
  );
  for (const watchlist of watchlists) {
    insertWatchlist.run(id, watchlist.id, watchlist.name, watchlist.relevance);
  }
  return id;
}

function formatPrice(payload: NotificationPayload): string {
  if (payload.priceText !== undefined && payload.priceText.trim().length > 0) {
    return payload.priceText.trim();
  }
  if (payload.price === undefined) return 'Price unknown';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: payload.price % 100 === 0 ? 0 : 2,
  }).format(payload.price / 100);
}

function relativeAge(firstSeen: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - firstSeen) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes === 1) return '1 minute ago';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return '1 hour ago';
  return `${hours} hours ago`;
}

function notificationMessage(
  payload: NotificationPayload,
  watchlists: readonly NotificationWatchlistRow[],
  now: number,
): EmailMessage {
  const price = formatPrice(payload);
  const watchlistLines = watchlists.map(
    (watchlist) =>
      `Watchlist: ${watchlist.watchlist_name}\nRelevance: ${watchlist.relevance}`,
  );
  return {
    subject: `MarketScope: ${payload.title} - ${price}`,
    text: [
      payload.title,
      '',
      `Price: ${price}`,
      `Location: ${payload.location ?? 'Unknown'}`,
      ...watchlistLines,
      `First seen: ${relativeAge(payload.firstSeen, now)}`,
      '',
      `OPEN LISTING  ${payload.url}`,
    ].join('\n'),
  };
}

function safeError(error: unknown, secrets: readonly string[]): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of secrets) {
    if (secret.length > 0) message = message.replaceAll(secret, '[REDACTED]');
  }
  return message.slice(0, 1_000);
}

export class NotificationWorker {
  readonly #database: Database.Database;
  readonly #settings: EmailSettingsRepository;
  readonly #now: () => number;
  readonly #sendMail: SendMail;
  #timer: ReturnType<typeof setInterval> | undefined;
  #processing = false;

  public constructor(
    database: Database.Database,
    settings: EmailSettingsRepository,
    now: () => number,
    sendMail: SendMail = sendSmtpMail,
  ) {
    this.#database = database;
    this.#settings = settings;
    this.#now = now;
    this.#sendMail = sendMail;
    this.#database
      .prepare(
        `UPDATE notifications SET state = 'retrying', next_attempt_at = ?,
           updated_at = ? WHERE state = 'sending'`,
      )
      .run(now(), now());
  }

  public start(intervalMs = DEFAULT_POLL_MS): void {
    if (this.#timer !== undefined) return;
    this.#timer = setInterval(() => void this.processDue(), intervalMs);
    this.#timer.unref();
    void this.processDue();
  }

  public stop(): void {
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  public async processDue(): Promise<number> {
    if (this.#processing) return 0;
    const config = this.#settings.get();
    if (config?.verifiedAt === undefined) return 0;
    this.#processing = true;
    let processed = 0;
    try {
      while (true) {
        const row = this.#database
          .prepare(
            `SELECT id, listing_id, attempt_count, payload_json
             FROM notifications
             WHERE state IN ('queued', 'failed', 'retrying')
               AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
             ORDER BY created_at, id LIMIT 1`,
          )
          .get(this.#now()) as NotificationRow | undefined;
        if (row === undefined) break;
        await this.#deliver(row, config);
        processed += 1;
      }
      return processed;
    } finally {
      this.#processing = false;
    }
  }

  async #deliver(
    row: NotificationRow,
    config: NonNullable<ReturnType<EmailSettingsRepository['get']>>,
  ): Promise<void> {
    this.#database
      .prepare(
        `UPDATE notifications SET state = 'sending', updated_at = ? WHERE id = ?`,
      )
      .run(this.#now(), row.id);
    const watchlists = this.#database
      .prepare(
        `SELECT watchlist_name, relevance FROM notification_watchlists
         WHERE notification_id = ? ORDER BY watchlist_name, watchlist_id`,
      )
      .all(row.id) as NotificationWatchlistRow[];
    try {
      await this.#sendMail(
        config,
        notificationMessage(
          JSON.parse(row.payload_json) as NotificationPayload,
          watchlists,
          this.#now(),
        ),
      );
      this.#database.transaction(() => {
        this.#database
          .prepare(
            `UPDATE notifications SET state = 'sent', attempt_count = ?,
               next_attempt_at = NULL, last_error = NULL, updated_at = ?
             WHERE id = ?`,
          )
          .run(row.attempt_count + 1, this.#now(), row.id);
        this.#database
          .prepare('UPDATE listings SET last_alerted = ? WHERE id = ?')
          .run(this.#now(), row.listing_id);
      })();
    } catch (error) {
      const attemptCount = row.attempt_count + 1;
      const delay = BACKOFF_MS[attemptCount - 1];
      const state =
        delay === undefined
          ? 'dead'
          : attemptCount === 1
            ? 'failed'
            : 'retrying';
      this.#database
        .prepare(
          `UPDATE notifications SET state = ?, attempt_count = ?,
             next_attempt_at = ?, last_error = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          state,
          attemptCount,
          delay === undefined ? null : this.#now() + delay,
          safeError(error, [config.password ?? '']),
          this.#now(),
          row.id,
        );
    }
  }
}

export function shouldAlertOnPriceChange(
  watchlist: Pick<Watchlist, 'alertOnPriceChange'>,
  previousPrice: number | null,
  currentPrice: number | null,
): boolean {
  if (
    previousPrice === currentPrice ||
    watchlist.alertOnPriceChange === 'NEVER'
  ) {
    return false;
  }
  if (watchlist.alertOnPriceChange === 'ANY') return true;
  return (
    previousPrice !== null &&
    currentPrice !== null &&
    currentPrice < previousPrice
  );
}
