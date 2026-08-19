import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';

import argon2 from 'argon2';
import type Database from 'better-sqlite3';
import type { FastifyReply, FastifyRequest } from 'fastify';

const SESSION_COOKIE = 'marketscope_session';
const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1_000;
const PRE_AUTH_CSRF_LIFETIME_MS = 15 * 60 * 1_000;
const LOGIN_WINDOW_MS = 15 * 60 * 1_000;

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
} as const;

interface SessionRow {
  user_id: string;
  csrf_token_hash: string;
  expires_at: number;
}

interface LoginState {
  failures: number[];
  lockLevel: number;
  lockedUntil: number;
}

export interface AuthenticatedSession {
  userId: string;
  csrfHash: string;
}

export interface SessionCredentials {
  csrfToken: string;
  expiresAt: number;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function createToken(): string {
  return randomBytes(32).toString('base64url');
}

function bearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (header === undefined || !header.startsWith('Bearer ')) {
    return undefined;
  }
  const token = header.slice('Bearer '.length).trim();
  return token.length === 0 ? undefined : token;
}

export class LoginRateLimiter {
  readonly #states = new Map<string, LoginState>();
  readonly #now: () => number;

  public constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  public retryAfterMs(ip: string): number {
    const state = this.#states.get(ip);
    if (state === undefined) {
      return 0;
    }
    return Math.max(0, state.lockedUntil - this.#now());
  }

  public recordFailure(ip: string): void {
    const now = this.#now();
    const state = this.#states.get(ip) ?? {
      failures: [],
      lockLevel: 0,
      lockedUntil: 0,
    };
    state.failures = state.failures.filter(
      (timestamp) => timestamp > now - LOGIN_WINDOW_MS,
    );
    state.failures.push(now);
    if (state.failures.length >= 5) {
      state.lockLevel += 1;
      state.lockedUntil = now + LOGIN_WINDOW_MS * 2 ** (state.lockLevel - 1);
      state.failures = [];
    }
    this.#states.set(ip, state);
  }

  public clear(ip: string): void {
    this.#states.delete(ip);
  }
}

export class AuthService {
  readonly #database: Database.Database;
  readonly #now: () => number;
  readonly #sessionSigningKey: string | undefined;
  readonly #preAuthCsrf = new Map<string, number>();
  readonly loginRateLimiter: LoginRateLimiter;

  public constructor(
    database: Database.Database,
    now: () => number = Date.now,
    sessionSigningKey?: string,
  ) {
    this.#database = database;
    this.#now = now;
    this.#sessionSigningKey = sessionSigningKey;
    this.loginRateLimiter = new LoginRateLimiter(now);
  }

  #hashSessionToken(token: string): string {
    return this.#sessionSigningKey === undefined
      ? hashToken(token)
      : createHmac('sha256', this.#sessionSigningKey)
          .update(token)
          .digest('hex');
  }

  public hasAdmin(): boolean {
    const row = this.#database.prepare('SELECT 1 FROM users LIMIT 1').get();
    return row !== undefined;
  }

  public issuePreAuthCsrf(): string {
    const token = createToken();
    this.#preAuthCsrf.set(
      this.#hashSessionToken(token),
      this.#now() + PRE_AUTH_CSRF_LIFETIME_MS,
    );
    return token;
  }

  public consumePreAuthCsrf(token: string | undefined): boolean {
    if (token === undefined) {
      return false;
    }
    const hash = this.#hashSessionToken(token);
    const expiresAt = this.#preAuthCsrf.get(hash);
    this.#preAuthCsrf.delete(hash);
    return expiresAt !== undefined && expiresAt > this.#now();
  }

  public async createAdmin(
    username: string,
    password: string,
  ): Promise<string> {
    if (this.hasAdmin()) {
      throw new Error('Administrator account already exists');
    }
    if (username.trim().length === 0) {
      throw new Error('Username is required');
    }
    if (password.length < 12) {
      throw new Error('Password must be at least 12 characters');
    }
    const userId = randomUUID();
    const timestamp = this.#now();
    const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);
    this.#database
      .prepare(
        `INSERT INTO users
          (id, username, password_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(userId, username.trim(), passwordHash, timestamp, timestamp);
    return userId;
  }

  public async verifyLogin(
    username: string,
    password: string,
  ): Promise<string | undefined> {
    const row = this.#database
      .prepare('SELECT id, password_hash FROM users WHERE username = ?')
      .get(username) as { id: string; password_hash: string } | undefined;
    if (row === undefined) {
      return undefined;
    }
    return (await argon2.verify(row.password_hash, password))
      ? row.id
      : undefined;
  }

  public createSession(
    userId: string,
    reply: FastifyReply,
  ): SessionCredentials {
    const token = createToken();
    const csrfToken = createToken();
    const timestamp = this.#now();
    const expiresAt = timestamp + SESSION_LIFETIME_MS;
    this.#database.transaction(() => {
      this.#database
        .prepare('DELETE FROM sessions WHERE user_id = ? OR expires_at <= ?')
        .run(userId, timestamp);
      this.#database
        .prepare(
          `INSERT INTO sessions
            (token_hash, user_id, csrf_token_hash, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          this.#hashSessionToken(token),
          userId,
          this.#hashSessionToken(csrfToken),
          timestamp,
          expiresAt,
        );
    })();
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_LIFETIME_MS / 1_000,
    });
    return { csrfToken, expiresAt };
  }

  public session(request: FastifyRequest): AuthenticatedSession | undefined {
    const token = request.cookies[SESSION_COOKIE];
    if (token === undefined) {
      return undefined;
    }
    const row = this.#database
      .prepare(
        `SELECT user_id, csrf_token_hash, expires_at
         FROM sessions
         WHERE token_hash = ?`,
      )
      .get(this.#hashSessionToken(token)) as SessionRow | undefined;
    if (row === undefined) {
      return undefined;
    }
    if (row.expires_at <= this.#now()) {
      this.#database
        .prepare('DELETE FROM sessions WHERE token_hash = ?')
        .run(this.#hashSessionToken(token));
      return undefined;
    }
    return { userId: row.user_id, csrfHash: row.csrf_token_hash };
  }

  public verifyCsrf(
    request: FastifyRequest,
    session: AuthenticatedSession,
  ): boolean {
    const token = request.headers['x-csrf-token'];
    return (
      typeof token === 'string' &&
      this.#hashSessionToken(token) === session.csrfHash
    );
  }

  public rotateCsrf(session: AuthenticatedSession): string {
    const csrfToken = createToken();
    this.#database
      .prepare('UPDATE sessions SET csrf_token_hash = ? WHERE user_id = ?')
      .run(this.#hashSessionToken(csrfToken), session.userId);
    return csrfToken;
  }

  public logout(request: FastifyRequest, reply: FastifyReply): void {
    const token = request.cookies[SESSION_COOKIE];
    if (token !== undefined) {
      this.#database
        .prepare('DELETE FROM sessions WHERE token_hash = ?')
        .run(this.#hashSessionToken(token));
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  public createExtensionToken(name: string): { id: string; token: string } {
    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      throw new Error('Token name is required');
    }
    const id = randomUUID();
    const token = `msx_${createToken()}`;
    this.#database
      .prepare(
        `INSERT INTO extension_tokens
          (id, name, token_hash, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(id, trimmedName, hashToken(token), this.#now());
    return { id, token };
  }

  public revokeExtensionToken(id: string): boolean {
    return (
      this.#database
        .prepare(
          'UPDATE extension_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
        )
        .run(this.#now(), id).changes === 1
    );
  }

  public authenticateExtension(request: FastifyRequest): boolean {
    const token = bearerToken(request);
    if (token === undefined) {
      return false;
    }
    const result = this.#database
      .prepare(
        `UPDATE extension_tokens
         SET last_used_at = ?
         WHERE token_hash = ? AND revoked_at IS NULL`,
      )
      .run(this.#now(), hashToken(token));
    return result.changes === 1;
  }
}
