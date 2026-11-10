/**
 * Question banks: the pool of questions a workflow's steps draw from.
 *
 * LEGACY_SOLAR is SunScan's own set with the address and roof checks forced
 * first (what `resolveFlow(null)` has always been). SOLAR lets the address sit
 * anywhere, with its roof checks following it. DISCOVERY holds gentle opening
 * questions that quote nothing.
 *
 * Banks read QUESTIONS lazily (getters and functions only): questionnaire.ts
 * imports resolve.ts, which imports this module, so QUESTIONS may not exist yet
 * when this module loads.
 */

import type { FlowStep, QuoteEngine } from '@sunny/contracts';

import { DISCOVERY_QUESTIONS, QUESTIONS, type Question } from '../questionnaire.js';
import { FIXED_START, PRESET_GROUPS, SYSTEM_SET } from './presets.js';

/** The answer value that records a visitor skipping an optional question. */
export const SKIPPED = 'skipped';

export interface QuestionBank {
  id: 'legacy_solar' | 'solar' | 'discovery';
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

export function bankFor(engine: QuoteEngine | 'lead' | 'discovery'): QuestionBank {
  if (engine === 'discovery') return DISCOVERY;
  // heat_pump and battery have no banks yet (later phases add HEAT_PUMP and BATTERY).
  return SOLAR;
}
