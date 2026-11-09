import { z } from 'zod';

/**
 * An installer's version of the quote conversation. `steps` lists the middle
 * section only (the fixed start and end are implied). A preset step absent from
 * `steps` is removed from the conversation.
 */

export const CUSTOM_ID = /^c_[a-z0-9]{6,24}$/;

export const FLOW_LIMITS = {
  steps: 60,
  choices: 12,
  followUpDepth: 2,
  promptChars: 300,
  labelChars: 80,
} as const;

export type FlowEffect =
  | { kind: 'add'; itemKey: string; quantity?: number }
  | { kind: 'remove'; itemKey: string }
  | { kind: 'swap'; fromKey: string; toKey: string; quantity?: number };

export interface FlowChoice {
  value: string;
  label: string;
  effects: FlowEffect[];
}

export type FlowStep =
  | {
      kind: 'preset';
      id: string;
      prompt?: string;
      labels?: Record<string, string>;
      effects?: Record<string, FlowEffect[]>;
      followUps?: FlowFollowUp[];
    }
  | {
      kind: 'custom';
      id: string;
      prompt: string;
      mode: 'quote' | 'lead';
      answer: 'choice' | 'text';
      choices: FlowChoice[];
      followUps?: FlowFollowUp[];
    };

/** `when` holds the parent answer values that open this follow-up. */
export interface FlowFollowUp {
  when: string[];
  step: FlowStep;
}

export interface ConversationFlow {
  version: number;
  updatedAt: string;
  steps: FlowStep[];
}

const key = z.string().trim().min(1).max(120);
const label = z.string().trim().min(1).max(FLOW_LIMITS.labelChars);
const prompt = z.string().trim().min(1).max(FLOW_LIMITS.promptChars);
const quantity = z.number().int().positive().optional();

const flowEffectSchema: z.ZodType<FlowEffect> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('add'), itemKey: key, quantity }),
  z.object({ kind: z.literal('remove'), itemKey: key }),
  z.object({ kind: z.literal('swap'), fromKey: key, toKey: key, quantity }),
]);

const flowChoiceSchema: z.ZodType<FlowChoice> = z.object({
  value: key,
  label,
  effects: z.array(flowEffectSchema).max(FLOW_LIMITS.choices),
});

const flowFollowUpSchema: z.ZodType<FlowFollowUp> = z.lazy(() =>
  z.object({ when: z.array(key).min(1).max(FLOW_LIMITS.choices), step: flowStepSchema }),
);

const followUps = z.array(flowFollowUpSchema).max(FLOW_LIMITS.choices).optional();

const flowStepSchema: z.ZodType<FlowStep> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('preset'),
      id: key,
      prompt: prompt.optional(),
      labels: z.record(z.string(), label).optional(),
      effects: z.record(z.string(), z.array(flowEffectSchema).max(FLOW_LIMITS.choices)).optional(),
      followUps,
    }),
    z
      .object({
        kind: z.literal('custom'),
        id: z.string().regex(CUSTOM_ID),
        prompt,
        mode: z.enum(['quote', 'lead']),
        answer: z.enum(['choice', 'text']),
        choices: z.array(flowChoiceSchema).max(FLOW_LIMITS.choices),
        followUps,
      })
      .refine((s) => !(s.mode === 'quote' && s.answer === 'text'), {
        message: 'A quote question needs choices, not free text',
        path: ['answer'],
      }),
  ]),
);

/** Deepest follow-up nesting below a step (a step with none is 0). */
function depth(step: FlowStep): number {
  let max = 0;
  for (const f of step.followUps ?? []) max = Math.max(max, 1 + depth(f.step));
  return max;
}

export const conversationFlowSchema: z.ZodType<ConversationFlow> = z
  .object({
    version: z.number().int().nonnegative(),
    updatedAt: z.string().min(1),
    steps: z.array(flowStepSchema).max(FLOW_LIMITS.steps),
  })
  .superRefine((flow, ctx) => {
    flow.steps.forEach((s, i) => {
      if (depth(s) > FLOW_LIMITS.followUpDepth) {
        ctx.addIssue({
          code: 'custom',
          message: `Follow-ups can nest at most ${FLOW_LIMITS.followUpDepth} deep`,
          path: ['steps', i],
        });
      }
    });
  });
