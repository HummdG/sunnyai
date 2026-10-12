// Test support: structural checks of a HouseModelSpec (schema, frames, footprints, heights, context, quality).
import { expect } from 'vitest';
import type { BuildingPartSpec, HouseModelSpec } from '@sunny/sunscan-core';
import { buildRoof, isSimple, ringArea } from '@sunny/sunscan-core/geometry';

const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

/** Highest roof point of a part (above the ground datum), from the geometry engine. */
export function ridgeOf(p: BuildingPartSpec): number {
  const roof = buildRoof(p.footprint, p.edgeKinds, { ...p.roof, eaveHeight: p.eaveHeight });
  return roof.vertices.reduce((m, v) => Math.max(m, v[2]), p.eaveHeight);
}

/** Assert the invariants every spec produced by the pipeline must satisfy. */
export function expectWellFormedSpec(spec: HouseModelSpec): void {
  expect(spec.schema).toBe('sunscan.house/1');
  expect(spec.id).toMatch(/^(osm:(way|relation)\/\d+|overture:.+|drawn:[0-9a-f]+)$/);
  expect(spec.generator).toMatch(/^sunscan-server\//);
  expect(Number.isNaN(Date.parse(spec.generatedAt))).toBe(false);
  expect(spec.address.display.length).toBeGreaterThan(0);
  expect(spec.origin.lat).toBeGreaterThan(49.8);
  expect(spec.origin.lat).toBeLessThan(61);
  expect(spec.origin.lon).toBeGreaterThan(-8.8);
  expect(spec.origin.lon).toBeLessThan(2);
  expect(spec.groundElevation === null || finite(spec.groundElevation)).toBe(true);
  expect(['detached', 'semi-detached', 'end-terrace', 'mid-terrace', 'block', 'unknown']).toContain(spec.builtForm);
  expect(spec.parts.length).toBeGreaterThan(0);
  const ids = new Set<string>();
  for (const p of spec.parts) {
    expect(ids.has(p.id)).toBe(false);
    ids.add(p.id);
    const nEdges = p.footprint.outer.length + (p.footprint.holes ?? []).reduce((s, h) => s + h.length, 0);
    expect(p.footprint.outer.length).toBeGreaterThanOrEqual(3);
    expect(ringArea(p.footprint.outer)).toBeGreaterThan(0); // CCW
    for (const h of p.footprint.holes ?? []) expect(ringArea(h)).toBeLessThan(0); // CW
    expect(isSimple(p.footprint)).toBe(true);
    expect(p.edgeKinds).toHaveLength(nEdges);
    for (const k of p.edgeKinds) expect(['eave', 'gable', 'party']).toContain(k);
    for (const q of p.footprint.outer) expect(finite(q[0]) && finite(q[1])).toBe(true);
    expect(p.baseHeight).toBe(0);
    expect(finite(p.eaveHeight)).toBe(true);
    expect(p.storeys).toBeGreaterThanOrEqual(1);
    expect(p.overhang).toBeGreaterThanOrEqual(0);
    expect(['brick', 'render', 'stone', 'timber', 'pebbledash']).toContain(p.material.wall);
    expect(['tile', 'slate', 'flat']).toContain(p.material.roof);
    if (p.roof.type === 'flat') expect(p.material.roof).toBe('flat');
    for (const c of p.chimneys) expect(finite(c.top) && c.width > 0 && c.depth > 0).toBe(true);
    expect(ridgeOf(p)).toBeGreaterThanOrEqual(p.eaveHeight - 1e-6);
  }
  // the origin is the (registered) target centroid: parts must surround it
  const xs = spec.parts.flatMap((p) => p.footprint.outer.map((q) => q[0]));
  const ys = spec.parts.flatMap((p) => p.footprint.outer.map((q) => q[1]));
  expect(Math.min(...xs)).toBeLessThan(0);
  expect(Math.max(...xs)).toBeGreaterThan(0);
  expect(Math.min(...ys)).toBeLessThan(0);
  expect(Math.max(...ys)).toBeGreaterThan(0);
  for (const n of spec.context.neighbours) {
    expect(n.footprint.outer.length).toBeGreaterThanOrEqual(3);
    expect(n.height).toBeGreaterThan(0);
    expect(['osm', 'overture']).toContain(n.source);
  }
  const t = spec.context.terrain;
  if (t) {
    expect(t.heights).toHaveLength(t.width * t.height);
    expect(t.cellSize).toBeGreaterThan(0);
    expect(t.heights.some((h) => h !== null)).toBe(true);
  }
  if (spec.facade.front) {
    const part = spec.parts.find((p) => p.id === spec.facade.front!.partId);
    expect(part).toBeDefined();
    expect(spec.facade.front.edge).toBeLessThan(part!.footprint.outer.length);
    expect(part!.edgeKinds[spec.facade.front.edge]).not.toBe('party');
  }
  if (spec.evidence) {
    expect(spec.evidence.points.length % 3).toBe(0);
    expect(spec.evidence.points.length / 3).toBeLessThanOrEqual(4000);
    if (spec.evidence.residuals) expect(spec.evidence.residuals).toHaveLength(spec.evidence.points.length / 3);
  }
  if (spec.fit) {
    expect(finite(spec.fit.sigma) && finite(spec.fit.rmse) && finite(spec.fit.pModel)).toBe(true);
    expect(spec.fit.registration.shift.every(finite)).toBe(true);
    expect(spec.quality.flags.includes('fit-unreliable')).toBe(spec.fit.unreliable);
  }
  const q = spec.quality;
  expect(['high', 'medium', 'low', 'manual']).toContain(q.geocode);
  for (const c of [q.footprint, q.heights, q.roof]) expect(['measured', 'high', 'medium', 'low', 'estimated']).toContain(c);
  expect(q.openings).toBe('procedural');
  expect(q.interior).toBe('procedural');
  expect(new Set(q.flags).size).toBe(q.flags.length);
  expect(spec.provenance.length).toBeGreaterThan(0);
  for (const s of spec.provenance) expect(s.id && s.title && s.licence && s.attribution).toBeTruthy();
  // JSON round trip (no NaN / typed arrays / undefined leaking into the payload)
  expect(JSON.parse(JSON.stringify(spec))).toEqual(spec);
}
