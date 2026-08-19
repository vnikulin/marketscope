import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import cookie from '@fastify/cookie';
import type Database from 'better-sqlite3';
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';

import { AuthService, type AuthenticatedSession } from './auth.js';
import { createBackup, restoreBackup } from './backup.js';
import { openDatabase } from './database.js';
import {
  EMAIL_PRESETS,
  EmailSettingsRepository,
  parseSmtpConfig,
  publicEmailSettings,
  sendSmtpMail,
  type SendMail,
} from './email.js';
import { ingestListings } from './listings.js';
import { loadMigrations, type Migration } from './migrations.js';
import { NotificationWorker } from './notifications.js';
import { diagnostics, listPwaListings, setFavorite } from './pwa.js';
import {
  getRetentionDays,
  setRetentionDays,
  startRetentionJob,
} from './retention.js';
import {
  parseThumbnailUpload,
  parseIngestListing,
  parseWatchlistInput,
  ValidationError,
} from './validation.js';
import { WatchlistRepository } from './watchlists.js';
import { registerWebApp } from './web.js';
import {
  attachThumbnail,
  MAX_THUMBNAIL_BYTES,
  ThumbnailCache,
} from './thumbnails.js';

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
  startNotifications?: boolean;
  notificationPollIntervalMs?: number;
  sendMail?: SendMail;
  thumbnailDirectory?: string;
  thumbnailCacheMaxBytes?: number;
  backupDirectory?: string;
  webDirectory?: string;
}

export interface MarketScopeServer {
  app: FastifyInstance;
  database: Database.Database;
  notificationWorker: NotificationWorker;
  thumbnailCache: ThumbnailCache;
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

function defaultWebDirectory(): string | undefined {
  const sourceDirectory = fileURLToPath(
    new URL('../../web/dist', import.meta.url),
  );
  const builtDirectory = fileURLToPath(
    new URL('../../../web/dist', import.meta.url),
  );
  if (existsSync(sourceDirectory)) return sourceDirectory;
  return existsSync(builtDirectory) ? builtDirectory : undefined;
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
  const startedAt = now();
  const database = openDatabase(
    options.databasePath,
    options.migrations ?? defaultMigrations(),
    now,
  );
  const app = Fastify({ logger: options.logger ?? false });
  await app.register(cookie);

  const auth = new AuthService(database, now);
  const watchlists = new WatchlistRepository(database, now);
  const emailSettings = new EmailSettingsRepository(database, now);
  const sendMail = options.sendMail ?? sendSmtpMail;
  const notificationWorker = new NotificationWorker(
    database,
    emailSettings,
    now,
    sendMail,
  );
  const notificationsEnabled = options.startNotifications !== false;
  const thumbnailCache = new ThumbnailCache(
    options.thumbnailDirectory,
    options.thumbnailCacheMaxBytes,
  );
  const retentionTimer =
    options.startRetention === false
      ? undefined
      : startRetentionJob(database, now);
  if (notificationsEnabled) {
    notificationWorker.start(options.notificationPollIntervalMs);
  }

  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?', 1)[0] ?? request.url;
    if (
      !auth.hasAdmin() &&
      path.startsWith('/api/') &&
      !SETUP_ALLOWED_PATHS.has(path)
    ) {
      await reply.code(428).send({ error: 'SETUP_REQUIRED' });
    }
  });

  app.addHook('onClose', async () => {
    if (retentionTimer !== undefined) {
      clearInterval(retentionTimer);
    }
    notificationWorker.stop();
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

  app.get<{ Params: { file: string } }>(
    '/api/thumbnails/:file',
    async (request, reply) => {
      const match = /^([a-f0-9]{64})\.jpg$/.exec(request.params.file);
      if (match === null) return sendNotFound(reply);
      const hash = match[1];
      if (hash === undefined) return sendNotFound(reply);
      const bytes = thumbnailCache.read(hash);
      if (bytes === undefined) return sendNotFound(reply);
      return reply.type('image/jpeg').send(bytes);
    },
  );

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
    const result = await ingestListings(database, watchlists, listings, now());
    if (notificationsEnabled) void notificationWorker.processDue();
    return reply.send(result);
  });

  app.post('/api/extension/thumbnails', async (request, reply) => {
    if (!requireExtension(auth, request, reply)) {
      return;
    }
    const upload = parseThumbnailUpload(request.body);
    const bytes = Buffer.from(upload.jpegBase64, 'base64');
    if (bytes.byteLength > MAX_THUMBNAIL_BYTES) {
      throw new ValidationError('thumbnail exceeds the 200KB limit');
    }
    const hash = attachThumbnail(
      database,
      thumbnailCache,
      upload.sourceListingId,
      upload.url,
      bytes,
    );
    if (hash === undefined) return sendNotFound(reply);
    return reply.code(201).send({ hash });
  });

  app.get('/api/listings', async (request, reply) => {
    if (requireSession(auth, request, reply, false) === undefined) {
      return;
    }
    const view = (request.query as { view?: string }).view ?? 'history';
    if (!['matches', 'favorites', 'history', 'blocked'].includes(view)) {
      throw new ValidationError(
        'view must be matches, favorites, history, or blocked',
      );
    }
    const listings = listPwaListings(database).filter((listing) => {
      const passed = listing.evaluations.some(
        (evaluation) => evaluation.verdict.passed,
      );
      if (view === 'matches') return passed;
      if (view === 'favorites') return listing.favorite;
      if (view === 'blocked') {
        return listing.evaluations.length > 0 && !passed;
      }
      return true;
    });
    return { listings };
  });

  app.put<{ Params: { id: string } }>(
    '/api/listings/:id/favorite',
    async (request, reply) => {
      if (requireSession(auth, request, reply, true) === undefined) return;
      if (!setFavorite(database, request.params.id, true, now())) {
        return sendNotFound(reply);
      }
      return { favorite: true };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/listings/:id/favorite',
    async (request, reply) => {
      if (requireSession(auth, request, reply, true) === undefined) return;
      if (!setFavorite(database, request.params.id, false, now())) {
        return sendNotFound(reply);
      }
      return reply.code(204).send();
    },
  );

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

  app.get('/api/settings/email', async (request, reply) => {
    if (requireSession(auth, request, reply, false) === undefined) {
      return;
    }
    return {
      presets: EMAIL_PRESETS,
      settings: publicEmailSettings(emailSettings.get()),
    };
  });

  app.put('/api/settings/email', async (request, reply) => {
    if (requireSession(auth, request, reply, true) === undefined) {
      return;
    }
    return {
      settings: publicEmailSettings(
        emailSettings.save(parseSmtpConfig(request.body)),
      ),
    };
  });

  app.post('/api/settings/email/test', async (request, reply) => {
    if (requireSession(auth, request, reply, true) === undefined) {
      return;
    }
    const config = emailSettings.get();
    if (config === undefined) {
      return reply.code(409).send({ error: 'EMAIL_NOT_CONFIGURED' });
    }
    try {
      await sendMail(config, {
        subject: 'MarketScope test email',
        text: 'MarketScope sent this message to verify your SMTP settings.',
      });
    } catch (error) {
      let detail = error instanceof Error ? error.message : String(error);
      if (config.password !== undefined) {
        detail = detail.replaceAll(config.password, '[REDACTED]');
      }
      emailSettings.markTestFailed(detail.slice(0, 1_000));
      return reply
        .code(502)
        .send({ error: 'EMAIL_TEST_FAILED', message: detail.slice(0, 1_000) });
    }
    const verified = emailSettings.markVerified();
    if (notificationsEnabled) void notificationWorker.processDue();
    return { settings: publicEmailSettings(verified), sent: true };
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

  app.get('/api/dashboard', async (request, reply) => {
    if (requireSession(auth, request, reply, false) === undefined) return;
    const listings = listPwaListings(database);
    const activeWatchlists = watchlists
      .list()
      .filter((watchlist) => watchlist.enabled);
    const matchingListings = listings.filter((listing) =>
      listing.evaluations.some((evaluation) => evaluation.verdict.passed),
    );
    return {
      activeWatchlists: activeWatchlists.length,
      matches: matchingListings.length,
      favorites: listings.filter((listing) => listing.favorite).length,
      blocked: listings.filter(
        (listing) =>
          listing.evaluations.length > 0 &&
          !listing.evaluations.some((evaluation) => evaluation.verdict.passed),
      ).length,
      matchesLast24Hours: matchingListings.filter(
        (listing) => listing.lastSeen >= now() - 24 * 60 * 60 * 1_000,
      ).length,
      recentListings: matchingListings.slice(0, 5),
    };
  });

  app.get('/api/diagnostics', async (request, reply) => {
    if (requireSession(auth, request, reply, false) === undefined) return;
    return diagnostics(
      database,
      options.databasePath,
      emailSettings,
      thumbnailCache,
      startedAt,
      now(),
    );
  });

  app.get('/api/diagnostics/export', async (request, reply) => {
    if (requireSession(auth, request, reply, false) === undefined) return;
    const report = diagnostics(
      database,
      options.databasePath,
      emailSettings,
      thumbnailCache,
      startedAt,
      now(),
    );
    return reply
      .header(
        'content-disposition',
        `attachment; filename="marketscope-diagnostics-${new Date(now()).toISOString().slice(0, 10)}.json"`,
      )
      .send(report);
  });

  app.get('/api/backup', async (request, reply) => {
    if (requireSession(auth, request, reply, false) === undefined) return;
    const includeHistory =
      (request.query as { includeHistory?: string }).includeHistory === 'true';
    const date = new Date(now()).toISOString().slice(0, 10);
    return reply
      .header(
        'content-disposition',
        `attachment; filename="marketscope-backup-${date}.json"`,
      )
      .send(
        createBackup(
          database,
          watchlists,
          emailSettings,
          now(),
          includeHistory,
        ),
      );
  });

  app.post('/api/restore', async (request, reply) => {
    if (requireSession(auth, request, reply, true) === undefined) return;
    const backupDirectory =
      options.backupDirectory ?? join(dirname(options.databasePath), 'backups');
    const result = await restoreBackup(
      database,
      watchlists,
      backupDirectory,
      request.body,
      now(),
    );
    return { restored: true, ...result };
  });

  const webDirectory = options.webDirectory ?? defaultWebDirectory();
  if (webDirectory !== undefined) registerWebApp(app, webDirectory);

  return { app, database, notificationWorker, thumbnailCache };
}
