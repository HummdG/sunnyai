import { z } from 'zod';

/**
 * A qualification answer submitted directly, rather than through a turn.
 *
 * `save_answer` already records answers from inside a chat turn. This is the
 * same answer for a host page that is displaying the questionnaire itself — the
 * wizard on the installer's own site, where the visitor may never open the
 * assistant at all.
 *
 * The schema is deliberately loose about *which* questions exist and what values
 * they accept. That vocabulary is SunScan's, it lives in the API beside the
 * question set, and copying it here would be a second copy to keep in step — with
 * the contracts package shipping to the browser, so the copy would be public too.
 * The route validates `questionId` and `value` against the real question set and
 * answers `400` with the permitted values, which is more useful to a caller than
 * a schema error anyway.
 */
export const qualificationAnswerSchema = z.object({
  sessionId: z.string().min(1).max(200),
  questionId: z.string().min(1).max(80),
  /**
   * Bounded, because this is stored and later shown to the installer. The longest
   * real answer is a postcode or a kWh figure; 500 is far above that and still
   * short enough that a lead summary built from these stays readable.
   */
  value: z.string().min(1).max(500),
});

export type QualificationAnswer = z.infer<typeof qualificationAnswerSchema>;

/**
 * What the route hands back.
 *
 * `answers` is the whole standing map, not just the one that was written, so the
 * host page can re-render the wizard from a single response instead of tracking
 * state itself. `nextQuestionId` is a suggestion: the page is free to ask in its
 * own order, and nothing in the widget depends on it being followed.
 */
export const qualificationAnswerResponseSchema = z.object({
  questionId: z.string(),
  answers: z.record(z.string(), z.string()),
  nextQuestionId: z.string().nullable(),
});

export type QualificationAnswerResponse = z.infer<typeof qualificationAnswerResponseSchema>;
