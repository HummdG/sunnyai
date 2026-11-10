import { describe, expect, it } from 'vitest';

import { draftFrom, flowFrom, type Context } from '../components/dashboard/conversation/model.js';
import {
  addPattern,
  kindBadge,
  outcomeLabel,
  pagesSummary,
  pathOf,
  removePattern,
  testUrl,
  withFlow,
  workflowFlow,
} from '../components/dashboard/workflows/model.js';
import type { PresetView, Workflow } from '../lib/portal-api.js';

const rule = (include: string[] = [], exclude: string[] = []) => ({ include, exclude });

const wf = (extra: Partial<Workflow> = {}): Workflow => ({
  id: 'wf_x_1',
  kind: 'custom',
  name: 'X',
  enabled: true,
  description: '',
  triggers: [],
  interests: [],
  pages: rule(),
  steps: [],
  outcome: { kind: 'lead' },
  template: null,
  version: 3,
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...extra,
});

describe('pagesSummary', () => {
  it('describes each form', () => {
    expect(pagesSummary(rule())).toBe('All pages');
    expect(pagesSummary(rule(['/a', '/b']))).toBe('Only /a, /b');
    expect(pagesSummary(rule([], ['/x']))).toBe('All pages except /x');
    expect(pagesSummary(rule(['/a'], ['/a/old']))).toBe('Only /a (not /a/old)');
  });
});

describe('addPattern and removePattern', () => {
  it('prefixes a slash and trims', () => {
    expect(addPattern(rule(), 'include', ' offers/battery* ').rule.include).toEqual([
      '/offers/battery*',
    ]);
  });
  it('rejects whitespace, ? and #', () => {
    for (const bad of ['/a b', '/a?x=1', '/a#top']) {
      const r = rule(['/k']);
      const out = addPattern(r, 'include', bad);
      expect(out.error).not.toBeNull();
      expect(out.rule).toEqual(r);
    }
  });
  it('de-duplicates', () => {
    expect(addPattern(rule(['/a']), 'include', 'a').rule.include).toEqual(['/a']);
  });
  it('refuses a 21st pattern', () => {
    const full = rule(Array.from({ length: 20 }, (_, i) => `/p${i}`));
    const out = addPattern(full, 'include', '/more');
    expect(out.error).not.toBeNull();
    expect(out.rule).toEqual(full);
  });
  it('removes a pattern', () => {
    expect(removePattern(rule(['/a', '/b'], ['/c']), 'include', '/a')).toEqual(
      rule(['/b'], ['/c']),
    );
  });
});

describe('pathOf', () => {
  it('reads a path or a full URL', () => {
    expect(pathOf(' /offers/battery?u=1#top ')).toBe('/offers/battery');
    expect(pathOf('https://x.co/offers/battery-deal?u=1')).toBe('/offers/battery-deal');
    expect(pathOf('x.co/heat')).toBe('/heat');
  });
  it('is null when unreadable', () => {
    expect(pathOf('')).toBeNull();
    expect(pathOf('battery')).toBeNull();
  });
});

describe('testUrl', () => {
  it('matches a full URL or a path', () => {
    const r = rule(['/offers/battery*']);
    expect(testUrl(r, 'https://x.co/offers/battery-deal?u=1')).toBe(true);
    expect(testUrl(r, '/offers/battery-deal')).toBe(true);
    expect(testUrl(r, 'https://x.co/other')).toBe(false);
    expect(testUrl(rule(['/a'], ['/a']), '/a')).toBe(false);
  });
  it('is null when unparseable', () => {
    expect(testUrl(rule(), '::')).toBeNull();
    expect(testUrl(rule(), '  ')).toBeNull();
  });
});

describe('labels', () => {
  it('names outcomes', () => {
    expect(outcomeLabel({ kind: 'quote', engine: 'solar' })).toBe('Solar quote');
    expect(outcomeLabel({ kind: 'quote', engine: 'heat_pump' })).toBe('Heat pump quote');
    expect(outcomeLabel({ kind: 'quote', engine: 'battery' })).toBe('Battery quote');
    expect(outcomeLabel({ kind: 'lead' })).toBe('Passes details to you');
  });
  it('badges kinds', () => {
    expect(kindBadge(wf())).toBe('Your own');
    expect(kindBadge(wf({ template: { id: 'solar_quote', version: 1 } }))).toBe('Built in');
    expect(kindBadge(wf({ id: 'wf_solar' }))).toBe('Built in');
  });
});

describe('flow helpers', () => {
  it('lifts and replaces steps', () => {
    const w = wf({ steps: [{ kind: 'preset', id: 'address' }] });
    expect(workflowFlow(w)).toEqual({ version: 3, updatedAt: w.updatedAt, steps: w.steps });
    const next = withFlow(w, { version: 9, updatedAt: 'z', steps: [] });
    expect(next.steps).toEqual([]);
    expect(next.version).toBe(3);
    expect(next.updatedAt).toBe(w.updatedAt);
  });
});

describe('draft round trip with workflow presets (no fixed entries)', () => {
  const preset = (id: string, group: string[] = []): PresetView => ({
    id,
    prompt: id,
    options: [{ value: 'yes', label: 'Yes' }],
    fixed: false,
    warning: null,
    group,
    appearsWhen: null,
  });
  const presets = [
    preset('address', ['roof_confidence', 'roof_confirmed']),
    preset('roof_confidence'),
    preset('roof_confirmed'),
    preset('storeys'),
  ];
  const ctx: Context = {
    presets: new Map(presets.map((p) => [p.id, p])),
    items: [],
    assistant: 'Sunny',
  };
  it('keeps a leading address step and its place', () => {
    const flow = {
      version: 2,
      updatedAt: 'x',
      steps: [
        { kind: 'preset' as const, id: 'address' },
        { kind: 'preset' as const, id: 'storeys' },
      ],
    };
    const draft = draftFrom(flow, presets);
    expect(draft.steps.map((s) => s.id)).toEqual(['address', 'storeys']);
    expect(flowFrom(draft, ctx, flow).steps.map((s) => s.id)).toEqual(['address', 'storeys']);
    expect(draftFrom(null, presets).steps.map((s) => s.id)).toEqual(['address', 'storeys']);
  });
});
