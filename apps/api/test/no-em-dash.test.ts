import { describe, expect, it } from 'vitest';

import { buildSystemInstruction, fallbackLine, workflowState } from '../src/agent/prompt.js';
import { DISCOVERY_QUESTIONS } from '../src/questionnaire.js';
import { DEMO_TENANT } from '../src/tenants.js';
import { WORKFLOW_TOOLS } from '../src/workflows/agent-tools.js';
import { defaultWorkflowSet } from '../src/workflows/templates.js';

/**
 * The owner's house style: no em dash (or en dash) in anything a visitor can
 * read, or in anything that teaches the model how to write to one.
 */

const DASHES = /[–—]/;

describe('no em dash', () => {
  const now = '2026-11-10T10:00:00.000Z';
  const set = defaultWorkflowSet(now);
  const solar = set.workflows[0]!;

  const texts: Array<[string, string]> = [
    ['system instruction', buildSystemInstruction(DEMO_TENANT, 'chat', 1)],
    ['fallback line', fallbackLine()],
    [
      'workflow state',
      workflowState({
        active: {
          workflow: solar,
          step: {
            workflowId: solar.id,
            stage: 'questions',
            nextQuestionId: 'property_type',
            prompt: 'What type of home is it?',
            options: ['detached', 'semi'],
            multi: false,
            optional: false,
            missing: ['property_type'],
            ready: false,
            journey: null,
          },
        },
        paused: [{ workflow: solar, resumeOffered: false }],
        available: set.workflows,
        discovery: { status: 'none', suggestedWorkflowId: null },
        discoveryEnabled: true,
        likely: solar.id,
      }),
    ],
    ['default workflows', JSON.stringify(defaultWorkflowSet(now))],
    ['discovery questions', JSON.stringify(DISCOVERY_QUESTIONS)],
    ...WORKFLOW_TOOLS.map((t): [string, string] => [`${t.name} description`, t.description]),
  ];

  for (const [name, text] of texts) {
    it(`has none in the ${name}`, () => {
      expect(text).not.toMatch(DASHES);
    });
  }
});
