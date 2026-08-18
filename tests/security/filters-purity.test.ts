import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

interface PackageManifest {
  dependencies?: Record<string, unknown>;
}

describe('@marketscope/filters package boundaries', () => {
  it('has no runtime dependencies', () => {
    const manifestPath = fileURLToPath(
      new URL('../../packages/filters/package.json', import.meta.url),
    );
    const manifest = JSON.parse(
      readFileSync(manifestPath, 'utf8'),
    ) as PackageManifest;

    expect(Object.keys(manifest.dependencies ?? {})).toEqual([]);
  });
});
