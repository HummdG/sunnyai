/**
 * Question banks: the pool of questions a workflow's steps draw from.
 *
 * LEGACY_SOLAR is SunScan's own set with the address and roof checks forced
 * first (what `resolveFlow(null)` has always been). SOLAR lets the address sit
 * anywhere, with its roof checks following it. DISCOVERY holds gentle opening
 * questions that quote nothing. HEAT_PUMP holds the shared property questions
 * and the heat pump estimate's own.
 *
 * Banks read QUESTIONS lazily (getters and functions only): questionnaire.ts
 * imports resolve.ts, which imports this module, so QUESTIONS may not exist yet
 * when this module loads.
 */

import type { FlowStep, QuoteEngine } from '@sunny/contracts';

import {
  DISCOVERY_QUESTIONS,
  HEAT_PUMP_QUESTIONS,
  QUESTIONS,
  type Question,
} from '../questionnaire.js';
import { FIXED_START, PRESET_GROUPS, SYSTEM_SET } from './presets.js';

/** The answer value that records a visitor skipping an optional question. */
export const SKIPPED = 'skipped';

export interface QuestionBank {
  id: 'legacy_solar' | 'solar' | 'discovery' | 'heat_pump';
  questions: Record<string, Question>;
  fixedStart: readonly string[];
  /** Emitted right after their anchor. */
  followers: Readonly<Record<string, readonly string[]>>;
  groups: Readonly<Record<string, readonly string[]>>;
  /** Never asked of the visitor. */
  systemSet: ReadonlySet<string>;
  defaultSteps(): FlowStep[];
}

function stepsFor(
  questions: Record<string, Question>,
  skip: ReadonlySet<string>,
  groups: Readonly<Record<string, readonly string[]>>,
): FlowStep[] {
  const members = new Set(Object.values(groups).flat());
  return Object.keys(questions)
    .filter((id) => !skip.has(id) && !members.has(id))
    .map((id) => ({ kind: 'preset', id }));
}

export const LEGACY_SOLAR: QuestionBank = {
  id: 'legacy_solar',
  get questions() {
    return QUESTIONS as Record<string, Question>;
  },
  fixedStart: FIXED_START,
  followers: {},
  groups: PRESET_GROUPS,
  systemSet: SYSTEM_SET,
  defaultSteps() {
    return stepsFor(this.questions, new Set(this.fixedStart), this.groups);
  },
};

export const SOLAR: QuestionBank = {
  id: 'solar',
  get questions() {
    return QUESTIONS as Record<string, Question>;
  },
  fixedStart: [],
  followers: { address: ['roof_confidence', 'roof_confirmed'] },
  groups: PRESET_GROUPS,
  systemSet: SYSTEM_SET,
  defaultSteps() {
    return stepsFor(this.questions, new Set(Object.values(this.followers).flat()), this.groups);
  },
};

export const DISCOVERY: QuestionBank = {
  id: 'discovery',
  get questions() {
    return {
      ...DISCOVERY_QUESTIONS,
      motivation: { ...QUESTIONS.motivation!, prompt: 'What matters most to you?' },
    } as Record<string, Question>;
  },
  fixedStart: [],
  followers: {},
  groups: {},
  systemSet: new Set<string>(),
  defaultSteps() {
    return stepsFor(this.questions, new Set(), this.groups);
  },
};

/** Questions the heat pump bank lets the visitor pass over. */
const HEAT_PUMP_OPTIONAL: ReadonlySet<string> = new Set([
  'hp_floor_area',
  'hp_occupants',
  'hp_annual_spend',
  'hp_epc',
]);

export const HEAT_PUMP: QuestionBank = {
  id: 'heat_pump',
  get questions() {
    // In the default order: the shared property questions, then the home's own.
    return {
      motivation: QUESTIONS.motivation!,
      property_type: QUESTIONS.property_type!,
      ownership: QUESTIONS.ownership!,
      address: QUESTIONS.address!,
      ...HEAT_PUMP_QUESTIONS,
    } as Record<string, Question>;
  },
  fixedStart: [],
  followers: {},
  groups: {},
  systemSet: new Set<string>(),
  defaultSteps() {
    return stepsFor(this.questions, new Set(), this.groups).map((step) =>
      HEAT_PUMP_OPTIONAL.has(step.id) ? { ...step, optional: true } : step,
    );
  },
};

export function bankFor(engine: QuoteEngine | 'lead' | 'discovery'): QuestionBank {
  if (engine === 'discovery') return DISCOVERY;
  if (engine === 'heat_pump') return HEAT_PUMP;
  // battery has no bank yet (a later phase adds BATTERY).
  return SOLAR;
}
