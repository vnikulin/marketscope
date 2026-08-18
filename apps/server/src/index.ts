import { resolve } from 'node:path';

import { createServer } from './app.js';

const databasePath = process.env.MARKETSCOPE_DATABASE_PATH;
if (databasePath === undefined || databasePath.trim().length === 0) {
  throw new Error('MARKETSCOPE_DATABASE_PATH is required');
}

const { app } = await createServer({
  databasePath: resolve(databasePath),
  logger: true,
});

try {
  await app.listen({ host: '0.0.0.0', port: 3000 });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
