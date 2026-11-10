/**
 * An installer's stored conversation, resolved into the questions Sunny asks.
 *
 * A stored `ConversationFlow` lists only the middle of the conversation, in the
 * installer's order and wording. This module turns it (or no flow at all, which
 * means Sunny's own questions) into one ordered list of questions with the same
 * rules `questionnaire.ts` has always applied: which questions apply given the
 * answers so far, which come next, whether an answer is acceptable, and which
 * stored answers a later answer has ruled out.
 *
 * `resolveFlow(null)` is SunScan's question set exactly; `questionnaire.ts`
 * delegates to it, so the default flow and the questionnaire cannot disagree.
 */

import type { ConversationFlow, FlowStep } from '@sunny/contracts';

import {
  optionLabel,
  type AnswerVerdict,
  type Applicability,
  type DroppedAnswer,
  type NumericRule,
} from '../questionnaire.js';
import { LEGACY_SOLAR, SKIPPED, type QuestionBank } from './banks.js';

export { SKIPPED };

// Never read QUESTIONS at module level here: questionnaire.ts imports this
// module, so at load time QUESTIONS may not exist yet (circular import).

/** The longest free-text answer a lead-only question accepts. */
export const FREE_TEXT_MAX = 500;

export interface ResolvedQuestion {
  id: string;
  /** The installer's wording, or Sunny's when they kept it. */
  prompt: string;
  /** The stable answer values, or null for a number or free text. */
  options: string[] | null;
  multi: boolean;
  numeric: NumericRule | null;
  freeText: boolean;
  mode: 'quote' | 'lead' | 'preset';
  /** The visitor may skip this question. */
  optional: boolean;
  /** The answer this question waits on, and the values of it that open it. */
  parent: { id: string; anyOf: string[] } | null;
  /** How a stored value reads to a visitor, under the installer's labels. */
  label(value: string): string;
}

export interface ResolvedFlow {
  /** The bank this was resolved over. */
  bank: QuestionBank;
  /** False for Sunny's own questions (no stored flow). */
  custom: boolean;
  /** The stored flow this was resolved from (null for Sunny's own), for `effectsFor`. */
  stored: ConversationFlow | null;
  /**
   * Fixed start, then the middle in order. A follow-up comes right after its
   * parent, except that a group head's own group members come first.
   */
  questions: ResolvedQuestion[];
  /** Sunny's questions the installer removed, in the question set's order. */
  removedPresets: string[];
  question(id: string): ResolvedQuestion | undefined;
  applicability(id: string, answers: Record<string, string>): Applicability;
  outstanding(answers: Record<string, string>): string[];
  /** Outstanding minus optional questions. */
  required(answers: Record<string, string>): string[];
  next(answers: Record<string, string>): string | null;
  validate(id: string, value: string, answers?: Record<string, string>): AnswerVerdict;
  reconcile(answers: Record<string, string>): {
    answers: Record<string, string>;
    dropped: DroppedAnswer[];
  };
}

type Parent = ResolvedQuestion['parent'];
type PresetStep = Extract<FlowStep, { kind: 'preset' }>;
type CustomStep = Extract<FlowStep, { kind: 'custom' }>;

/** The first stored step for each preset id, wherever it sits, for its wording. */
function indexPresets(
  steps: FlowStep[],
  into = new Map<string, PresetStep>(),
): Map<string, PresetStep> {
  for (const step of steps) {
    if (step.kind === 'preset' && !into.has(step.id)) into.set(step.id, step);
    indexPresets(
      (step.followUps ?? []).map((f) => f.step),
      into,
    );
  }
  return into;
}

function presetQuestion(
  bank: QuestionBank,
  id: string,
  stored: PresetStep | undefined,
  enclosing: Parent,
  optional = false,
): ResolvedQuestion {
  const base = bank.questions[id]!;
  const labels = stored?.labels ?? {};
  const one = (value: string) => labels[value] ?? optionLabel(value);
  return {
    id,
    prompt: stored?.prompt ?? base.prompt,
    options: base.options ? [...base.options] : null,
    multi: base.multi === true,
    numeric: base.numeric ?? null,
    freeText: false,
    mode: 'preset',
    optional,
    // A preset's own condition always stands (the roof fallback questions
    // only appear when the roof mapping is uncertain, wherever they are put).
    parent: base.appearsWhen
      ? { id: base.appearsWhen.questionId, anyOf: [...base.appearsWhen.anyOf] }
      : enclosing,
    label: (value) =>
      base.multi
        ? value
            .split(',')
            .map((part) => one(part.trim()))
            .join(', ')
        : one(value),
  };
}

function customQuestion(step: CustomStep, enclosing: Parent): ResolvedQuestion {
  const text = step.answer === 'text';
  const labels = new Map(step.choices.map((c) => [c.value, c.label]));
  return {
    id: step.id,
    prompt: step.prompt,
    options: text ? null : step.choices.map((c) => c.value),
    multi: false,
    numeric: null,
    freeText: text,
    mode: step.mode,
    optional: step.optional === true,
    parent: enclosing,
    label: (value) => labels.get(value) ?? value,
  };
}

/**
 * A number as a visitor types it.
 *
 * Tolerates the punctuation people actually use -- a leading currency symbol,
 * thousands separators, a trailing unit -- and nothing more. A wider grammar is a
 * parser, and a parser that guesses is how "3200" and "3,200" become two different
 * answers to a question asked once. The value stored is the visitor's own text,
 * not a re-rendering of it: Sunny has no business rewriting a figure the installer
 * will read.
 */
function parseNumber(value: string): number | null {
  const cleaned = value
    .trim()
    .replace(/[,\s]/g, '')
    .replace(/^[£$€]/, '')
    .replace(/(kwh|gbp|pounds?)$/i, '');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

export function resolveFlow(
  stored: ConversationFlow | null | undefined,
  bank: QuestionBank = LEGACY_SOLAR,
): ResolvedFlow {
  const FIXED = new Set<string>(bank.fixedStart);
  const GROUP_MEMBERS = new Set(Object.values(bank.groups).flat());
  const FOLLOWERS = new Set(Object.values(bank.followers).flat());
  const steps = stored ? stored.steps : bank.defaultSteps();
  const wording = indexPresets(steps);
  const questions: ResolvedQuestion[] = [];
  const emitted = new Set<string>();

  const emit = (q: ResolvedQuestion) => {
    questions.push(q);
    emitted.add(q.id);
  };

  const walkFollowUps = (step: FlowStep | undefined, parentId: string) => {
    for (const f of step?.followUps ?? []) walk([f.step], { id: parentId, anyOf: [...f.when] });
  };

  // A fixed-start question is placed at the start, but the follow-ups an
  // installer hangs on it are asked where they listed it (first listing only).
  const fixedWalked = new Set<string>();

  function walk(list: FlowStep[], enclosing: Parent): void {
    for (const step of list) {
      if (step.kind === 'preset' && (FIXED.has(step.id) || FOLLOWERS.has(step.id))) {
        if (!fixedWalked.has(step.id)) {
          fixedWalked.add(step.id);
          walkFollowUps(step, step.id);
        }
        continue;
      }
      if (emitted.has(step.id)) continue; // a duplicate id: the first one stands
      if (step.kind === 'custom') {
        emit(customQuestion(step, enclosing));
        walkFollowUps(step, step.id);
        continue;
      }
      // Unknown presets are ignored; group members are placed by their head.
      if (!bank.questions[step.id] || GROUP_MEMBERS.has(step.id)) continue;
      emit(presetQuestion(bank, step.id, wording.get(step.id), enclosing, step.optional === true));
      for (const follower of bank.followers[step.id] ?? []) {
        if (emitted.has(follower)) continue;
        const followerStep = wording.get(follower);
        emit(presetQuestion(bank, follower, followerStep, enclosing));
        walkFollowUps(followerStep, follower);
      }
      for (const member of bank.groups[step.id] ?? []) {
        if (emitted.has(member)) continue;
        const memberStep = wording.get(member);
        emit(presetQuestion(bank, member, memberStep, enclosing, memberStep?.optional === true));
        walkFollowUps(memberStep, member);
      }
      walkFollowUps(step, step.id);
    }
  }

  for (const id of bank.fixedStart) emit(presetQuestion(bank, id, wording.get(id), null));
  walk(steps, null);

  const byId = new Map(questions.map((q) => [q.id, q]));
  const removedPresets = Object.keys(bank.questions).filter((id) => !emitted.has(id));

  /**
   * Whether a question applies: `pending` while its parent is unanswered (an
   * answer to it is still accepted), `conflicts` once the parent is answered
   * the other way (an answer to it would be to something nobody asked).
   */
  function applicability(id: string, answers: Record<string, string>): Applicability {
    const gate = byId.get(id)?.parent;
    if (!gate) return 'applies';
    const given = answers[gate.id];
    if (given === undefined) return 'pending';
    // A multi-select parent stores a comma list; any picked value opens the gate.
    const picked = byId.get(gate.id)?.multi ? given.split(',').map((part) => part.trim()) : [given];
    return picked.some((value) => gate.anyOf.includes(value)) ? 'applies' : 'conflicts';
  }

  function outstanding(answers: Record<string, string>): string[] {
    return questions
      .map((q) => q.id)
      .filter((id) => answers[id] === undefined && applicability(id, answers) === 'applies');
  }

  function required(answers: Record<string, string>): string[] {
    return outstanding(answers).filter((id) => !byId.get(id)?.optional);
  }

  function reconcile(answers: Record<string, string>): {
    answers: Record<string, string>;
    dropped: DroppedAnswer[];
  } {
    const kept: Record<string, string> = { ...answers };
    const dropped: DroppedAnswer[] = [];
    // Dropping a parent answer leaves its dependents pending, not conflicting,
    // so this cannot cascade today; it loops anyway so nested follow-ups stay
    // correct without re-deriving that argument.
    for (let pass = 0; pass < questions.length; pass++) {
      // Flow order, not insertion order, so the report is stable.
      const conflicting = questions.filter(
        (q) => kept[q.id] !== undefined && applicability(q.id, kept) === 'conflicts',
      );
      if (conflicting.length === 0) break;
      for (const q of conflicting) {
        const gate = q.parent!;
        dropped.push({
          questionId: q.id,
          value: kept[q.id]!,
          ruledOutBy: { questionId: gate.id, value: kept[gate.id]!, anyOf: gate.anyOf },
        });
        delete kept[q.id];
      }
    }
    return { answers: kept, dropped };
  }

  function validate(
    id: string,
    value: string,
    answers: Record<string, string> = {},
  ): AnswerVerdict {
    if (!id || !value) {
      return { ok: false, error: 'questionId and value are required' };
    }
    const question = byId.get(id);
    if (!question) {
      return { ok: false, error: 'unknown question', known: questions.map((q) => q.id) };
    }
    if (applicability(id, answers) === 'conflicts') {
      const gate = question.parent!;
      return {
        ok: false,
        error: 'that question is not asked, given an earlier answer',
        needs: `${gate.id} to be one of ${gate.anyOf.join(', ')} (it is "${answers[gate.id]}")`,
      };
    }
    if (value === SKIPPED && question.optional) {
      return { ok: true, questionId: id, value: SKIPPED };
    }
    const options = question.options;
    if (question.multi && options) {
      const parts = value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
      const bad = parts.filter((part) => !options.includes(part));
      if (parts.length === 0 || bad.length > 0) {
        return { ok: false, error: 'value not among the allowed options', allowed: options };
      }
      if (parts.includes('none') && parts.length > 1) {
        return { ok: false, error: '"none" cannot be combined with other options' };
      }
      // Normalised: de-duplicated, in the question's own option order.
      const normal = options.filter((option) => parts.includes(option)).join(',');
      return { ok: true, questionId: id, value: normal };
    }
    if (options && !options.includes(value)) {
      return { ok: false, error: 'value not among the allowed options', allowed: options };
    }
    if (question.freeText) {
      const text = value.trim();
      if (!text) return { ok: false, error: 'questionId and value are required' };
      if (text.length > FREE_TEXT_MAX) {
        return {
          ok: false,
          error: 'answer is too long',
          expects: `at most ${FREE_TEXT_MAX} characters`,
        };
      }
      return { ok: true, questionId: id, value: text };
    }
    if (question.numeric) {
      const parsed = parseNumber(value);
      const { min, max, unit } = question.numeric;
      if (parsed === null) {
        return { ok: false, error: 'value is not a number', expects: `a number of ${unit}` };
      }
      if (parsed < min || parsed > max) {
        return {
          ok: false,
          error: 'value is outside the range that makes sense',
          expects: `a number of ${unit} between ${min} and ${max}`,
        };
      }
    }
    return { ok: true, questionId: id, value };
  }

  return {
    bank,
    custom: stored != null,
    stored: stored ?? null,
    questions,
    removedPresets,
    question: (id) => byId.get(id),
    applicability,
    outstanding,
    required,
    next: (answers) => outstanding(answers)[0] ?? null,
    validate,
    reconcile,
  };
}
