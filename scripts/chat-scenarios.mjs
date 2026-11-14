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
 *   - which events the turn carried (`roof_image` after an address lookup,
 *     `quote` with its prices and budget ladder, `lead_saved`);
 *   - what the routes beside the chat did: a bill upload, a package chosen,
 *     the conversation (and its lead) deleted;
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
 *
 * The lead scenario files a real lead with made-up details and deletes it
 * (with its conversation) before it ends, so the installer's list stays clean.
 */

import { readFileSync } from 'node:fs';

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
// A turn: { say, asks?, asksNot?, events?, noEvents?, matches?, picture?,
//           tools?, quote?, lead? }
//   asks      the question the server must be asking after the turn (an id,
//             or a list of acceptable ids)
//   asksNot   ids it must not be asking
//   events    event types the turn must carry; noEvents, ones it must not
//   matches   a pattern the reply must match
//   picture   after this turn, GET /v1/quote/roof-picture must answer 200
//   tools     tools the turn must have used
//   quote     the turn must carry a quote card: { kind?, priced?, budget? }
//             (budget: true wants the budget slider's ladder on it)
//   lead      the turn must save a lead
//
// Steps that are not a chat message, as the widget makes them:
//   { upload: <base64 | file URL>, mime, read }   POST /v1/bill; `read` is
//                                    whether the bill must be readable
//   { choose: true }         choose the last quote's recommended package
//   { cleanup: { leads } }   delete the conversation; it must take that many
//                            leads with it

const FULL = '20 Forthlin Road, Liverpool L18 9TN';
/** What the widget says for the visitor once a bill is uploaded. */
const UPLOADED = 'I have uploaded my bill.';
/** A made-up bill: 3,180 kWh a year. */
const BILL = new URL('./fixtures/sample-bill.pdf', import.meta.url);
/** A file that is not a bill: an empty PDF. */
const NOT_A_BILL = 'JVBERi0xLjQKJSVFT0YK';

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
  {
    name: 'a solar quote to the end, a package chosen, details left',
    turns: [
      { say: "I'd like a solar quote please", asks: 'ownership' },
      { say: 'I own it', asks: 'address' },
      { say: FULL, asks: 'usage_source' },
      { say: 'about £120 a month', asks: 'lifestyle' },
      { say: "We're mostly out at work in the day", asks: 'existing_system' },
      {
        say: 'No, nothing yet',
        quote: { priced: true, budget: true },
        tools: ['get_quote_options'],
      },
      { choose: true },
      {
        say: "Yes please pass my details to the installer. I'm Sam Example, sam@example.test, 07700 900123. I'm happy to be contacted.",
        lead: true,
        tools: ['create_lead'],
      },
      { cleanup: { leads: 1 } },
    ],
  },
  {
    name: 'a heat pump quote to the end',
    turns: [
      { say: 'How much is a heat pump?', asks: 'ownership' },
      { say: 'I own it', asks: 'address' },
      { say: FULL, asks: 'property_type' },
      { say: 'Terraced', asks: 'hp_bedrooms' },
      { say: '3 bedrooms', asks: 'hp_current_heating' },
      { say: 'Mains gas', asks: 'hp_emitters' },
      { say: 'Radiators', asks: 'hp_hot_water' },
      {
        say: 'A hot water cylinder',
        quote: { kind: 'heat_pump', priced: true },
        tools: ['get_quote_options'],
      },
    ],
  },
  {
    // Seen live: after the upload the next question (lifestyle) was answered
    // by the model for the visitor and never asked.
    name: 'a bill upload is read, and the next question is still asked',
    turns: [
      { say: "I'd like a solar quote please", asks: 'ownership' },
      { say: 'I own it', asks: 'address' },
      { say: FULL, asks: 'usage_source' },
      { upload: BILL, mime: 'application/pdf', read: true },
      { say: UPLOADED, asks: 'lifestyle', matches: /about [\d,]+ kWh/i },
    ],
  },
  {
    name: 'a file that is not a bill asks for the usage another way',
    turns: [
      { say: "I'd like a solar quote please", asks: 'ownership' },
      { say: 'I own it', asks: 'address' },
      { say: FULL, asks: 'usage_source' },
      { upload: NOT_A_BILL, mime: 'application/pdf', read: false },
      { say: UPLOADED, asks: ['usage_source', 'annual_kwh', 'monthly_cost'] },
    ],
  },
];

// ── running them ─────────────────────────────────────────────────────────────

/**
 * A request that waits out the deployment's rate limit (production allows
 * one address 20 chat messages in 10 minutes, and one pass of the suite sends
 * more): a 429 is the limit working, not the chat failing, so it is retried
 * after the window, up to three times.
 */
async function polite(url, init) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, init);
    if (response.status !== 429 || attempt === 3) return response;
    const after = Number(response.headers.get('retry-after'));
    const wait = Number.isFinite(after) && after > 0 ? after * 1000 : 60_000;
    console.log(`  ..   rate limited; waiting ${Math.round(wait / 1000)}s`);
    await new Promise((resolve) => setTimeout(resolve, wait + 1000));
  }
}

async function session() {
  const response = await polite(`${base}/v1/widget/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ publicId: PUBLIC_ID, origin: ORIGIN }),
  });
  if (!response.ok) throw new Error(`session: HTTP ${response.status}`);
  return response.json();
}

async function turn(s, text) {
  const response = await polite(`${base}/v1/chat/stream`, {
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
    quote: frames.find((f) => f.type === 'quote')?.quote ?? null,
    lead: frames.find((f) => f.type === 'lead_saved')?.leadId ?? null,
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
  for (const tool of step.tools ?? []) {
    if (!got.tools.includes(tool)) problems.push(`${tool} was not used`);
  }
  if (step.quote) problems.push(...checkQuote(step.quote, got.quote));
  if (step.lead && !got.lead) problems.push('no lead was saved');
  return problems;
}

function checkQuote(wanted, quote) {
  if (!quote) return ['no quote card'];
  const problems = [];
  if (wanted.kind !== undefined && quote.kind !== wanted.kind) {
    problems.push(`the quote is ${quote.kind ?? 'solar'}, wanted ${wanted.kind}`);
  }
  if (!Array.isArray(quote.options) || quote.options.length === 0) {
    problems.push('the quote has no options');
  }
  if (wanted.priced !== undefined) {
    if (quote.priced !== wanted.priced) problems.push(`the quote's priced is ${quote.priced}`);
    const anyPrice = (quote.options ?? []).some((o) => typeof o.priceGbp === 'number');
    if (wanted.priced && !anyPrice) problems.push('no option has a price');
  }
  if (wanted.budget) {
    const b = quote.budget;
    if (!b || !Array.isArray(b.steps) || b.steps.length < 2) {
      problems.push('the quote has no budget ladder');
    } else if (!(b.minGbp <= b.initialGbp && b.initialGbp <= b.maxGbp)) {
      problems.push(`the budget starts at ${b.initialGbp}, outside ${b.minGbp} to ${b.maxGbp}`);
    }
  }
  return problems;
}

/** POST /v1/bill, as the widget's upload button does. */
async function upload(s, step) {
  const data =
    step.upload instanceof URL ? readFileSync(step.upload).toString('base64') : step.upload;
  const response = await polite(`${base}/v1/bill`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${s.sessionToken}`,
      origin: ORIGIN,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ sessionId: s.sessionId, mimeType: step.mime, data }),
  });
  if (!response.ok) {
    return { said: `HTTP ${response.status}`, problems: [`bill: HTTP ${response.status}`] };
  }
  const body = await response.json();
  const problems = [];
  if (body.read !== step.read)
    problems.push(`the bill's read is ${body.read}, wanted ${step.read}`);
  if (step.read && !(body.annualKwh > 0)) problems.push('the bill gave no yearly kWh');
  return { said: JSON.stringify(body), problems };
}

/** The widget's Choose button: the recommended package of the last quote. */
async function choose(s, quote) {
  if (!quote) return { said: '-', problems: ['no quote to choose from'] };
  const option = quote.options.find((o) => o.isRecommended) ?? quote.options[0];
  const headers = { authorization: `Bearer ${s.sessionToken}`, origin: ORIGIN };
  const response = await polite(`${base}/v1/quote/${quote.quoteId}/choose`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: s.sessionId, optionId: option.id }),
  });
  if (!response.ok) return { said: option.id, problems: [`choose: HTTP ${response.status}`] };
  const saved = await polite(`${base}/v1/quote/${quote.quoteId}`, { headers });
  const record = saved.ok ? await saved.json() : {};
  return {
    said: option.id,
    problems:
      record.chosenOptionId === option.id
        ? []
        : [`the quote's chosen package is ${record.chosenOptionId}, wanted ${option.id}`],
  };
}

/** Deletes the conversation and whatever leads it filed. */
async function forget(s) {
  const response = await polite(`${base}/v1/conversation`, {
    method: 'DELETE',
    headers: {
      authorization: `Bearer ${s.sessionToken}`,
      origin: ORIGIN,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ sessionId: s.sessionId }),
  });
  if (!response.ok) throw new Error(`delete conversation: HTTP ${response.status}`);
  return response.json();
}

/** A step that is not a chat message: an upload, a choice, or the clean-up. */
async function aside(s, step, state) {
  if (step.upload !== undefined) return { what: 'bill upload', ...(await upload(s, step)) };
  if (step.choose) return { what: 'choose', ...(await choose(s, state.quote)) };
  const body = await forget(s);
  state.leadFiled = false;
  return {
    what: 'delete conversation',
    said: JSON.stringify(body),
    problems:
      body.leadsDeleted === step.cleanup.leads
        ? []
        : [`${body.leadsDeleted} leads were deleted, wanted ${step.cleanup.leads}`],
  };
}

async function picture(s) {
  const response = await polite(`${base}/v1/quote/roof-picture`, {
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
  const state = { quote: null, leadFiled: false };
  try {
    return await runSteps(scenario, s, state);
  } finally {
    // A lead left behind by a run that failed part-way is still removed.
    if (state.leadFiled) await forget(s).catch(() => {});
  }
}

async function runSteps(scenario, s, state) {
  const log = [];
  for (const step of scenario.turns) {
    if (step.say === undefined) {
      const did = await aside(s, step, state);
      log.push(`    * ${did.what}: ${did.said.slice(0, 220)}`);
      if (did.problems.length > 0) return { ok: false, problems: did.problems, log };
      continue;
    }
    const got = await turn(s, step.say);
    if (got.quote) state.quote = got.quote;
    if (got.lead) state.leadFiled = true;
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
