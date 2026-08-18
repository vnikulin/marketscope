import { afterEach, describe, expect, it } from 'vitest';

import {
  adminHeaders,
  closeTestServer,
  createAdmin,
  createWatchlist,
  makeTestServer,
  VALID_WATCHLIST,
  type TestServer,
} from './helpers.js';

describe('watchlist operations', () => {
  let testServer: TestServer | undefined;

  afterEach(async () => {
    if (testServer !== undefined) {
      await closeTestServer(testServer);
      testServer = undefined;
    }
  });

  it('creates, edits, duplicates, pauses, resumes, exports, imports, and deletes', async () => {
    testServer = await makeTestServer();
    const session = await createAdmin(testServer);
    const headers = adminHeaders(session);
    const original = await createWatchlist(testServer, session);
    expect(original.seeded).toBe(false);

    const maliciousName = "Garmin'); DROP TABLE watchlists; --";
    const edited = await testServer.server.app.inject({
      method: 'PUT',
      url: `/api/watchlists/${original.id}`,
      headers,
      payload: {
        ...VALID_WATCHLIST,
        name: maliciousName,
        relevanceThreshold: 25,
      },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({
      id: original.id,
      name: maliciousName,
      relevanceThreshold: 25,
      seeded: false,
    });

    const duplicate = await testServer.server.app.inject({
      method: 'POST',
      url: `/api/watchlists/${original.id}/duplicate`,
      headers,
    });
    expect(duplicate.statusCode).toBe(201);
    const duplicateBody = duplicate.json<{
      id: string;
      name: string;
      seeded: boolean;
    }>();
    expect(duplicateBody.id).not.toBe(original.id);
    expect(duplicateBody.name).toBe(`${maliciousName} (copy)`);
    expect(duplicateBody.seeded).toBe(false);

    const paused = await testServer.server.app.inject({
      method: 'POST',
      url: `/api/watchlists/${original.id}/pause`,
      headers,
    });
    expect(paused.json()).toMatchObject({ enabled: false });
    const resumed = await testServer.server.app.inject({
      method: 'POST',
      url: `/api/watchlists/${original.id}/resume`,
      headers,
    });
    expect(resumed.json()).toMatchObject({ enabled: true });

    const exported = await testServer.server.app.inject({
      method: 'GET',
      url: '/api/watchlists/export',
      headers: { cookie: session.cookie },
    });
    expect(exported.statusCode).toBe(200);
    const exportBody = exported.json<{
      version: number;
      watchlists: Array<Record<string, unknown>>;
    }>();
    expect(exportBody.version).toBe(1);
    expect(exportBody.watchlists).toHaveLength(2);
    expect(exportBody.watchlists[0]).not.toHaveProperty('id');
    expect(exportBody.watchlists[0]).not.toHaveProperty('seeded');

    const imported = await testServer.server.app.inject({
      method: 'POST',
      url: '/api/watchlists/import',
      headers,
      payload: { version: 1, watchlists: exportBody.watchlists },
    });
    expect(imported.statusCode).toBe(201);
    expect(imported.json()).toMatchObject({ imported: 2 });

    const invalidImport = await testServer.server.app.inject({
      method: 'POST',
      url: '/api/watchlists/import',
      headers,
      payload: {
        version: 1,
        watchlists: [VALID_WATCHLIST, { ...VALID_WATCHLIST, termMode: 'NOPE' }],
      },
    });
    expect(invalidImport.statusCode).toBe(400);

    const list = await testServer.server.app.inject({
      method: 'GET',
      url: '/api/watchlists',
      headers: { cookie: session.cookie },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json<{ watchlists: unknown[] }>().watchlists).toHaveLength(4);

    const deleted = await testServer.server.app.inject({
      method: 'DELETE',
      url: `/api/watchlists/${duplicateBody.id}`,
      headers,
    });
    expect(deleted.statusCode).toBe(204);
    expect(
      testServer.server.database
        .prepare('SELECT COUNT(*) AS count FROM watchlists')
        .get(),
    ).toEqual({ count: 3 });
  });
});
