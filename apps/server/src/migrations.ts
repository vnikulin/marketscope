import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type Database from 'better-sqlite3';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

const MIGRATION_FILE = /^(\d+)_([a-z0-9_-]+)\.sql$/i;

export function loadMigrations(directory: string): Migration[] {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && MIGRATION_FILE.test(entry.name))
    .map((entry) => {
      const match = MIGRATION_FILE.exec(entry.name);
      if (match === null) {
        throw new Error(`Invalid migration filename: ${entry.name}`);
      }
      const versionText = match[1];
      if (versionText === undefined) {
        throw new Error(`Migration filename has no version: ${entry.name}`);
      }
      return {
        version: Number.parseInt(versionText, 10),
        name: entry.name,
        sql: readFileSync(join(directory, entry.name), 'utf8'),
      };
    })
    .sort((left, right) => left.version - right.version);
}

export function applyMigrations(
  database: Database.Database,
  migrations: readonly Migration[],
  now: () => number = Date.now,
): void {
  const duplicateVersion = migrations.find(
    (migration, index) =>
      index > 0 && migration.version === migrations[index - 1]?.version,
  );
  if (duplicateVersion !== undefined) {
    throw new Error(`Duplicate migration version: ${duplicateVersion.version}`);
  }

  database.transaction(() => {
    database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at INTEGER NOT NULL
      )
    `);
    const applied = new Map(
      database
        .prepare('SELECT version, name FROM schema_migrations ORDER BY version')
        .all()
        .map((row) => {
          const typed = row as { version: number; name: string };
          return [typed.version, typed.name] as const;
        }),
    );

    for (const migration of migrations) {
      const appliedName = applied.get(migration.version);
      if (appliedName !== undefined && appliedName !== migration.name) {
        throw new Error(
          `Migration ${migration.version} was applied as ${appliedName}, not ${migration.name}`,
        );
      }
    }

    const record = database.prepare(
      'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
    );
    for (const migration of migrations) {
      if (applied.has(migration.version)) {
        continue;
      }
      database.exec(migration.sql);
      record.run(migration.version, migration.name, now());
    }
  })();
}
