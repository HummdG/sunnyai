#!/usr/bin/env node
/**
 * End-to-end smoke test against a running API.
 *
 * Deliberately dependency-free and assertion-based rather than a printf dump:
 * its exit code is the signal, so it can run as the last CI step after a deploy
 * and page someone when the deployed service is not actually serving.
 *
 *   node scripts/smoke-api.mjs [baseUrl]
 *
 * Environment:
 *   BASE                       base URL, default http://127.0.0.1:8787
 *   SMOKE_EXPECT_CHAT=1        also require the assistant to answer, not just
 *                              to be reachable. Without this the script passes
 *                              on a deployment that reports chat unavailable,
 *                              which is the honest state of an un-keyed install.
 *   SMOKE_ADMIN_TOKEN          the deployment's SUNNY_ADMIN_TOKEN, for the admin
 *                              routes (knowledge onboarding, catalogue upload).
 *                              Without it those routes are checked for their
 *                              refusal when the deployment has no token, and
 *                              skipped when it has one -- the same two-mode shape
 *                              the chat section uses. A smoke run must never fail
 *                              because the operator held a secret back.
 */

const base = (process.argv[2] ?? process.env.BASE ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const expectChat = process.env.SMOKE_EXPECT_CHAT === '1';

const PUBLIC_ID = process.env.SMOKE_PUBLIC_ID ?? 'w_demo000001';
const ORIGIN = process.env.SMOKE_ORIGIN ?? 'http://localhost:4173';

let failures = 0;
let checks = 0;

function check(label, condition, detail = '') {
  checks += 1;
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function call(path, init) {
  const response = await fetch(`${base}${path}`, init);
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: response.status, json, text, headers: response.headers };
}

async function main() {
  console.log(`smoke: ${base}\n`);

  // ── health ────────────────────────────────────────────────────────────────
  const health = await call('/healthz');
  check('GET /healthz is 200', health.status === 200, `got ${health.status}`);
  check('health report names its capabilities', Boolean(health.json?.capabilities));
  const chatAvailable = health.json?.capabilities?.chat?.available === true;
  console.log(`  ..   chat available: ${chatAvailable}`);
  if (!chatAvailable) {
    console.log(`  ..   reason: ${health.json?.capabilities?.chat?.reason}`);
  }

  // ── public config ─────────────────────────────────────────────────────────
  const config = await call(`/v1/widget/config/${PUBLIC_ID}`);
  check('GET widget config is 200', config.status === 200, `got ${config.status}`);
  check('config carries the tenant branding', typeof config.json?.companyName === 'string');
  check(
    'config never leaks the SunScan slug or an internal tenant id',
    !config.text.includes('sunscan') && !config.text.includes('t_demo'),
  );

  const unknown = await call('/v1/widget/config/w_doesnotexist');
  check('an unknown widget id is 404', unknown.status === 404, `got ${unknown.status}`);
  check('the error uses the shared envelope', unknown.json?.error?.code === 'not_found');

  // ── session ───────────────────────────────────────────────────────────────
  const session = await call('/v1/widget/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ publicId: PUBLIC_ID, origin: ORIGIN }),
  });
  check('POST widget session is 200', session.status === 200, `got ${session.status}`);
  const token = session.json?.sessionToken;
  const sessionId = session.json?.sessionId;
  check('session returns a token', typeof token === 'string' && token.length > 20);
  check('a new session is not reported as resumed', session.json?.resumed === false);

  const resumed = await call('/v1/widget/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ publicId: PUBLIC_ID, origin: ORIGIN, sessionToken: token }),
  });
  check('presenting a token back resumes the same session', resumed.json?.sessionId === sessionId);

  const forged = await call('/v1/widget/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ publicId: PUBLIC_ID, origin: ORIGIN, sessionToken: `${token}x` }),
  });
  check(
    "a tampered token does not resume anyone else's session",
    forged.json?.sessionId !== sessionId,
  );

  // ── leads ─────────────────────────────────────────────────────────────────
  // The refusal is checked before the acceptance, for two reasons: a route that
  // stores a row and *then* reports a problem is the failure worth catching, and
  // only the missing-consent path can show that no row was written.
  //
  // These calls spend the same per-address budget, so a deployment with a tight
  // lead limit -- or a second run in the same minute -- can exhaust it. A 429 is
  // reported as a skipped check rather than a failure, because it is the limiter
  // working, not the route being broken. Either call can hit it: the budget may be
  // spent before this run starts, or only once the first call has taken a slot.
  // A 404 or a 5xx still fails, so "route missing" and "route unwell" are not
  // mistaken for "limiter engaged".
  //
  // The skip is printed: a check that quietly stops running is worse than one that
  // fails, because nothing tells you the coverage went away.
  const leadLimited = (response) => response.status === 429;

  const unconsented = await call('/v1/leads', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ sessionId, email: 'smoke@example.test' }),
  });

  if (leadLimited(unconsented)) {
    console.log('  ..   lead checks skipped: the rate limiter refused this address');
  } else {
    check(
      'a lead without consent is refused',
      unconsented.status === 400,
      `got ${unconsented.status}`,
    );

    const lead = await call('/v1/leads', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        sessionId,
        consent: true,
        name: 'Smoke Test',
        email: 'smoke@example.test',
        summary: 'Automated smoke check',
      }),
    });

    if (leadLimited(lead)) {
      console.log('  ..   lead acceptance skipped: the rate limiter refused the second call');
    } else {
      check('a consented lead is accepted', lead.status === 201, `got ${lead.status}`);
      check('the lead comes back with an id', typeof lead.json?.leadId === 'string');

      const leads = await call('/v1/leads', { headers: { authorization: `Bearer ${token}` } });
      check(
        'the lead appears in the installer list',
        leads.json?.leads?.some((l) => l.id === lead.json?.leadId) === true,
      );
    }
  }

  // ── qualification ─────────────────────────────────────────────────────────
  const badAnswer = await call('/v1/qualification/answer', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ sessionId, questionId: 'roof_direction', value: 'sideways' }),
  });
  check(
    'an answer outside the options is refused',
    badAnswer.status === 400,
    `got ${badAnswer.status}`,
  );

  const answer = await call('/v1/qualification/answer', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ sessionId, questionId: 'roof_direction', value: 'south' }),
  });
  check('a valid answer is accepted', answer.status === 200, `got ${answer.status}`);
  check(
    'the answer comes back on the standing map',
    answer.json?.answers?.roof_direction === 'south',
  );
  check('the response suggests a next question', typeof answer.json?.nextQuestionId === 'string');

  // The property D-11 exists for: the answer is recorded without the API putting
  // words in the visitor's mouth. Checked here rather than only in the unit tests
  // because it is the kind of thing a well-meaning refactor "simplifies" back out.
  const afterAnswer = await call('/v1/conversation', {
    headers: { authorization: `Bearer ${token}` },
  });
  check(
    'the answer did not invent a transcript turn',
    (afterAnswer.json?.turns?.length ?? -1) === 0,
    `got ${afterAnswer.json?.turns?.length} turns`,
  );

  // ── authorisation ─────────────────────────────────────────────────────────
  const unauthed = await call('/v1/chat/stream', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, clientMessageId: 'c1', text: 'hello' }),
  });
  check('chat without a token is 401', unauthed.status === 401, `got ${unauthed.status}`);

  const wrongSession = await call('/v1/chat/stream', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ sessionId: 'sess_someoneelse', clientMessageId: 'c1', text: 'hello' }),
  });
  check(
    'a valid token for a different session is refused',
    wrongSession.status === 403,
    `got ${wrongSession.status}`,
  );

  const tooLong = await call('/v1/chat/stream', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ sessionId, clientMessageId: 'c1', text: 'x'.repeat(4001) }),
  });
  check('an over-long message is rejected', tooLong.status === 400, `got ${tooLong.status}`);

  // ── chat ──────────────────────────────────────────────────────────────────
  const chat = await call('/v1/chat/stream', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      sessionId,
      clientMessageId: 'c1',
      text: 'How much could I save with solar?',
    }),
  });

  if (!chatAvailable) {
    check(
      'chat refuses rather than simulating when unconfigured',
      chat.status === 403,
      `expected 403 not_enabled, got ${chat.status}`,
    );
    check('the refusal names the missing configuration', chat.json?.error?.code === 'not_enabled');
    console.log('\n  ..   chat is unconfigured on this deployment; skipping the live turn.');
  } else {
    check(
      'chat streams as SSE',
      chat.headers.get('content-type')?.includes('text/event-stream') === true,
    );
    const events = chat.text
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => {
        try {
          return JSON.parse(line.slice(6));
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    check('the stream produced events', events.length > 0);
    check('the stream starts a message', events[0]?.type === 'message_started');
    check('the stream ends with done', events.at(-1)?.type === 'done');
    const text = events
      .filter((e) => e.type === 'text_delta')
      .map((e) => e.text)
      .join('');
    check('the assistant produced text', text.length > 0);
    console.log(`  ..   assistant said: ${text.slice(0, 160).replace(/\n/g, ' ')}…`);

    // ── persistence ─────────────────────────────────────────────────────────
    const conversation = await call('/v1/conversation', {
      headers: { authorization: `Bearer ${token}` },
    });
    check('the conversation is readable afterwards', conversation.status === 200);
    check(
      'both halves of the turn were persisted',
      conversation.json?.turns?.length >= 2,
      `got ${conversation.json?.turns?.length ?? 0} turns`,
    );
    check(
      "the visitor's message is in the transcript",
      conversation.json?.turns?.some((t) => t.role === 'user' && t.text.includes('save')),
    );

    // Idempotency: replaying the same clientMessageId must not duplicate the turn.
    const before = conversation.json?.turns?.length ?? 0;
    await call('/v1/chat/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        sessionId,
        clientMessageId: 'c1',
        text: 'How much could I save with solar?',
      }),
    });
    const after = await call('/v1/conversation', { headers: { authorization: `Bearer ${token}` } });
    check(
      'a retried message does not duplicate the transcript',
      (after.json?.turns?.length ?? 0) === before + 2,
      `went from ${before} to ${after.json?.turns?.length}`,
    );
  }

  // ── knowledge ─────────────────────────────────────────────────────────────
  //
  // The admin routes, which the sections above never touch. Two modes, matching
  // the chat section: with no token configured the honest state is a refusal, and
  // the check is that it refuses rather than half-working. With a token the round
  // trip runs for real.
  //
  // One thing this cannot show: the deployment seeds a single tenant, so the
  // two-directional isolation property is only really exercised by the unit tests
  // (`apps/api/test/knowledge.test.ts`), which can stand up a rival tenant. What
  // is checked here is the weaker, still-worth-checking version -- a job id is not
  // readable under a tenant it was not ingested for -- and it is labelled as what
  // it is rather than as the stronger claim.
  //
  // It also cannot clean up after itself. A source id is minted by the server and
  // there is no list or delete route for sources yet, so each run against a store
  // that persists leaves one document behind. That accumulation is the cost of
  // exercising the route for real rather than trusting it; the disposal of a smoke
  // store belongs to whoever runs it.
  const adminToken = process.env.SMOKE_ADMIN_TOKEN;
  const knowledgeInit = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(adminToken ? { authorization: `Bearer ${adminToken}` } : {}),
    },
    body: JSON.stringify({
      tenantId: 't_demo0001',
      title: 'Smoke test warranty page',
      url: 'https://example.test/warranty',
      version: 'smoke-1',
      text:
        '# Warranty terms\n\nWorkmanship on the roof mounting is covered for 25-YEAR.\n\n' +
        '# Panel product\n\nThe SB-430 panel carries a 12-year product warranty.\n',
    }),
  };

  if (!adminToken) {
    const refused = await call('/v1/knowledge/sources', knowledgeInit);
    // Three outcomes, and only two of them are about the deployment. A 403 means
    // no token is configured and the route is refusing to half-work, which is the
    // thing worth asserting. A 401 means the deployment *has* a token and this run
    // was not given it -- the operator withholding a secret, not a broken service.
    // Treating that as a failure would make `npm run smoke` red on every correctly
    // configured deployment, which is the fastest way to teach people to ignore it.
    // So it is a skip, printed rather than silent, in the same spirit as the spent
    // lead budget above. Anything else -- 404, 5xx -- still fails, so "route
    // missing" is not filed under "secret withheld".
    if (refused.status === 401) {
      console.log(
        '  ..   this deployment requires an admin token and SMOKE_ADMIN_TOKEN is unset; skipping the admin routes.',
      );
    } else {
      check(
        'ingestion refuses rather than half-working when no admin token is set',
        refused.status === 403,
        `expected 403 not_enabled, got ${refused.status}`,
      );
      check(
        'the refusal names the missing configuration',
        refused.json?.error?.code === 'not_enabled',
      );
      console.log('  ..   no SMOKE_ADMIN_TOKEN; skipping the live ingestion round trip.');
    }
  } else {
    const ingested = await call('/v1/knowledge/sources', knowledgeInit);
    check('an onboarded document is accepted', ingested.status === 201, `got ${ingested.status}`);
    check(
      'the document is chunked into quotable passages',
      (ingested.json?.source?.chunkCount ?? 0) > 0,
    );
    check('the ingestion job succeeded', ingested.json?.job?.status === 'succeeded');
    check(
      'the job counts the passages the source reports',
      ingested.json?.job?.chunks === ingested.json?.source?.chunkCount,
    );

    const jobId = ingested.json?.job?.id;
    const mine = await call(`/v1/knowledge/jobs/${jobId}?tenantId=t_demo0001`, {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    check('the job reads back by id', mine.status === 200 && mine.json?.job?.id === jobId);

    const theirs = await call(`/v1/knowledge/jobs/${jobId}?tenantId=t_smoke_other`, {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    check(
      'a job id is not readable under another tenant id',
      theirs.status === 404,
      `got ${theirs.status}`,
    );

    const unauthedIngest = await call('/v1/knowledge/sources', {
      ...knowledgeInit,
      headers: { 'content-type': 'application/json' },
    });
    check(
      'ingestion without the admin token is refused',
      unauthedIngest.status === 401,
      `got ${unauthedIngest.status}`,
    );
  }

  if (expectChat && !chatAvailable) {
    failures += 1;
    console.error('\n  FAIL SMOKE_EXPECT_CHAT=1 but the assistant is unconfigured');
  }

  console.log(`\n${checks - failures}/${checks} checks passed`);
  // Set the code and fall out of `main`, rather than calling process.exit().
  //
  // That distinction was worth 127 exit codes. `fetch` pools keep-alive sockets,
  // and process.exit() tears the process down while one is still closing. On
  // Windows libuv then hits `!(handle->flags & UV_HANDLE_CLOSING)` in
  // win/async.c and aborts -- so a run that printed "17/17 checks passed" still
  // exited non-zero, which as the last CI step after a deploy reads as a failed
  // deployment. Letting the loop drain closes the pool in its own time and the
  // process exits with the code set here.
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(`smoke: could not reach ${base} — ${error.message}`);
  process.exitCode = 1;
});
