/**
 * When the email add-on may send on its own, and how sure it has to be.
 *
 * The default is a draft for a person to approve (Blueprint §5,
 * human-in-the-loop). An automatic reply needs every one of:
 *   - the installer switched auto-send on;
 *   - grounding confidence ≥ the threshold (0.95) on a STANDARD FAQ;
 *   - the sender is under today's cap (3 automatic replies per sender per day);
 *   - no safety escalation, no "I don't have that exact information" fallback,
 *     and nothing in the email that looked like an attempt to instruct the
 *     assistant.
 *
 * "Grounding confidence" is deliberately narrow and conservative, because it
 * decides whether a person reads the reply before the customer does. It is the
 * similarity between the customer's question and a "Customer question: …"
 * heading of a passage the answer cited -- the knowledge base's own standard
 * FAQs -- and it is zero when the answer cites nothing, used a tool other than
 * knowledge retrieval, or contains a figure no cited passage contains.
 */

export interface GroundingInput {
  /** The customer's words: subject and the new part of the email. */
  question: string;
  /** The answer as it would be sent, footer excluded. */
  answer: string;
  /** Passages the answer cited by marker. */
  cited: ReadonlyArray<{ heading: string | null; text: string }>;
  /** Tools the model used in the turn. */
  tools: readonly string[];
}

const STOPWORDS = new Set(
  (
    'a an and are as at be but by can could do does for from had has have hello hi how i if in ' +
    'is it its me my of on or our please so that the their them then there this to us was we ' +
    'what when where which who why will with would you your thanks thank regards dear kind'
  ).split(' '),
);

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s']/g, ' ')
      .split(/\s+/)
      .map((w) => w.replace(/^'+|'+$/g, ''))
      .filter((w) => w.length > 1 && !STOPWORDS.has(w)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / (a.size + b.size - shared);
}

/** Figures: amounts, percentages, durations -- anything with a digit. */
function figures(text: string): string[] {
  return (text.match(/[£$€]?\d[\d,.]*\s*%?/g) ?? []).map((f) => f.replace(/[,\s]/g, ''));
}

const FAQ_PREFIX = /^customer question:\s*/i;

export function groundingConfidence(input: GroundingInput): number {
  if (input.cited.length === 0) return 0;
  if (input.tools.some((tool) => tool !== 'retrieve_knowledge')) return 0;

  // Every figure in the answer must appear in a cited passage.
  const evidence = input.cited
    .map((c) => c.text)
    .join('\n')
    .replace(/[,\s]/g, '');
  // Citation markers ([S1]) are not figures.
  for (const figure of figures(input.answer.replace(/\[S\d+\]/g, ''))) {
    const bare = figure.replace(/^[£$€]/, '').replace(/%$/, '');
    if (!evidence.includes(bare)) return 0;
  }

  const faqs = input.cited
    .map((c) => c.heading ?? '')
    .filter((heading) => FAQ_PREFIX.test(heading))
    .map((heading) => words(heading.replace(FAQ_PREFIX, '')));
  if (faqs.length === 0) return 0;

  // Compare each sentence of the customer's message, so a greeting and a
  // sign-off do not dilute an exact question.
  const sentences = input.question
    .split(/(?<=[.?!])\s+|\n+/)
    .map((s) => words(s))
    .filter((s) => s.size > 0);
  let best = 0;
  for (const sentence of sentences) {
    for (const faq of faqs) best = Math.max(best, jaccard(sentence, faq));
  }
  return Math.round(best * 1000) / 1000;
}

export interface SendDecisionInput {
  autoSendEnabled: boolean;
  confidence: number;
  threshold: number;
  autoRepliesToday: number;
  cap: number;
  escalated: boolean;
  usedFallback: boolean;
  injectionSuspected: boolean;
  /** A mailbox that can send is connected. */
  canSend: boolean;
}

export type SendDecision = { send: true } | { send: false; reason: string };

export function decideSend(input: SendDecisionInput): SendDecision {
  if (!input.autoSendEnabled) return { send: false, reason: 'draft mode (auto-send is off)' };
  if (input.escalated) return { send: false, reason: 'safety escalation' };
  if (input.usedFallback) return { send: false, reason: 'answer not in the knowledge base' };
  if (input.injectionSuspected)
    return { send: false, reason: 'email looked like it tried to instruct the assistant' };
  if (!input.canSend) return { send: false, reason: 'no connected mailbox can send' };
  if (input.autoRepliesToday >= input.cap) {
    return { send: false, reason: `sender reached ${input.cap} automatic replies today` };
  }
  if (input.confidence < input.threshold) {
    return {
      send: false,
      reason: `grounding confidence ${input.confidence} below ${input.threshold}`,
    };
  }
  return { send: true };
}
