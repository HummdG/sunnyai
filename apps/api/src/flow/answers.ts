import type { LeadFlowAnswer } from '@sunny/contracts';

import type { ResolvedFlow } from './resolve.js';

/**
 * The visitor's answers as a lead keeps them: each answered question in the
 * order the flow asks it, with the installer's wording for the question and the
 * answer and the stable id and value underneath. Lead-only free text is
 * included. Answers to questions the flow no longer lists (the visitor was
 * mid-conversation when it was saved) are not part of the record.
 */
export function flowAnswersFor(
  flow: ResolvedFlow,
  answers: Record<string, string>,
): LeadFlowAnswer[] {
  const out: LeadFlowAnswer[] = [];
  for (const question of flow.questions) {
    const value = answers[question.id];
    if (value === undefined || value.trim() === '') continue;
    out.push({
      id: question.id,
      question: question.prompt,
      value,
      answer: question.label(value),
      mode: question.mode,
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
