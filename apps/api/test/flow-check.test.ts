import { describe, expect, it } from 'vitest';

import type { ConversationFlow, FlowEffect, FlowStep, Workflow } from '@sunny/contracts';

import type { PriceItem, PriceList } from '../src/catalogue/price-list.js';
import { SOLAR } from '../src/flow/banks.js';
import {
  PACKAGE_UNITS,
  checkFlow,
  checkWorkflow,
  checkWorkflowSet,
  isFixedQuantity,
} from '../src/flow/check.js';
import { FIXED_START, PRESET_GROUPS, PRESET_WARNINGS } from '../src/flow/presets.js';
import { QUESTIONS, optionLabel } from '../src/questionnaire.js';
import { presetViews } from '../src/routes/flow-views.js';
import { solarTemplate } from '../src/workflows/templates.js';

function item(over: Partial<PriceItem> & Pick<PriceItem, 'key' | 'name' | 'pricing'>): PriceItem {
  return {
    category: 'optional',
    manufacturer: null,
    model: null,
    mandatory: false,
    priceStatus: 'verified',
    exclusiveGroup: null,
    expansion: null,
    additionalUnitDiscountMinor: null,
    capacityWh: null,
    powerW: null,
    notes: null,
    rows: [],
    ...over,
  };
}

const LIST: PriceList = {
  currency: 'GBP',
  vatRatePercent: 20,
  pricesIncludeVat: false,
  sourceRef: null,
  sourceVersion: null,
  budgetBands: [],
  sentinel: null,
  items: [
    item({
      key: 'PV-BASE',
      name: 'Solar PV system',
      category: 'pv',
      pricing: {
        kind: 'table',
        basis: 'panel_count',
        rows: [{ quantity: 1, amountMinor: 1, label: null }],
      },
    }),
    item({
      key: 'PANEL-PREMIUM',
      name: 'Premium panel',
      category: 'panel_uplift',
      pricing: { kind: 'percent_uplift', of: 'pv', percent: 7.5 },
    }),
    item({
      key: 'ADMIN-FEE',
      name: 'Administration fee',
      category: 'admin',
      mandatory: true,
      pricing: { kind: 'flat', amountMinor: 35000 },
    }),
    item({
      key: 'OPT-TIGO',
      name: 'Optimiser',
      pricing: { kind: 'per_unit', unit: 'panel', amountMinor: 6000, flatMinor: 0 },
    }),
    item({ key: 'BIRD', name: 'Bird mesh', pricing: { kind: 'flat', amountMinor: 60000 } }),
    item({
      key: 'TRENCH',
      name: 'Trenching',
      pricing: { kind: 'per_unit', unit: 'metre', amountMinor: 1500, flatMinor: 0 },
    }),
    item({ key: 'BESPOKE', name: 'Bespoke job', pricing: { kind: 'quote_only' } }),
  ],
};

const custom = (
  id: string,
  effects: FlowEffect[],
  extra: Record<string, unknown> = {},
): FlowStep => ({
  kind: 'custom',
  id,
  prompt: 'Q?',
  mode: 'quote',
  answer: 'choice',
  choices: [{ value: 'yes', label: 'Yes', effects }],
  ...extra,
});

const flowOf = (...steps: FlowStep[]): ConversationFlow => ({
  version: 1,
  updatedAt: 'now',
  steps,
});
const codes = (flow: ConversationFlow, list: PriceList | null = LIST) =>
  checkFlow(flow, list).map((i) => i.code);

describe('checkFlow', () => {
  it('a flow with no effects and no price list has no issues', () => {
    expect(checkFlow(flowOf(custom('c_aaaaaa', [])), null)).toEqual([]);
  });

  it('flags an item that is no longer on the price list', () => {
    const issues = checkFlow(flowOf(custom('c_aaaaaa', [{ kind: 'add', itemKey: 'GONE' }])), LIST);
    expect(issues).toEqual([
      {
        stepId: 'c_aaaaaa',
        choice: 'yes',
        code: 'missing_item',
        message: 'GONE is no longer on your price list.',
      },
    ]);
  });

  it('flags every effect as missing when there is no price list', () => {
    expect(codes(flowOf(custom('c_aaaaaa', [{ kind: 'add', itemKey: 'BIRD' }])), null)).toEqual([
      'missing_item',
    ]);
  });

  it('flags a mandatory item as an add, remove or swap target', () => {
    for (const effect of [
      { kind: 'add', itemKey: 'ADMIN-FEE' },
      { kind: 'remove', itemKey: 'ADMIN-FEE' },
      { kind: 'swap', fromKey: 'ADMIN-FEE', toKey: 'BIRD' },
      { kind: 'swap', fromKey: 'BIRD', toKey: 'ADMIN-FEE' },
    ] as FlowEffect[]) {
      const issues = checkFlow(flowOf(custom('c_aaaaaa', [effect])), LIST);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
        code: 'mandatory_item',
        message: 'Administration fee is on every quote, so an answer cannot remove or swap it.',
      });
    }
  });

  it('flags the base price table and quote-only items as not targetable', () => {
    for (const [key, name] of [
      ['PV-BASE', 'Solar PV system'],
      ['BESPOKE', 'Bespoke job'],
    ]) {
      const issues = checkFlow(
        flowOf(custom('c_aaaaaa', [{ kind: 'remove', itemKey: key! }])),
        LIST,
      );
      expect(issues.map((i) => i.code)).toEqual(['not_targetable']);
      expect(issues[0]!.message).toBe(
        `${name} is part of the system price, so an answer cannot change it.`,
      );
    }
  });

  it('accepts a panel_uplift item', () => {
    expect(codes(flowOf(custom('c_aaaaaa', [{ kind: 'add', itemKey: 'PANEL-PREMIUM' }])))).toEqual(
      [],
    );
    expect(
      codes(
        flowOf(custom('c_aaaaaa', [{ kind: 'swap', fromKey: 'PANEL-PREMIUM', toKey: 'BIRD' }])),
      ),
    ).toEqual([]);
  });

  it('asks for a quantity on an add of an item priced per metre', () => {
    const issues = checkFlow(
      flowOf(custom('c_aaaaaa', [{ kind: 'add', itemKey: 'TRENCH' }])),
      LIST,
    );
    expect(issues[0]).toMatchObject({
      code: 'needs_quantity',
      message: 'Set how many metres of Trenching to add.',
    });
    expect(
      codes(flowOf(custom('c_aaaaaa', [{ kind: 'add', itemKey: 'TRENCH', quantity: 10 }]))),
    ).toEqual([]);
    expect(
      codes(flowOf(custom('c_aaaaaa', [{ kind: 'swap', fromKey: 'BIRD', toKey: 'TRENCH' }]))),
    ).toEqual(['needs_quantity']);
    expect(codes(flowOf(custom('c_aaaaaa', [{ kind: 'remove', itemKey: 'TRENCH' }])))).toEqual([]);
  });

  it('an effect on a per-panel item needs no quantity', () => {
    expect(codes(flowOf(custom('c_aaaaaa', [{ kind: 'add', itemKey: 'OPT-TIGO' }])))).toEqual([]);
    expect(PACKAGE_UNITS).toEqual(['panel']);
  });

  it('asks for a quantity on an add of an item priced per kWh', () => {
    const list: PriceList = {
      ...LIST,
      items: [
        ...LIST.items,
        item({
          key: 'STORAGE-KWH',
          name: 'Extra storage',
          pricing: { kind: 'per_unit', unit: 'kwh', amountMinor: 30000, flatMinor: 0 },
        }),
      ],
    };
    const add = (quantity?: number) =>
      checkFlow(
        flowOf(
          custom('c_aaaaaa', [
            { kind: 'add', itemKey: 'STORAGE-KWH', ...(quantity ? { quantity } : {}) },
          ]),
        ),
        list,
      );
    expect(add()).toMatchObject([
      { code: 'needs_quantity', message: 'Set how many kWh of Extra storage to add.' },
    ]);
    expect(add(5)).toEqual([]);
  });

  it('asks no quantity for an inverter or battery priced per unit, which the package places', () => {
    const inverter = item({
      key: 'INV-HYBRID',
      name: 'Hybrid inverter',
      category: 'inverter',
      pricing: { kind: 'per_unit', unit: 'unit', amountMinor: 90000, flatMinor: 0 },
    });
    const battery = item({
      key: 'BATT-KWH',
      name: 'Battery storage',
      category: 'battery',
      pricing: { kind: 'per_unit', unit: 'kwh', amountMinor: 40000, flatMinor: 0 },
    });
    const list: PriceList = { ...LIST, items: [...LIST.items, inverter, battery] };
    expect(isFixedQuantity(inverter)).toBe(false);
    expect(isFixedQuantity(battery)).toBe(false);
    expect(
      codes(
        flowOf(
          custom('c_aaaaaa', [
            { kind: 'add', itemKey: 'INV-HYBRID' },
            { kind: 'add', itemKey: 'BATT-KWH' },
          ]),
        ),
        list,
      ),
    ).toEqual([]);
    // The same units on an extra still need one: the quote prices that quantity.
    expect(isFixedQuantity(LIST.items.find((i) => i.key === 'TRENCH')!)).toBe(true);
    expect(isFixedQuantity(LIST.items.find((i) => i.key === 'OPT-TIGO')!)).toBe(false);
  });

  it('flags a choice question with no answers, which the journey could never get past', () => {
    const empty = custom('c_aaaaaa', [], { choices: [] });
    expect(checkFlow(flowOf(empty), LIST)).toEqual([
      {
        stepId: 'c_aaaaaa',
        code: 'no_choices',
        message: 'Add at least one answer to this question.',
      },
    ]);
    // Also as a follow-up, and never for a free-text question.
    const nested = custom('c_bbbbbb', [], {
      followUps: [{ when: ['yes'], step: custom('c_cccccc', [], { choices: [] }) }],
    });
    expect(codes(flowOf(nested))).toEqual(['no_choices']);
    const text = custom('c_dddddd', [], { mode: 'lead', answer: 'text', choices: [] });
    expect(codes(flowOf(text))).toEqual([]);
  });

  it('checks the effects of a preset step by answer value', () => {
    const flow = flowOf({
      kind: 'preset',
      id: 'lifestyle',
      effects: { ev: [{ kind: 'add', itemKey: 'GONE' }] },
    });
    expect(checkFlow(flow, LIST)).toMatchObject([
      { stepId: 'lifestyle', choice: 'ev', code: 'missing_item' },
    ]);
  });

  it('flags a follow-up whose parent answer is not one of the parent answers', () => {
    const flow = flowOf(
      custom('c_aaaaaa', [], { followUps: [{ when: ['maybe'], step: custom('c_bbbbbb', []) }] }),
    );
    expect(checkFlow(flow, LIST)).toEqual([
      {
        stepId: 'c_bbbbbb',
        code: 'bad_parent',
        message: "This follow-up's question is no longer in the conversation.",
      },
    ]);
  });

  it('flags a follow-up under a parent with no answer choices, and accepts valid ones', () => {
    const textParent = custom('c_aaaaaa', [], {
      mode: 'lead',
      answer: 'text',
      choices: [],
      followUps: [{ when: ['x'], step: custom('c_bbbbbb', []) }],
    });
    expect(codes(flowOf(textParent))).toEqual(['bad_parent']);
    const ok = flowOf(
      custom('c_aaaaaa', [], { followUps: [{ when: ['yes'], step: custom('c_bbbbbb', []) }] }),
      {
        kind: 'preset',
        id: 'tariff_type',
        followUps: [{ when: ['standard'], step: custom('c_cccccc', []) }],
      },
    );
    expect(codes(ok)).toEqual([]);
  });

  it('flags the same id used twice, including inside follow-ups', () => {
    const flow = flowOf(
      custom('c_aaaaaa', [], { followUps: [{ when: ['yes'], step: custom('c_bbbbbb', []) }] }),
      custom('c_bbbbbb', []),
    );
    expect(checkFlow(flow, LIST)).toEqual([
      { stepId: 'c_bbbbbb', code: 'duplicate_id', message: 'Two questions share the same id.' },
    ]);
  });
});

describe('presetViews', () => {
  it('keeps the legacy output exactly', () => {
    const expected = Object.entries(QUESTIONS).map(([id, q]) => ({
      id,
      prompt: q.prompt,
      options: (q.options ?? []).map((value) => ({ value, label: optionLabel(value) })),
      fixed: (FIXED_START as readonly string[]).includes(id),
      warning: PRESET_WARNINGS[id] ?? null,
      group: [...(PRESET_GROUPS[id] ?? [])],
      appearsWhen: q.appearsWhen
        ? { questionId: q.appearsWhen.questionId, anyOf: [...q.appearsWhen.anyOf] }
        : null,
    }));
    expect(presetViews()).toEqual(expected);
  });

  it('SOLAR has nothing fixed and hides the address followers', () => {
    const views = presetViews(SOLAR);
    expect(views.some((v) => v.fixed)).toBe(false);
    expect(views.some((v) => v.id === 'roof_confidence' || v.id === 'roof_confirmed')).toBe(false);
    expect(views.find((v) => v.id === 'address')!.group).toEqual([
      'roof_confidence',
      'roof_confirmed',
    ]);
  });
});

describe('workflow checks', () => {
  const NOW = '2026-11-10T00:00:00.000Z';
  const solar = (over: Partial<Workflow> = {}): Workflow => ({ ...solarTemplate(NOW), ...over });
  const set = (workflows: Workflow[]) => ({
    version: 1,
    updatedAt: NOW,
    discovery: { enabled: true },
    workflows,
  });

  it('asks a solar quote for the address', () => {
    const w = solar({ steps: [{ kind: 'preset', id: 'motivation' }] });
    expect(checkWorkflow(w, LIST).map((i) => i.code)).toEqual(['needs_address']);
    expect(checkWorkflow(solar(), LIST)).toEqual([]);
  });

  it('flags a page pattern that is not a path', () => {
    const w = solar({ pages: { include: ['offers/x'], exclude: [] } });
    const issues = checkWorkflow(w, LIST);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'bad_page_pattern', field: 'pages', workflowId: w.id });
  });

  it('flags a custom step id used in two workflows', () => {
    const step = custom('c_abc123', []);
    const a = solar({ steps: [{ kind: 'preset', id: 'address' }, step] });
    const b = solar({ id: 'wf_other', kind: 'custom', steps: [step] });
    const issues = checkWorkflowSet(set([a, b]), LIST).filter(
      (i) => i.code === 'duplicate_step_id',
    );
    expect(issues).toEqual([
      expect.objectContaining({ workflowId: 'wf_other', stepId: 'c_abc123' }),
    ]);
  });

  it('warns when two all-pages workflows share an interest', () => {
    const a = solar();
    const b = solar({ id: 'wf_other', kind: 'custom', steps: [{ kind: 'preset', id: 'address' }] });
    const issues = checkWorkflowSet(set([a, b]), LIST).filter((i) => i.code === 'interest_overlap');
    expect(issues).toHaveLength(1);
    expect(issues[0]!.warning).toBe(true);
  });
});
