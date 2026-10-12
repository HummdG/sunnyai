/**
 * Several answers from one message, deterministically.
 *
 * A visitor says "it's a semi, we own it, the bill is about £120 a month and
 * we're getting an electric car" -- four answers. The model may propose them
 * with `save_answers`; this does the same from the visitor's own words, so the
 * journey can take a multi-answer message even when the model proposed fewer.
 * Nothing here is final: every proposal goes through `validateAnswer` before it
 * is stored, so a guess the questionnaire would refuse is dropped, not saved.
 *
 * Bare replies ("yes", "none", "not sure", "the second one") only count for the
 * question that was just asked -- `current` -- so a "yes" is never read as an
 * answer to some other question.
 */

import { optionLabel, QUESTIONS, reconcile, validateAnswer } from '../questionnaire.js';

export interface Proposal {
  questionId: string;
  value: string;
}

const has = (text: string, pattern: RegExp) => pattern.test(text);

function money(raw: string): number {
  const cleaned = raw.toLowerCase().replace(/[£,\s]/g, '');
  const k = cleaned.endsWith('k');
  const n = Number(k ? cleaned.slice(0, -1) : cleaned);
  return Number.isFinite(n) ? (k ? n * 1000 : n) : NaN;
}

const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
};

function bandFor(amount: number): string {
  if (amount < 6000) return 'under_6k';
  if (amount <= 10000) return '6k_10k';
  if (amount <= 15000) return '10k_15k';
  return '15k_plus';
}

/**
 * The budget band for a figure or range the visitor typed ("£9k", "9,500",
 * "8 to 10 grand"). Amounts under 100 are read as thousands ("about 12").
 */
export function budgetBand(text: string): string | null {
  const amounts = [...text.matchAll(/£?\s*(\d[\d,]*(?:\.\d+)?)\s*(k|grand|thousand)?/g)]
    .map((m) => {
      const n = Number((m[1] ?? '').replace(/,/g, ''));
      if (!Number.isFinite(n) || n <= 0) return null;
      return m[2] || n < 100 ? n * 1000 : n;
    })
    .filter((n): n is number => n !== null);
  if (amounts.length === 0) return null;
  const top = Math.max(...amounts);
  if (top < 6000) return 'under_6k';
  if (top <= 10000) return '6k_10k';
  if (top <= 15000) return '10k_15k';
  return '15k_plus';
}

/** Yes / no / unsure, as the visitor might say it. */
function polarity(text: string): 'yes' | 'no' | 'unsure' | null {
  if (has(text, /\b(not sure|unsure|don'?t know|no idea|dunno|maybe|not certain)\b/))
    return 'unsure';
  if (has(text, /^\s*(no|nope|nah|not really|that'?s wrong|wrong|incorrect)\b/)) return 'no';
  if (has(text, /\b(not right|doesn'?t look right|isn'?t right|that'?s not)\b/)) return 'no';
  if (
    has(
      text,
      /^\s*(yes|yeah|yep|yup|correct|right|sure|absolutely|definitely|that'?s right|looks right|spot on|ok|okay)\b/,
    )
  ) {
    return 'yes';
  }
  return null;
}

function direction(text: string): string | null {
  if (has(text, /\beast\s*(and|&|\/)\s*west\b/)) return 'east_west';
  if (has(text, /\bsouth[\s-]?east\b|\bse\b/)) return 'south_east';
  if (has(text, /\bsouth[\s-]?west\b|\bsw\b/)) return 'south_west';
  if (has(text, /\bsouth\b/)) return 'south';
  if (has(text, /\beast\b/)) return 'east';
  if (has(text, /\bwest\b/)) return 'west';
  if (has(text, /\bnorth\b/)) return 'north';
  return null;
}

export function extractAnswers(message: string, current: string | null): Proposal[] {
  const text = ` ${message.toLowerCase().replace(/\s+/g, ' ').trim()} `;
  const out: Proposal[] = [];
  const add = (questionId: string, value: string) => {
    if (!out.some((p) => p.questionId === questionId)) out.push({ questionId, value });
  };

  // ── the question just asked: bare replies and option words ──────────────
  if (current && QUESTIONS[current]) {
    const q = QUESTIONS[current];
    const p = polarity(text);
    if (current === 'roof_confirmed' && (p === 'yes' || p === 'no')) add(current, p);
    if (current === 'finance_interest') {
      if (has(text, /\b(tell me more|learn more|more info|how does it work)\b/))
        add(current, 'learn_more');
      else if (p === 'yes' || p === 'no') add(current, p);
      else if (p === 'unsure') add(current, 'maybe');
    }
    if (p === 'unsure' && q.options?.includes('unsure')) add(current, 'unsure');
    if (p === 'unsure' && current === 'tariff_type') add(current, 'unknown');
    if (current === 'lifestyle' && has(text, /^\s*(none|no|nope|none of (those|them|these))\b/))
      add(current, 'none');
    if (current === 'existing_system' && has(text, /^\s*(no|none|nope|nothing)\b/))
      add(current, 'none');
    if (current === 'roof_shading' && has(text, /^\s*(no|none|nope|not really)\b/))
      add(current, 'none');
    if (current === 'roof_size') {
      if (has(text, /\bsmall\b/)) add(current, 'small');
      else if (has(text, /\b(medium|average|normal)\b/)) add(current, 'medium');
      else if (has(text, /\b(large|big)\b/)) add(current, 'large');
    }
    if (current === 'roof_direction') {
      const d = direction(text);
      if (d) add(current, d);
    }
    if (current === 'household_size') {
      const n = /\b(\d+)\b/.exec(text)?.[1];
      const word = Object.keys(WORD_NUMBERS).find((w) => has(text, new RegExp(`\\b${w}\\b`)));
      const size = n ? Number(n) : word ? WORD_NUMBERS[word] : undefined;
      if (size && size > 0) add(current, String(Math.min(5, size)));
    }
    if (current === 'annual_kwh' || current === 'monthly_cost') {
      const n = /£?\s*(\d[\d,]*(?:\.\d+)?)/.exec(text)?.[1];
      if (n) add(current, n.replace(/,/g, ''));
    }
    if (current === 'usage_source') {
      if (has(text, /\bkwh\b|\bunits\b|\bmeter reading\b/)) add(current, 'manual_kwh');
      else if (has(text, /\b(bill|monthly|a month|per month|cost|spend|pay)\b|£/))
        add(current, 'monthly_cost');
      else if (has(text, /\b(people|household|family|how many live|live here)\b/))
        add(current, 'household');
    }
    if (current === 'ownership' && polarity(text) === 'yes') add(current, 'own');
    // Budgets arrive as figures ("about £9k", "£8,000 to £10,000"); a range is
    // placed by its top end, which is the most the visitor said they'd spend.
    if (current === 'budget_band') {
      const band = budgetBand(text);
      if (band) add(current, band);
    }
    // A reply naming exactly one option by its visitor-facing label.
    if (q.options) {
      const named = q.options.filter((o) => {
        const label = optionLabel(o).toLowerCase();
        return label.length > 3 && text.includes(` ${label} `.replace(/\s+/g, ' ').trim());
      });
      if (named.length === 1 && named[0]) add(current, named[0]);
    }
    // A reply that is exactly one of the options ("semi", "smart_tou").
    const exact = q.options?.find((o) => text.trim() === o.replace(/_/g, ' ') || text.trim() === o);
    if (exact) add(current, exact);
  }

  // ── facts a visitor volunteers, whatever was asked ────────────────────────
  if (has(text, /\bsemi(-| )?detached\b|\ba semi\b|\bsemi\b/)) add('property_type', 'semi');
  else if (has(text, /\bdetached\b/)) add('property_type', 'detached');
  else if (has(text, /\bterrace(d)?\b|\bend of terrace\b/)) add('property_type', 'terraced');
  else if (has(text, /\bbungalow\b/)) add('property_type', 'bungalow');
  else if (has(text, /\b(flat|apartment|maisonette)\b/) && !has(text, /\bflat roof\b/))
    add('property_type', 'flat');

  if (has(text, /\b(rent|renting|tenant)\b/)) add('ownership', 'rent');
  else if (has(text, /\blandlord\b/)) add('ownership', 'landlord');
  else if (has(text, /\bmortgage\b/)) add('ownership', 'mortgage');
  else if (has(text, /\b(we|i) own\b|\bown (it|the house|the property|our home)\b|\bhomeowner\b/))
    add('ownership', 'own');

  const kwh = /(\d[\d,]*)\s*kwh/.exec(text)?.[1];
  const monthly =
    /£\s*(\d[\d,]*(?:\.\d+)?)\s*(?:a|per|\/|each|every)\s*month|(\d[\d,]*)\s*(?:pounds|quid)\s*(?:a|per)\s*month/.exec(
      text,
    );
  const people =
    /\b(\d+)\s*(?:people|of us|in the (?:house|household|home)|person household)\b/.exec(
      text,
    )?.[1] ??
    /\bfamily of (\w+)\b/.exec(text)?.[1] ??
    null;
  if (kwh) {
    add('usage_source', 'manual_kwh');
    add('annual_kwh', kwh.replace(/,/g, ''));
  } else if (monthly) {
    add('usage_source', 'monthly_cost');
    add('monthly_cost', (monthly[1] ?? monthly[2] ?? '').replace(/,/g, ''));
  } else if (people) {
    const n = Number(people) || WORD_NUMBERS[people] || 0;
    if (n > 0) {
      add('usage_source', 'household');
      add('household_size', String(Math.min(5, n)));
    }
  }

  const tags: string[] = [];
  const planned = (subject: string) =>
    has(
      text,
      new RegExp(
        `(plan|planning|getting|thinking|soon|next year|want|considering)[^.]{0,30}${subject}`,
      ),
    ) || has(text, new RegExp(`${subject}[^.]{0,20}(soon|next year|planned|on order)`));
  if (
    has(text, /\b(ev|electric (car|vehicle)|tesla)\b/) &&
    !has(text, /\bno (ev|electric car)\b/)
  ) {
    tags.push(planned('(ev|electric (car|vehicle)|tesla)') ? 'ev_planned' : 'ev_now');
  }
  if (has(text, /\bheat ?pump\b/) && !has(text, /\bno heat ?pump\b/)) {
    tags.push(planned('heat ?pump') ? 'heatpump_planned' : 'heatpump_now');
  }
  if (has(text, /\b(work from home|wfh|home (all|during the) day|at home in the day|retired)\b/))
    tags.push('home_daytime');
  if (has(text, /\b(evenings?|out (all|during the) day|at work all day)\b/))
    tags.push('evening_use');
  if (tags.length > 0) add('lifestyle', tags.join(','));

  if (has(text, /\beconomy ?7\b|\be7\b/)) add('tariff_type', 'economy7');
  else if (has(text, /\b(agile|flux|go tariff|intelligent|smart tariff|time of use|tou)\b/))
    add('tariff_type', 'smart_tou');
  else if (has(text, /\b(export tariff|already export|seg)\b/)) add('tariff_type', 'import_export');

  const solar =
    has(text, /\b(already|existing|have)[^.]{0,20}(solar|panels)\b/) &&
    !has(text, /\bno (solar|panels)\b/);
  const battery =
    has(text, /\b(already|existing|have)[^.]{0,20}batter(y|ies)\b/) && !has(text, /\bno batter/);
  if (solar && battery) add('existing_system', 'solar_battery');
  else if (solar) add('existing_system', 'solar');
  else if (battery) add('existing_system', 'battery');
  else if (has(text, /\bno (solar|panels)\b/)) add('existing_system', 'none');

  if (has(text, /\b(bills?|save money|saving money|cut (my|our) costs)\b/))
    add('motivation', 'reduce_bills');
  else if (has(text, /\b(independen|self[- ]sufficien|off grid)/))
    add('motivation', 'independence');
  else if (has(text, /\b(carbon|environment|planet|green|climate)\b/)) add('motivation', 'carbon');
  else if (has(text, /\b(earn|export income|sell (back|power))\b/))
    add('motivation', 'earn_export');
  else if (has(text, /\b(price rises|rising prices|protect)\b/))
    add('motivation', 'price_protection');
  else if (has(text, /\b(home value|value of (my|our|the) (home|house))\b/))
    add('motivation', 'home_value');
  else if (has(text, /\b(just looking|exploring|browsing|curious)\b/))
    add('motivation', 'exploring');

  const budget =
    /(?:budget|spend|up to|around|about|under|max(?:imum)?)[^.£\d]{0,15}£?\s*(\d[\d,.]*k?)/.exec(
      text,
    )?.[1];
  if (budget) {
    const amount = money(budget);
    if (Number.isFinite(amount) && amount >= 1000) add('budget_band', bandFor(amount));
  }

  if (has(text, /\b(no shade|no shading|not shaded|unshaded|nothing shading)\b/))
    add('roof_shading', 'none');
  else if (has(text, /\b(trees?|hedge)\b[^.]{0,20}(shad|block|overhang)|shaded by trees/))
    add('roof_shading', 'trees');
  else if (has(text, /\bshaded by (a |the )?(building|house|neighbou?r)/))
    add('roof_shading', 'buildings');

  return out;
}

export interface AppliedAnswers {
  answers: Record<string, string>;
  accepted: Proposal[];
  rejected: Array<Proposal & { reason: string }>;
  removed: string[];
}

/**
 * Apply proposals to the standing answers, gate answers first, each validated
 * against the answers before it -- the same rule the routes use -- and
 * reconcile afterwards so a correction drops what it ruled out.
 */
export function applyProposals(
  answers: Record<string, string>,
  proposals: readonly Proposal[],
): AppliedAnswers {
  const gates = new Set(
    Object.values(QUESTIONS)
      .map((q) => q.appearsWhen?.questionId)
      .filter((id): id is string => id !== undefined),
  );
  const ordered = [...proposals].sort(
    (a, b) => Number(gates.has(b.questionId)) - Number(gates.has(a.questionId)),
  );
  let next = { ...answers };
  const accepted: Proposal[] = [];
  const rejected: AppliedAnswers['rejected'] = [];
  for (const proposal of ordered) {
    const verdict = validateAnswer(proposal.questionId, proposal.value, next);
    if (!verdict.ok) {
      rejected.push({ ...proposal, reason: verdict.error });
      continue;
    }
    next = { ...next, [verdict.questionId]: verdict.value };
    accepted.push({ questionId: verdict.questionId, value: verdict.value });
  }
  const reconciled = reconcile(next);
  return {
    answers: reconciled.answers,
    accepted,
    rejected,
    removed: reconciled.dropped.map((d) => d.questionId),
  };
}
