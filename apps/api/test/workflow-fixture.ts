import type { WorkflowSet } from '@sunny/contracts';

import { EMPTY_SESSION, cloneSession, type WorkflowSession } from '../src/workflows/session.js';
import { defaultWorkflowSet } from '../src/workflows/templates.js';

/** The workflow fields of a tool context: Sunny's own set, nothing running, no page. */
export function workflowContext(): {
  workflows: WorkflowSet;
  session: WorkflowSession;
  pagePath: string | null;
} {
  return {
    workflows: defaultWorkflowSet('2026-11-10T00:00:00.000Z'),
    session: cloneSession(EMPTY_SESSION),
    pagePath: null,
  };
}
