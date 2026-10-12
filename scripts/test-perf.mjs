#!/usr/bin/env node
/**
 * Run the wall-clock performance budgets on their own.
 *
 *   npm run test:perf
 *
 * The SunScan fit budgets (< 1.5 s per house) are claims about the code on an
 * unloaded CPU. Inside the full parallel suite twenty workers compete for the
 * same cores and the timings measure the machine, not the code, so those tests
 * skip there and run here, alone, with SUNSCAN_PERF set.
 */
import { spawnSync } from 'node:child_process';

const result = spawnSync(
  'npx',
  [
    'vitest',
    'run',
    'packages/sunscan-core/test/fit-realdata.test.ts',
    'packages/sunscan-core/test/fit-synthetic.test.ts',
    '--maxWorkers=1',
  ],
  { stdio: 'inherit', shell: true, env: { ...process.env, SUNSCAN_PERF: '1' } },
);
process.exit(result.status ?? 1);
