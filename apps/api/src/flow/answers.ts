import type { LeadFlowAnswer } from '@sunny/contracts';

import { QUESTIONS, optionLabel } from '../questionnaire.js';

import type { ResolvedFlow } from './resolve.js';

/** Journey bookkeeping kept beside the answers (see `JOURNEY_KEYS`); not something the visitor said. */
const BOOKKEEPING = /^journey_/;

/**
 * The visitor's answers as a lead keeps them: every answered question, with the
 * installer's wording for the question and the answer and the stable id and
 * value underneath. Lead-only free text is included.
 *
 * Questions the flow lists come first, in the order it asks them. An answer to a
 * question the flow no longer lists (the installer saved a new flow mid
 * conversation, or its follow-up's parent was removed) is still the visitor's
 * answer, so it follows, in Sunny's own wording for a known preset and as the
 * bare id and value for anything else.
 */
export function flowAnswersFor(
  flow: ResolvedFlow,
  answers: Record<string, string>,
): LeadFlowAnswer[] {
  const out: LeadFlowAnswer[] = [];
  const emitted = new Set<string>();
  for (const question of flow.questions) {
    const value = answers[question.id];
    if (value === undefined || value.trim() === '') continue;
    emitted.add(question.id);
    out.push({
      id: question.id,
      question: question.prompt,
      value,
      answer: question.label(value),
      mode: question.mode,
    });
  }
  for (const [id, value] of Object.entries(answers)) {
    if (emitted.has(id) || BOOKKEEPING.test(id) || value.trim() === '') continue;
    const preset = QUESTIONS[id];
    if (!preset) {
      out.push({ id, question: id, value, answer: value, mode: 'lead' });
      continue;
    }
    out.push({
      id,
      question: preset.prompt,
      value,
      answer: preset.multi
        ? value
            .split(',')
            .map((part) => optionLabel(part.trim()))
            .join(', ')
        : optionLabel(value),
      mode: 'preset',
    });
  }
  return out;
}

/** The flow fields every conversation lead carries. */
export function flowFieldsFor(flow: ResolvedFlow, answers: Record<string, string>) {
  return {
    flowAnswers: flowAnswersFor(flow, answers),
    ...(flow.stored ? { flowVersion: flow.stored.version } : {}),
  };
}
