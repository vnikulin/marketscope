import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import type Database from 'better-sqlite3';

export const MAX_THUMBNAIL_BYTES = 200 * 1_024;
export const MAX_THUMBNAIL_CACHE_BYTES = 2 * 1_024 * 1_024 * 1_024;

interface CacheEntry {
  hash: string;
  path: string;
  size: number;
  lastUsed: number;
}

export class ThumbnailCache {
  readonly #directory: string;
  readonly #maxBytes: number;

  public constructor(
    directory = '/var/lib/marketscope/thumbnails',
    maxBytes = MAX_THUMBNAIL_CACHE_BYTES,
  ) {
    this.#directory = directory;
    this.#maxBytes = maxBytes;
  }

  public store(bytes: Buffer): string {
    if (bytes.byteLength > MAX_THUMBNAIL_BYTES) {
      throw new Error('Thumbnail exceeds the 200KB limit');
    }
    if (
      bytes.byteLength < 3 ||
      bytes[0] !== 0xff ||
      bytes[1] !== 0xd8 ||
      bytes[2] !== 0xff
    ) {
      throw new Error('Thumbnail is not a JPEG image');
    }
    mkdirSync(this.#directory, { recursive: true, mode: 0o700 });
    const hash = createHash('sha256').update(bytes).digest('hex');
    const path = this.path(hash);
    if (!existsSync(path)) writeFileSync(path, bytes, { mode: 0o600 });
    this.#touch(path);
    this.#evict(hash);
    return hash;
  }

  public read(hash: string): Buffer | undefined {
    if (!/^[a-f0-9]{64}$/.test(hash)) return undefined;
    const path = this.path(hash);
    if (!existsSync(path)) return undefined;
    const bytes = readFileSync(path);
    this.#touch(path);
    return bytes;
  }

  public path(hash: string): string {
    return join(this.#directory, `${hash}.jpg`);
  }

  public stats(): { files: number; bytes: number } {
    const entries = this.#entries();
    return {
      files: entries.length,
      bytes: entries.reduce((sum, entry) => sum + entry.size, 0),
    };
  }

  #entries(): CacheEntry[] {
    if (!existsSync(this.#directory)) return [];
    return readdirSync(this.#directory, { withFileTypes: true })
      .filter(
        (entry) => entry.isFile() && /^[a-f0-9]{64}\.jpg$/.test(entry.name),
      )
      .map((entry) => {
        const path = join(this.#directory, entry.name);
        const stats = statSync(path);
        return {
          hash: entry.name.slice(0, 64),
          path,
          size: stats.size,
          lastUsed: stats.mtimeMs,
        };
      });
  }

  #evict(protectedHash: string): void {
    const entries = this.#entries();
    let total = entries.reduce((sum, entry) => sum + entry.size, 0);
    entries.sort((left, right) => left.lastUsed - right.lastUsed);
    for (const entry of entries) {
      if (total <= this.#maxBytes) break;
      if (entry.hash === protectedHash) continue;
      rmSync(entry.path);
      total -= entry.size;
    }
  }

  #touch(path: string): void {
    const timestamp = new Date();
    utimesSync(path, timestamp, timestamp);
  }
}

export function attachThumbnail(
  database: Database.Database,
  cache: ThumbnailCache,
  sourceListingId: string | undefined,
  canonicalUrl: string,
  bytes: Buffer,
): string | undefined {
  const row = database
    .prepare(
      `SELECT id FROM listings WHERE source = 'facebook'
       AND (source_listing_id = ? OR canonical_url = ?)
       ORDER BY CASE WHEN source_listing_id = ? THEN 0 ELSE 1 END LIMIT 1`,
    )
    .get(sourceListingId ?? null, canonicalUrl, sourceListingId ?? null) as
    { id: string } | undefined;
  if (row === undefined) return undefined;
  const hash = cache.store(bytes);
  database
    .prepare('UPDATE listings SET image_hash = ? WHERE id = ?')
    .run(hash, row.id);
  return hash;
}
