import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../../apps/server/src/database.js';
import { loadMigrations } from '../../apps/server/src/migrations.js';
import { closeTestServer, makeTestServer, type TestServer } from './helpers.js';

describe('database migrations', () => {
  let testServer: TestServer | undefined;

  afterEach(async () => {
    if (testServer !== undefined) {
      await closeTestServer(testServer);
      testServer = undefined;
    }
  });

  it('applies numbered migrations to a real SQLite file with required pragmas', async () => {
    testServer = await makeTestServer();
    const { database } = testServer.server;

    expect(existsSync(testServer.databasePath)).toBe(true);
    expect(database.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(database.pragma('busy_timeout', { simple: true })).toBe(5000);
    expect(
      database.prepare('SELECT version, name FROM schema_migrations').all(),
    ).toEqual([
      { version: 1, name: '001_initial.sql' },
      { version: 2, name: '002_notifications.sql' },
    ]);

    const tables = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tables).toEqual(
      expect.arrayContaining([
        'favorites',
        'ignore_rules',
        'listing_price_history',
        'listings',
        'notifications',
        'notification_watchlists',
        'schema_migrations',
        'sessions',
        'users',
        'watchlist_matches',
        'watchlists',
      ]),
    );
  });

  it('rolls every pending migration back when a later migration fails', () => {
    const directory = mkdtempSync(join(tmpdir(), 'marketscope-migration-'));
    const migrationDirectory = join(directory, 'migrations');
    const databasePath = join(directory, 'broken.db');
    try {
      writeFileSync(
        join(directory, 'placeholder'),
        'keeps the temporary target explicit',
      );
      const sourceMigrations = loadMigrations(
        join(process.cwd(), 'apps', 'server', 'migrations'),
      );
      expect(() =>
        openDatabase(databasePath, [
          ...sourceMigrations,
          {
            version: 3,
            name: '003_deliberately_broken.sql',
            sql: 'CREATE TABLE partial_state (id TEXT); THIS IS NOT SQL;',
          },
        ]),
      ).toThrow();

      const database = new Database(databasePath);
      const tables = database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all();
      database.close();
      expect(tables).toEqual([]);
      expect(existsSync(migrationDirectory)).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
