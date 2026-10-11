/**
 * Cross-tenant isolation, checked against a *running* deployment.
 *
 * `tests/security/tenant-isolation.test.ts` (D-35) is the thorough one: every
 * case in the route table, in process. This script asks a narrower question in a
 * different place, and the difference is the point -- an operator about to point
 * a customer's site at a deployment wants to know that *this* process, with its
 * real session secret, its real data directory and its real origin list, keeps
 * two installers apart. A suite that builds its own registry cannot answer that,
 * because the wiring it would be testing is the part it wrote itself.
 *
 * Three rules make the result mean something:
 *
 *   1. Every denial is paired with a control. "B's token cannot read A's
 *      catalogue" proves nothing if A's own token cannot read it either, so the
 *      allowed call is asserted first and the case fails if it does not succeed.
 *   2. A sweep that cannot tell the two tenants apart is refused rather than run.
 *      Two public ids that resolve to the same config, or to the same session,
 *      would make every case pass for the reason a broken test passes -- and a
 *      deployment that knows only one tenant is exactly that deployment, so this
 *      exits 2 and says so rather than reporting a green sweep.
 *   3. Nothing is asserted about a body without looking for the internal id in
 *      it. `t_...` is the string every store key is built from, and the leak that
 *      matters most here is not a wrong row but the identifier itself appearing
 *      in a response the browser receives. The check is about *that* id, not a
 *      general cull of identifiers: a catalogue row carries `sourceRef` and
 *      `documentRefs` deliberately, and they are not this.
 *
 * Usage:
 *   npm run verify:isolation
 *   SUNNY_API_URL=https://sunny-staging.example npm run verify:isolation
 *   SUNNY_SANDBOX_TENANT=1 npm run dev:api     # first, for a local pair
 *
 * Environment:
 *   SUNNY_API_URL        default http://localhost:8787
 *   SUNNY_ORIGIN         default http://localhost:4173
 *   SUNNY_ADMIN_TOKEN    optional -- the installer cases are skipped without it
 *   SUNNY_TENANT_A       default w_demo000001
 *   SUNNY_TENANT_B       default w_sandbox0001
 *   SUNNY_TENANT_A_ID    default t_demo0001     (internal, for the write cases)
 *   SUNNY_TENANT_B_ID    default t_sandbox001
 *   SUNNY_LEAD_EMAIL     default isolation-sweep@example.test
 *
 * Exit codes: 0 swept and everything held, 1 something failed, 2 the sweep
 * refused to run because the deployment it was pointed at cannot answer the
 * question. A 2 is not a pass: it means nothing was checked.
 *
 * It writes as well as reads: one lead and one catalogue upload into tenant A,
 * both idempotent -- the lead by `clientLeadId`, the catalogue by `replace` --
 * so a second run leaves the same rows rather than adding to them. Tenant B is
 * written to only by the tests that must fail to write to it. Point it at a
 * development or staging deployment whose data you are willing to touch.
 */

import { readFile } from 'node:fs/promises';

import { tenantIdSchema } from '@sunny/contracts';

const baseUrl = (process.env['SUNNY_API_URL'] ?? 'http://localhost:8787').replace(/\/$/, '');
const origin = process.env['SUNNY_ORIGIN'] ?? 'http://localhost:4173';
const adminToken = process.env['SUNNY_ADMIN_TOKEN'];
const leadEmail = process.env['SUNNY_LEAD_EMAIL'] ?? 'isolation-sweep@example.test';

const A = {
  publicId: process.env['SUNNY_TENANT_A'] ?? 'w_demo000001',
  id: process.env['SUNNY_TENANT_A_ID'] ?? 't_demo0001',
};
const B = {
  publicId: process.env['SUNNY_TENANT_B'] ?? 'w_sandbox0001',
  id: process.env['SUNNY_TENANT_B_ID'] ?? 't_sandbox001',
};

/** The idempotency key for the lead, so a second run replays rather than adds. */
const LEAD_KEY = 'isolation-sweep-lead';

interface Outcome {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  detail: string;
}

const outcomes: Outcome[] = [];

function pass(name: string, detail = ''): void {
  outcomes.push({ name, status: 'pass', detail });
}

function fail(name: string, detail: string): void {
  outcomes.push({ name, status: 'fail', detail });
}

function skip(name: string, detail: string): void {
  outcomes.push({ name, status: 'skip', detail });
}

interface Answer {
  status: number;
  body: string;
  json: unknown;
}

async function call(path: string, init: { body?: unknown; token?: string } = {}): Promise<Answer> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (init.token) headers['authorization'] = `Bearer ${init.token}`;
  const response = await fetch(`${baseUrl}${path}`, {
    method: init.body === undefined ? 'GET' : 'POST',
    headers,
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.text();
  let json: unknown = null;
  try {
    json = JSON.parse(body);
  } catch {
    // Left null. A route that answered with something that is not JSON is a
    // failure the caller reports on the status and the body, not a crash here.
  }
  return { status: response.status, body, json };
}

/**
 * The internal ids anywhere inside a response body.
 *
 * Tested against the contract's own definition of the shape rather than a
 * hand-written pattern, so a change to what an internal id looks like is a
 * change to what this looks for. Every string is visited, at any depth, because
 * the leak worth finding is one nested field in one response nobody read
 * closely -- which is exactly how `products[].tenantId` was found.
 */
function internalIdsIn(value: unknown): string[] {
  const found = new Set<string>();
  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      if (tenantIdSchema.safeParse(node).success) found.add(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (node && typeof node === 'object') {
      for (const item of Object.values(node)) walk(item);
    }
  };
  walk(value);
  return [...found];
}

function field(answer: Answer, key: string): unknown {
  return (answer.json as Record<string, unknown> | null)?.[key];
}

/**
 * A string field of a JSON body, or `undefined` when it is missing, empty, or
 * not a string. Separate from `field` so that "the installer is called X" is a
 * fact about a string rather than about `unknown` — which is also what keeps the
 * comparisons below honest when a deployment answers with a number or an object.
 */
function stringField(answer: Answer, key: string): string | undefined {
  const value = field(answer, key);
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** The first panel model in a catalogue CSV, read by its own header row. */
function firstPanelModel(csv: string): string | null {
  const lines = csv.split('\n').filter((line) => line.trim() !== '');
  const header = (lines[0] ?? '').split(',').map((cell) => cell.trim());
  const category = header.indexOf('Category');
  const model = header.indexOf('Model');
  if (category < 0 || model < 0) return null;
  for (const line of lines.slice(1)) {
    const cells = line.split(',');
    const cell = (index: number): string => (cells[index] ?? '').trim();
    if (cell(category) === 'Panel' && cell(model) !== '') return cell(model);
  }
  return null;
}

/**
 * Returns the exit code rather than calling `process.exit`.
 *
 * `process.exit` with a keep-alive socket still open trips a libuv assertion on
 * Windows and the process leaves with 127 instead of the code it asked for --
 * which would turn "the sweep refused to run" into an unreadable crash. Setting
 * the code and letting Node wind down is the version that reports what happened.
 */
async function main(): Promise<number> {
  console.log(`Cross-tenant isolation sweep against ${baseUrl}`);
  console.log(`  A: ${A.publicId} (${A.id})   B: ${B.publicId} (${B.id})\n`);

  if (A.publicId === B.publicId || A.id === B.id) {
    console.error(
      'The two tenants are the same tenant, so every case below would compare a tenant\n' +
        'with itself and pass without testing anything. Set SUNNY_TENANT_A/B and\n' +
        'SUNNY_TENANT_A_ID/B_ID to two different installers.',
    );
    return 2;
  }

  // ── the preconditions, which are also the vacuity guards ───────────────────

  const configA = await call(`/v1/widget/config/${A.publicId}`);
  const configB = await call(`/v1/widget/config/${B.publicId}`);
  const nameA = stringField(configA, 'companyName');
  const nameB = stringField(configB, 'companyName');

  if (configA.status !== 200 || configB.status !== 200 || !nameA || !nameB) {
    console.error(
      `The deployment does not serve both widget ids: A answered ${configA.status}, ` +
        `B answered ${configB.status}. Start it with SUNNY_SANDBOX_TENANT=1 to serve the ` +
        'second fixture tenant, or point SUNNY_TENANT_A/B at two real ones.',
    );
    return 2;
  }
  if (nameA === nameB) {
    console.error(
      `Both widget ids answer as "${nameA}", so the two tenants are ` +
        'indistinguishable\nand every comparison below would pass for the wrong reason. ' +
        'Refusing to sweep.',
    );
    return 2;
  }

  const sessionA = await call('/v1/widget/session', { body: { publicId: A.publicId, origin } });
  const sessionB = await call('/v1/widget/session', { body: { publicId: B.publicId, origin } });
  const tokenA = field(sessionA, 'sessionToken');
  const tokenB = field(sessionB, 'sessionToken');
  const sessionIdA = field(sessionA, 'sessionId');
  const sessionIdB = field(sessionB, 'sessionId');

  if (
    typeof tokenA !== 'string' ||
    typeof tokenB !== 'string' ||
    typeof sessionIdA !== 'string' ||
    typeof sessionIdB !== 'string'
  ) {
    console.error(
      `Could not open a session on both tenants (A ${sessionA.status}, B ${sessionB.status}). ` +
        'Nothing can be swept without a credential; the bodies were:\n' +
        `  A: ${sessionA.body.slice(0, 200)}\n  B: ${sessionB.body.slice(0, 200)}`,
    );
    return 2;
  }
  if (sessionIdA === sessionIdB) {
    console.error('Both widget ids issued the same session id. Refusing to sweep.');
    return 2;
  }

  // ── what a visitor can read ────────────────────────────────────────────────

  const ownName = 'a published config names its own installer and no other';
  if (configA.body.includes(nameB) || configB.body.includes(nameA)) {
    fail(ownName, 'one installer’s config carries the other’s name');
  } else {
    pass(ownName, `${JSON.stringify(nameA)} vs ${JSON.stringify(nameB)}`);
  }

  const catalogueA = await call('/v1/catalog/products', { token: tokenA });
  const catalogueB = await call('/v1/catalog/products', { token: tokenB });

  const leak = 'no internal tenant id reaches a browser';
  const leaked = [
    ...internalIdsIn(configA.json),
    ...internalIdsIn(configB.json),
    ...internalIdsIn(sessionA.json),
    ...internalIdsIn(sessionB.json),
    ...internalIdsIn(catalogueA.json),
    ...internalIdsIn(catalogueB.json),
  ];
  if (leaked.length > 0) {
    fail(
      leak,
      `internal ids in a visitor-facing response: ${JSON.stringify([...new Set(leaked)])}`,
    );
  } else {
    pass(leak, 'config, session and catalogue responses carry none');
  }

  const unknown = 'an unknown widget id is a 404 rather than a default tenant';
  const unknownId = await call('/v1/widget/config/w_notarealtenant');
  if (unknownId.status === 404) {
    pass(unknown);
  } else {
    fail(unknown, `answered ${unknownId.status}: ${unknownId.body.slice(0, 200)}`);
  }

  // ── the control, and then the denial it makes meaningful ──────────────────

  const writes = 'A’s visitor can answer A’s own questionnaire';
  const answered = await call('/v1/qualification/answer', {
    body: { sessionId: sessionIdA, questionId: 'roof_direction', value: 'south' },
    token: tokenA,
  });
  // The response carries the conversation's standing answers *after* the merge,
  // read back out of the store -- so this is the write and the read-back, not the
  // caller's own input echoed to it.
  const answers = field(answered, 'answers') as Record<string, unknown> | undefined;
  if (answered.status === 200 && answers?.['roof_direction'] === 'south') {
    pass(writes);
  } else {
    fail(writes, `answered ${answered.status}: ${answered.body.slice(0, 200)}`);
  }

  const crossWrite = 'B’s visitor cannot answer A’s questionnaire';
  const crossed = await call('/v1/qualification/answer', {
    body: { sessionId: sessionIdA, questionId: 'roof_direction', value: 'north' },
    token: tokenB,
  });
  if (crossed.status === 403) {
    pass(crossWrite, 'forbidden');
  } else {
    fail(
      crossWrite,
      `expected 403, got ${crossed.status}: ${crossed.body.slice(0, 200)}` +
        (crossed.status === 200 ? ' -- the other installer’s answer was accepted' : ''),
    );
  }

  const visitorDenied = 'the installer’s own lead list is refused to a visitor';
  const asVisitor = await call(`/v1/leads?tenantId=${A.id}`, { token: tokenA });
  if (asVisitor.status === 401) {
    pass(visitorDenied, 'the list is admin-only');
  } else {
    fail(
      visitorDenied,
      `a visitor token read the lead list (${asVisitor.status}): ${asVisitor.body.slice(0, 200)}`,
    );
  }

  // ── the installer's own path, which needs the admin token ─────────────────

  if (!adminToken) {
    skip(
      'a lead filed with A is on A’s list and not on B’s',
      'SUNNY_ADMIN_TOKEN is not set, so the installer’s list cannot be read',
    );
    skip(
      'A’s catalogue is priced to A and invisible to B',
      'SUNNY_ADMIN_TOKEN is not set, so nothing can be uploaded',
    );
  } else {
    const leadName = 'a lead filed with A is on A’s list and not on B’s';
    const filed = await call('/v1/leads', {
      body: {
        sessionId: sessionIdA,
        consent: true,
        clientLeadId: LEAD_KEY,
        email: leadEmail,
        summary: 'Isolation sweep fixture',
      },
      token: tokenA,
    });
    if (filed.status !== 201 && filed.status !== 200) {
      fail(leadName, `filing the fixture lead answered ${filed.status}`);
    } else {
      const listA = await call(`/v1/leads?tenantId=${A.id}`, { token: adminToken });
      const listB = await call(`/v1/leads?tenantId=${B.id}`, { token: adminToken });
      if (listA.status !== 200 || !listA.body.includes(leadEmail)) {
        fail(leadName, `A’s own list does not carry the fixture lead (${listA.status})`);
      } else if (listB.body.includes(leadEmail)) {
        fail(leadName, 'the fixture lead appears on B’s list as well');
      } else {
        pass(leadName);
      }
    }

    const catalogueName = 'A’s catalogue is priced to A and invisible to B';
    const csv = await readFile('fixtures/demo-catalogue.csv', 'utf8').catch(() => null);
    const model = csv === null ? null : firstPanelModel(csv);
    if (csv === null || model === null) {
      skip(catalogueName, 'fixtures/demo-catalogue.csv is not readable from here');
    } else {
      // Uploaded to A, never to B: B's catalogue stays empty, so the cross check
      // below is about the row landing where it was addressed rather than about
      // two fixtures that happen to differ.
      const uploaded = await call('/v1/catalog/products', {
        body: { tenantId: A.id, csv, mode: 'replace' },
        token: adminToken,
      });
      const accepted = field(uploaded, 'accepted');
      // 201 is the status of a real import: a `dryRun` or a structurally broken
      // file answers 200, and either would leave A's catalogue as it was found,
      // which would make the comparison below meaningless rather than failing it.
      if (uploaded.status !== 201 || typeof accepted !== 'number' || accepted < 1) {
        fail(
          catalogueName,
          `the upload answered ${uploaded.status} accepting ${String(accepted)}: ` +
            uploaded.body.slice(0, 200),
        );
      } else {
        const priced = await call('/v1/catalog/products', { token: tokenA });
        const theirs = await call('/v1/catalog/products', { token: tokenB });
        if (!priced.body.includes(model)) {
          fail(catalogueName, `A’s own visitors are not priced from A’s catalogue (${model})`);
        } else if (theirs.body.includes(model)) {
          fail(catalogueName, `B’s visitors are priced from A’s catalogue (${model})`);
        } else {
          pass(catalogueName, `A carries ${model}, B does not`);
        }
      }
    }
  }

  // ── report ─────────────────────────────────────────────────────────────────

  const width = outcomes.reduce((max, outcome) => Math.max(max, outcome.name.length), 0);
  console.log('');
  for (const outcome of outcomes) {
    const mark = outcome.status === 'pass' ? 'ok  ' : outcome.status === 'skip' ? 'skip' : 'FAIL';
    console.log(
      `  ${mark}  ${outcome.name.padEnd(width)}${outcome.detail ? `  ${outcome.detail}` : ''}`,
    );
  }

  const failed = outcomes.filter((outcome) => outcome.status === 'fail').length;
  const skipped = outcomes.filter((outcome) => outcome.status === 'skip').length;
  const passed = outcomes.length - failed - skipped;

  console.log(
    `\n${passed} passed, ${failed} failed, ${skipped} skipped against ${baseUrl}` +
      (skipped > 0 ? ' (a partial sweep: see the skipped lines above)' : ''),
  );

  return failed > 0 ? 1 : 0;
}

process.exitCode = await main().catch((error: unknown) => {
  console.error(`fatal: the sweep could not run: ${String(error)}`);
  return 1;
});
