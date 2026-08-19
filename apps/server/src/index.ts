import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createServer } from './app.js';

const databasePath = process.env.MARKETSCOPE_DATABASE_PATH;
if (databasePath === undefined || databasePath.trim().length === 0) {
  throw new Error('MARKETSCOPE_DATABASE_PATH is required');
}

const sessionKeyPath = process.env.MARKETSCOPE_SESSION_KEY_PATH;
if (sessionKeyPath === undefined || sessionKeyPath.trim().length === 0) {
  throw new Error('MARKETSCOPE_SESSION_KEY_PATH is required');
}
const sessionSigningKey = readFileSync(resolve(sessionKeyPath), 'utf8').trim();
if (sessionSigningKey.length < 32) {
  throw new Error(
    'MarketScope session signing key must contain at least 32 characters',
  );
}

const { app } = await createServer({
  databasePath: resolve(databasePath),
  logger: true,
  sessionSigningKey,
  ...(process.env.MARKETSCOPE_THUMBNAIL_DIRECTORY === undefined
    ? {}
    : {
        thumbnailDirectory: resolve(
          process.env.MARKETSCOPE_THUMBNAIL_DIRECTORY,
        ),
      }),
  ...(process.env.MARKETSCOPE_BACKUP_DIRECTORY === undefined
    ? {}
    : { backupDirectory: resolve(process.env.MARKETSCOPE_BACKUP_DIRECTORY) }),
  serverVersion: process.env.MARKETSCOPE_VERSION ?? 'dev',
  extensionVersion: process.env.MARKETSCOPE_EXTENSION_VERSION ?? 'dev',
});

try {
  await app.listen({ host: '0.0.0.0', port: 3000 });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
