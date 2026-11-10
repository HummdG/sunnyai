import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The API image holds only the workspaces `scripts/build-api.mjs` names, and
 * installs only what `apps/api/package.json` depends on. A `@sunny/*` package
 * the API imports but either list misses builds and tests fine here, then fails
 * to resolve in the container. This reads all three as text and holds them
 * together.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) out.push(...sourceFiles(file));
    else if (/\.(ts|mts|js|mjs)$/.test(name) && !name.endsWith('.d.ts')) out.push(file);
  }
  return out;
}

/** Every `@sunny/*` package named in an import, export or dynamic import under apps/api/src. */
function importedPackages(): Set<string> {
  const found = new Set<string>();
  const specifier =
    /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"](@sunny\/[a-z0-9-]+)(?:\/[^'"]*)?['"]/g;
  for (const file of sourceFiles(path.join(ROOT, 'apps', 'api', 'src'))) {
    for (const m of readFileSync(file, 'utf8').matchAll(specifier)) found.add(m[1]!);
  }
  return found;
}

/** The WORKSPACES array in the build script, read as text (the script builds on import). */
function buildWorkspaces(): string[] {
  const text = readFileSync(path.join(ROOT, 'scripts', 'build-api.mjs'), 'utf8');
  const block = /const WORKSPACES = \[([\s\S]*?)\];/.exec(text);
  if (!block) throw new Error('scripts/build-api.mjs has no WORKSPACES array');
  return [...block[1]!.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]!);
}

/** A workspace directory's package name, from its package.json. */
function packageName(dir: string): string {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, dir, 'package.json'), 'utf8')) as {
    name: string;
  };
  return pkg.name;
}

describe('the API build', () => {
  const imported = [...importedPackages()].sort();

  it('finds the packages the API imports', () => {
    expect(imported).toContain('@sunny/contracts');
    expect(imported).toContain('@sunny/heat-pump-engine');
  });

  it('copies every @sunny package the API imports', () => {
    const built = new Set(buildWorkspaces().map(packageName));
    expect(imported.filter((name) => !built.has(name))).toEqual([]);
  });

  it('depends on every @sunny package the API imports', () => {
    const pkg = JSON.parse(
      readFileSync(path.join(ROOT, 'apps', 'api', 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    const deps = new Set(Object.keys(pkg.dependencies ?? {}));
    expect(imported.filter((name) => !deps.has(name))).toEqual([]);
  });
});
