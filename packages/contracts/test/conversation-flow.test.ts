import { describe, expect, it } from 'vitest';
import { conversationFlowSchema } from '../src/index.js';

const custom = (over: Record<string, unknown> = {}) => ({
  kind: 'custom',
  id: 'c_abcdef12',
  prompt: 'Do you have a car?',
  mode: 'quote',
  answer: 'choice',
  choices: [{ value: 'yes', label: 'Yes', effects: [{ kind: 'add', itemKey: 'charger', quantity: 1 }] }],
  ...over,
});
const flow = (steps: unknown[]) => ({ version: 1, updatedAt: '2026-11-09T10:00:00.000Z', steps });

describe('conversationFlowSchema', () => {
  it('accepts a flow with a preset rewording, a custom quote question with an add effect, and a follow-up', () => {
    const r = conversationFlowSchema.safeParse(
      flow([
        { kind: 'preset', id: 'roof', prompt: 'What is your roof like?', labels: { tile: 'Tiles' } },
        custom({
          followUps: [{ when: ['yes'], step: custom({ id: 'c_followup1', mode: 'lead', answer: 'text', choices: [] }) }],
        }),
      ]),
    );
    expect(r.success).toBe(true);
  });

  it('refuses a custom question in quote mode with free-text answers', () => {
    expect(conversationFlowSchema.safeParse(flow([custom({ answer: 'text' })])).success).toBe(false);
  });

  it('refuses follow-ups nested deeper than 2', () => {
    const l3 = custom({ id: 'c_level3aa' });
    const l2 = custom({ id: 'c_level2aa', followUps: [{ when: ['yes'], step: l3 }] });
    const l1 = custom({ id: 'c_level1aa', followUps: [{ when: ['yes'], step: l2 }] });
    const top = custom({ followUps: [{ when: ['yes'], step: l1 }] });
    expect(conversationFlowSchema.safeParse(flow([top])).success).toBe(false);
    const ok = custom({ followUps: [{ when: ['yes'], step: custom({ id: 'c_level1aa', followUps: [{ when: ['yes'], step: l3 }] }) }] });
    expect(conversationFlowSchema.safeParse(flow([ok])).success).toBe(true);
  });

  it('refuses a custom id that does not match c_[a-z0-9]{6,24}', () => {
    for (const id of ['abcdef12', 'c_ABCDEF12', 'c_abc', 'c_' + 'a'.repeat(25)]) {
      expect(conversationFlowSchema.safeParse(flow([custom({ id })])).success).toBe(false);
    }
  });

  it('refuses a prompt over 300 characters and a label over 80', () => {
    expect(conversationFlowSchema.safeParse(flow([custom({ prompt: 'a'.repeat(301) })])).success).toBe(false);
    expect(
      conversationFlowSchema.safeParse(
        flow([custom({ choices: [{ value: 'y', label: 'a'.repeat(81), effects: [] }] })]),
      ).success,
    ).toBe(false);
  });

  it('refuses an add with quantity 0 or a fraction', () => {
    for (const quantity of [0, 1.5]) {
      const c = custom({ choices: [{ value: 'y', label: 'Y', effects: [{ kind: 'add', itemKey: 'x', quantity }] }] });
      expect(conversationFlowSchema.safeParse(flow([c])).success).toBe(false);
    }
  });
});
