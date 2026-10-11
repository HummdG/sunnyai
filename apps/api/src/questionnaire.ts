/**
 * The qualification questionnaire, as a model rather than a list.
 *
 * The question set, the step order and the option values are SunScan's, taken
 * from its journey module (recorded in `docs/discovery-sunscan.md` §1.3) rather
 * than invented. Keeping them in a versioned constant is what lets Sunny ask the
 * same questions the host site's own wizard asks, so an answer given to Sunny is
 * an answer the installer can use.
 *
 * This module exists because the questionnaire is no longer a flat list. One
 * branch of it is conditional -- the follow-up to "how would you like to tell us
 * about your usage?" depends on the answer -- and a condition implemented in three
 * places (the tool the model calls, the route a host page calls, and the summary
 * the lead is built from) is three chances to disagree about whether a visitor was
 * ever asked something. Everything derived from the question set is derived here,
 * once.
 *
 * ## The version string names SunScan's journey, not this file
 *
 * `QUESTIONNAIRE_VERSION` is a label for the SunScan release the set was
 * extracted from, echo of that project's own `CATALOGUE_VERSION = '2026-01'`
 * (`docs/discovery-sunscan.md` §"catalogue"). Reconciling more of the journey
 * here does not move it: bumping it when *Sunny* changes would make it a claim
 * about SunScan's release that is not true. What Sunny has and has not reconciled
 * is recorded in `docs/integration/sunscan-contract.md` §2.1 instead.
 */

export const QUESTIONNAIRE_VERSION = 'sunscan-2026-01';

/**
 * Why a question appears only sometimes.
 *
 * Expressed as a declared dependency on another answer rather than as a function.
 * A predicate would be shorter and more expressive, and it would also be
 * invisible: nothing could list the conditions, no data could be sent to the
 * model explaining why a question appeared, and a reader would have to run the
 * code to know whether `roof_shading` is always asked. This shape answers all
 * three by being data.
 */
export interface AppearsWhen {
  /** The answer this question waits on. */
  questionId: string;
  /** The values of that answer which bring this question into the flow. */
  anyOf: readonly string[];
}

/**
 * A number a visitor types, with the bounds that make it a plausible one.
 *
 * `min`/`max` are sanity bounds, not product limits: a year's consumption or a
 * month's bill outside them is a typo, not a customer. They exist because these
 * fields have no option list to validate against, so today any string at all
 * reaches the lead -- and a lead summary reading "annual use: purple" is worse
 * than a refusal the visitor can act on.
 */
export interface NumericRule {
  min: number;
  max: number;
  /** What the number is of, for the message a refusal carries. */
  unit: string;
}

export interface Question {
  step: string;
  prompt: string;
  options?: readonly string[];
  appearsWhen?: AppearsWhen;
  numeric?: NumericRule;
}

export const QUESTIONS: Readonly<Record<string, Question>> = {
  address: { step: 'address', prompt: 'What is the address you would like assessed?' },
  roof_confidence: {
    step: 'roof',
    prompt: 'How confident are you about your roof details?',
    options: ['high', 'medium', 'low'],
  },
  roof_size: {
    step: 'roof',
    prompt: 'Roughly how much roof space is available?',
    options: ['small', 'medium', 'large', 'unsure'],
  },
  roof_direction: {
    step: 'roof',
    prompt: 'Which way does the main roof face?',
    options: ['south', 'south_east', 'south_west', 'east', 'west', 'east_west', 'north', 'unsure'],
  },
  roof_shading: {
    step: 'roof',
    prompt: 'Is the roof shaded by trees or buildings?',
    options: ['none', 'trees', 'buildings', 'heavy', 'unsure'],
  },
  property_type: {
    step: 'property',
    prompt: 'What kind of property is it?',
    options: ['detached', 'semi', 'terraced', 'bungalow', 'flat', 'other'],
  },
  ownership: {
    step: 'property',
    prompt: 'Do you own the property?',
    options: ['own', 'mortgage', 'rent', 'social', 'landlord', 'other'],
  },
  usage_source: {
    step: 'usage',
    prompt: 'How would you like to tell me about your electricity use?',
    options: ['bill_ocr', 'manual_kwh', 'monthly_cost', 'household'],
  },
  // The usage branch. SunScan asks a different follow-up per source, and requires
  // the branch's own value before its usage step can advance
  // (`canAdvance`, `docs/discovery-sunscan.md` §1.3): a kWh figure for a bill
  // upload or a typed one, a monthly cost for a monthly cost, a household size
  // for "I don't know". Sunny had only the kWh question, so a visitor who chose
  // "monthly cost" or "I don't know" was asked for an annual figure they had just
  // said they would not give.
  annual_kwh: {
    step: 'usage',
    prompt: 'Roughly how many kWh do you use in a year?',
    appearsWhen: { questionId: 'usage_source', anyOf: ['bill_ocr', 'manual_kwh'] },
    numeric: { min: 1, max: 100_000, unit: 'kWh' },
  },
  monthly_cost: {
    step: 'usage',
    prompt: 'Roughly what is your typical monthly electricity cost, in pounds?',
    appearsWhen: { questionId: 'usage_source', anyOf: ['monthly_cost'] },
    numeric: { min: 1, max: 5_000, unit: 'pounds a month' },
  },
  household_size: {
    step: 'usage',
    // The real journey's picker is 1..4 plus "5 or more", stored as an integer.
    // The label lives in the prompt rather than in an option-label table, because
    // Sunny's questions carry no labels and inventing a second shape for one
    // question would be a bigger change than the words here.
    prompt: 'How many people live in the household? Answer 1 to 5, where 5 means five or more.',
    appearsWhen: { questionId: 'usage_source', anyOf: ['household'] },
    options: ['1', '2', '3', '4', '5'],
  },
  tariff_type: {
    step: 'tariff',
    prompt: 'What kind of electricity tariff are you on?',
    options: ['standard', 'economy7', 'smart_tou', 'import_export', 'already_exports', 'unknown'],
  },
  existing_system: {
    step: 'existing',
    prompt: 'Do you already have solar or a battery?',
    options: ['none', 'solar', 'battery', 'solar_battery', 'unsure'],
  },
  motivation: {
    step: 'motivation',
    prompt: 'What matters most to you about going solar?',
    options: [
      'reduce_bills',
      'price_protection',
      'cheap_tariffs',
      'earn_export',
      'independence',
      'carbon',
      'home_value',
      'exploring',
    ],
  },
  budget_band: {
    step: 'motivation',
    prompt: 'What budget did you have in mind?',
    options: ['under_6k', '6k_10k', '10k_15k', '15k_plus', 'unsure'],
  },
  finance_interest: {
    step: 'motivation',
    prompt: 'Would finance be of interest?',
    options: ['yes', 'no', 'maybe', 'learn_more'],
  },
};

/**
 * The seven steps, in the order the journey visits them.
 *
 * Kept beside the questions because the two are meant to agree, and nothing
 * enforces that but a reader: every question's `step` is a member, and the
 * questions of a step are contiguous above. A test checks the first of those.
 */
export const STEP_ORDER = [
  'address',
  'roof',
  'property',
  'usage',
  'tariff',
  'existing',
  'motivation',
] as const;

/**
 * Whether a question applies, and if not, why not.
 *
 * Three values rather than a boolean because the two ways a question can fail to
 * apply call for opposite handling. A question waiting on an answer it has not
 * been given yet is **pending** -- the host page is free to ask in its own order,
 * so an answer to it is accepted and stored. A question whose condition is
 * already settled against it **conflicts** -- the visitor has said they are on a
 * monthly cost, so a kWh figure is an answer to something nobody asked, and
 * storing it would put a number in the lead that the visitor never gave for that
 * branch.
 *
 * That distinction is the whole reason this is not `if (!applies) refuse`.
 */
export type Applicability = 'applies' | 'pending' | 'conflicts';

export function applicability(questionId: string, answers: Record<string, string>): Applicability {
  const question = QUESTIONS[questionId];
  const gate = question?.appearsWhen;
  if (!gate) return 'applies';
  const given = answers[gate.questionId];
  if (given === undefined) return 'pending';
  return gate.anyOf.includes(given) ? 'applies' : 'conflicts';
}

/**
 * The questions in the flow that have no answer yet, in the journey's order.
 *
 * Pending questions are left out: they are waiting on their gate, and the gate is
 * either already outstanding (so the visitor will be asked it first) or answered
 * the other way (so the question conflicts and is not in the flow at all).
 */
export function outstandingQuestions(answers: Record<string, string>): string[] {
  return Object.keys(QUESTIONS).filter(
    (id) => answers[id] === undefined && applicability(id, answers) === 'applies',
  );
}

/** The first outstanding question, or null when nothing applies and is unanswered. */
export function nextQuestion(answers: Record<string, string>): string | null {
  return outstandingQuestions(answers)[0] ?? null;
}

/** An answer removed because a later answer ruled its question out. */
export interface DroppedAnswer {
  questionId: string;
  /** What the visitor had said, kept so a page can offer to restore it. */
  value: string;
  /** The answer that ruled it out, so the visitor can be told which one. */
  ruledOutBy: { questionId: string; value: string; anyOf: readonly string[] };
}

/**
 * Drop every stored answer the visitor's own answers have since ruled out.
 *
 * `validateAnswer` guards a *new* answer against the standing ones. This guards
 * the standing ones against each other, and it is needed the moment an answer can
 * be corrected. Change the usage source from a monthly cost to a household size
 * and the monthly cost is no longer an answer to a question anybody asked -- yet
 * a plain merge leaves it in the map, where it is indistinguishable from a live
 * answer, rides into the lead summary, and is never offered again because
 * `outstandingQuestions` only lists questions with no answer.
 *
 * The invariant this establishes is the one `applicability` already describes:
 * **the standing map never holds an answer its own question says was not asked.**
 * `pending` answers are kept -- they are answerable in any order, so refusing to
 * store one would take back a freedom the page is given.
 *
 * Removal is the right answer rather than keeping the value dormant: a dormant
 * second tier would be a second way for an answer to be half-true, and the
 * visitor who corrects their usage source has said the monthly figure no longer
 * describes them. The dropped value is returned so the page can say so out loud
 * and, if it likes, offer it back.
 */
export function reconcile(answers: Record<string, string>): {
  answers: Record<string, string>;
  dropped: DroppedAnswer[];
} {
  const kept: Record<string, string> = { ...answers };
  const dropped: DroppedAnswer[] = [];
  // A pass can only ever turn a dependent from `applies` to `pending` (dropping a
  // gate answer leaves the gate unanswered, and unanswered is pending, never a
  // conflict), so this cannot cascade. It loops anyway rather than assuming that:
  // each pass removes at least one answer or ends, and a question set that later
  // nests gates stays correct without anyone re-deriving that argument.
  for (let pass = 0; pass < Object.keys(QUESTIONS).length; pass++) {
    // Question-set order, not insertion order, so the report is the same for the
    // same map however the answers arrived.
    const conflicting = Object.keys(QUESTIONS).filter(
      (id) => kept[id] !== undefined && applicability(id, kept) === 'conflicts',
    );
    if (conflicting.length === 0) break;
    for (const id of conflicting) {
      const gate = QUESTIONS[id]!.appearsWhen!;
      dropped.push({
        questionId: id,
        value: kept[id]!,
        ruledOutBy: {
          questionId: gate.questionId,
          value: kept[gate.questionId]!,
          anyOf: gate.anyOf,
        },
      });
      delete kept[id];
    }
  }
  return { answers: kept, dropped };
}

/**
 * The one place an answer is judged acceptable.
 *
 * Extracted from `save_answer` rather than duplicated for the qualification
 * route, because two copies of "is this a real answer" drift: the tool would keep
 * accepting an option the route had stopped accepting, and the difference would
 * surface only as a question the visitor appears to have answered twice. Both
 * callers now apply the same rule by construction.
 *
 * `answers` is a parameter rather than a concern of the caller because
 * conditionality made it part of the question "is this acceptable": what counts
 * as a real answer depends on what the visitor has already said.
 *
 * Pure on purpose -- strings in, verdict out -- so it can be tested without a
 * tenant, a store or a model.
 */
export type AnswerVerdict =
  | { ok: true; questionId: string; value: string }
  | {
      ok: false;
      error: string;
      known?: readonly string[];
      allowed?: readonly string[];
      expects?: string;
      needs?: string;
    };

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

export function validateAnswer(
  questionId: string,
  value: string,
  answers: Record<string, string> = {},
): AnswerVerdict {
  if (!questionId || !value) {
    return { ok: false, error: 'questionId and value are required' };
  }
  const question = QUESTIONS[questionId];
  if (!question) {
    return { ok: false, error: 'unknown question', known: Object.keys(QUESTIONS) };
  }
  if (applicability(questionId, answers) === 'conflicts') {
    const gate = question.appearsWhen!;
    return {
      ok: false,
      error: 'that question is not asked, given an earlier answer',
      needs: `${gate.questionId} to be one of ${gate.anyOf.join(', ')} (it is "${answers[gate.questionId]}")`,
    };
  }
  if (question.options && !question.options.includes(value)) {
    return { ok: false, error: 'value not among the allowed options', allowed: question.options };
  }
  if (question.numeric) {
    const parsed = parseNumber(value);
    if (parsed === null) {
      return {
        ok: false,
        error: 'value is not a number',
        expects: `a number of ${question.numeric.unit}`,
      };
    }
    const { min, max, unit } = question.numeric;
    if (parsed < min || parsed > max) {
      return {
        ok: false,
        error: 'value is outside the range that makes sense',
        expects: `a number of ${unit} between ${min} and ${max}`,
      };
    }
  }
  return { ok: true, questionId, value };
}

/**
 * A refusal, as one sentence a caller can act on.
 *
 * Shared by the route and the tool so a visitor reading a page and a model
 * reading a tool result are told the same thing about the same refusal. Without
 * this the two would each pick their own part of the verdict to show, and one of
 * them would eventually show the part that does not help.
 */
export function explain(verdict: Extract<AnswerVerdict, { ok: false }>): string {
  if (verdict.allowed) return `${verdict.error}: ${verdict.allowed.join(', ')}`;
  if (verdict.known) return `${verdict.error}: ${verdict.known.join(', ')}`;
  if (verdict.expects) return `${verdict.error}: ${verdict.expects}`;
  if (verdict.needs) return `${verdict.error} — it needs ${verdict.needs}`;
  return verdict.error;
}
