#!/usr/bin/env node
/**
 * Make sure a Java runtime exists for the Firebase emulators, without
 * installing anything system-wide.
 *
 *   node scripts/ensure-jre.mjs
 *
 * Downloads the latest Eclipse Temurin LTS JRE for this OS and architecture
 * from the official Adoptium API, verifies the archive against the SHA-256
 * the API publishes, and extracts it to `.cache/jre/<release>/` -- the
 * location `scripts/firestore-emulator.mjs` and `scripts/auth-emulator.mjs`
 * already look in. Idempotent: if a JRE is already there it prints its path
 * and does nothing. `.cache/` is gitignored.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const LTS_FEATURE_RELEASE = 21;
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const jreRoot = join(root, '.cache', 'jre');

/** The java executable inside an extracted JRE, if this is one. */
export function javaIn(dir) {
  for (const name of ['java.exe', 'java']) {
    const candidate = join(dir, 'bin', name);
    if (existsSync(candidate)) return candidate;
  }
  // macOS archives nest the runtime in Contents/Home.
  const mac = join(dir, 'Contents', 'Home', 'bin', 'java');
  return existsSync(mac) ? mac : null;
}

/** An already-extracted JRE under .cache/jre, or null. */
export async function existingJava() {
  const entries = await readdir(jreRoot).catch(() => []);
  for (const entry of entries) {
    const java = javaIn(join(jreRoot, entry));
    if (java) return java;
  }
  return null;
}

function platform() {
  const os = { win32: 'windows', darwin: 'mac', linux: 'linux' }[process.platform];
  const arch = { x64: 'x64', arm64: 'aarch64' }[process.arch];
  if (!os || !arch) throw new Error(`unsupported platform ${process.platform}/${process.arch}`);
  return { os, arch };
}

async function main() {
  const found = await existingJava();
  if (found) {
    console.log(`jre: already present at ${found}`);
    return found;
  }

  const { os, arch } = platform();
  const api =
    `https://api.adoptium.net/v3/assets/latest/${LTS_FEATURE_RELEASE}/hotspot` +
    `?architecture=${arch}&image_type=jre&os=${os}&vendor=eclipse`;
  const listing = await fetch(api);
  if (!listing.ok) throw new Error(`Adoptium API answered ${listing.status}`);
  const assets = await listing.json();
  const asset = assets[0];
  if (!asset?.binary?.package) throw new Error('Adoptium API returned no JRE for this platform');
  const { link, checksum, name } = asset.binary.package;
  console.log(`jre: downloading ${name} (${asset.release_name})`);

  const download = await fetch(link);
  if (!download.ok) throw new Error(`download failed: ${download.status}`);
  const bytes = Buffer.from(await download.arrayBuffer());
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== checksum) {
    throw new Error(`checksum mismatch for ${name}: expected ${checksum}, got ${actual}`);
  }
  console.log(`jre: sha256 ${actual} verified`);

  await mkdir(jreRoot, { recursive: true });
  const archive = join(jreRoot, name);
  await writeFile(archive, bytes);
  // bsdtar (bundled with Windows 10+, macOS and most Linux) reads both .zip and .tar.gz.
  // On Windows use the system bsdtar explicitly: a GNU tar earlier on PATH (Git
  // Bash) reads "C:\..." as a remote host and cannot open zip files.
  const systemTar = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe');
  const tar = process.platform === 'win32' && existsSync(systemTar) ? systemTar : 'tar';
  const extracted = spawnSync(tar, ['-xf', archive, '-C', jreRoot], { stdio: 'inherit' });
  await rm(archive, { force: true });
  if (extracted.status !== 0) throw new Error('could not extract the JRE archive');

  const java = await existingJava();
  if (!java) throw new Error('extracted the archive but found no bin/java in it');
  const version = spawnSync(java, ['-version'], { encoding: 'utf8' });
  console.log(`jre: ready at ${java}\n${(version.stderr || version.stdout).trim()}`);
  return java;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`jre: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
