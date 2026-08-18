import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import Database from 'better-sqlite3';

import { applyMigrations, type Migration } from './migrations.js';

export function openDatabase(
  path: string,
  migrations: readonly Migration[],
  now: () => number = Date.now,
): Database.Database {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  }

  const database = new Database(path);
  try {
    database.pragma('journal_mode = WAL');
    database.pragma('busy_timeout = 5000');
    database.pragma('foreign_keys = ON');
    applyMigrations(database, migrations, now);
    if (path !== ':memory:') {
      chmodSync(path, 0o600);
    }
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
