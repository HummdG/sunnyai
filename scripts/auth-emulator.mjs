#!/usr/bin/env node
/**
 * Start the Firebase Auth emulator for the sign-in tests.
 *
 *   npm run test:auth-emulator          # or: node scripts/auth-emulator.mjs
 *
 * The port (9099) is set in firebase.json.
 *
 * Project `demo-sunny`: a `demo-` project needs no real Firebase account or
 * credentials, and the emulator refuses to talk to production services for
 * it. Java comes from `.cache/jre` (fetched and checksum-verified by
 * `scripts/ensure-jre.mjs`) and is put on PATH for this process only.
 */
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { existingJava } from './ensure-jre.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

const java = process.env['SUNNY_JAVA'] ?? (await existingJava());
const env = { ...process.env };
if (java) {
  const sep = process.platform === 'win32' ? ';' : ':';
  env['PATH'] = `${dirname(java)}${sep}${env['PATH'] ?? env['Path'] ?? ''}`;
  if (process.platform === 'win32') env['Path'] = env['PATH'];
} else {
  console.warn(
    'auth-emulator: no JRE in .cache/jre; run `node scripts/ensure-jre.mjs` if the emulator needs one.',
  );
}

const firebase = join(root, 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js');
const child = spawn(
  process.execPath,
  [
    firebase,
    'emulators:start',
    '--only',
    'auth',
    '--project',
    'demo-sunny',
    '--config',
    join(root, 'firebase.json'),
  ],
  {
    cwd: root,
    env,
    stdio: 'inherit',
  },
);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 0));
