import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

import { createBackup, restoreBackup } from './backup.js';
import { openDatabase } from './database.js';
import { EmailSettingsRepository } from './email.js';
import { loadMigrations } from './migrations.js';
import { WatchlistRepository } from './watchlists.js';

function migrationsDirectory(): string {
  const sourceDirectory = fileURLToPath(
    new URL('../migrations', import.meta.url),
  );
  const builtDirectory = fileURLToPath(
    new URL('../../migrations', import.meta.url),
  );
  return existsSync(sourceDirectory) ? sourceDirectory : builtDirectory;
}

export async function writeLogicalBackup(
  databasePath: string,
  outputPath: string,
  includeHistory: boolean,
  now: number = Date.now(),
): Promise<void> {
  const database = openDatabase(
    resolve(databasePath),
    loadMigrations(migrationsDirectory()),
  );
  try {
    const backup = createBackup(
      database,
      new WatchlistRepository(database, () => now),
      new EmailSettingsRepository(database, () => now),
      now,
      includeHistory,
    );
    mkdirSync(dirname(resolve(outputPath)), { recursive: true, mode: 0o700 });
    writeFileSync(resolve(outputPath), `${JSON.stringify(backup, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
  } finally {
    database.close();
  }
}

export async function restoreLogicalBackup(
  databasePath: string,
  backupDirectory: string,
  inputPath: string,
  now: number = Date.now(),
): Promise<{ snapshot: string }> {
  const raw = readFileSync(resolve(inputPath), 'utf8');
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`Backup is not valid JSON: ${String(error)}`, {
      cause: error,
    });
  }
  const database = openDatabase(
    resolve(databasePath),
    loadMigrations(migrationsDirectory()),
  );
  try {
    const result = await restoreBackup(
      database,
      new WatchlistRepository(database, () => now),
      resolve(backupDirectory),
      value,
      now,
    );
    return { snapshot: join(resolve(backupDirectory), result.snapshot) };
  } finally {
    database.close();
  }
}

export async function writeDatabaseSnapshot(
  databasePath: string,
  outputPath: string,
): Promise<void> {
  mkdirSync(dirname(resolve(outputPath)), { recursive: true, mode: 0o700 });
  const database = new Database(resolve(databasePath), { readonly: true });
  try {
    await database.backup(resolve(outputPath));
  } finally {
    database.close();
  }
}

async function main(): Promise<void> {
  const databasePath = process.env.MARKETSCOPE_DATABASE_PATH;
  if (databasePath === undefined || databasePath.trim().length === 0) {
    throw new Error('MARKETSCOPE_DATABASE_PATH is required');
  }
  const [command, path, ...flags] = process.argv.slice(2);
  if (command === 'backup' && path !== undefined) {
    await writeLogicalBackup(
      databasePath,
      path,
      flags.includes('--include-history'),
    );
    process.stdout.write(`${resolve(path)}\n`);
    return;
  }
  if (command === 'restore' && path !== undefined) {
    const backupDirectory = process.env.MARKETSCOPE_BACKUP_DIRECTORY;
    if (backupDirectory === undefined || backupDirectory.trim().length === 0) {
      throw new Error('MARKETSCOPE_BACKUP_DIRECTORY is required');
    }
    const result = await restoreLogicalBackup(
      databasePath,
      backupDirectory,
      path,
    );
    process.stdout.write(
      `Restore complete. Safety snapshot: ${result.snapshot}\n`,
    );
    return;
  }
  if (command === 'snapshot' && path !== undefined) {
    await writeDatabaseSnapshot(databasePath, path);
    process.stdout.write(`${resolve(path)}\n`);
    return;
  }
  throw new Error(
    'Usage: maintenance.js backup <output> [--include-history] | restore <input> | snapshot <output>',
  );
}

if (
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  await main();
}
