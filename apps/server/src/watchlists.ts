import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';

import type { Watchlist, WatchlistInput } from './types.js';

interface WatchlistRow {
  id: string;
  name: string;
  search_url: string;
  term_mode: Watchlist['termMode'];
  required_terms_json: string;
  boolean_expression: string | null;
  optional_terms_json: string;
  excluded_terms_json: string;
  regex_patterns_json: string;
  price_rules_json: string;
  location_rules_json: string;
  listing_type_rules_json: string;
  relevance_threshold: number;
  email_enabled: number;
  enabled: number;
  ignore_older_than_days: number | null;
  alert_on_price_change: Watchlist['alertOnPriceChange'];
  seeded: number;
  created_at: number;
  updated_at: number;
}

function parseJson<T>(json: string): T {
  return JSON.parse(json) as T;
}

function toWatchlist(row: WatchlistRow): Watchlist {
  return {
    id: row.id,
    name: row.name,
    searchUrl: row.search_url,
    termMode: row.term_mode,
    requiredTerms: parseJson<Watchlist['requiredTerms']>(
      row.required_terms_json,
    ),
    ...(row.boolean_expression === null
      ? {}
      : { booleanExpression: row.boolean_expression }),
    optionalTerms: parseJson<Watchlist['optionalTerms']>(
      row.optional_terms_json,
    ),
    excludedTerms: parseJson<Watchlist['excludedTerms']>(
      row.excluded_terms_json,
    ),
    regexPatterns: parseJson<Watchlist['regexPatterns']>(
      row.regex_patterns_json,
    ),
    priceRules: parseJson<Watchlist['priceRules']>(row.price_rules_json),
    locationRules: parseJson<Watchlist['locationRules']>(
      row.location_rules_json,
    ),
    listingTypeRules: parseJson<Watchlist['listingTypeRules']>(
      row.listing_type_rules_json,
    ),
    relevanceThreshold: row.relevance_threshold,
    emailEnabled: row.email_enabled === 1,
    enabled: row.enabled === 1,
    ...(row.ignore_older_than_days === null
      ? {}
      : { ignoreOlderThanDays: row.ignore_older_than_days }),
    alertOnPriceChange: row.alert_on_price_change,
    seeded: row.seeded === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function values(input: WatchlistInput): readonly unknown[] {
  return [
    input.name,
    input.searchUrl,
    input.termMode,
    JSON.stringify(input.requiredTerms),
    input.booleanExpression ?? null,
    JSON.stringify(input.optionalTerms),
    JSON.stringify(input.excludedTerms),
    JSON.stringify(input.regexPatterns),
    JSON.stringify(input.priceRules),
    JSON.stringify(input.locationRules),
    JSON.stringify(input.listingTypeRules),
    input.relevanceThreshold,
    Number(input.emailEnabled),
    Number(input.enabled),
    input.ignoreOlderThanDays ?? null,
    input.alertOnPriceChange,
  ];
}

const SELECT_COLUMNS = `
  id, name, search_url, term_mode, required_terms_json, boolean_expression,
  optional_terms_json, excluded_terms_json, regex_patterns_json,
  price_rules_json, location_rules_json, listing_type_rules_json,
  relevance_threshold, email_enabled, enabled, ignore_older_than_days,
  alert_on_price_change, seeded, created_at, updated_at
`;

export class WatchlistRepository {
  readonly #database: Database.Database;
  readonly #now: () => number;

  public constructor(
    database: Database.Database,
    now: () => number = Date.now,
  ) {
    this.#database = database;
    this.#now = now;
  }

  public list(enabledOnly = false): Watchlist[] {
    const rows = this.#database
      .prepare(
        `SELECT ${SELECT_COLUMNS} FROM watchlists
         ${enabledOnly ? 'WHERE enabled = 1' : ''}
         ORDER BY created_at, id`,
      )
      .all() as WatchlistRow[];
    return rows.map(toWatchlist);
  }

  public get(id: string): Watchlist | undefined {
    const row = this.#database
      .prepare(`SELECT ${SELECT_COLUMNS} FROM watchlists WHERE id = ?`)
      .get(id) as WatchlistRow | undefined;
    return row === undefined ? undefined : toWatchlist(row);
  }

  public create(input: WatchlistInput): Watchlist {
    const id = randomUUID();
    const timestamp = this.#now();
    this.#database
      .prepare(
        `INSERT INTO watchlists (
          id, name, search_url, term_mode, required_terms_json,
          boolean_expression, optional_terms_json, excluded_terms_json,
          regex_patterns_json, price_rules_json, location_rules_json,
          listing_type_rules_json, relevance_threshold, email_enabled,
          enabled, ignore_older_than_days, alert_on_price_change, seeded,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      )
      .run(id, ...values(input), timestamp, timestamp);
    const created = this.get(id);
    if (created === undefined) {
      throw new Error('Created watchlist could not be loaded');
    }
    return created;
  }

  public update(id: string, input: WatchlistInput): Watchlist | undefined {
    const timestamp = this.#now();
    const result = this.#database
      .prepare(
        `UPDATE watchlists SET
          name = ?, search_url = ?, term_mode = ?, required_terms_json = ?,
          boolean_expression = ?, optional_terms_json = ?, excluded_terms_json = ?,
          regex_patterns_json = ?, price_rules_json = ?, location_rules_json = ?,
          listing_type_rules_json = ?, relevance_threshold = ?, email_enabled = ?,
          enabled = ?, ignore_older_than_days = ?, alert_on_price_change = ?,
          seeded = 0, updated_at = ?
         WHERE id = ?`,
      )
      .run(...values(input), timestamp, id);
    return result.changes === 0 ? undefined : this.get(id);
  }

  public duplicate(id: string): Watchlist | undefined {
    const source = this.get(id);
    if (source === undefined) {
      return undefined;
    }
    return this.create({
      name: `${source.name} (copy)`,
      searchUrl: source.searchUrl,
      termMode: source.termMode,
      requiredTerms: source.requiredTerms,
      ...(source.booleanExpression === undefined
        ? {}
        : { booleanExpression: source.booleanExpression }),
      optionalTerms: source.optionalTerms,
      excludedTerms: source.excludedTerms,
      regexPatterns: source.regexPatterns,
      priceRules: source.priceRules,
      locationRules: source.locationRules,
      listingTypeRules: source.listingTypeRules,
      relevanceThreshold: source.relevanceThreshold,
      emailEnabled: source.emailEnabled,
      enabled: source.enabled,
      ...(source.ignoreOlderThanDays === undefined
        ? {}
        : { ignoreOlderThanDays: source.ignoreOlderThanDays }),
      alertOnPriceChange: source.alertOnPriceChange,
    });
  }

  public setEnabled(id: string, enabled: boolean): Watchlist | undefined {
    const result = this.#database
      .prepare('UPDATE watchlists SET enabled = ?, updated_at = ? WHERE id = ?')
      .run(Number(enabled), this.#now(), id);
    return result.changes === 0 ? undefined : this.get(id);
  }

  public delete(id: string): boolean {
    return (
      this.#database.prepare('DELETE FROM watchlists WHERE id = ?').run(id)
        .changes === 1
    );
  }

  public markSeeded(ids: readonly string[]): void {
    if (ids.length === 0) {
      return;
    }
    const update = this.#database.prepare(
      'UPDATE watchlists SET seeded = 1, updated_at = ? WHERE id = ?',
    );
    const timestamp = this.#now();
    for (const id of ids) {
      update.run(timestamp, id);
    }
  }
}
