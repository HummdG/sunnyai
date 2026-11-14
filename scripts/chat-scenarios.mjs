#!/usr/bin/env node
/**
 * Real conversations against a deployed Sunny, checked turn by turn.
 *
 * The unit tests drive the tools directly; this drives the whole thing: the
 * widget's session, the live model, the workflow, the home lookups and the
 * roof photo, the way a visitor does. Each scenario is a conversation someone
 * has actually had (or a near variant of one), and each turn is checked on
 * what the server did, not on the model's wording:
 *
 *   - which question the server is asking now (the `quick_replies` event's
 *     questionId: the workflow's own next question, whatever the model said);
 *   - which events the turn carried (`roof_image` after an address lookup);
 *   - that the reply is safe to show: not empty, no tool names, tags, prompt
 *     or SunScan talk, no em dashes.
 *
 * The model varies from run to run, so every scenario runs RUNS times (default
 * 2) and any failing run fails the suite.
 *
 *   node scripts/chat-scenarios.mjs https://api-staging.heysunny.co.uk
 *
 * Environment:
 *   SCENARIO_ORIGIN   the page the chat is opened from (a registered domain of
 *                     the widget's installer), e.g. https://staging.heysunny.co.uk
 *   SCENARIO_PUBLIC_ID  the widget id, default w_demo000001 (the demo installer)
 *   RUNS              how many times each scenario runs, default 2
 *   ONLY              run only scenarios whose name contains this text
 *
 * Each turn is a real model call and the address scenarios make real Google
 * Solar calls (a lookup and a photo), so this is a post-deploy check, not
 * part of every smoke run. Exit code 1 when anything failed.
 */

const base = (process.argv[2] ?? process.env.BASE ?? '').replace(/\/$/, '');
const ORIGIN = process.env.SCENARIO_ORIGIN ?? '';
const PUBLIC_ID = process.env.SCENARIO_PUBLIC_ID || 'w_demo000001';
const RUNS = Number(process.env.RUNS ?? 2);
const ONLY = process.env.ONLY ?? '';
if (!base || !ORIGIN) {
  console.error('usage: SCENARIO_ORIGIN=<site> node scripts/chat-scenarios.mjs <api base url>');
  process.exit(2);
}

// ── what every reply must never contain ──────────────────────────────────────

const NEVER = [
  [
    /\b(save_workflow_answers|get_workflow_step|start_workflow|start_sunscan_assessment|get_quote_options|create_lead|request_callback|retrieve_knowledge)\b/i,
    'a tool name',
  ],
  [/<\/?(workflow_state|server_note|user_query|verified_context)\b/i, 'a prompt tag'],
  [
    /\b(workflow state|tool output|tool note|server note|system prompt|my instructions)\b/i,
    'talk about its instructions',
  ],
  [/\b(sunscan|lidar|laser|matched an area)\b/i, 'SunScan talk (the 3D roof is not shown)'],
  [/—/, 'an em dash'],
];

// ── the conversations ────────────────────────────────────────────────────────
//
// A turn: { say, asks?, asksNot?, events?, noEvents?, matches?, picture? }
//   asks      the question the server must be asking after the turn (an id,
//             or a list of acceptable ids)
//   asksNot   ids it must not be asking
//   events    event types the turn must carry; noEvents, ones it must not
//   matches   a pattern the reply must match
//   picture   after this turn, GET /v1/quote/roof-picture must answer 200

const FULL = '20 Forthlin Road, Liverpool L18 9TN';

const SCENARIOS = [
  {
    name: 'asks for a quote, then answers in order',
    turns: [
      { say: "I'd like a solar quote please", asks: 'ownership' },
      { say: 'I own it', asks: 'address' },
      {
        say: FULL,
        asks: 'usage_source',
        events: ['roof_image'],
        matches: /about \d+ panels/i,
        picture: true,
      },
    ],
  },
  {
    // Seen live: the house number was read as a £20 monthly bill.
    name: 'a house number is not read as a bill',
    turns: [
      { say: 'Solar quote please', asks: 'ownership' },
      { say: 'Yes I own it', asks: 'address' },
      { say: FULL, asks: 'usage_source', asksNot: ['lifestyle', 'household_size'] },
    ],
  },
  {
    // Seen live: the address given before anything else was lost.
    name: 'opens with a whole address',
    turns: [{ say: FULL, asks: 'ownership', events: ['roof_image'], picture: true }],
  },
  {
    // Seen live (the screenshot): street, then postcode, before any quote.
    name: 'opens with a street, then its postcode',
    turns: [
      { say: '3A Downs Walk', asks: 'address', matches: /postcode/i, noEvents: ['roof_image'] },
      { say: 'BN10 7SN', asks: 'ownership', events: ['roof_image'], picture: true },
    ],
  },
  {
    name: 'a typo in the street',
    turns: [
      { say: '3A Dowsn Walk', asks: 'address', matches: /postcode/i },
      { say: 'BN10 7SN', asks: 'ownership', events: ['roof_image'] },
    ],
  },
  {
    // Seen live: the postcode was never asked (a measurement guessed one).
    name: 'answers ownership before giving the postcode',
    turns: [
      { say: '3A Downs Walk', asks: 'address', matches: /postcode/i },
      { say: 'I own it with a mortgage', asks: 'address', matches: /postcode/i },
      { say: 'BN10 7SN', asks: 'usage_source', events: ['roof_image'], picture: true },
    ],
  },
  {
    name: 'a postcode on its own asks for the house',
    turns: [
      { say: 'Solar quote please', asks: 'ownership' },
      { say: 'I own it', asks: 'address' },
      { say: 'BN10 7SN', asks: 'address', noEvents: ['roof_image'] },
    ],
  },
  {
    name: 'a question mid-quote is answered and the quote carries on',
    turns: [
      { say: "I'd like a solar quote please", asks: 'ownership' },
      { say: 'How long do solar panels last?', asks: 'ownership' },
    ],
  },
  {
    name: 'usage given as a monthly bill moves on',
    turns: [
      { say: "I'd like a solar quote please", asks: 'ownership' },
      { say: 'I own it', asks: 'address' },
      { say: FULL, asks: 'usage_source' },
      { say: 'about £120 a month', asksNot: ['usage_source', 'address', 'ownership'] },
    ],
  },
];

// ── running them ─────────────────────────────────────────────────────────────

async function session() {
  const response = await fetch(`${base}/v1/widget/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ publicId: PUBLIC_ID, origin: ORIGIN }),
  });
  if (!response.ok) throw new Error(`session: HTTP ${response.status}`);
  return response.json();
}

async function turn(s, text) {
  const response = await fetch(`${base}/v1/chat/stream`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${s.sessionToken}`,
      origin: ORIGIN,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sessionId: s.sessionId,
      clientMessageId: `scn_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      text,
    }),
  });
  if (!response.ok) throw new Error(`chat: HTTP ${response.status}`);
  const frames = (await response.text())
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)));
  const finished = frames.find((f) => f.type === 'message_finished');
  const replies = frames.filter((f) => f.type === 'quick_replies').at(-1);
  return {
    text: finished?.text ?? '',
    tools: finished?.tools ?? [],
    events: [...new Set(frames.map((f) => f.type))],
    asks: replies ? replies.questionId : null,
  };
}

function checkTurn(step, got) {
  const problems = [];
  if (got.text.trim() === '') problems.push('the reply is empty');
  for (const [pattern, what] of NEVER) {
    if (pattern.test(got.text)) problems.push(`the reply contains ${what}`);
  }
  if (step.asks !== undefined) {
    const wanted = [step.asks].flat();
    if (!wanted.includes(got.asks)) {
      problems.push(`asks ${got.asks ?? 'nothing'}, wanted ${wanted.join(' or ')}`);
    }
  }
  for (const id of step.asksNot ?? []) {
    if (got.asks === id) problems.push(`asks ${id}, which it should not`);
  }
  for (const type of step.events ?? []) {
    if (!got.events.includes(type)) problems.push(`no ${type} event`);
  }
  for (const type of step.noEvents ?? []) {
    if (got.events.includes(type)) problems.push(`a ${type} event it should not have`);
  }
  if (step.matches && !step.matches.test(got.text)) {
    problems.push(`the reply does not match ${step.matches}`);
  }
  return problems;
}

async function picture(s) {
  const response = await fetch(`${base}/v1/quote/roof-picture`, {
    headers: { authorization: `Bearer ${s.sessionToken}`, origin: ORIGIN },
  });
  if (!response.ok) return `GET roof-picture answered ${response.status}`;
  const body = await response.json();
  return Array.isArray(body.faces) && body.faces.length > 0
    ? null
    : 'the picture has no roof faces';
}

async function runScenario(scenario) {
  const s = await session();
  const log = [];
  for (const step of scenario.turns) {
    const got = await turn(s, step.say);
    const problems = checkTurn(step, got);
    if (step.picture) {
      const problem = await picture(s);
      if (problem) problems.push(problem);
    }
    log.push(
      `    > ${step.say}\n    < ${got.text.replace(/\s+/g, ' ').slice(0, 220)}\n      asks ${got.asks ?? '-'} | tools ${got.tools.join(', ') || '-'}`,
    );
    if (problems.length > 0) return { ok: false, problems, log };
  }
  return { ok: true, problems: [], log };
}

const chosen = SCENARIOS.filter((s) => s.name.includes(ONLY));
let failed = 0;
let runs = 0;
console.log(`chat scenarios: ${base} (${chosen.length} scenarios x ${RUNS} runs)`);
for (const scenario of chosen) {
  for (let run = 1; run <= RUNS; run++) {
    runs += 1;
    let result;
    try {
      result = await runScenario(scenario);
    } catch (error) {
      result = { ok: false, problems: [String(error?.message ?? error)], log: [] };
    }
    if (result.ok) {
      console.log(`  ok   ${scenario.name} (run ${run})`);
    } else {
      failed += 1;
      console.error(`  FAIL ${scenario.name} (run ${run}): ${result.problems.join('; ')}`);
      for (const line of result.log) console.error(line);
    }
  }
}
console.log(`\n${runs - failed}/${runs} runs passed`);
process.exit(failed === 0 ? 0 : 1);
