import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import type { ChatChunk, ChatTurnRequest } from '../src/agent/provider.js';
import type { ToolContext } from '../src/agent/tools.js';
import { billSentence, readBill, readingFrom } from '../src/bill/read.js';
import type { ServerConfig } from '../src/config.js';
import { whyFor } from '../src/flow/why.js';
import { extractAnswers } from '../src/journey/extract.js';
import { JOURNEY_KEYS, journeyStatus } from '../src/journey/journey.js';
import { buildServer } from '../src/server.js';
import { FileStore } from '../src/store.js';
import { TenantRegistry } from '../src/tenants.js';
import { completeAddress } from '../src/workflows/agent-tools.js';
import { defaultWorkflowSet } from '../src/workflows/templates.js';
import { resolvedFlowFor } from '../src/workflows/tenant.js';

import { ScriptedProvider } from './scripted-provider.js';

const PDF = 'JVBERi0xLjQKJSVFT0YK';

describe('reading a bill', () => {
  it("uses the bill's own yearly figure, and its unit rate", () => {
    expect(
      readingFrom({
        isElectricityBill: true,
        estimatedAnnualKwh: 3120.4,
        periodKwh: 280,
        periodDays: 31,
        unitRatePence: 24.86,
      }),
    ).toEqual({ status: 'read', annualKwh: 3120, basis: 'stated_annual', unitRatePence: 24.86 });
  });

  it('scales the billing period to a year when no yearly figure is shown', () => {
    expect(
      readingFrom({ isElectricityBill: true, periodKwh: 300, periodDays: 30, unitRatePence: null }),
    ).toEqual({ status: 'read', annualKwh: 3650, basis: 'period', unitRatePence: null });
  });

  it('refuses what is not an electricity bill, or has no usable usage', () => {
    expect(readingFrom({ isElectricityBill: false })).toEqual({
      status: 'unreadable',
      reason: 'not_a_bill',
    });
    // Three days says too little; 12 kWh a year is a misread.
    expect(readingFrom({ isElectricityBill: true, periodKwh: 30, periodDays: 3 }).status).toBe(
      'unreadable',
    );
    expect(readingFrom({ isElectricityBill: true, estimatedAnnualKwh: 12 }).status).toBe(
      'unreadable',
    );
    expect(readingFrom('nonsense')).toEqual({ status: 'unreadable', reason: 'failed' });
  });

  it('turns a failed or slow model call into an unreadable bill', async () => {
    const reading = await readBill(
      { readBill: () => Promise.reject(new Error('boom')) },
      { data: PDF, mimeType: 'application/pdf' },
    );
    expect(reading).toEqual({ status: 'unreadable', reason: 'failed' });
  });
});

describe('the usage question in the visitor’s own words', () => {
  const usage = (text: string) =>
    Object.fromEntries(extractAnswers(text, 'usage_source').map((p) => [p.questionId, p.value]));

  it('reads a figure as kWh or pounds by its words, else by its size', () => {
    expect(usage('about 3,200 kWh')).toMatchObject({
      usage_source: 'manual_kwh',
      annual_kwh: '3200',
    });
    expect(usage('£120')).toMatchObject({ usage_source: 'monthly_cost', monthly_cost: '120' });
    expect(usage('around 95 a month')).toMatchObject({
      usage_source: 'monthly_cost',
      monthly_cost: '95',
    });
    expect(usage('4000')).toMatchObject({ usage_source: 'manual_kwh', annual_kwh: '4000' });
    expect(usage('150')).toMatchObject({ usage_source: 'monthly_cost', monthly_cost: '150' });
  });

  it('takes "not sure" and household words to the household question', () => {
    expect(usage("I'm not sure")).toMatchObject({ usage_source: 'household' });
    expect(usage('there are 3 of us')).toMatchObject({ usage_source: 'household' });
    expect(usage('there are 3 of us').monthly_cost).toBeUndefined();
  });
});

describe('an address given without its postcode', () => {
  const ctxWith = (address: string) => ({ answers: { address } }) as unknown as ToolContext;

  it('is asked for the postcode straight away', () => {
    const flow = resolvedFlowFor(defaultWorkflowSet('2026-11-14T00:00:00.000Z').workflows[0]!);
    const view = journeyStatus({ ownership: 'own', address: '3A Downs Walk' }, null, {}, flow);
    expect(view.nextQuestionId).toBe('address');
    expect(view.prompt).toBe('What is the postcode of the property?');
  });

  it('takes a postcode on its own as the rest of the address', () => {
    for (const proposals of [
      [],
      [{ questionId: 'address', value: 'BN10 7SN' }],
      [{ questionId: 'postcode', value: 'bn10 7sn' }],
    ]) {
      const list = [...proposals];
      completeAddress(ctxWith('3A Downs Walk'), list, 'BN10 7SN');
      expect(list).toEqual([{ questionId: 'address', value: '3A Downs Walk, BN10 7SN' }]);
    }
  });

  it('leaves a whole new address, and an address that has its postcode, alone', () => {
    const list = [{ questionId: 'address', value: '12 Mill Lane, Norwich NR4 7TJ' }];
    completeAddress(ctxWith('3A Downs Walk'), list, '12 Mill Lane, Norwich NR4 7TJ');
    expect(list).toEqual([{ questionId: 'address', value: '12 Mill Lane, Norwich NR4 7TJ' }]);
    const none: { questionId: string; value: string }[] = [];
    completeAddress(ctxWith('3A Downs Walk, BN10 7SN'), none, 'BN10 7SN');
    expect(none).toEqual([]);
  });
});

describe('why a question is asked', () => {
  it('gives the reason that fits the quote', () => {
    expect(whyFor('ownership', 'heat_pump')).toContain('grant');
    expect(whyFor('ownership', 'solar')).toContain('landlord');
    expect(whyFor('address', 'heat_pump')).toContain('energy certificate');
    expect(whyFor('address', null)).toContain('roof');
    expect(whyFor('c_custom12345', 'solar')).toBeNull();
    expect(whyFor(null, 'solar')).toBeNull();
  });
});

// ── the upload route and the turn after it ────────────────────────────────────

class BillReadingProvider extends ScriptedProvider {
  reads = 0;
  constructor(
    private readonly reply: unknown,
    script: (request: ChatTurnRequest) => ChatChunk[],
  ) {
    super(script);
  }
  readBill(): Promise<unknown> {
    this.reads += 1;
    return Promise.resolve(this.reply);
  }
}

function makeConfig(): ServerConfig {
  const open = { limit: 100_000, windowMs: 60_000 };
  return {
    port: 0,
    host: '127.0.0.1',
    nodeEnv: 'test',
    gemini: undefined,
    dataDir: '.data-test',
    allowedOrigins: ['http://localhost:4173'],
    sessionSecret: 'test-secret-not-used-in-production',
    adminToken: 'test-admin-token',
    logLevel: 'silent',
    sandboxTenant: false,
    leadRetentionDays: 730,
    rateLimit: {
      enabled: true,
      trustProxyHops: 0,
      rules: {
        session: open,
        chat: open,
        leads: open,
        qualification: open,
        catalogue: open,
        knowledge: open,
      },
      maxKeys: 10_000,
    },
  };
}

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function harness(provider: BillReadingProvider) {
  const dir = await mkdtemp(join(tmpdir(), 'sunny-bill-'));
  dirs.push(dir);
  const store = new FileStore(dir);
  const app = buildServer({
    config: makeConfig(),
    store,
    tenants: new TenantRegistry(),
    provider,
    now: () => 1_700_000_000_000,
  });
  await app.ready();
  const session = (
    await app.inject({
      method: 'POST',
      url: '/v1/widget/session',
      payload: { publicId: 'w_demo000001', origin: 'http://localhost:4173' },
    })
  ).json<{ sessionId: string; sessionToken: string }>();
  return { app, store, sessionId: session.sessionId, token: session.sessionToken };
}

const upload = (app: FastifyInstance, token: string, body: Record<string, unknown>) =>
  app.inject({
    method: 'POST',
    url: '/v1/bill',
    headers: { authorization: `Bearer ${token}` },
    payload: body,
  });

function said(body: string): string {
  return body
    .split('\n\n')
    .map((frame) => frame.split('\n').find((l) => l.startsWith('data: ')))
    .filter((line): line is string => Boolean(line))
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>)
    .filter((e) => e['type'] === 'text_delta')
    .map((e) => String(e['text']))
    .join('');
}

describe('POST /v1/bill', () => {
  it('saves the usage, keeps no file, and the next turn says what it found once', async () => {
    let seen = '';
    const provider = new BillReadingProvider(
      { isElectricityBill: true, estimatedAnnualKwh: 3100, unitRatePence: 25 },
      (request) => {
        seen = request.message;
        return [{ type: 'text', text: 'Do you already have solar or a battery?' }];
      },
    );
    const { app, store, sessionId, token } = await harness(provider);
    const response = await upload(app, token, {
      sessionId,
      mimeType: 'application/pdf',
      data: PDF,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ read: true, annualKwh: 3100 });
    const answers = (await store.getConversation('t_demo0001', sessionId))?.answers ?? {};
    expect(answers['usage_source']).toBe('bill_ocr');
    expect(answers['annual_kwh']).toBe('3100');
    expect(JSON.stringify(answers)).not.toContain(PDF);

    const turn = (text: string, id: string) =>
      app.inject({
        method: 'POST',
        url: '/v1/chat/stream',
        headers: { authorization: `Bearer ${token}` },
        payload: { sessionId, clientMessageId: id, text },
      });
    const first = await turn('I have uploaded my bill.', 'c1');
    const sentence = billSentence({
      status: 'read',
      annualKwh: 3100,
      basis: 'stated_annual',
      told: false,
    })!;
    expect(said(first.body)).toBe(`${sentence} Do you already have solar or a battery?`);
    expect(seen).toContain('They have already been told');
    const second = await turn('No, none.', 'c2');
    expect(said(second.body)).toBe('Do you already have solar or a battery?');
    const record = JSON.parse(
      (await store.getConversation('t_demo0001', sessionId))!.answers![JOURNEY_KEYS.bill]!,
    ) as { told: boolean };
    expect(record.told).toBe(true);
  });

  it('tells the model when the bill could not be read, and saves no usage', async () => {
    let seen = '';
    const provider = new BillReadingProvider({ isElectricityBill: false }, (request) => {
      seen = request.message;
      return [{ type: 'text', text: 'Sorry, I could not read that.' }];
    });
    const { app, store, sessionId, token } = await harness(provider);
    const response = await upload(app, token, { sessionId, mimeType: 'image/png', data: PDF });
    expect(response.json()).toEqual({ read: false, reason: 'not_a_bill' });
    expect((await store.getConversation('t_demo0001', sessionId))?.answers?.['annual_kwh']).toBe(
      undefined,
    );
    await app.inject({
      method: 'POST',
      url: '/v1/chat/stream',
      headers: { authorization: `Bearer ${token}` },
      payload: { sessionId, clientMessageId: 'c1', text: 'I have uploaded my bill.' },
    });
    expect(seen).toContain('did not look like an electricity bill');
  });

  it('refuses another session, a file type it cannot read, and anything unsigned', async () => {
    const provider = new BillReadingProvider({ isElectricityBill: true }, () => []);
    const { app, sessionId, token } = await harness(provider);
    expect(
      (await upload(app, token, { sessionId: 's_other', mimeType: 'application/pdf', data: PDF }))
        .statusCode,
    ).toBe(403);
    expect(
      (await upload(app, token, { sessionId, mimeType: 'text/html', data: PDF })).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/bill',
          payload: { sessionId, mimeType: 'application/pdf', data: PDF },
        })
      ).statusCode,
    ).toBe(401);
    expect(provider.reads).toBe(0);
  });
});
