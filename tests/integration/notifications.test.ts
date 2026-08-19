import { spawn, type ChildProcess } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { WatchlistInput } from '../../apps/server/src/types.js';
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

const MAILPIT_BIN = process.env.MAILPIT_BIN;

interface MailpitMessage {
  ID: string;
  Subject: string;
}

interface MailpitMessageList {
  messages: MailpitMessage[];
  total: number;
}

class MailpitHarness {
  readonly directory = mkdtempSync(join(tmpdir(), 'marketscope-mailpit-'));
  smtpPort = 0;
  httpPort = 0;
  process: ChildProcess | undefined;

  public async initialize(): Promise<void> {
    this.smtpPort = await freePort();
    this.httpPort = await freePort();
    await this.start();
  }

  public async start(): Promise<void> {
    if (MAILPIT_BIN === undefined) throw new Error('MAILPIT_BIN is required');
    this.process = spawn(
      MAILPIT_BIN,
      [
        '--smtp',
        `127.0.0.1:${this.smtpPort}`,
        '--listen',
        `127.0.0.1:${this.httpPort}`,
        '--database',
        join(this.directory, 'mailpit.db'),
        '--quiet',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    );
    let processOutput = '';
    this.process.stdout?.on('data', (chunk: Buffer) => {
      processOutput += chunk.toString();
    });
    this.process.stderr?.on('data', (chunk: Buffer) => {
      processOutput += chunk.toString();
    });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (this.process.exitCode !== null) {
        throw new Error(`Mailpit exited during startup: ${processOutput}`);
      }
      try {
        const response = await fetch(`${this.url}/api/v1/messages`);
        if (response.ok) return;
      } catch {
        // Mailpit needs a brief moment to bind both listeners.
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Mailpit did not become ready: ${processOutput}`);
  }

  public async stop(): Promise<void> {
    const child = this.process;
    this.process = undefined;
    if (child === undefined || child.exitCode !== null) return;
    const exited = new Promise<void>((resolve) =>
      child.once('exit', () => resolve()),
    );
    child.kill();
    await exited;
  }

  public async clear(): Promise<void> {
    const response = await fetch(`${this.url}/api/v1/messages`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error(`Mailpit clear failed with ${response.status}`);
    }
  }

  public async messages(): Promise<MailpitMessageList> {
    const response = await fetch(`${this.url}/api/v1/messages`);
    if (!response.ok) {
      throw new Error(`Mailpit list failed with ${response.status}`);
    }
    return (await response.json()) as MailpitMessageList;
  }

  public async latestText(): Promise<string> {
    const response = await fetch(`${this.url}/view/latest.txt`);
    if (!response.ok) {
      throw new Error(`Mailpit latest text failed with ${response.status}`);
    }
    return response.text();
  }

  public async dispose(): Promise<void> {
    await this.stop();
    rmSync(this.directory, { recursive: true, force: true });
  }

  public get url(): string {
    return `http://127.0.0.1:${this.httpPort}`;
  }
}

async function freePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    server.close();
    throw new Error('Could not allocate a local test port');
  }
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );
  return address.port;
}

async function configureEmail(
  testServer: TestServer,
  session: AdminSession,
  mailpit: MailpitHarness,
): Promise<void> {
  const save = await testServer.server.app.inject({
    method: 'PUT',
    url: '/api/settings/email',
    headers: adminHeaders(session),
    payload: {
      preset: 'CUSTOM',
      hostname: '127.0.0.1',
      port: mailpit.smtpPort,
      security: 'NONE',
      sender: 'MarketScope <marketscope@example.test>',
      recipients: ['buyer@example.test'],
    },
  });
  expect(save.statusCode).toBe(200);
  expect(save.json()).toMatchObject({
    settings: { configured: false, passwordConfigured: false },
  });

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
  await mailpit.clear();
}

interface DeliveryContext {
  session: AdminSession;
  extensionHeaders: Record<string, string>;
}

async function deliveryContext(
  testServer: TestServer,
  mailpit: MailpitHarness,
  watchlistInputs: readonly WatchlistInput[] = [VALID_WATCHLIST],
): Promise<DeliveryContext> {
  const session = await createAdmin(testServer);
  await configureEmail(testServer, session, mailpit);
  for (const input of watchlistInputs) {
    await createWatchlist(testServer, session, input);
  }
  const extension = await createExtensionToken(testServer, session);
  const extensionHeaders = { authorization: `Bearer ${extension.token}` };
  const seed = await testServer.server.app.inject({
    method: 'POST',
    url: '/api/extension/listings',
    headers: extensionHeaders,
    payload: { listings: [listing('seed')] },
  });
  expect(seed.statusCode).toBe(200);
  return { session, extensionHeaders };
}

async function ingestMatch(
  testServer: TestServer,
  headers: Record<string, string>,
  id = 'new-match',
): Promise<void> {
  const response = await testServer.server.app.inject({
    method: 'POST',
    url: '/api/extension/listings',
    headers,
    payload: { listings: [listing(id)] },
  });
  expect(response.statusCode).toBe(200);
}

describe
  .skipIf(MAILPIT_BIN === undefined)
  .sequential('M5 email delivery through Mailpit', () => {
    const mailpit = new MailpitHarness();
    let testServer: TestServer | undefined;

    beforeAll(async () => mailpit.initialize(), 15_000);

    afterEach(async () => {
      if (testServer !== undefined) {
        await closeTestServer(testServer);
        testServer = undefined;
      }
      if (mailpit.process !== undefined) await mailpit.clear();
    });

    afterAll(async () => mailpit.dispose());

    it('1. queues a notification for a new matching listing', async () => {
      testServer = await makeTestServer();
      const context = await deliveryContext(testServer, mailpit);
      await ingestMatch(testServer, context.extensionHeaders);
      expect(
        testServer.server.database
          .prepare('SELECT state FROM notifications')
          .get(),
      ).toEqual({ state: 'queued' });
    });

    it('2. delivers the queued notification to Mailpit', async () => {
      testServer = await makeTestServer();
      const context = await deliveryContext(testServer, mailpit);
      await ingestMatch(testServer, context.extensionHeaders);
      await testServer.server.notificationWorker.processDue();
      expect((await mailpit.messages()).total).toBe(1);
    });

    it('3. formats the required subject', async () => {
      testServer = await makeTestServer();
      const context = await deliveryContext(testServer, mailpit);
      await ingestMatch(testServer, context.extensionHeaders);
      await testServer.server.notificationWorker.processDue();
      const messages = await mailpit.messages();
      expect(messages.messages[0]?.Subject).toBe(
        'MarketScope: Garmin GPSMAP 1042xsv - $500',
      );
    });

    it('4. includes the canonical listing URL in the message body', async () => {
      testServer = await makeTestServer();
      const context = await deliveryContext(testServer, mailpit);
      await ingestMatch(testServer, context.extensionHeaders, 'body-link');
      await testServer.server.notificationWorker.processDue();
      expect(await mailpit.latestText()).toContain(
        'OPEN LISTING  https://www.facebook.com/marketplace/item/body-link/',
      );
    });

    it('5. does not re-alert for an unchanged listing', async () => {
      testServer = await makeTestServer();
      const context = await deliveryContext(testServer, mailpit);
      await ingestMatch(testServer, context.extensionHeaders, 'unchanged');
      await testServer.server.notificationWorker.processDue();
      testServer.clock.now += 60_000;
      await ingestMatch(testServer, context.extensionHeaders, 'unchanged');
      await testServer.server.notificationWorker.processDue();
      expect((await mailpit.messages()).total).toBe(1);
      expect(
        testServer.server.database
          .prepare('SELECT COUNT(*) AS count FROM notifications')
          .get(),
      ).toEqual({ count: 1 });
    });

    it('6. alerts when a configured watchlist sees a price decrease', async () => {
      testServer = await makeTestServer();
      const context = await deliveryContext(testServer, mailpit);
      testServer.clock.now += 60_000;
      const response = await testServer.server.app.inject({
        method: 'POST',
        url: '/api/extension/listings',
        headers: context.extensionHeaders,
        payload: {
          listings: [listing('seed', { price: 45_000, priceText: '$450' })],
        },
      });
      expect(response.statusCode).toBe(200);
      await testServer.server.notificationWorker.processDue();
      expect((await mailpit.messages()).messages[0]?.Subject).toBe(
        'MarketScope: Garmin GPSMAP 1042xsv - $450',
      );
    });

    it('7. retries SMTP failures with backoff, then dead letters without blocking ingest', async () => {
      testServer = await makeTestServer();
      const context = await deliveryContext(testServer, mailpit);
      await mailpit.stop();
      try {
        await ingestMatch(testServer, context.extensionHeaders, 'smtp-failure');
        expect(
          testServer.server.database
            .prepare('SELECT title FROM listings WHERE source_listing_id = ?')
            .get('smtp-failure'),
        ).toEqual({ title: 'Garmin GPSMAP 1042xsv' });

        await testServer.server.notificationWorker.processDue();
        expect(
          testServer.server.database
            .prepare('SELECT state, attempt_count FROM notifications')
            .get(),
        ).toEqual({ state: 'failed', attempt_count: 1 });

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
      } finally {
        await mailpit.start();
      }
    }, 20_000);

    it('8. sends one email naming every matching watchlist', async () => {
      testServer = await makeTestServer();
      const watchlists = [
        'Garmin Boats',
        'Chartplotter Deals',
        'Local GPS',
      ].map((name) => ({ ...VALID_WATCHLIST, name }));
      const context = await deliveryContext(testServer, mailpit, watchlists);
      await ingestMatch(testServer, context.extensionHeaders, 'three-lists');
      await testServer.server.notificationWorker.processDue();
      expect((await mailpit.messages()).total).toBe(1);
      const body = await mailpit.latestText();
      for (const watchlist of watchlists) {
        expect(body).toContain(`Watchlist: ${watchlist.name}`);
      }
    });
  });
