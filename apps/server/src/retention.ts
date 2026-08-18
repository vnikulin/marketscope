import type Database from 'better-sqlite3';

const DAY_MS = 24 * 60 * 60 * 1_000;
const DAILY_MS = DAY_MS;

export function getRetentionDays(
  database: Database.Database,
): 7 | 30 | 90 | null {
  const row = database
    .prepare("SELECT value_json FROM settings WHERE key = 'retentionDays'")
    .get() as { value_json: string } | undefined;
  if (row === undefined) {
    return 30;
  }
  const parsed = JSON.parse(row.value_json) as unknown;
  if (parsed === null || parsed === 7 || parsed === 30 || parsed === 90) {
    return parsed;
  }
  throw new Error('Stored retentionDays setting is invalid');
}

export function setRetentionDays(
  database: Database.Database,
  days: 7 | 30 | 90 | null,
  now: number,
): void {
  database
    .prepare(
      `INSERT INTO settings (key, value_json, updated_at)
       VALUES ('retentionDays', ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = excluded.updated_at`,
    )
    .run(JSON.stringify(days), now);
}

export function pruneListings(
  database: Database.Database,
  now: number,
  retentionDays = getRetentionDays(database),
): number {
  if (retentionDays === null) {
    return 0;
  }
  const cutoff = now - retentionDays * DAY_MS;
  return database
    .prepare(
      `DELETE FROM listings
       WHERE last_seen < ?
         AND NOT EXISTS (
           SELECT 1 FROM favorites WHERE favorites.listing_id = listings.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM ignore_rules WHERE ignore_rules.listing_id = listings.id
         )`,
    )
    .run(cutoff).changes;
}

export function startRetentionJob(
  database: Database.Database,
  now: () => number = Date.now,
): NodeJS.Timeout {
  const timer = setInterval(() => {
    pruneListings(database, now());
  }, DAILY_MS);
  timer.unref();
  return timer;
}
