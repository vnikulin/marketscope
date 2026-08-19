import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

import {
  restoreLogicalBackup,
  writeLogicalBackup,
} from '../../apps/server/src/maintenance.js';
import {
  adminHeaders,
  createAdmin,
  createExtensionToken,
  createWatchlist,
  makeTestServer,
} from './helpers.js';

describe('maintenance backup and restore', () => {
  test('round trips logical data without writing any installed secret', async () => {
    const testServer = await makeTestServer();
    const session = await createAdmin(testServer);
    await createWatchlist(testServer, session);
    const extension = await createExtensionToken(testServer, session);
    const smtpPassword = 'smtp-secret-from-maintenance-test';
    const sessionKey = 'session-signing-secret-from-maintenance-test';
    const email = await testServer.server.app.inject({
      method: 'PUT',
      url: '/api/settings/email',
      headers: adminHeaders(session),
      payload: {
        preset: 'CUSTOM',
        hostname: 'localhost',
        port: 1025,
        security: 'NONE',
        username: 'owner',
        password: smtpPassword,
        sender: 'marketscope@example.com',
        recipients: ['owner@example.com'],
      },
    });
    expect(email.statusCode).toBe(200);

    const directory = testServer.directory;
    const output = join(directory, 'marketscope-backup.json');
    const backupDirectory = join(directory, 'safety-snapshots');
    writeFileSync(join(directory, 'session.key'), sessionKey, 'utf8');
    await testServer.server.app.close();

    try {
      await writeLogicalBackup(testServer.databasePath, output, true);
      const serialized = readFileSync(output, 'utf8');
      expect(serialized).not.toContain(smtpPassword);
      expect(serialized).not.toContain(extension.token);
      expect(serialized).not.toContain(sessionKey);

      const database = new Database(testServer.databasePath);
      database.prepare('DELETE FROM watchlists').run();
      database.close();

      const restored = await restoreLogicalBackup(
        testServer.databasePath,
        backupDirectory,
        output,
      );
      expect(existsSync(restored.snapshot)).toBe(true);
      const verified = new Database(testServer.databasePath, {
        readonly: true,
      });
      expect(
        verified.prepare('SELECT COUNT(*) AS count FROM watchlists').get(),
      ).toEqual({ count: 1 });
      verified.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
