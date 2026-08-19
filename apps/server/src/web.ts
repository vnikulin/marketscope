import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';

import type { FastifyInstance, FastifyReply } from 'fastify';

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

function safeFile(directory: string, pathname: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  const root = resolve(directory);
  const candidate = resolve(root, `.${decoded}`);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    return undefined;
  }
  if (!existsSync(candidate) || !statSync(candidate).isFile()) return undefined;
  return candidate;
}

function sendFile(reply: FastifyReply, path: string): FastifyReply {
  const extension = extname(path).toLowerCase();
  reply.type(CONTENT_TYPES[extension] ?? 'application/octet-stream');
  if (path.endsWith('sw.js') || path.endsWith('index.html')) {
    reply.header('cache-control', 'no-cache');
  } else if (path.includes(`${sep}assets${sep}`)) {
    reply.header('cache-control', 'public, max-age=31536000, immutable');
  }
  if (path.endsWith('sw.js')) reply.header('service-worker-allowed', '/');
  return reply.send(createReadStream(path));
}

export function registerWebApp(app: FastifyInstance, directory: string): void {
  const index = safeFile(directory, '/index.html');
  if (index === undefined) return;
  app.get('/*', async (request, reply) => {
    const pathname = request.url.split('?', 1)[0] ?? '/';
    const asset = safeFile(directory, pathname);
    if (asset !== undefined) return sendFile(reply, asset);
    if (extname(pathname).length > 0) {
      return reply.code(404).send({ error: 'NOT_FOUND' });
    }
    return sendFile(reply, index);
  });
}
