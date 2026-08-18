import { afterEach, describe, expect, it } from 'vitest';

import {
  adminHeaders,
  closeTestServer,
  createAdmin,
  createExtensionToken,
  createWatchlist,
  makeTestServer,
  preflight,
  responseCookie,
  VALID_WATCHLIST,
  type TestServer,
} from './helpers.js';

describe('server authentication', () => {
  let testServer: TestServer | undefined;

  afterEach(async () => {
    if (testServer !== undefined) {
      await closeTestServer(testServer);
      testServer = undefined;
    }
  });

  it('forces first-run setup and creates an Argon2id admin session', async () => {
    testServer = await makeTestServer();

    const gated = await testServer.server.app.inject({
      method: 'GET',
      url: '/api/watchlists',
    });
    expect(gated.statusCode).toBe(428);
    expect(gated.json()).toEqual({ error: 'SETUP_REQUIRED' });

    const missingCsrf = await testServer.server.app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: { username: 'admin', password: 'correct horse battery staple' },
    });
    expect(missingCsrf.statusCode).toBe(403);

    const setup = await testServer.server.app.inject({
      method: 'POST',
      url: '/api/setup',
      headers: { 'x-csrf-token': await preflight(testServer) },
      payload: { username: 'admin', password: 'correct horse battery staple' },
    });
    expect(setup.statusCode).toBe(201);
    const setCookie = String(setup.headers['set-cookie']);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Max-Age=2592000');

    const stored = testServer.server.database
      .prepare('SELECT username, password_hash FROM users')
      .get() as { username: string; password_hash: string };
    expect(stored.username).toBe('admin');
    expect(stored.password_hash).toMatch(/^\$argon2id\$/);
    expect(stored.password_hash).not.toContain('correct horse battery staple');

    const authenticated = await testServer.server.app.inject({
      method: 'GET',
      url: '/api/watchlists',
      headers: { cookie: responseCookie(setup) },
    });
    expect(authenticated.statusCode).toBe(200);

    const secondSetup = await testServer.server.app.inject({
      method: 'POST',
      url: '/api/setup',
      headers: { 'x-csrf-token': await preflight(testServer) },
      payload: { username: 'other', password: 'another long password' },
    });
    expect(secondSetup.statusCode).toBe(409);
  });

  it('rejects missing CSRF tokens and expired sessions', async () => {
    testServer = await makeTestServer();
    const session = await createAdmin(testServer);

    const missingCsrf = await testServer.server.app.inject({
      method: 'POST',
      url: '/api/watchlists',
      headers: { cookie: session.cookie },
      payload: VALID_WATCHLIST,
    });
    expect(missingCsrf.statusCode).toBe(403);
    expect(missingCsrf.json()).toEqual({ error: 'CSRF_REJECTED' });

    testServer.server.database
      .prepare('UPDATE sessions SET expires_at = ?')
      .run(testServer.clock.now - 1);
    const expired = await testServer.server.app.inject({
      method: 'GET',
      url: '/api/watchlists',
      headers: { cookie: session.cookie },
    });
    expect(expired.statusCode).toBe(401);
    expect(
      testServer.server.database
        .prepare('SELECT COUNT(*) AS count FROM sessions')
        .get(),
    ).toEqual({ count: 0 });
  });

  it('rate limits login after five failures in fifteen minutes', async () => {
    testServer = await makeTestServer();
    await createAdmin(testServer);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await testServer.server.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { 'x-csrf-token': await preflight(testServer) },
        payload: { username: 'admin', password: `wrong-password-${attempt}` },
      });
      expect(response.statusCode).toBe(401);
    }

    const locked = await testServer.server.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-csrf-token': await preflight(testServer) },
      payload: { username: 'admin', password: 'correct horse battery staple' },
    });
    expect(locked.statusCode).toBe(429);
    expect(locked.headers['retry-after']).toBe('900');
  });

  it('stores extension token hashes and enforces their narrow scope', async () => {
    testServer = await makeTestServer();
    const session = await createAdmin(testServer);
    await createWatchlist(testServer, session);
    const extension = await createExtensionToken(testServer, session);
    const bearer = { authorization: `Bearer ${extension.token}` };

    const stored = testServer.server.database
      .prepare('SELECT token_hash FROM extension_tokens WHERE id = ?')
      .get(extension.id) as { token_hash: string };
    expect(stored.token_hash).not.toBe(extension.token);
    expect(stored.token_hash).toMatch(/^[a-f0-9]{64}$/);

    const watchlists = await testServer.server.app.inject({
      method: 'GET',
      url: '/api/extension/watchlists',
      headers: bearer,
    });
    expect(watchlists.statusCode).toBe(200);

    const settingsWrite = await testServer.server.app.inject({
      method: 'PUT',
      url: '/api/settings/retention',
      headers: bearer,
      payload: { retentionDays: 7 },
    });
    expect(settingsWrite.statusCode).toBe(403);

    const watchlistWrite = await testServer.server.app.inject({
      method: 'POST',
      url: '/api/watchlists',
      headers: bearer,
      payload: VALID_WATCHLIST,
    });
    expect(watchlistWrite.statusCode).toBe(403);

    const revoked = await testServer.server.app.inject({
      method: 'DELETE',
      url: `/api/extension-tokens/${extension.id}`,
      headers: adminHeaders(session),
    });
    expect(revoked.statusCode).toBe(204);

    const afterRevoke = await testServer.server.app.inject({
      method: 'GET',
      url: '/api/extension/watchlists',
      headers: bearer,
    });
    expect(afterRevoke.statusCode).toBe(401);
  });
});
