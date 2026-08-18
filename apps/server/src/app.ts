import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import cookie from '@fastify/cookie';
import type Database from 'better-sqlite3';
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';

import { AuthService, type AuthenticatedSession } from './auth.js';
import { openDatabase } from './database.js';
import { ingestListings } from './listings.js';
import { loadMigrations, type Migration } from './migrations.js';
import {
  getRetentionDays,
  setRetentionDays,
  startRetentionJob,
} from './retention.js';
import {
  parseIngestListing,
  parseWatchlistInput,
  ValidationError,
} from './validation.js';
import { WatchlistRepository } from './watchlists.js';

const SETUP_ALLOWED_PATHS = new Set([
  '/health',
  '/api/setup/status',
  '/api/auth/preflight',
  '/api/setup',
]);

export interface ServerOptions {
  databasePath: string;
  logger?: boolean;
  migrations?: readonly Migration[];
  now?: () => number;
  startRetention?: boolean;
}

export interface MarketScopeServer {
  app: FastifyInstance;
  database: Database.Database;
}

function defaultMigrations(): Migration[] {
  const sourceDirectory = fileURLToPath(
    new URL('../migrations', import.meta.url),
  );
  const builtDirectory = fileURLToPath(
    new URL('../../migrations', import.meta.url),
  );
  const directory = existsSync(sourceDirectory)
    ? sourceDirectory
    : builtDirectory;
  return loadMigrations(directory);
}

function bodyRecord(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ValidationError('request body must be an object');
  }
  return body as Record<string, unknown>;
}

function stringField(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} must be a string`);
  }
  return value;
}

function preAuthCsrf(request: FastifyRequest): string | undefined {
  const value = request.headers['x-csrf-token'];
  return typeof value === 'string' ? value : undefined;
}

function requireSession(
  auth: AuthService,
  request: FastifyRequest,
  reply: FastifyReply,
  csrf: boolean,
): AuthenticatedSession | undefined {
  const session = auth.session(request);
  if (session === undefined) {
    const status = request.headers.authorization?.startsWith('Bearer ')
      ? 403
      : 401;
    void reply
      .code(status)
      .send({ error: status === 403 ? 'FORBIDDEN' : 'UNAUTHORIZED' });
    return undefined;
  }
  if (csrf && !auth.verifyCsrf(request, session)) {
    void reply.code(403).send({ error: 'CSRF_REJECTED' });
    return undefined;
  }
  return session;
}

function requireExtension(
  auth: AuthService,
  request: FastifyRequest,
  reply: FastifyReply,
): boolean {
  if (!auth.authenticateExtension(request)) {
    void reply.code(401).send({ error: 'INVALID_EXTENSION_TOKEN' });
    return false;
  }
  return true;
}

function sendNotFound(reply: FastifyReply): void {
  void reply.code(404).send({ error: 'NOT_FOUND' });
}

function clientErrorStatus(error: unknown): number | undefined {
  if (
    typeof error !== 'object' ||
    error === null ||
    !('statusCode' in error) ||
    typeof error.statusCode !== 'number'
  ) {
    return undefined;
  }
  return error.statusCode >= 400 && error.statusCode < 500
    ? error.statusCode
    : undefined;
}

export async function createServer(
  options: ServerOptions,
): Promise<MarketScopeServer> {
  const now = options.now ?? Date.now;
  const database = openDatabase(
    options.databasePath,
    options.migrations ?? defaultMigrations(),
    now,
  );
  const app = Fastify({ logger: options.logger ?? false });
  await app.register(cookie);

  const auth = new AuthService(database, now);
  const watchlists = new WatchlistRepository(database, now);
  const retentionTimer =
    options.startRetention === false
      ? undefined
      : startRetentionJob(database, now);

  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?', 1)[0] ?? request.url;
    if (!auth.hasAdmin() && !SETUP_ALLOWED_PATHS.has(path)) {
      await reply.code(428).send({ error: 'SETUP_REQUIRED' });
    }
  });

  app.addHook('onClose', async () => {
    if (retentionTimer !== undefined) {
      clearInterval(retentionTimer);
    }
    database.close();
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ValidationError) {
      void reply
        .code(400)
        .send({ error: 'VALIDATION_ERROR', message: error.message });
      return;
    }
    const statusCode = clientErrorStatus(error);
    if (statusCode !== undefined) {
      void reply
        .code(statusCode)
        .send({ error: 'BAD_REQUEST', message: String(error) });
      return;
    }
    app.log.error(error);
    void reply.code(500).send({ error: 'INTERNAL_SERVER_ERROR' });
  });

  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/api/setup/status', async () => ({ required: !auth.hasAdmin() }));

  app.get('/api/auth/preflight', async () => ({
    csrfToken: auth.issuePreAuthCsrf(),
  }));

  app.post('/api/setup', async (request, reply) => {
    if (!auth.consumePreAuthCsrf(preAuthCsrf(request))) {
      return reply.code(403).send({ error: 'CSRF_REJECTED' });
    }
    if (auth.hasAdmin()) {
      return reply.code(409).send({ error: 'ALREADY_CONFIGURED' });
    }
    const body = bodyRecord(request.body);
    const username = stringField(body, 'username');
    const password = stringField(body, 'password');
    if (username.trim().length === 0) {
      throw new ValidationError('username must be a non-empty string');
    }
    if (password.length < 12) {
      throw new ValidationError('password must be at least 12 characters');
    }
    const userId = await auth.createAdmin(username, password);
    const session = auth.createSession(userId, reply);
    return reply.code(201).send(session);
  });

  app.post('/api/auth/login', async (request, reply) => {
    if (!auth.consumePreAuthCsrf(preAuthCsrf(request))) {
      return reply.code(403).send({ error: 'CSRF_REJECTED' });
    }
    const retryAfterMs = auth.loginRateLimiter.retryAfterMs(request.ip);
    if (retryAfterMs > 0) {
      return reply
        .code(429)
        .header('retry-after', String(Math.ceil(retryAfterMs / 1_000)))
        .send({ error: 'LOGIN_LOCKED', retryAfterMs });
    }
    const body = bodyRecord(request.body);
    const userId = await auth.verifyLogin(
      stringField(body, 'username'),
      stringField(body, 'password'),
    );
    if (userId === undefined) {
      auth.loginRateLimiter.recordFailure(request.ip);
      return reply.code(401).send({ error: 'INVALID_CREDENTIALS' });
    }
    auth.loginRateLimiter.clear(request.ip);
    return reply.send(auth.createSession(userId, reply));
  });

  app.post('/api/auth/logout', async (request, reply) => {
    if (requireSession(auth, request, reply, true) === undefined) {
      return;
    }
    auth.logout(request, reply);
    return reply.code(204).send();
  });

  app.get('/api/auth/csrf', async (request, reply) => {
    const session = requireSession(auth, request, reply, false);
    if (session === undefined) {
      return;
    }
    return { csrfToken: auth.rotateCsrf(session) };
  });

  app.post('/api/extension-tokens', async (request, reply) => {
    if (requireSession(auth, request, reply, true) === undefined) {
      return;
    }
    const body = bodyRecord(request.body);
    const name = stringField(body, 'name');
    if (name.trim().length === 0) {
      throw new ValidationError('name must be a non-empty string');
    }
    return reply.code(201).send(auth.createExtensionToken(name));
  });

  app.delete<{ Params: { id: string } }>(
    '/api/extension-tokens/:id',
    async (request, reply) => {
      if (requireSession(auth, request, reply, true) === undefined) {
        return;
      }
      if (!auth.revokeExtensionToken(request.params.id)) {
        return sendNotFound(reply);
      }
      return reply.code(204).send();
    },
  );

  app.get('/api/watchlists', async (request, reply) => {
    if (requireSession(auth, request, reply, false) === undefined) {
      return;
    }
    return { watchlists: watchlists.list() };
  });

  app.post('/api/watchlists', async (request, reply) => {
    if (requireSession(auth, request, reply, true) === undefined) {
      return;
    }
    return reply
      .code(201)
      .send(watchlists.create(parseWatchlistInput(request.body)));
  });

  app.put<{ Params: { id: string } }>(
    '/api/watchlists/:id',
    async (request, reply) => {
      if (requireSession(auth, request, reply, true) === undefined) {
        return;
      }
      const updated = watchlists.update(
        request.params.id,
        parseWatchlistInput(request.body),
      );
      if (updated === undefined) {
        return sendNotFound(reply);
      }
      return updated;
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/watchlists/:id/duplicate',
    async (request, reply) => {
      if (requireSession(auth, request, reply, true) === undefined) {
        return;
      }
      const duplicate = watchlists.duplicate(request.params.id);
      if (duplicate === undefined) {
        return sendNotFound(reply);
      }
      return reply.code(201).send(duplicate);
    },
  );

  for (const operation of [
    { path: 'pause', enabled: false },
    { path: 'resume', enabled: true },
  ] as const) {
    app.post<{ Params: { id: string } }>(
      `/api/watchlists/:id/${operation.path}`,
      async (request, reply) => {
        if (requireSession(auth, request, reply, true) === undefined) {
          return;
        }
        const updated = watchlists.setEnabled(
          request.params.id,
          operation.enabled,
        );
        if (updated === undefined) {
          return sendNotFound(reply);
        }
        return updated;
      },
    );
  }

  app.delete<{ Params: { id: string } }>(
    '/api/watchlists/:id',
    async (request, reply) => {
      if (requireSession(auth, request, reply, true) === undefined) {
        return;
      }
      if (!watchlists.delete(request.params.id)) {
        return sendNotFound(reply);
      }
      return reply.code(204).send();
    },
  );

  app.get('/api/watchlists/export', async (request, reply) => {
    if (requireSession(auth, request, reply, false) === undefined) {
      return;
    }
    return {
      version: 1,
      exportedAt: now(),
      watchlists: watchlists.list().map((watchlist) => ({
        name: watchlist.name,
        searchUrl: watchlist.searchUrl,
        termMode: watchlist.termMode,
        requiredTerms: watchlist.requiredTerms,
        ...(watchlist.booleanExpression === undefined
          ? {}
          : { booleanExpression: watchlist.booleanExpression }),
        optionalTerms: watchlist.optionalTerms,
        excludedTerms: watchlist.excludedTerms,
        regexPatterns: watchlist.regexPatterns,
        priceRules: watchlist.priceRules,
        locationRules: watchlist.locationRules,
        listingTypeRules: watchlist.listingTypeRules,
        relevanceThreshold: watchlist.relevanceThreshold,
        emailEnabled: watchlist.emailEnabled,
        enabled: watchlist.enabled,
        ...(watchlist.ignoreOlderThanDays === undefined
          ? {}
          : { ignoreOlderThanDays: watchlist.ignoreOlderThanDays }),
        alertOnPriceChange: watchlist.alertOnPriceChange,
      })),
    };
  });

  app.post('/api/watchlists/import', async (request, reply) => {
    if (requireSession(auth, request, reply, true) === undefined) {
      return;
    }
    const body = bodyRecord(request.body);
    if (body.version !== 1 || !Array.isArray(body.watchlists)) {
      throw new ValidationError('watchlist import must use schema version 1');
    }
    const inputs = body.watchlists.map(parseWatchlistInput);
    const imported = database.transaction(() =>
      inputs.map((input) => watchlists.create(input)),
    )();
    return reply
      .code(201)
      .send({ imported: imported.length, watchlists: imported });
  });

  app.get('/api/extension/watchlists', async (request, reply) => {
    if (!requireExtension(auth, request, reply)) {
      return;
    }
    return { watchlists: watchlists.list(true) };
  });

  app.post('/api/extension/listings', async (request, reply) => {
    if (!requireExtension(auth, request, reply)) {
      return;
    }
    const body = bodyRecord(request.body);
    if (!Array.isArray(body.listings) || body.listings.length > 500) {
      throw new ValidationError(
        'listings must be an array with at most 500 items',
      );
    }
    const listings = body.listings.map(parseIngestListing);
    return reply.send(
      await ingestListings(database, watchlists, listings, now()),
    );
  });

  app.get('/api/listings', async (request, reply) => {
    if (requireSession(auth, request, reply, false) === undefined) {
      return;
    }
    return {
      listings: database
        .prepare(
          `SELECT id, source, source_listing_id AS sourceListingId,
             canonical_url AS url, title, description, price_cents AS price,
             price_text AS priceText, location, distance_miles AS distanceMiles,
             seller_name AS sellerName, first_seen AS firstSeen,
             last_seen AS lastSeen, last_alerted AS lastAlerted
           FROM listings ORDER BY first_seen DESC`,
        )
        .all(),
    };
  });

  app.get<{ Params: { id: string } }>(
    '/api/listings/:id/price-history',
    async (request, reply) => {
      if (requireSession(auth, request, reply, false) === undefined) {
        return;
      }
      const exists = database
        .prepare('SELECT 1 FROM listings WHERE id = ?')
        .get(request.params.id);
      if (exists === undefined) {
        return sendNotFound(reply);
      }
      return {
        history: database
          .prepare(
            `SELECT price_cents AS price, observed_at AS observedAt
             FROM listing_price_history
             WHERE listing_id = ? ORDER BY observed_at, id`,
          )
          .all(request.params.id),
      };
    },
  );

  app.get('/api/settings', async (request, reply) => {
    if (requireSession(auth, request, reply, false) === undefined) {
      return;
    }
    return { retentionDays: getRetentionDays(database) };
  });

  app.put('/api/settings/retention', async (request, reply) => {
    if (requireSession(auth, request, reply, true) === undefined) {
      return;
    }
    const body = bodyRecord(request.body);
    if (
      body.retentionDays !== null &&
      body.retentionDays !== 7 &&
      body.retentionDays !== 30 &&
      body.retentionDays !== 90
    ) {
      throw new ValidationError('retentionDays must be 7, 30, 90, or null');
    }
    setRetentionDays(database, body.retentionDays as 7 | 30 | 90 | null, now());
    return { retentionDays: getRetentionDays(database) };
  });

  return { app, database };
}
