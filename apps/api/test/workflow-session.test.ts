import { describe, expect, it } from 'vitest';

import { type Workflow, type WorkflowSet } from '@sunny/contracts';

import { solarTemplate } from '../src/workflows/templates.js';
import {
  DISCOVERY_ID,
  EMPTY_SESSION,
  available,
  complete,
  markResumeOffered,
  pause,
  settle,
  start,
  suggest,
} from '../src/workflows/session.js';

const T0 = '2026-11-10T10:00:00.000Z';
const T1 = '2026-11-10T10:05:00.000Z';

function wf(id: string, over: Partial<Workflow> = {}): Workflow {
  return { ...solarTemplate(T0), id, ...over };
}
function setOf(...workflows: Workflow[]): WorkflowSet {
  return { version: 1, updatedAt: T0, discovery: { enabled: true }, workflows };
}

describe('start', () => {
  it('sets active on an empty session', () => {
    const r = start(EMPTY_SESSION, 'wf_a', T0);
    expect(r.session.active).toEqual({ workflowId: 'wf_a', startedAt: T0 });
    expect(r.pausedOther).toBeNull();
    expect(r.resumed).toBe(false);
    expect(EMPTY_SESSION.active).toBeNull();
  });
  it('returns an already active workflow unchanged', () => {
    const a = start(EMPTY_SESSION, 'wf_a', T0).session;
    const r = start(a, 'wf_a', T1);
    expect(r.session).toEqual(a);
    expect(r.resumed).toBe(false);
    expect(r.pausedOther).toBeNull();
  });
  it('pauses the active one when another starts', () => {
    const a = start(EMPTY_SESSION, 'wf_a', T0).session;
    const r = start(a, 'wf_b', T1);
    expect(r.pausedOther).toBe('wf_a');
    expect(r.session.active?.workflowId).toBe('wf_b');
    expect(r.session.paused[0]).toEqual({
      workflowId: 'wf_a',
      pausedAt: T1,
      resumeOfferedAt: null,
    });
  });
  it('resumes a paused workflow', () => {
    const a = start(EMPTY_SESSION, 'wf_a', T0).session;
    const b = start(a, 'wf_b', T1).session;
    const r = start(b, 'wf_a', T1);
    expect(r.resumed).toBe(true);
    expect(r.pausedOther).toBe('wf_b');
    expect(r.session.active?.workflowId).toBe('wf_a');
    expect(r.session.paused.map((p) => p.workflowId)).toEqual(['wf_b']);
  });
});

describe('pause, complete, markResumeOffered', () => {
  it('pause moves active to paused, and is a no-op without one', () => {
    const a = start(EMPTY_SESSION, 'wf_a', T0).session;
    const p = pause(a, T1);
    expect(p.active).toBeNull();
    expect(p.paused[0]?.workflowId).toBe('wf_a');
    expect(pause(EMPTY_SESSION, T1)).toEqual(EMPTY_SESSION);
  });
  it('complete records the refs and clears active', () => {
    const a = start(EMPTY_SESSION, 'wf_a', T0).session;
    const c = complete(a, T1, { quoteId: 'q1' });
    expect(c.active).toBeNull();
    expect(c.completed).toEqual([{ workflowId: 'wf_a', at: T1, quoteId: 'q1' }]);
  });
  it('markResumeOffered stamps the paused entry', () => {
    const s = pause(start(EMPTY_SESSION, 'wf_a', T0).session, T0);
    expect(markResumeOffered(s, 'wf_a', T1).paused[0]?.resumeOfferedAt).toBe(T1);
  });
});

describe('settle', () => {
  it('pauses an active workflow that is disabled or gone', () => {
    const a = start(EMPTY_SESSION, 'wf_a', T0).session;
    const off = settle(a, setOf(wf('wf_a', { enabled: false })));
    expect(off.active).toBeNull();
    expect(off.paused[0]?.workflowId).toBe('wf_a');
    expect(settle(a, setOf()).active).toBeNull();
  });
  it('keeps an enabled one, and leaves discovery alone', () => {
    const a = start(EMPTY_SESSION, 'wf_a', T0).session;
    expect(settle(a, setOf(wf('wf_a')))).toEqual(a);
    const d = start(EMPTY_SESSION, DISCOVERY_ID, T0).session;
    expect(settle(d, setOf())).toEqual(d);
  });
});

describe('available and suggest', () => {
  const solar = wf('solar');
  const promo = wf('promo', {
    interests: ['battery'],
    pages: { include: ['/battery-deal'], exclude: [] },
  });
  const set = setOf(solar, promo);
  it('puts specific pages first, and null path gets only all-pages', () => {
    expect(available(set, '/battery-deal').map((w) => w.id)).toEqual(['promo', 'solar']);
    expect(available(set, '/').map((w) => w.id)).toEqual(['solar']);
    expect(available(set, null).map((w) => w.id)).toEqual(['solar']);
    expect(set.workflows.map((w) => w.id)).toEqual(['solar', 'promo']);
  });
  it('skips disabled workflows', () => {
    expect(available(setOf(wf('x', { enabled: false })), '/')).toEqual([]);
  });
  it('suggests by interest', () => {
    expect(suggest(set, { disc_interest: 'battery' }, '/battery-deal')?.id).toBe('promo');
    expect(suggest(set, { disc_interest: 'battery' }, '/')).toBeNull();
    expect(suggest(set, { disc_interest: 'not_sure' }, '/battery-deal')).toBeNull();
    expect(suggest(set, {}, '/')).toBeNull();
  });
});
