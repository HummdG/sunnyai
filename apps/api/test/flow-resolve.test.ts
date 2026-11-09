import { describe, expect, it } from 'vitest';

import type { ConversationFlow, FlowStep } from '@sunny/contracts';

import { FIXED_START, PRESET_GROUPS, PRESET_TOPICS, PRESET_WARNINGS } from '../src/flow/presets.js';
import { resolveFlow } from '../src/flow/resolve.js';
import { QUESTIONS } from '../src/questionnaire.js';

/**
 * The resolved flow: an installer's stored conversation turned into the API the
 * questionnaire has always offered.
 *
 * The first block pins today's behaviour. Its expectations were recorded from
 * `questionnaire.ts` BEFORE it was re-implemented over `resolveFlow(null)`, so a
 * default flow that drifts from SunScan's question set fails here, literally.
 */

// --- recorded from questionnaire.ts before the refactor (do not regenerate) ---
type Verdict = Record<string, unknown>;
interface BaselineRow {
  name: string;
  answers: Record<string, string>;
  next: string | null;
  outstanding: string[];
  validate: { id: string; value: string; verdict: Verdict }[];
  reconcile: { answers: Record<string, string>; dropped: unknown[] };
}
const BASELINE: BaselineRow[] = [
  {
    name: 'empty',
    answers: {},
    next: 'address',
    outstanding: [
      'address',
      'roof_confidence',
      'roof_shading',
      'property_type',
      'ownership',
      'usage_source',
      'lifestyle',
      'tariff_type',
      'existing_system',
      'motivation',
      'budget_band',
      'finance_interest',
    ],
    validate: [
      {
        id: 'annual_kwh',
        value: '3,200 kWh',
        verdict: {
          ok: true,
          questionId: 'annual_kwh',
          value: '3,200 kWh',
        },
      },
      {
        id: 'monthly_cost',
        value: '£120',
        verdict: {
          ok: true,
          questionId: 'monthly_cost',
          value: '£120',
        },
      },
      {
        id: 'roof_size',
        value: 'large',
        verdict: {
          ok: true,
          questionId: 'roof_size',
          value: 'large',
        },
      },
      {
        id: 'lifestyle',
        value: 'heatpump_planned, ev_now, ev_now',
        verdict: {
          ok: true,
          questionId: 'lifestyle',
          value: 'ev_now,heatpump_planned',
        },
      },
    ],
    reconcile: {
      answers: {},
      dropped: [],
    },
  },
  {
    name: 'address only',
    answers: {
      address: '1 High Street, Leeds LS1 1AA',
    },
    next: 'roof_confidence',
    outstanding: [
      'roof_confidence',
      'roof_shading',
      'property_type',
      'ownership',
      'usage_source',
      'lifestyle',
      'tariff_type',
      'existing_system',
      'motivation',
      'budget_band',
      'finance_interest',
    ],
    validate: [
      {
        id: 'annual_kwh',
        value: '3,200 kWh',
        verdict: {
          ok: true,
          questionId: 'annual_kwh',
          value: '3,200 kWh',
        },
      },
      {
        id: 'monthly_cost',
        value: '£120',
        verdict: {
          ok: true,
          questionId: 'monthly_cost',
          value: '£120',
        },
      },
      {
        id: 'roof_size',
        value: 'large',
        verdict: {
          ok: true,
          questionId: 'roof_size',
          value: 'large',
        },
      },
      {
        id: 'lifestyle',
        value: 'heatpump_planned, ev_now, ev_now',
        verdict: {
          ok: true,
          questionId: 'lifestyle',
          value: 'ev_now,heatpump_planned',
        },
      },
    ],
    reconcile: {
      answers: {
        address: '1 High Street, Leeds LS1 1AA',
      },
      dropped: [],
    },
  },
  {
    name: 'low roof confidence',
    answers: {
      address: '1 High Street, Leeds LS1 1AA',
      roof_confidence: 'low',
    },
    next: 'roof_size',
    outstanding: [
      'roof_size',
      'roof_direction',
      'roof_shading',
      'property_type',
      'ownership',
      'usage_source',
      'lifestyle',
      'tariff_type',
      'existing_system',
      'motivation',
      'budget_band',
      'finance_interest',
    ],
    validate: [
      {
        id: 'annual_kwh',
        value: '3,200 kWh',
        verdict: {
          ok: true,
          questionId: 'annual_kwh',
          value: '3,200 kWh',
        },
      },
      {
        id: 'monthly_cost',
        value: '£120',
        verdict: {
          ok: true,
          questionId: 'monthly_cost',
          value: '£120',
        },
      },
      {
        id: 'roof_size',
        value: 'large',
        verdict: {
          ok: true,
          questionId: 'roof_size',
          value: 'large',
        },
      },
      {
        id: 'lifestyle',
        value: 'heatpump_planned, ev_now, ev_now',
        verdict: {
          ok: true,
          questionId: 'lifestyle',
          value: 'ev_now,heatpump_planned',
        },
      },
    ],
    reconcile: {
      answers: {
        address: '1 High Street, Leeds LS1 1AA',
        roof_confidence: 'low',
      },
      dropped: [],
    },
  },
  {
    name: 'usage household',
    answers: {
      address: '1 High Street, Leeds LS1 1AA',
      roof_confidence: 'high',
      roof_confirmed: 'yes',
      roof_shading: 'none',
      property_type: 'semi',
      ownership: 'own',
      usage_source: 'household',
    },
    next: 'household_size',
    outstanding: [
      'household_size',
      'lifestyle',
      'tariff_type',
      'existing_system',
      'motivation',
      'budget_band',
      'finance_interest',
    ],
    validate: [
      {
        id: 'annual_kwh',
        value: '3,200 kWh',
        verdict: {
          ok: false,
          error: 'that question is not asked, given an earlier answer',
          needs: 'usage_source to be one of bill_ocr, manual_kwh (it is "household")',
        },
      },
      {
        id: 'monthly_cost',
        value: '£120',
        verdict: {
          ok: false,
          error: 'that question is not asked, given an earlier answer',
          needs: 'usage_source to be one of monthly_cost (it is "household")',
        },
      },
      {
        id: 'roof_size',
        value: 'large',
        verdict: {
          ok: false,
          error: 'that question is not asked, given an earlier answer',
          needs: 'roof_confidence to be one of low (it is "high")',
        },
      },
      {
        id: 'lifestyle',
        value: 'heatpump_planned, ev_now, ev_now',
        verdict: {
          ok: true,
          questionId: 'lifestyle',
          value: 'ev_now,heatpump_planned',
        },
      },
    ],
    reconcile: {
      answers: {
        address: '1 High Street, Leeds LS1 1AA',
        roof_confidence: 'high',
        roof_confirmed: 'yes',
        roof_shading: 'none',
        property_type: 'semi',
        ownership: 'own',
        usage_source: 'household',
      },
      dropped: [],
    },
  },
  {
    name: 'lifestyle ev_now',
    answers: {
      address: '1 High Street, Leeds LS1 1AA',
      roof_confidence: 'high',
      roof_confirmed: 'yes',
      roof_shading: 'none',
      property_type: 'semi',
      ownership: 'own',
      usage_source: 'household',
      household_size: '3',
      lifestyle: 'ev_now',
    },
    next: 'tariff_type',
    outstanding: [
      'tariff_type',
      'existing_system',
      'motivation',
      'budget_band',
      'finance_interest',
    ],
    validate: [
      {
        id: 'annual_kwh',
        value: '3,200 kWh',
        verdict: {
          ok: false,
          error: 'that question is not asked, given an earlier answer',
          needs: 'usage_source to be one of bill_ocr, manual_kwh (it is "household")',
        },
      },
      {
        id: 'monthly_cost',
        value: '£120',
        verdict: {
          ok: false,
          error: 'that question is not asked, given an earlier answer',
          needs: 'usage_source to be one of monthly_cost (it is "household")',
        },
      },
      {
        id: 'roof_size',
        value: 'large',
        verdict: {
          ok: false,
          error: 'that question is not asked, given an earlier answer',
          needs: 'roof_confidence to be one of low (it is "high")',
        },
      },
      {
        id: 'lifestyle',
        value: 'heatpump_planned, ev_now, ev_now',
        verdict: {
          ok: true,
          questionId: 'lifestyle',
          value: 'ev_now,heatpump_planned',
        },
      },
    ],
    reconcile: {
      answers: {
        address: '1 High Street, Leeds LS1 1AA',
        roof_confidence: 'high',
        roof_confirmed: 'yes',
        roof_shading: 'none',
        property_type: 'semi',
        ownership: 'own',
        usage_source: 'household',
        household_size: '3',
        lifestyle: 'ev_now',
      },
      dropped: [],
    },
  },
  {
    name: 'everything answered',
    answers: {
      address: '1 High Street, Leeds LS1 1AA',
      roof_confidence: 'high',
      roof_confirmed: 'yes',
      roof_shading: 'trees',
      property_type: 'detached',
      ownership: 'mortgage',
      usage_source: 'manual_kwh',
      annual_kwh: '3200',
      lifestyle: 'ev_now,heatpump_planned',
      tariff_type: 'economy7',
      existing_system: 'none',
      motivation: 'reduce_bills',
      budget_band: '6k_10k',
      finance_interest: 'maybe',
    },
    next: null,
    outstanding: [],
    validate: [
      {
        id: 'annual_kwh',
        value: '3,200 kWh',
        verdict: {
          ok: true,
          questionId: 'annual_kwh',
          value: '3,200 kWh',
        },
      },
      {
        id: 'monthly_cost',
        value: '£120',
        verdict: {
          ok: false,
          error: 'that question is not asked, given an earlier answer',
          needs: 'usage_source to be one of monthly_cost (it is "manual_kwh")',
        },
      },
      {
        id: 'roof_size',
        value: 'large',
        verdict: {
          ok: false,
          error: 'that question is not asked, given an earlier answer',
          needs: 'roof_confidence to be one of low (it is "high")',
        },
      },
      {
        id: 'lifestyle',
        value: 'heatpump_planned, ev_now, ev_now',
        verdict: {
          ok: true,
          questionId: 'lifestyle',
          value: 'ev_now,heatpump_planned',
        },
      },
    ],
    reconcile: {
      answers: {
        address: '1 High Street, Leeds LS1 1AA',
        roof_confidence: 'high',
        roof_confirmed: 'yes',
        roof_shading: 'trees',
        property_type: 'detached',
        ownership: 'mortgage',
        usage_source: 'manual_kwh',
        annual_kwh: '3200',
        lifestyle: 'ev_now,heatpump_planned',
        tariff_type: 'economy7',
        existing_system: 'none',
        motivation: 'reduce_bills',
        budget_band: '6k_10k',
        finance_interest: 'maybe',
      },
      dropped: [],
    },
  },
  {
    name: 'conflicting monthly_cost after household',
    answers: {
      address: '1 High Street, Leeds LS1 1AA',
      usage_source: 'household',
      household_size: '3',
      monthly_cost: '120',
    },
    next: 'roof_confidence',
    outstanding: [
      'roof_confidence',
      'roof_shading',
      'property_type',
      'ownership',
      'lifestyle',
      'tariff_type',
      'existing_system',
      'motivation',
      'budget_band',
      'finance_interest',
    ],
    validate: [
      {
        id: 'annual_kwh',
        value: '3,200 kWh',
        verdict: {
          ok: false,
          error: 'that question is not asked, given an earlier answer',
          needs: 'usage_source to be one of bill_ocr, manual_kwh (it is "household")',
        },
      },
      {
        id: 'monthly_cost',
        value: '£120',
        verdict: {
          ok: false,
          error: 'that question is not asked, given an earlier answer',
          needs: 'usage_source to be one of monthly_cost (it is "household")',
        },
      },
      {
        id: 'roof_size',
        value: 'large',
        verdict: {
          ok: true,
          questionId: 'roof_size',
          value: 'large',
        },
      },
      {
        id: 'lifestyle',
        value: 'heatpump_planned, ev_now, ev_now',
        verdict: {
          ok: true,
          questionId: 'lifestyle',
          value: 'ev_now,heatpump_planned',
        },
      },
    ],
    reconcile: {
      answers: {
        address: '1 High Street, Leeds LS1 1AA',
        usage_source: 'household',
        household_size: '3',
      },
      dropped: [
        {
          questionId: 'monthly_cost',
          value: '120',
          ruledOutBy: {
            questionId: 'usage_source',
            value: 'household',
            anyOf: ['monthly_cost'],
          },
        },
      ],
    },
  },
  {
    name: 'pending annual_kwh',
    answers: {
      address: '1 High Street, Leeds LS1 1AA',
      annual_kwh: '3200',
    },
    next: 'roof_confidence',
    outstanding: [
      'roof_confidence',
      'roof_shading',
      'property_type',
      'ownership',
      'usage_source',
      'lifestyle',
      'tariff_type',
      'existing_system',
      'motivation',
      'budget_band',
      'finance_interest',
    ],
    validate: [
      {
        id: 'annual_kwh',
        value: '3,200 kWh',
        verdict: {
          ok: true,
          questionId: 'annual_kwh',
          value: '3,200 kWh',
        },
      },
      {
        id: 'monthly_cost',
        value: '£120',
        verdict: {
          ok: true,
          questionId: 'monthly_cost',
          value: '£120',
        },
      },
      {
        id: 'roof_size',
        value: 'large',
        verdict: {
          ok: true,
          questionId: 'roof_size',
          value: 'large',
        },
      },
      {
        id: 'lifestyle',
        value: 'heatpump_planned, ev_now, ev_now',
        verdict: {
          ok: true,
          questionId: 'lifestyle',
          value: 'ev_now,heatpump_planned',
        },
      },
    ],
    reconcile: {
      answers: {
        address: '1 High Street, Leeds LS1 1AA',
        annual_kwh: '3200',
      },
      dropped: [],
    },
  },
];
const EXTRAS: { id: string; value: string; answers: Record<string, string>; verdict: Verdict }[] = [
  {
    id: 'nope',
    value: 'x',
    answers: {},
    verdict: {
      ok: false,
      error: 'unknown question',
      known: [
        'address',
        'roof_confidence',
        'roof_confirmed',
        'roof_size',
        'roof_direction',
        'roof_shading',
        'property_type',
        'ownership',
        'usage_source',
        'annual_kwh',
        'monthly_cost',
        'household_size',
        'lifestyle',
        'tariff_type',
        'existing_system',
        'motivation',
        'budget_band',
        'finance_interest',
      ],
    },
  },
  {
    id: 'address',
    value: '',
    answers: {},
    verdict: { ok: false, error: 'questionId and value are required' },
  },
  {
    id: 'annual_kwh',
    value: 'purple',
    answers: {},
    verdict: { ok: false, error: 'value is not a number', expects: 'a number of kWh' },
  },
  {
    id: 'annual_kwh',
    value: '999999',
    answers: {},
    verdict: {
      ok: false,
      error: 'value is outside the range that makes sense',
      expects: 'a number of kWh between 1 and 100000',
    },
  },
  {
    id: 'lifestyle',
    value: 'none,ev_now',
    answers: {},
    verdict: { ok: false, error: '"none" cannot be combined with other options' },
  },
  {
    id: 'roof_shading',
    value: 'sideways',
    answers: {},
    verdict: {
      ok: false,
      error: 'value not among the allowed options',
      allowed: ['none', 'trees', 'buildings', 'heavy', 'unsure'],
    },
  },
  {
    id: 'annual_kwh',
    value: '3200',
    answers: { usage_source: 'monthly_cost' },
    verdict: {
      ok: false,
      error: 'that question is not asked, given an earlier answer',
      needs: 'usage_source to be one of bill_ocr, manual_kwh (it is "monthly_cost")',
    },
  },
];
// --- end of recorded expectations ---

function flow(steps: FlowStep[]): ConversationFlow {
  return { version: 1, updatedAt: '2026-11-09T00:00:00.000Z', steps };
}

const preset = (
  id: string,
  extra: Partial<Extract<FlowStep, { kind: 'preset' }>> = {},
): FlowStep => ({
  kind: 'preset',
  id,
  ...extra,
});

/** Sunny's middle section, as a stored flow would list it (group members implied). */
const DEFAULT_MIDDLE = [
  'roof_size',
  'roof_shading',
  'property_type',
  'ownership',
  'usage_source',
  'lifestyle',
  'tariff_type',
  'existing_system',
  'motivation',
  'budget_band',
  'finance_interest',
];

const EV: FlowStep = {
  kind: 'custom',
  id: 'c_evcharger',
  prompt: 'Do you have an electric car?',
  mode: 'quote',
  answer: 'choice',
  choices: [
    { value: 'yes', label: 'Yes', effects: [{ kind: 'add', itemKey: 'ev_charger' }] },
    { value: 'no', label: 'No', effects: [] },
  ],
  followUps: [
    {
      when: ['yes'],
      step: {
        kind: 'custom',
        id: 'c_evmodel',
        prompt: 'Which car is it?',
        mode: 'lead',
        answer: 'text',
        choices: [],
      },
    },
  ],
};

describe('the default flow', () => {
  it('asks exactly what questionnaire.ts asks today', () => {
    const resolved = resolveFlow(null);
    for (const row of BASELINE) {
      expect(resolved.next(row.answers), row.name).toBe(row.next);
      expect(resolved.outstanding(row.answers), row.name).toEqual(row.outstanding);
      for (const probe of row.validate) {
        expect(
          resolved.validate(probe.id, probe.value, row.answers),
          `${row.name}: ${probe.id}`,
        ).toEqual(probe.verdict);
      }
      expect(resolved.reconcile(row.answers), row.name).toEqual(row.reconcile);
    }
    for (const probe of EXTRAS) {
      expect(resolved.validate(probe.id, probe.value, probe.answers), probe.id).toEqual(
        probe.verdict,
      );
    }
  });

  it('is not custom, removes nothing, and lists every SunScan question in order', () => {
    const resolved = resolveFlow(null);
    expect(resolved.custom).toBe(false);
    expect(resolved.removedPresets).toEqual([]);
    expect(resolved.questions.map((q) => q.id)).toEqual(Object.keys(QUESTIONS));
    expect(resolveFlow(undefined).questions.map((q) => q.id)).toEqual(Object.keys(QUESTIONS));
  });
});

describe('presets', () => {
  it('names a fixed start, a warning and a topic for every price-dependent preset', () => {
    expect(FIXED_START).toEqual(['address', 'roof_confidence', 'roof_confirmed']);
    expect(Object.keys(PRESET_TOPICS).sort()).toEqual(Object.keys(PRESET_WARNINGS).sort());
    expect(PRESET_TOPICS.roof_shading).toBe('roof shading');
    expect(PRESET_TOPICS.usage_source).toBe('electricity use');
    expect(PRESET_GROUPS.usage_source).toEqual(['annual_kwh', 'monthly_cost', 'household_size']);
    for (const text of [...Object.values(PRESET_WARNINGS), ...Object.values(PRESET_TOPICS)]) {
      expect(text).not.toContain('—');
    }
  });
});

describe('an installer flow', () => {
  it('a removed preset is never asked', () => {
    const resolved = resolveFlow(
      flow(DEFAULT_MIDDLE.filter((id) => id !== 'roof_shading').map((id) => preset(id))),
    );
    expect(resolved.custom).toBe(true);
    expect(resolved.removedPresets).toEqual(['roof_shading']);
    expect(resolved.question('roof_shading')).toBeUndefined();
    const answers = { address: 'x', roof_confidence: 'high', roof_confirmed: 'yes' };
    expect(resolved.next(answers)).toBe('property_type');
    expect(resolved.outstanding(answers)).not.toContain('roof_shading');
    expect(resolved.validate('roof_shading', 'none', answers)).toMatchObject({
      ok: false,
      error: 'unknown question',
    });
  });

  it('removing usage_source removes its follow-ups too', () => {
    const resolved = resolveFlow(
      flow(DEFAULT_MIDDLE.filter((id) => id !== 'usage_source').map((id) => preset(id))),
    );
    expect(resolved.removedPresets).toEqual([
      'usage_source',
      'annual_kwh',
      'monthly_cost',
      'household_size',
    ]);
    for (const id of ['usage_source', 'annual_kwh', 'monthly_cost', 'household_size']) {
      expect(resolved.question(id)).toBeUndefined();
    }
  });

  it('a reworded preset keeps its values and shows the new label', () => {
    const resolved = resolveFlow(
      flow([
        preset('roof_shading', {
          prompt: 'Any trees near the roof?',
          labels: { heavy: 'Lots of trees nearby' },
        }),
      ]),
    );
    const q = resolved.question('roof_shading')!;
    expect(q.prompt).toBe('Any trees near the roof?');
    expect(q.options).toEqual(['none', 'trees', 'buildings', 'heavy', 'unsure']);
    expect(q.mode).toBe('preset');
    expect(q.label('heavy')).toBe('Lots of trees nearby');
    expect(q.label('trees')).toBe('Trees');
    expect(resolved.validate('roof_shading', 'heavy')).toEqual({
      ok: true,
      questionId: 'roof_shading',
      value: 'heavy',
    });
    expect(resolved.validate('roof_shading', 'Lots of trees nearby')).toMatchObject({ ok: false });
  });

  it('keeps the roof fallback questions conditional when reworded and reordered', () => {
    const resolved = resolveFlow(
      flow([preset('property_type'), preset('roof_size', { prompt: 'How big is the roof?' })]),
    );
    const ids = resolved.questions.map((q) => q.id);
    expect(ids).toEqual([...FIXED_START, 'property_type', 'roof_size', 'roof_direction']);
    expect(resolved.question('roof_size')!.parent).toEqual({
      id: 'roof_confidence',
      anyOf: ['low'],
    });
    expect(
      resolved.next({
        address: 'x',
        roof_confidence: 'high',
        roof_confirmed: 'yes',
        property_type: 'semi',
      }),
    ).toBe(null);
    expect(resolved.next({ address: 'x', roof_confidence: 'low', property_type: 'semi' })).toBe(
      'roof_size',
    );
  });

  it('a custom question sits where the installer put it, and its follow-up comes right after it, only when its parent answer matches', () => {
    const resolved = resolveFlow(flow([preset('property_type'), EV, preset('ownership')]));
    expect(resolved.questions.map((q) => q.id)).toEqual([
      ...FIXED_START,
      'property_type',
      'c_evcharger',
      'c_evmodel',
      'ownership',
    ]);
    const ev = resolved.question('c_evcharger')!;
    expect(ev).toMatchObject({
      mode: 'quote',
      options: ['yes', 'no'],
      multi: false,
      freeText: false,
      parent: null,
    });
    expect(ev.label('yes')).toBe('Yes');
    expect(resolved.question('c_evmodel')!.parent).toEqual({ id: 'c_evcharger', anyOf: ['yes'] });

    const base = {
      address: 'x',
      roof_confidence: 'high',
      roof_confirmed: 'yes',
      property_type: 'semi',
    };
    expect(resolved.next(base)).toBe('c_evcharger');
    expect(resolved.next({ ...base, c_evcharger: 'yes' })).toBe('c_evmodel');
    expect(resolved.next({ ...base, c_evcharger: 'no' })).toBe('ownership');
    expect(resolved.applicability('c_evmodel', base)).toBe('pending');
    expect(resolved.applicability('c_evmodel', { ...base, c_evcharger: 'no' })).toBe('conflicts');
  });

  it('the fixed start comes first whatever the stored order', () => {
    const resolved = resolveFlow(
      flow([
        preset('ownership'),
        preset('roof_confirmed'),
        preset('address'),
        preset('property_type'),
      ]),
    );
    expect(resolved.questions.map((q) => q.id)).toEqual([
      ...FIXED_START,
      'ownership',
      'property_type',
    ]);
  });

  it('a stored flow cannot remove roof_confirmed', () => {
    const resolved = resolveFlow(flow([preset('ownership')]));
    expect(resolved.question('roof_confirmed')).toBeDefined();
    expect(resolved.removedPresets).not.toContain('roof_confirmed');
    expect(resolved.removedPresets).not.toContain('address');
    expect(resolved.removedPresets).not.toContain('roof_confidence');
  });

  it('a custom choice question refuses a value that is not one of its choices', () => {
    const resolved = resolveFlow(flow([EV]));
    expect(resolved.validate('c_evcharger', 'maybe')).toEqual({
      ok: false,
      error: 'value not among the allowed options',
      allowed: ['yes', 'no'],
    });
    expect(resolved.validate('c_evcharger', 'yes')).toEqual({
      ok: true,
      questionId: 'c_evcharger',
      value: 'yes',
    });
  });

  it('a lead text question accepts any text up to 500 characters', () => {
    const resolved = resolveFlow(flow([EV]));
    const answers = { c_evcharger: 'yes' };
    expect(resolved.question('c_evmodel')).toMatchObject({
      freeText: true,
      options: null,
      mode: 'lead',
    });
    expect(resolved.validate('c_evmodel', 'A Tesla Model 3, the long range one', answers)).toEqual({
      ok: true,
      questionId: 'c_evmodel',
      value: 'A Tesla Model 3, the long range one',
    });
    expect(resolved.validate('c_evmodel', 'x'.repeat(500), answers)).toMatchObject({ ok: true });
    expect(resolved.validate('c_evmodel', 'x'.repeat(501), answers)).toMatchObject({ ok: false });
  });

  it('reconcile drops a follow-up answer when its parent answer changes', () => {
    const resolved = resolveFlow(flow([EV]));
    expect(resolved.reconcile({ c_evcharger: 'no', c_evmodel: 'Tesla' })).toEqual({
      answers: { c_evcharger: 'no' },
      dropped: [
        {
          questionId: 'c_evmodel',
          value: 'Tesla',
          ruledOutBy: { questionId: 'c_evcharger', value: 'no', anyOf: ['yes'] },
        },
      ],
    });
  });

  it('a follow-up on a multi-select preset opens when any picked value matches', () => {
    const charger: FlowStep = {
      kind: 'custom',
      id: 'c_charger',
      prompt: 'Would you like a car charger?',
      mode: 'quote',
      answer: 'choice',
      choices: [
        { value: 'yes', label: 'Yes', effects: [] },
        { value: 'no', label: 'No', effects: [] },
      ],
    };
    const resolved = resolveFlow(
      flow([preset('lifestyle', { followUps: [{ when: ['ev_now'], step: charger }] })]),
    );
    const picked = { lifestyle: 'ev_now,heatpump_planned' };
    expect(resolved.applicability('c_charger', picked)).toBe('applies');
    expect(resolved.validate('c_charger', 'yes', picked)).toMatchObject({ ok: true });
    expect(resolved.reconcile({ ...picked, c_charger: 'yes' }).dropped).toEqual([]);
    expect(
      resolved.applicability('c_charger', { lifestyle: 'heatpump_planned,home_daytime' }),
    ).toBe('conflicts');
  });

  it('a follow-up on a fixed-start preset is asked where the installer listed it', () => {
    const why: FlowStep = {
      kind: 'custom',
      id: 'c_roofwrong',
      prompt: 'What looks wrong about the roof?',
      mode: 'lead',
      answer: 'text',
      choices: [],
    };
    const resolved = resolveFlow(
      flow([
        preset('property_type'),
        preset('roof_confirmed', { followUps: [{ when: ['no'], step: why }] }),
        preset('ownership'),
      ]),
    );
    expect(resolved.questions.map((q) => q.id)).toEqual([
      ...FIXED_START,
      'property_type',
      'c_roofwrong',
      'ownership',
    ]);
    expect(resolved.question('c_roofwrong')!.parent).toEqual({
      id: 'roof_confirmed',
      anyOf: ['no'],
    });
    const base = { address: 'x', roof_confidence: 'high', property_type: 'semi' };
    expect(resolved.next({ ...base, roof_confirmed: 'no' })).toBe('c_roofwrong');
    expect(resolved.next({ ...base, roof_confirmed: 'yes' })).toBe('ownership');
  });
});
