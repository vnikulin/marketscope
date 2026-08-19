import { afterEach, describe, expect, it } from 'vitest';

import type { EmailMessage, SendMail } from '../../apps/server/src/email.js';
import {
  adminHeaders,
  closeTestServer,
  createAdmin,
  createExtensionToken,
  createWatchlist,
  listing,
  makeTestServer,
  type AdminSession,
  type TestServer,
  VALID_WATCHLIST,
} from './helpers.js';

async function configureEmail(
  testServer: TestServer,
  session: AdminSession,
  password = 'smtp-test-secret',
): Promise<void> {
  const save = await testServer.server.app.inject({
    method: 'PUT',
    url: '/api/settings/email',
    headers: adminHeaders(session),
    payload: {
      preset: 'CUSTOM',
      hostname: 'smtp.example.test',
      port: 2525,
      security: 'NONE',
      username: 'smtp-user',
      password,
      sender: 'marketscope@example.test',
      recipients: ['buyer@example.test'],
    },
  });
  expect(save.statusCode).toBe(200);
  expect(save.body).not.toContain(password);
  expect(save.json()).toMatchObject({ settings: { configured: false } });
  const test = await testServer.server.app.inject({
    method: 'POST',
    url: '/api/settings/email/test',
    headers: adminHeaders(session),
  });
  expect(test.statusCode).toBe(200);
  expect(test.json()).toMatchObject({
    settings: { configured: true },
    sent: true,
  });
}

async function extensionHeaders(
  testServer: TestServer,
  session: AdminSession,
): Promise<Record<string, string>> {
  const extension = await createExtensionToken(testServer, session);
  return { authorization: `Bearer ${extension.token}` };
}

async function ingest(
  testServer: TestServer,
  headers: Record<string, string>,
  ...listings: Record<string, unknown>[]
): Promise<void> {
  const response = await testServer.server.app.inject({
    method: 'POST',
    url: '/api/extension/listings',
    headers,
    payload: { listings },
  });
  expect(response.statusCode).toBe(200);
}

describe('notification queue behavior', () => {
  let testServer: TestServer | undefined;

  afterEach(async () => {
    if (testServer !== undefined) {
      await closeTestServer(testServer);
      testServer = undefined;
    }
  });

  it('requires a successful test send before delivering queued alerts', async () => {
    const delivered: EmailMessage[] = [];
    testServer = await makeTestServer(undefined, {
      sendMail: async (_config, message) => {
        delivered.push(message);
      },
    });
    const session = await createAdmin(testServer);
    const save = await testServer.server.app.inject({
      method: 'PUT',
      url: '/api/settings/email',
      headers: adminHeaders(session),
      payload: {
        preset: 'CUSTOM',
        hostname: 'smtp.example.test',
        port: 2525,
        security: 'NONE',
        sender: 'marketscope@example.test',
        recipients: ['buyer@example.test'],
      },
    });
    expect(save.statusCode).toBe(200);
    await createWatchlist(testServer, session);
    const headers = await extensionHeaders(testServer, session);
    await ingest(testServer, headers, listing('seed'));
    await ingest(testServer, headers, listing('new'));
    expect(
      testServer.server.database
        .prepare('SELECT state FROM notifications')
        .get(),
    ).toEqual({ state: 'queued' });
    expect(await testServer.server.notificationWorker.processDue()).toBe(0);
    expect(delivered).toEqual([]);
  });

  it('sends one message naming all matching watchlists', async () => {
    const delivered: EmailMessage[] = [];
    testServer = await makeTestServer(undefined, {
      sendMail: async (_config, message) => {
        delivered.push(message);
      },
    });
    const session = await createAdmin(testServer);
    await configureEmail(testServer, session);
    delivered.length = 0;
    for (const name of ['Garmin Boats', 'Chartplotter Deals', 'Local GPS']) {
      await createWatchlist(testServer, session, { ...VALID_WATCHLIST, name });
    }
    const headers = await extensionHeaders(testServer, session);
    await ingest(testServer, headers, listing('seed'));
    await ingest(testServer, headers, listing('combined'));
    expect(await testServer.server.notificationWorker.processDue()).toBe(1);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.subject).toBe(
      'MarketScope: Garmin GPSMAP 1042xsv - $500',
    );
    expect(delivered[0]?.text).toContain(
      'OPEN LISTING  https://www.facebook.com/marketplace/item/combined/',
    );
    for (const name of ['Garmin Boats', 'Chartplotter Deals', 'Local GPS']) {
      expect(delivered[0]?.text).toContain(`Watchlist: ${name}`);
    }
  });

  it('does not re-alert unchanged listings and honors price decrease rules', async () => {
    const delivered: EmailMessage[] = [];
    testServer = await makeTestServer(undefined, {
      sendMail: async (_config, message) => {
        delivered.push(message);
      },
    });
    const session = await createAdmin(testServer);
    await configureEmail(testServer, session);
    delivered.length = 0;
    await createWatchlist(testServer, session);
    const headers = await extensionHeaders(testServer, session);
    await ingest(testServer, headers, listing('price-listing'));
    testServer.clock.now += 60_000;
    await ingest(testServer, headers, listing('price-listing'));
    expect(await testServer.server.notificationWorker.processDue()).toBe(0);
    testServer.clock.now += 60_000;
    await ingest(
      testServer,
      headers,
      listing('price-listing', { price: 45_000, priceText: '$450' }),
    );
    expect(await testServer.server.notificationWorker.processDue()).toBe(1);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.subject).toContain('$450');
  });

  it('uses every retry delay, redacts secrets, and dead letters after six failures', async () => {
    let failing = false;
    const sendMail: SendMail = async (config) => {
      if (failing) throw new Error(`SMTP rejected ${config.password}`);
    };
    testServer = await makeTestServer(undefined, { sendMail });
    const session = await createAdmin(testServer);
    await configureEmail(testServer, session);
    await createWatchlist(testServer, session);
    const headers = await extensionHeaders(testServer, session);
    await ingest(testServer, headers, listing('seed'));
    failing = true;
    await ingest(testServer, headers, listing('failure'));

    await testServer.server.notificationWorker.processDue();
    expect(
      testServer.server.database
        .prepare(
          'SELECT state, attempt_count, last_error AS lastError FROM notifications',
        )
        .get(),
    ).toEqual({
      state: 'failed',
      attempt_count: 1,
      lastError: 'SMTP rejected [REDACTED]',
    });

    for (const delay of [60_000, 300_000, 900_000, 3_600_000, 21_600_000]) {
      testServer.clock.now += delay;
      await testServer.server.notificationWorker.processDue();
    }
    expect(
      testServer.server.database
        .prepare(
          'SELECT state, attempt_count, next_attempt_at FROM notifications',
        )
        .get(),
    ).toEqual({ state: 'dead', attempt_count: 6, next_attempt_at: null });
  });
});
