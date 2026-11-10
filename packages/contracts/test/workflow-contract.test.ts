import { describe, expect, it } from 'vitest';
import {
  chatRequestSchema,
  conversationFlowSchema,
  leadRequestSchema,
  pathMatches,
  sessionRequestSchema,
  workflowSetSchema,
} from '../src/index.js';

const open = { include: [] as string[], exclude: [] as string[] };

describe('pathMatches', () => {
  it('matches anything when the rule is open, even a null path', () => {
    expect(pathMatches(open, '/anything')).toBe(true);
    expect(pathMatches(open, null)).toBe(true);
  });
  it('matches single-star globs within one segment', () => {
    const rule = { include: ['/offers/battery*'], exclude: [] };
    expect(pathMatches(rule, '/offers/battery-deal')).toBe(true);
    expect(pathMatches(rule, '/offers/solar')).toBe(false);
    expect(pathMatches(rule, '/offers/battery/x')).toBe(false);
  });
  it('lets ** cross slashes', () => {
    const rule = { include: ['/heat-pumps/**'], exclude: [] };
    expect(pathMatches(rule, '/heat-pumps/a/b')).toBe(true);
  });
  it('lets exclude win over include', () => {
    expect(pathMatches({ include: ['/a/**'], exclude: ['/a/b'] }, '/a/b')).toBe(false);
    expect(pathMatches({ include: ['/a/**'], exclude: ['/a/b'] }, '/a/c')).toBe(true);
  });
  it('rejects a null path when restricted', () => {
    expect(pathMatches({ include: ['/a'], exclude: [] }, null)).toBe(false);
  });
  it('ignores trailing slashes', () => {
    expect(pathMatches({ include: ['/promo/'], exclude: [] }, '/promo')).toBe(true);
    expect(pathMatches({ include: ['/promo'], exclude: [] }, '/promo/')).toBe(true);
  });
  it('escapes regex characters', () => {
    expect(pathMatches({ include: ['/a.b'], exclude: [] }, '/axb')).toBe(false);
  });
});

const wf = (over: Record<string, unknown> = {}) => ({
  id: 'wf_solar',
  kind: 'solar_quote',
  name: 'Solar quote',
  enabled: true,
  description: 'Get a solar quote',
  triggers: ['solar'],
  interests: ['solar'],
  pages: { include: [], exclude: [] },
  steps: [],
  outcome: { kind: 'quote', engine: 'solar' },
  template: { id: 'solar_quote', version: 1 },
  version: 1,
  updatedAt: '2026-11-10T10:00:00.000Z',
  ...over,
});
const custom = (id: string) => ({
  kind: 'custom',
  id,
  prompt: 'Do you have a car?',
  mode: 'lead',
  answer: 'text',
  choices: [],
});
const customWf = (id: string, steps: unknown[] = []) =>
  wf({
    id,
    kind: 'custom',
    outcome: { kind: 'lead' },
    template: null,
    triggers: [],
    interests: [],
    steps,
  });
const set = (workflows: unknown[]) => ({
  version: 1,
  updatedAt: '2026-11-10T10:00:00.000Z',
  discovery: { enabled: true },
  workflows,
});

describe('workflowSetSchema', () => {
  it('accepts a minimal valid set', () => {
    expect(workflowSetSchema.safeParse(set([wf()])).success).toBe(true);
  });
  it('rejects a solar_quote workflow with a lead outcome', () => {
    expect(workflowSetSchema.safeParse(set([wf({ outcome: { kind: 'lead' } })])).success).toBe(
      false,
    );
  });
  it('rejects two solar_quote workflows', () => {
    expect(workflowSetSchema.safeParse(set([wf(), wf({ id: 'wf_solar2' })])).success).toBe(false);
  });
  it('rejects duplicate workflow ids', () => {
    expect(workflowSetSchema.safeParse(set([customWf('wf_abc'), customWf('wf_abc')])).success).toBe(
      false,
    );
  });
  it('rejects the same custom step id in two workflows', () => {
    const s = [custom('c_abc123')];
    expect(
      workflowSetSchema.safeParse(set([customWf('wf_one', s), customWf('wf_two', s)])).success,
    ).toBe(false);
  });
  it('rejects 13 workflows and accepts 12', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => customWf(`wf_custom${i}`));
    expect(workflowSetSchema.safeParse(set(many(12))).success).toBe(true);
    expect(workflowSetSchema.safeParse(set(many(13))).success).toBe(false);
  });
  it('rejects an id not matching ^wf_', () => {
    expect(workflowSetSchema.safeParse(set([customWf('solar')])).success).toBe(false);
  });
  it('rejects too many triggers and page patterns', () => {
    const t = Array.from({ length: 9 }, (_, i) => `t${i}`);
    expect(
      workflowSetSchema.safeParse(set([customWf('wf_abc', []), wf({ triggers: t })])).success,
    ).toBe(false);
    const p = Array.from({ length: 21 }, (_, i) => `/p${i}`);
    expect(
      workflowSetSchema.safeParse(set([wf({ pages: { include: p, exclude: [] } })])).success,
    ).toBe(false);
  });
});

describe('flow step optional', () => {
  it('round-trips optional: true', () => {
    const flow = {
      version: 1,
      updatedAt: '2026-11-10T10:00:00.000Z',
      steps: [
        { ...custom('c_abcdef'), optional: true },
        { kind: 'preset', id: 'roof', optional: true },
      ],
    };
    const r = conversationFlowSchema.safeParse(flow);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.steps.every((s) => s.optional === true)).toBe(true);
    }
  });
});

describe('request contracts', () => {
  const body = { sessionId: 's1', clientMessageId: 'm1', text: 'hi' };
  it('chat accepts no page and rejects a 513-char path', () => {
    expect(chatRequestSchema.safeParse(body).success).toBe(true);
    expect(chatRequestSchema.safeParse({ ...body, page: { path: '/a' } }).success).toBe(true);
    expect(
      chatRequestSchema.safeParse({ ...body, page: { path: '/' + 'a'.repeat(512) } }).success,
    ).toBe(false);
  });
  it('session accepts an optional path of up to 512 chars', () => {
    const base = { publicId: 'w_abcdefghij', origin: 'https://a.com' };
    expect(sessionRequestSchema.safeParse(base).success).toBe(true);
    const r = sessionRequestSchema.safeParse({ ...base, path: '/x' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.path).toBe('/x');
    expect(sessionRequestSchema.safeParse({ ...base, path: '/' + 'a'.repeat(512) }).success).toBe(
      false,
    );
  });

  it('lead accepts an optional workflowId up to 40 chars', () => {
    const b = { sessionId: 's', consent: true, email: 'a@b.co' };
    expect(leadRequestSchema.safeParse({ ...b, workflowId: 'wf_solar' }).success).toBe(true);
    expect(leadRequestSchema.safeParse({ ...b, workflowId: 'w'.repeat(41) }).success).toBe(false);
  });
});

describe('workflow step limits and null paths', () => {
  it('matches an unknown page for an exclude-only rule', () => {
    expect(pathMatches({ include: [], exclude: ['/checkout'] }, null)).toBe(true);
  });
  it('rejects a workflow with 61 steps', () => {
    const steps = Array.from({ length: 61 }, (_, i) => ({
      kind: 'preset',
      id: `p${i}`,
    }));
    expect(workflowSetSchema.safeParse(set([customWf('wf_abc', steps)])).success).toBe(false);
  });
  it('rejects follow-ups nested 3 deep', () => {
    const lvl = (id: string, child?: unknown) => ({
      ...custom(id),
      ...(child ? { followUps: [{ when: ['yes'], step: child }] } : {}),
    });
    const deep = lvl('c_aaaaaa', lvl('c_bbbbbb', lvl('c_cccccc', lvl('c_dddddd'))));
    expect(workflowSetSchema.safeParse(set([customWf('wf_abc', [deep])])).success).toBe(false);
    const ok = lvl('c_aaaaaa', lvl('c_bbbbbb', lvl('c_cccccc')));
    expect(workflowSetSchema.safeParse(set([customWf('wf_abc', [ok])])).success).toBe(true);
  });
  it('rejects the same custom step id twice in one workflow', () => {
    const steps = [custom('c_abc123'), custom('c_abc123')];
    expect(workflowSetSchema.safeParse(set([customWf('wf_abc', steps)])).success).toBe(false);
  });
});
