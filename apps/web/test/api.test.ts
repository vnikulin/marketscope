import { afterEach, describe, expect, it, vi } from 'vitest';

import { login, request } from '../src/api.js';

describe('web API client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refreshes a stale session CSRF token and retries the write once', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ csrfToken: 'preflight-token' }))
      .mockResolvedValueOnce(
        Response.json({ csrfToken: 'stale-session-token' }),
      )
      .mockResolvedValueOnce(
        Response.json({ error: 'CSRF_REJECTED' }, { status: 403 }),
      )
      .mockResolvedValueOnce(
        Response.json({ csrfToken: 'fresh-session-token' }),
      )
      .mockResolvedValueOnce(Response.json({ saved: true }));
    vi.stubGlobal('fetch', fetchMock);

    await login('admin', 'correct horse battery staple');
    await expect(
      request<{ saved: boolean }>('/api/settings/email', {
        method: 'PUT',
        body: JSON.stringify({ password: 'app-password' }),
      }),
    ).resolves.toEqual({ saved: true });

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls[3]?.[0]).toBe('/api/auth/csrf');
    const retriedHeaders = new Headers(fetchMock.mock.calls[4]?.[1]?.headers);
    expect(retriedHeaders.get('x-csrf-token')).toBe('fresh-session-token');
  });
});
