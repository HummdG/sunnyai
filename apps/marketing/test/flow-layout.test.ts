import { describe, expect, it } from 'vitest';

import { layoutFlow, type FlowNode } from '../components/dashboard/conversation/flow-layout.js';
import type { Context, Draft } from '../components/dashboard/conversation/model.js';
import type { PresetView, PriceItemView } from '../lib/portal-api.js';

const preset = (id: string, prompt: string, extra: Partial<PresetView> = {}): PresetView => ({
  id,
  prompt,
  options: [
    { value: 'yes', label: 'Yes' },
    { value: 'no', label: 'No' },
  ],
  fixed: false,
  warning: null,
  group: [],
  appearsWhen: null,
  ...extra,
});

const EV: PriceItemView = {
  key: 'EV-7KW',
  name: '7kW EV charger',
  category: 'optional',
  unitLabel: 'item',
  packageUnit: false,
  needsQuantity: false,
  mandatory: false,
  targetable: true,
  priceText: '£899',
};

const ctx: Context = {
  presets: new Map(
    [
      preset('address', 'What is your address?', { fixed: true }),
      preset('shading', 'Is the roof shaded by trees or buildings?'),
      preset('usage', 'How would you like to tell me about your electricity use?', {
        options: [
          { value: 'bill', label: 'From a bill' },
          { value: 'unsure', label: 'Not sure' },
        ],
        group: ['kwh', 'people'],
      }),
      preset('kwh', 'Roughly how many kWh a year?', {
        appearsWhen: { questionId: 'usage', anyOf: ['bill'] },
      }),
      preset('people', 'How many people live in the household?', {
        appearsWhen: { questionId: 'usage', anyOf: ['unsure'] },
      }),
    ].map((p) => [p.id, p]),
  ),
  items: [EV],
  assistant: 'Sunny',
};

const LONG =
  'Roughly how much roof space is free of skylights, vents and chimneys on the side that faces south?';

const draft: Draft = {
  members: {},
  steps: [
    { kind: 'preset', id: 'shading' },
    { kind: 'preset', id: 'usage' },
    {
      kind: 'custom',
      id: 'c_ev',
      prompt: 'Do you have an electric car?',
      mode: 'quote',
      answer: 'choice',
      choices: [
        { value: 'yes', label: 'Yes', effects: [{ kind: 'add', itemKey: 'EV-7KW' }] },
        { value: 'no', label: 'No', effects: [] },
      ],
      followUps: [
        {
          when: ['yes'],
          step: {
            kind: 'custom',
            id: 'c_tesla',
            prompt: 'Is it a Tesla?',
            mode: 'lead',
            answer: 'choice',
            choices: [
              { value: 'yes', label: 'Yes', effects: [] },
              { value: 'no', label: 'No', effects: [] },
            ],
          },
        },
      ],
    },
    {
      kind: 'custom',
      id: 'c_long',
      prompt: LONG,
      mode: 'quote',
      answer: 'choice',
      choices: [
        { value: 'yes', label: 'Yes', effects: [{ kind: 'add', itemKey: 'EV-7KW' }] },
        { value: 'no', label: 'No', effects: [] },
      ],
    },
  ],
};

const overlaps = (a: FlowNode, b: FlowNode) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe('the flow canvas layout', () => {
  const layout = layoutFlow(draft, ctx);
  const node = (key: string) => layout.nodes.find((n) => n.key === key)!;

  it('puts the listed questions on the spine, in order, between the locked start and end', () => {
    const spine = layout.nodes.filter((n) => n.depth === 0).sort((a, b) => a.y - b.y);
    expect(spine.map((n) => n.key)).toEqual(['start', 'shading', 'usage', 'c_ev', 'c_long', 'end']);
    expect(new Set(spine.map((n) => n.x)).size).toBe(1);
    expect(node('start').kind).toBe('fixed');
    expect(node('c_ev').index).toBe(2);
  });

  it('branches group members and follow-ups to the right, with the answer on the pill', () => {
    expect(node('kwh').x).toBeGreaterThan(node('usage').x + node('usage').width);
    expect(node('c_tesla').depth).toBe(1);
    const texts = layout.pills.map((p) => p.text);
    expect(texts).toContain('From a bill');
    expect(texts).toContain('Not sure');
    expect(texts).toContain('Yes · +£899 7kW EV charger');
    // A priced answer that opens nothing still shows, under its box.
    const stub = layout.pills.find((p) => p.key === 'stub-c_long-0')!;
    expect(stub.text).toBe('Yes · +£899 7kW EV charger');
    expect(stub.y).toBeGreaterThanOrEqual(node('c_long').y + node('c_long').height);
    const priced = layout.edges.filter((e) => e.price).map((e) => e.key);
    expect(priced).toContain('branch-c_tesla');
    expect(priced).not.toContain('branch-kwh');
  });

  it('keeps the full question, wrapping a long one inside a box of at most 280px', () => {
    expect(node('c_long').label).toBe(LONG);
    expect(node('c_long').width).toBeLessThanOrEqual(280);
    expect(node('c_long').height).toBeGreaterThan(node('shading').height);
  });

  it('never overlaps two boxes, or a pill and a box', () => {
    for (const a of layout.nodes)
      for (const b of layout.nodes) if (a !== b) expect(overlaps(a, b)).toBe(false);
    for (const p of layout.pills) {
      const box = p as unknown as FlowNode;
      for (const n of layout.nodes) expect(overlaps(box, n)).toBe(false);
    }
    for (const n of layout.nodes) {
      expect(n.x + n.width).toBeLessThanOrEqual(layout.width);
      expect(n.y + n.height).toBeLessThanOrEqual(layout.height);
    }
  });

  it('keeps each branch short: its pill in the middle of the gap, no line back to the spine', () => {
    const ev = node('c_ev');
    const tesla = node('c_tesla');
    const pill = layout.pills.find((p) => p.key === 'branch-c_tesla')!;
    const left = pill.x - (ev.x + ev.width);
    const right = tesla.x - (pill.x + pill.width);
    expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
    expect(left).toBeLessThanOrEqual(60);
    expect(layout.edges.some((e) => e.key.startsWith('return'))).toBe(false);
    expect(tesla.width).toBeLessThanOrEqual(260);
  });

  it('wraps a long pill instead of widening the canvas', () => {
    const long = layoutFlow(draft, ctx, new Map(), {
      text: (s) => s.length * 7.4,
      tag: (s) => s.length * 6.1,
      pill: (s) => s.length * 12,
    });
    for (const p of long.pills) expect(p.width).toBeLessThanOrEqual(180);
    expect(long.pills.some((p) => p.height > 22)).toBe(true);
  });

  it('uses measured heights when given, and still keeps boxes apart', () => {
    const tall = layoutFlow(draft, ctx, new Map([['c_ev', 160]]));
    const ev = tall.nodes.find((n) => n.key === 'c_ev')!;
    const next = tall.nodes.find((n) => n.key === 'c_long')!;
    expect(ev.height).toBe(160);
    expect(next.y).toBeGreaterThan(ev.y + 160);
  });
});
