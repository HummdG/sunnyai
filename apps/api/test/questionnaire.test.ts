import { describe, expect, it } from 'vitest';

import {
  QUESTIONS,
  STEP_ORDER,
  applicability,
  explain,
  nextQuestion,
  outstandingQuestions,
  reconcile,
  validateAnswer,
} from '../src/questionnaire.js';

/**
 * The questionnaire's own rules, tested without a tenant, a store or a model.
 *
 * These are the assertions the tool surface and the qualification route both
 * stand on: if `applicability` is wrong, the assistant asks a question the
 * visitor has ruled out, `nextQuestionId` sends a host page to ask it too, and
 * the only place the mistake would show is a conversation. So the rules are
 * pinned here, in the shape they are written in.
 */

describe('the question set', () => {
  it('gives every question a step that is one of the seven', () => {
    for (const [id, question] of Object.entries(QUESTIONS)) {
      expect(STEP_ORDER, `${id} has an unknown step "${question.step}"`).toContain(question.step);
    }
  });

  it('keeps the questions of a step contiguous, in the journey’s order', () => {
    // The order of `QUESTIONS` is what `nextQuestion` walks, so a question filed
    // under the wrong step, or a step's questions split by another's, would offer
    // the visitor the tariff before their usage. Nothing else checks the two
    // constants agree, and they are edited by hand.
    const steps = Object.values(QUESTIONS).map((question) => question.step);
    const collapsed = steps.filter((step, at) => step !== steps[at - 1]);
    expect(collapsed).toEqual([...STEP_ORDER]);
  });

  it('gates every conditional question on a question that exists', () => {
    for (const [id, question] of Object.entries(QUESTIONS)) {
      if (!question.appearsWhen) continue;
      expect(QUESTIONS[question.appearsWhen.questionId], `${id} waits on nothing`).toBeDefined();
    }
  });
});

describe('applicability', () => {
  it('applies an ungated question with nothing answered', () => {
    expect(applicability('property_type', {})).toBe('applies');
  });

  it('asks the roof questions only when the roof mapping is not trusted', () => {
    // SunScan's `roofFallback` step: shown only when confidence is low. With a
    // mapped roof the visitor confirms it instead.
    for (const id of ['roof_size', 'roof_direction']) {
      expect(applicability(id, { roof_confidence: 'low' })).toBe('applies');
      expect(applicability(id, { roof_confidence: 'high' })).toBe('conflicts');
    }
    // Shading is always asked: the 3D assessment does not simulate it.
    expect(applicability('roof_shading', { roof_confidence: 'high' })).toBe('applies');
    expect(applicability('roof_confirmed', { roof_confidence: 'high' })).toBe('applies');
    expect(applicability('roof_confirmed', { roof_confidence: 'low' })).toBe('conflicts');
  });

  it('holds a gated question pending until its gate is answered', () => {
    // Pending, not refused: a host page may ask in its own order, so an answer
    // given ahead of its gate is accepted rather than treated as a mistake.
    expect(applicability('annual_kwh', {})).toBe('pending');
  });

  it('applies exactly one usage follow-up per source', () => {
    // The whole point of the branch. SunScan asks a different follow-up per
    // source and requires that branch's value; Sunny asked every visitor for a
    // kWh figure, including the ones who had just said they would give a monthly
    // cost instead.
    const followUps = ['annual_kwh', 'monthly_cost', 'household_size'];
    for (const source of QUESTIONS['usage_source']!.options!) {
      const applying = followUps.filter(
        (id) => applicability(id, { usage_source: source }) === 'applies',
      );
      expect(applying, `usage_source=${source} should open exactly one follow-up`).toHaveLength(1);
    }
  });

  it('rules the other follow-ups out rather than holding them pending', () => {
    const answers = { usage_source: 'household' };
    expect(applicability('household_size', answers)).toBe('applies');
    expect(applicability('annual_kwh', answers)).toBe('conflicts');
    expect(applicability('monthly_cost', answers)).toBe('conflicts');
  });
});

describe('what is outstanding', () => {
  it('starts at the address and offers no gated question', () => {
    const outstanding = outstandingQuestions({});
    expect(outstanding[0]).toBe('address');
    // Pending questions waited on by an unanswered gate are not offered yet: the
    // gate is outstanding itself, so the visitor is asked that first.
    expect(outstanding).not.toContain('annual_kwh');
    expect(outstanding).not.toContain('monthly_cost');
    expect(outstanding).not.toContain('household_size');
  });

  it('offers the branch that applies once the source is known', () => {
    const outstanding = outstandingQuestions({ usage_source: 'monthly_cost' });
    expect(outstanding).toContain('monthly_cost');
    expect(outstanding).not.toContain('annual_kwh');
    expect(outstanding).not.toContain('household_size');
  });

  it('stops offering a question once it is answered', () => {
    expect(outstandingQuestions({ address: '1 Test Street' })).not.toContain('address');
    expect(nextQuestion({ address: '1 Test Street' })).toBe('roof_confidence');
  });

  it('runs out, answering every applicable question in order', () => {
    // A loop rather than a hand-written map: if a question is added with a gate
    // no answer ever opens, this fails by not terminating, which is the defect
    // worth catching -- `nextQuestion` returning the same question forever.
    const answers: Record<string, string> = {};
    for (let step = 0; step < 50; step += 1) {
      const next = nextQuestion(answers);
      if (next === null) break;
      const question = QUESTIONS[next]!;
      // A real answer for this question, so the walk is a plausible one.
      answers[next] =
        question.options?.[0] ?? (question.numeric ? String(question.numeric.min + 1) : 'answered');
    }
    expect(nextQuestion(answers)).toBeNull();
    // The branch is reachable: the walk had to choose a usage source, and one of
    // the three follow-ups was asked and answered.
    expect(answers['usage_source']).toBe('bill_ocr');
    expect(answers['annual_kwh']).toBeDefined();
    expect(answers['household_size']).toBeUndefined();
  });
});

describe('validating an answer', () => {
  it('refuses a question that does not exist, and names the ones that do', () => {
    const verdict = validateAnswer('roof_colour', 'red');
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error('unreachable');
    expect(verdict.error).toBe('unknown question');
    expect(verdict.known).toContain('roof_direction');
  });

  it('refuses a value outside the options, and names them', () => {
    const verdict = validateAnswer('roof_direction', 'sideways');
    if (verdict.ok) throw new Error('unreachable');
    expect(verdict.error).toBe('value not among the allowed options');
    expect(verdict.allowed).toContain('south');
  });

  it('accepts an answer to a question whose gate is not answered yet', () => {
    // The documented freedom of the host page: it may ask in its own order, so
    // this is stored rather than refused.
    expect(validateAnswer('annual_kwh', '4200', {}).ok).toBe(true);
  });

  it('refuses an answer the visitor’s earlier one has ruled out', () => {
    const verdict = validateAnswer('annual_kwh', '4200', { usage_source: 'household' });
    if (verdict.ok) throw new Error('unreachable');
    expect(verdict.error).toBe('that question is not asked, given an earlier answer');
    // The message has to say what to change, or the page cannot act on it.
    expect(verdict.needs).toContain('usage_source');
    expect(verdict.needs).toContain('household');
  });

  describe('numbers', () => {
    it('accepts the punctuation people actually type', () => {
      for (const typed of ['4200', '3,200', '4 200', '4200kWh', '4200 kWh']) {
        expect(validateAnswer('annual_kwh', typed).ok, typed).toBe(true);
      }
    });

    it('stores the visitor’s own text rather than rewriting it', () => {
      // The installer reads these. Normalising "3,200" to "3200" would be Sunny
      // editing a figure it was given and has no reason to touch.
      const verdict = validateAnswer('annual_kwh', '3,200');
      if (!verdict.ok) throw new Error('unreachable');
      expect(verdict.value).toBe('3,200');
    });

    it('refuses a word where a number belongs', () => {
      const verdict = validateAnswer('annual_kwh', 'purple');
      if (verdict.ok) throw new Error('unreachable');
      expect(verdict.error).toBe('value is not a number');
      expect(verdict.expects).toContain('kWh');
    });

    it('refuses a number outside the range that makes sense', () => {
      for (const wild of ['0', '999999']) {
        const verdict = validateAnswer('annual_kwh', wild);
        if (verdict.ok) throw new Error(`expected ${wild} to be refused`);
        expect(verdict.error).toBe('value is outside the range that makes sense');
      }
    });

    it('reads a currency symbol on a monthly cost', () => {
      expect(validateAnswer('monthly_cost', '£150', { usage_source: 'monthly_cost' }).ok).toBe(
        true,
      );
      expect(validateAnswer('monthly_cost', '150.50', { usage_source: 'monthly_cost' }).ok).toBe(
        true,
      );
    });

    it('does not let a household size be a number off the list', () => {
      // This one has options, so the option rule refuses it before the numeric
      // rule is reached -- and "3 beds" with it.
      expect(validateAnswer('household_size', '3', { usage_source: 'household' }).ok).toBe(true);
      expect(validateAnswer('household_size', '6', { usage_source: 'household' }).ok).toBe(false);
    });
  });
});

describe('the sentence a refusal becomes', () => {
  it('shows the vocabulary when there is one to show', () => {
    const verdict = validateAnswer('roof_direction', 'sideways');
    if (verdict.ok) throw new Error('unreachable');
    expect(explain(verdict)).toContain('south');
  });

  it('shows the expected form when the field is a number', () => {
    const verdict = validateAnswer('annual_kwh', 'purple');
    if (verdict.ok) throw new Error('unreachable');
    expect(explain(verdict)).toBe('value is not a number: a number of kWh');
  });

  it('lets a visitor who does not know answer, everywhere the journey does', () => {
    // §7.3 asks for "optional/skippable steps", and the honest answer is that
    // Sunny has no skip to offer, because the source journey has none to copy: in
    // `canAdvance` every step is required except `lifestyle` -- "select all that
    // apply", where empty is valid -- and Sunny's set deliberately omits
    // `lifestyle` as a whole step (`docs/discovery-sunscan.md` §1.3,
    // `docs/integration/sunscan-contract.md` §2.1). Not knowing is an ordinary
    // answer, not an absence, and each question a visitor might not know carries
    // the journey's own uncertainty option. Pinning it here is what keeps a later
    // question from being added with no way to answer it but a mechanism Sunny
    // does not have.
    for (const id of [
      'roof_size',
      'roof_direction',
      'roof_shading',
      'existing_system',
      'budget_band',
    ]) {
      expect(QUESTIONS[id]!.options, `${id} should offer the journey's "unsure"`).toContain(
        'unsure',
      );
    }
    // The journey's two other ways of saying it.
    expect(QUESTIONS['tariff_type']!.options).toContain('unknown');
    expect(QUESTIONS['usage_source']!.options).toContain('household');
    // SunScan's one optional step, lifestyle, is now asked because the quote
    // engine prices from it (2026-10-12); its "empty" answer is `none`.
    expect(QUESTIONS['lifestyle']!.multi).toBe(true);
    expect(QUESTIONS['lifestyle']!.options).toContain('none');
  });

  it('takes "select all that apply" answers as a list, and normalises them', () => {
    const verdict = validateAnswer('lifestyle', 'ev_planned, home_daytime,ev_planned');
    expect(verdict).toEqual({
      ok: true,
      questionId: 'lifestyle',
      value: 'home_daytime,ev_planned',
    });
    expect(validateAnswer('lifestyle', 'none').ok).toBe(true);
    expect(validateAnswer('lifestyle', 'none,ev_now').ok).toBe(false);
    expect(validateAnswer('lifestyle', 'jetpack').ok).toBe(false);
  });

  it('says what to change when an earlier answer ruled the question out', () => {
    const verdict = validateAnswer('annual_kwh', '4200', { usage_source: 'household' });
    if (verdict.ok) throw new Error('unreachable');
    expect(explain(verdict)).toBe(
      'that question is not asked, given an earlier answer: it needs usage_source to be one of bill_ocr, manual_kwh (it is "household")',
    );
  });
});

/**
 * Reconciliation: the answers a correction has left behind.
 *
 * `validateAnswer` guards a new answer against the standing map. These pin the
 * other direction -- the standing map against itself -- because that is the half
 * a correction can break. Everything here is a variation on one invariant: after
 * a write, no stored answer may be one the visitor's own answers ruled out.
 */
describe('reconcile', () => {
  it('drops the answer a corrected gate has ruled out, and says which answer did it', () => {
    // The live repro, in miniature: a monthly cost, then a change of mind about
    // how usage would be given.
    const { answers, dropped } = reconcile({
      usage_source: 'household',
      monthly_cost: '150',
    });

    expect(answers).toEqual({ usage_source: 'household' });
    expect(dropped).toEqual([
      {
        questionId: 'monthly_cost',
        value: '150',
        ruledOutBy: { questionId: 'usage_source', value: 'household', anyOf: ['monthly_cost'] },
      },
    ]);
  });

  it('leaves an answer its gate still admits, and one whose gate has not been answered', () => {
    // `monthly_cost` applies; `annual_kwh` is pending -- answered ahead of the
    // question it waits on, which the page is allowed to do.
    const { answers, dropped } = reconcile({
      usage_source: 'monthly_cost',
      monthly_cost: '150',
      annual_kwh: '4200',
    });

    // `annual_kwh` conflicts with the answered source, so it goes; the point of
    // this test is the *pending* case below, with no source given at all.
    expect(answers).toEqual({ usage_source: 'monthly_cost', monthly_cost: '150' });
    expect(dropped.map((entry) => entry.questionId)).toEqual(['annual_kwh']);

    const open = reconcile({ monthly_cost: '150' });
    expect(open.answers).toEqual({ monthly_cost: '150' });
    expect(open.dropped).toEqual([]);
  });

  it('changes nothing when nothing conflicts', () => {
    const given = { address: '1 Test Street', roof_direction: 'west', usage_source: 'household' };
    const { answers, dropped } = reconcile(given);
    expect(answers).toEqual(given);
    expect(dropped).toEqual([]);
  });

  it('reports in the question set’s order, however the answers arrived', () => {
    // Both of these conflict. Insertion order would give one order for each map;
    // a stable report is what lets a test and a page rely on it.
    const one = reconcile({ usage_source: 'household', monthly_cost: '150', annual_kwh: '4' });
    const two = reconcile({ annual_kwh: '4', monthly_cost: '150', usage_source: 'household' });
    expect(one.dropped.map((entry) => entry.questionId)).toEqual(['annual_kwh', 'monthly_cost']);
    expect(two.dropped.map((entry) => entry.questionId)).toEqual(['annual_kwh', 'monthly_cost']);
  });

  it('leaves a map where no answer is one its own question ruled out', () => {
    // The invariant, asserted over a map built to be as broken as the set allows:
    // every gated question answered, all at once, under a gate that admits none
    // of them.
    const gated = Object.keys(QUESTIONS).filter((id) => QUESTIONS[id]!.appearsWhen);
    const mess: Record<string, string> = { usage_source: 'unsure' };
    for (const id of gated) mess[id] = '1';

    const { answers } = reconcile(mess);
    for (const id of Object.keys(answers)) {
      expect(applicability(id, answers)).not.toBe('conflicts');
    }
  });
});
