export class ApiError extends Error {
  public constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let csrfToken = '';
let csrfRefresh: Promise<string | undefined> | undefined;

async function responseMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string; error?: string };
    return body.message ?? body.error ?? `Request failed with ${response.status}`;
  } catch {
    return `Request failed with ${response.status}`;
  }
}

async function isCsrfRejection(response: Response): Promise<boolean> {
  if (response.status !== 403) return false;
  try {
    const body = (await response.clone().json()) as { error?: unknown };
    return body.error === 'CSRF_REJECTED';
  } catch {
    return false;
  }
}

async function refreshSessionCsrf(): Promise<string | undefined> {
  csrfRefresh ??= (async () => {
    const response = await fetch('/api/auth/csrf', {
      credentials: 'include',
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { csrfToken?: unknown };
    return typeof body.csrfToken === 'string' && body.csrfToken.length > 0
      ? body.csrfToken
      : undefined;
  })();

  try {
    return await csrfRefresh;
  } finally {
    csrfRefresh = undefined;
  }
}

export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const method = options.method ?? 'GET';
  const stateChanging = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  const headers = new Headers(options.headers);
  if (options.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const usesSessionCsrf =
    stateChanging && csrfToken.length > 0 && !headers.has('x-csrf-token');
  if (usesSessionCsrf) {
    headers.set('x-csrf-token', csrfToken);
  }
  let response = await fetch(path, {
    ...options,
    headers,
    credentials: 'include',
  });
  if (usesSessionCsrf && (await isCsrfRejection(response))) {
    const refreshedToken = await refreshSessionCsrf();
    if (refreshedToken !== undefined) {
      csrfToken = refreshedToken;
      headers.set('x-csrf-token', refreshedToken);
      response = await fetch(path, {
        ...options,
        headers,
        credentials: 'include',
      });
    }
  }
  if (!response.ok) throw new ApiError(response.status, await responseMessage(response));
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function establishSessionCsrf(): Promise<boolean> {
  try {
    const response = await request<{ csrfToken: string }>('/api/auth/csrf');
    csrfToken = response.csrfToken;
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return false;
    throw error;
  }
}

async function preflight(): Promise<string> {
  return (await request<{ csrfToken: string }>('/api/auth/preflight')).csrfToken;
}

export async function login(username: string, password: string): Promise<void> {
  const token = await preflight();
  const response = await request<{ csrfToken: string }>('/api/auth/login', {
    method: 'POST',
    headers: { 'x-csrf-token': token },
    body: JSON.stringify({ username, password }),
  });
  csrfToken = response.csrfToken;
}

export async function setup(username: string, password: string): Promise<void> {
  const token = await preflight();
  const response = await request<{ csrfToken: string }>('/api/setup', {
    method: 'POST',
    headers: { 'x-csrf-token': token },
    body: JSON.stringify({ username, password }),
  });
  csrfToken = response.csrfToken;
}

export async function logout(): Promise<void> {
  await request('/api/auth/logout', { method: 'POST' });
  csrfToken = '';
}

export async function restoreBackup(value: unknown): Promise<unknown> {
  return request('/api/restore', { method: 'POST', body: JSON.stringify(value) });
}
