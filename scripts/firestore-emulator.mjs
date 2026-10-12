#!/usr/bin/env node
/**
 * Boot a Firestore emulator, point the test run at it, and tear it down.
 *
 * `npm run test:firestore` runs this, and it exists because the Firestore store
 * is the *production* store: the tests that hold it to the same contract as the
 * file store have to run somewhere, and a suite that only ever ran against a
 * temporary directory would leave the code that production actually executes
 * unexercised.
 *
 * The emulator is the official Cloud Firestore emulator -- the same JAR
 * `firebase-tools` downloads -- fetched straight from the URL the emulator
 * distribution publishes, so nothing here depends on `firebase-tools` being
 * installed. It needs a JRE, which this script looks for in the order a
 * developer would expect (see `findJava`).
 *
 * ## Why the variables are `SUNNY_FIRESTORE_*`
 *
 * The client library also honours `FIRESTORE_EMULATOR_HOST`, and this script
 * deliberately does not use it: `config.ts` reads `SUNNY_FIRESTORE_EMULATOR` for
 * the same reason, so that a stray ambient variable cannot redirect a process at
 * a throwaway database. A test runner that quietly relied on the conventional
 * name would make that choice a pretence.
 *
 * Nothing here is written to the repository: the JAR is cached under `.cache/`,
 * which is already ignored, and the emulator holds all state in memory and exits
 * with the process.
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { access, mkdir, open, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { looksLikeJar } from './lib/jar-archive.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const cache = join(repo, '.cache');
const JAR = join(cache, 'cloud-firestore-emulator-v1.19.9.jar');
const JAR_URL = `https://storage.googleapis.com/firebase-preview-drop/emulator/cloud-firestore-emulator-v1.19.9.jar`;
const LOG = join(cache, 'firestore-emulator.log');
const PROJECT = process.env.SUNNY_FIRESTORE_PROJECT ?? 'demo-sunny';
/** What to run once the emulator is up; overridable, so a new suite needs no edit. */
const TEST_ARGS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      'run',
      // Every suite with a Firestore half: the store contract, and the state
      // that must be shared across API instances (voice slots and minutes, the
      // email auto-reply cap).
      'apps/api/test/store-contract.test.ts',
      'apps/api/test/voice-shared-counters.test.ts',
      'apps/api/test/email-shared-state.test.ts',
    ];

/** Say something, and say it on the error stream where a failure can be read. */
function log(message) {
  process.stderr.write(`${message}\n`);
}

/**
 * A JRE, in the order that costs the user the least.
 *
 * A developer with Java installed should not have to install another one, CI
 * should be able to point at whatever `actions/setup-java` installed, and a
 * machine with neither can be told about `SUNNY_JAVA` rather than left to guess
 * why a Java program would not start.
 */
async function findJava() {
  if (process.env.SUNNY_JAVA) {
    await access(process.env.SUNNY_JAVA, constants.X_OK).catch(() => {
      throw new Error(`SUNNY_JAVA is set to ${process.env.SUNNY_JAVA}, which is not runnable`);
    });
    return process.env.SUNNY_JAVA;
  }

  // A JRE dropped under .cache/jre, for a machine that has none on PATH: the
  // download is not scripted here, because fetching and extracting a JDK is a
  // large, platform-specific job that would be its own script's, and a wrong
  // guess about which archive to fetch is worse than a clear message.
  const jreRoot = join(cache, 'jre');
  const candidates = await readdir(jreRoot).catch(() => []);
  for (const entry of candidates) {
    for (const name of ['java', 'java.exe']) {
      const candidate = join(jreRoot, entry, 'bin', name);
      if (await isFile(candidate)) return candidate;
    }
  }

  // Whatever is on PATH. Not `which`: spawning it is the only check that also
  // proves it runs, and on Windows `where` finds `java.exe` in a directory that
  // may still be a broken symlink or a stub.
  for (const name of ['java', 'java.exe']) {
    try {
      const child = spawn(name, ['-version'], { stdio: 'ignore' });
      const code = await new Promise((resolve) => {
        child.on('error', () => resolve(null));
        child.on('exit', (status) => resolve(status));
      });
      if (code !== null) return name;
    } catch {
      /* try the next name */
    }
  }

  throw new Error(
    'no Java runtime found. Install one, put a JRE at .cache/jre/<name>/bin/java, ' +
      'or set SUNNY_JAVA to the java executable.',
  );
}

async function isFile(path) {
  const info = await stat(path).catch(() => null);
  return info?.isFile() === true;
}

/**
 * The emulator JAR, fetched once.
 *
 * A downloaded file is untrusted input, so it is checked before it is used: what
 * is cached is either a whole archive or nothing. The alternative -- trusting a
 * 60 MB download because the URL looked right -- would turn a truncated or
 * substituted file into a confusing Java stack trace. `looksLikeJar` carries the
 * detail of what "whole" means here, and the reason it is not just a leading
 * `PK` (the artefact is self-executing, so it does not start with one).
 */
async function ensureJar() {
  if (await isFile(JAR)) return;
  await mkdir(cache, { recursive: true });
  log(`Downloading the Firestore emulator to ${JAR} …`);
  const response = await fetch(JAR_URL);
  if (!response.ok) {
    throw new Error(`the emulator download failed: HTTP ${response.status} from ${JAR_URL}`);
  }
  const declared = response.headers.get('content-length');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!looksLikeJar(bytes, declared === null ? undefined : Number(declared))) {
    throw new Error(`the emulator download is not a whole jar (${bytes.length} bytes)`);
  }
  await writeFile(JAR, bytes);
}

/** A port nobody holds, so a stale server on a fixed port cannot break a run. */
async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait for the emulator to answer, or for it to die trying.
 *
 * Polling the port rather than sleeping a fixed few seconds, because the first
 * run has to unpack a JAR and the machine may be doing anything else at the
 * time. Any HTTP response counts as ready -- including an error status, which is
 * still a live listener -- while a connection refused or a dead child does not.
 */
async function waitUntilReady(child, port, logPath) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) {
      const output = await readFileSafe(logPath);
      throw new Error(`the emulator exited with code ${child.exitCode}.\n${output}`);
    }
    try {
      await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) });
      return;
    } catch {
      await sleep(250);
    }
  }
  throw new Error(`the emulator did not answer on port ${port} within 30s`);
}

async function readFileSafe(path) {
  return readFile(path, 'utf8').catch(() => '(no emulator log)');
}

async function main() {
  const java = await findJava();
  await ensureJar();
  const port = await freePort();
  await mkdir(cache, { recursive: true });

  const out = await open(LOG, 'w');
  const emulator = spawn(
    java,
    ['-jar', JAR, '--host', '127.0.0.1', '--port', String(port), '--project', PROJECT],
    { cwd: cache, stdio: ['ignore', out.fd, out.fd] },
  );
  await out.close();

  let tests;
  try {
    await waitUntilReady(emulator, port, LOG);
    log(`Firestore emulator ready on 127.0.0.1:${port} (project ${PROJECT})`);
    // Vitest's own entry point through `node`, rather than `npx`: no shell in
    // between, so the process this script holds is the one running the tests and
    // the teardown below cannot leave a runner behind.
    tests = spawn(process.execPath, [join(repo, 'node_modules/vitest/vitest.mjs'), ...TEST_ARGS], {
      cwd: repo,
      stdio: 'inherit',
      env: {
        ...process.env,
        SUNNY_FIRESTORE_EMULATOR: `127.0.0.1:${port}`,
        SUNNY_FIRESTORE_PROJECT: PROJECT,
      },
    });
    const code = await new Promise((resolve) => tests.on('exit', resolve));
    process.exitCode = code ?? 1;
  } finally {
    // The emulator holds no state worth keeping, and leaving it running would
    // hold a port and a JVM for the rest of the session.
    emulator.kill();
    tests?.kill();
  }
}

main().catch((error) => {
  log(`\n${error.message}`);
  process.exitCode = 1;
});
