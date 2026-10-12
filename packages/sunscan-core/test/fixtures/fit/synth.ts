// Synthetic UK archetype scenes for the fit tests (TypeScript analogue of research/methods/roofit/synth.py).
// Roof surfaces come from the geometry engine (buildRoof -> heightAt) built on the wall line offset outwards by
// the eave / verge overhang (same planes as the wall-line roof, extended); DSM = area average over S x S
// sub-samples per 1 m pixel + N(0, sigma) + outliers; DTM = ground + N(0, 0.1). All footprints handed to the
// fitter are wall lines shifted by one misregistration vector. Planar coordinates use a BNG-like offset.
import { buildRoof, type EdgeKind, type RoofComponent, type RoofModel, type RoofParams, type RoofType } from '../../../src/geometry/roof.js';
import { mulberry32, type PolygonM, type Vec2 } from '../../../src/geometry/geom.js';
import type { HeightGrid, ReconstructInput } from '../../../src/types.js';

export class Rng {
  private r: () => number;
  private spare: number | null = null;
  constructor(seed: number) { this.r = mulberry32(seed); }
  u(): number { return this.r(); }
  uniform(a: number, b: number): number { return a + (b - a) * this.r(); }
  int(n: number): number { return Math.min(n - 1, Math.floor(this.r() * n)); }
  normal(): number {
    if (this.spare !== null) { const s = this.spare; this.spare = null; return s; }
    let u = 0, v = 0;
    while (u <= 1e-12) u = this.r();
    v = this.r();
    const m = Math.sqrt(-2 * Math.log(u));
    this.spare = m * Math.sin(2 * Math.PI * v);
    return m * Math.cos(2 * Math.PI * v);
  }
}

const X0 = 412_345.0, Y0 = 287_654.0; // planar offset (BNG-like magnitudes)

interface Frame { cx: number; cy: number; c: number; s: number }
const toW = (f: Frame, u: number, v: number): Vec2 => [f.cx + u * f.c - v * f.s, f.cy + u * f.s + v * f.c];
const toL = (f: Frame, x: number, y: number): Vec2 => [(x - f.cx) * f.c + (y - f.cy) * f.s, -(x - f.cx) * f.s + (y - f.cy) * f.c];

export interface TruthPart {
  ring: Vec2[]; // wall line, scene coords (CCW)
  kinds: EdgeKind[];
  type: RoofType;
  eave: number; // absolute eave at the wall line
  pitchDeg: number;
  parapet: number;
  roof: RoofModel;
  bb: [number, number, number, number];
}
interface Box { f: Frame; hu: number; hv: number; top: number }
export interface TruthBuilding { id: string; ring: Vec2[]; kinds: EdgeKind[]; parts: TruthPart[]; chimneys: Box[]; target: boolean; bb: [number, number, number, number] }

/** Intersection of consecutive edge lines offset outwards by offs[i] (CCW ring). */
function offsetRing(ring: Vec2[], offs: number[]): Vec2[] {
  const n = ring.length;
  const L = ring.map((a, i) => {
    const b = ring[(i + 1) % n];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const nx = (b[1] - a[1]) / l, ny = -(b[0] - a[0]) / l;
    return { nx, ny, c: nx * a[0] + ny * a[1] + offs[i] };
  });
  return ring.map((_, i) => {
    const p = L[(i - 1 + n) % n], q = L[i];
    const det = p.nx * q.ny - p.ny * q.nx;
    return [(p.c * q.ny - p.ny * q.c) / det, (p.nx * q.c - p.c * q.nx) / det] as Vec2;
  });
}

function makePart(ring: Vec2[], kinds: EdgeKind[], type: RoofType, eave: number, pitchDeg: number, oe: number, ov: number, parapet = 0, edgePitchDeg?: (number | undefined)[]): TruthPart {
  const s = Math.tan((pitchDeg * Math.PI) / 180);
  const tanAt = (i: number) => Math.tan(((edgePitchDeg?.[i] ?? pitchDeg) * Math.PI) / 180);
  let roof: RoofModel;
  if (type === 'flat') {
    const offs = kinds.map((k) => (k === 'party' || parapet > 0 ? 0 : 0.1));
    roof = buildRoof({ outer: offsetRing(ring, offs) }, kinds, { type: 'flat', eaveHeight: eave });
  } else {
    // eave overhangs offset so every eave face passes through `eave` at its wall line (steeper faces overhang less)
    const offs = kinds.map((k, i) => (k === 'party' ? 0 : k === 'eave' ? (oe * s) / tanAt(i) : ov));
    roof = buildRoof({ outer: offsetRing(ring, offs) }, kinds, { type, eaveHeight: eave - oe * s, pitchDeg, ...(edgePitchDeg ? { edgePitchDeg } : {}) } as RoofParams);
  }
  const xs = roof.vertices.map((v) => v[0]), ys = roof.vertices.map((v) => v[1]);
  return { ring, kinds, type, eave, pitchDeg, parapet, roof, bb: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
}

function pointInRing(x: number, y: number, r: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
const segD = (x: number, y: number, a: Vec2, b: Vec2) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2));
  return Math.hypot(a[0] + t * dx - x, a[1] + t * dy - y);
};

function buildingHeight(b: TruthBuilding, x: number, y: number): number {
  let h = -Infinity;
  for (const p of b.parts) {
    if (x < p.bb[0] || x > p.bb[2] || y < p.bb[1] || y > p.bb[3]) continue;
    const z = p.roof.heightAt([x, y]);
    if (z !== null) h = Math.max(h, z);
    if (p.parapet > 0 && pointInRing(x, y, p.ring)) {
      const near = p.ring.some((a, i) => p.kinds[i] !== 'party' && segD(x, y, a, p.ring[(i + 1) % p.ring.length]) < 0.3);
      if (near) h = Math.max(h, p.eave + p.parapet);
    }
  }
  for (const c of b.chimneys) {
    const [u, v] = toL(c.f, x, y);
    if (Math.abs(u) <= c.hu && Math.abs(v) <= c.hv) h = Math.max(h, c.top);
  }
  return h;
}

interface Ground { (x: number, y: number): number }
function makeGround(rng: Rng, xc: number, yc: number): Ground {
  const slope = rng.uniform(0, 0.06), a = rng.uniform(0, 2 * Math.PI);
  const g0 = rng.uniform(5, 150), amp = rng.uniform(0, 0.3), lam = rng.uniform(20, 60), ang = rng.uniform(0, 2 * Math.PI), ph = rng.uniform(0, 2 * Math.PI);
  const gx = slope * Math.cos(a), gy = slope * Math.sin(a), w = (2 * Math.PI) / lam;
  return (x, y) => g0 + gx * (x - xc) + gy * (y - yc) + amp * Math.sin(w * ((x - xc) * Math.cos(ang) + (y - yc) * Math.sin(ang)) + ph);
}

export interface CaseTruth {
  name: string;
  nParts: number;
  type: RoofType;
  kinds: EdgeKind[]; // on the target footprint (single-part cases)
  eave: number; // absolute (main part)
  pitchDeg: number;
  groundAtCentroid: number;
  correction: Vec2; // translation the fitter should find (= -misregistration)
  chimneys: Vec2[]; // planar centres of the target's chimneys
  mainKinds?: EdgeKind[]; // two-part case: main rectangle truth
  mainType?: RoofType;
  secondaryEave?: number;
  edgePitchDeg?: (number | undefined)[]; // asymmetric gable: per-edge pitch override of the target
  ridge?: number; // asymmetric gable: absolute ridge height
  components?: RoofComponent[]; // cross-gable: truth components in the raster frame (no misregistration)
  layout?: 'L' | 'T';
  mainRidge?: number; // cross-gable: absolute main ridge height
}

export interface SynthOptions { sigma?: number; outliers?: number; misreg?: number; chimneyP?: number; S?: number; crossWidth?: number }

export const SINGLE_CASES = ['gable_long', 'gable_short', 'hip', 'flat', 'skillion', 'semi_hip', 'mid_terrace', 'L_hip'] as const;
export type CaseName = (typeof SINGLE_CASES)[number] | 'outrigger' | 'gable_asym' | 'cross_L' | 'cross_T';

const rectRing = (f: Frame, u0: number, u1: number, v0: number, v1: number): Vec2[] => [toW(f, u0, v0), toW(f, u1, v0), toW(f, u1, v1), toW(f, u0, v1)];

/** Generate one random scene of an archetype; returns the fitter input and the truth. */
export function generateCase(name: CaseName, seed: number, o: SynthOptions = {}): { input: ReconstructInput; truth: CaseTruth } {
  const rng = new Rng(seed);
  const sigma = o.sigma ?? 0.15, outl = o.outliers ?? 0.05, misreg = o.misreg ?? 0.5, chP = o.chimneyP ?? 0.7, S = o.S ?? 8;
  const th = rng.uniform(0, Math.PI);
  const F: Frame = { cx: rng.uniform(0, 1), cy: rng.uniform(0, 1), c: Math.cos(th), s: Math.sin(th) };
  const fr = (u: number, v: number): Frame => { const [x, y] = toW(F, u, v); return { cx: x, cy: y, c: F.c, s: F.s }; };
  const ground = makeGround(rng, F.cx, F.cy);
  const gAt = (u: number, v: number) => { const [x, y] = toW(F, u, v); return ground(x, y); };
  const B: TruthBuilding[] = [];
  const chim = (u: number, v: number, hu: number, hv: number, top: number): Box => ({ f: fr(u, v), hu, hv, top });
  const oe = () => rng.uniform(0.15, 0.4), ov = () => rng.uniform(0.05, 0.2);
  const addRect = (id: string, u0: number, u1: number, v0: number, v1: number, kinds: EdgeKind[], type: RoofType, eave: number, pitch: number, target = false, parapet = 0, edgePitchDeg?: (number | undefined)[]) => {
    const ring = rectRing(F, u0, u1, v0, v1);
    const part = makePart(ring, kinds, type, eave, pitch, oe(), ov(), parapet, edgePitchDeg);
    const b: TruthBuilding = { id, ring, kinds: kinds.map((k) => (k === 'party' ? 'party' : 'eave')), parts: [part], chimneys: [], target, bb: part.bb };
    B.push(b);
    return b;
  };
  let truth: CaseTruth;
  const detachedNeighbours = (L: number) => {
    for (const side of [-1, 1]) {
      const gap = rng.uniform(1.5, 5), L2 = rng.uniform(8, 12), W2 = rng.uniform(7, 10);
      const uc = side * (L / 2 + gap + L2 / 2), vc = rng.uniform(-1.5, 1.5);
      const hip = rng.u() < 0.5;
      addRect(`n${side}`, uc - L2 / 2, uc + L2 / 2, vc - W2 / 2, vc + W2 / 2, hip ? ['eave', 'eave', 'eave', 'eave'] : ['eave', 'gable', 'eave', 'gable'],
        hip ? 'hipped' : 'gabled', gAt(uc, vc) + rng.uniform(4.8, 6.3), rng.uniform(20, 50));
    }
  };
  if (name === 'gable_long' || name === 'gable_short' || name === 'hip' || name === 'flat' || name === 'skillion') {
    const [L, W] = name === 'skillion' ? [rng.uniform(7, 9), rng.uniform(5, 7)] : [rng.uniform(11.5, 12.5), rng.uniform(9.5, 10.5)];
    const eRel = name === 'skillion' || name === 'flat' ? rng.uniform(2.6, 6.5) : rng.uniform(4.8, 6.3);
    const e = gAt(0, 0) + eRel;
    let kinds: EdgeKind[], type: RoofType, pitch: number, parapet = 0;
    if (name === 'gable_long') { kinds = ['eave', 'gable', 'eave', 'gable']; type = 'gabled'; pitch = rng.uniform(20, 50); }
    else if (name === 'gable_short') { kinds = ['gable', 'eave', 'gable', 'eave']; type = 'gabled'; pitch = rng.uniform(20, 50); }
    else if (name === 'hip') { kinds = ['eave', 'eave', 'eave', 'eave']; type = 'hipped'; pitch = rng.uniform(20, 50); }
    else if (name === 'flat') { kinds = ['eave', 'eave', 'eave', 'eave']; type = 'flat'; pitch = 0; parapet = rng.u() < 0.5 ? rng.uniform(0.2, 0.6) : 0; }
    else { const k = rng.int(4); kinds = [0, 1, 2, 3].map((i) => (i === k ? 'eave' : 'gable')); type = 'skillion'; pitch = rng.uniform(8, 25); }
    const b = addRect('target', -L / 2, L / 2, -W / 2, W / 2, kinds, type, e, pitch, true, parapet);
    const tp = Math.tan((pitch * Math.PI) / 180);
    if ((type === 'gabled' || type === 'hipped') && rng.u() < chP) {
      const w = rng.uniform(0.6, 1.0), d = rng.uniform(0.8, 1.5);
      if (name === 'gable_short') b.chimneys.push(chim(0, rng.uniform(-W / 2 + 1, W / 2 - 1), d / 2, w / 2, e + tp * (L / 2) + rng.uniform(0.5, 1.5)));
      else b.chimneys.push(chim(rng.uniform(-L / 2 + 1, L / 2 - 1), 0, w / 2, d / 2, e + tp * (W / 2) + rng.uniform(0.5, 1.5)));
    }
    detachedNeighbours(L);
    truth = { name, nParts: 1, type, kinds, eave: e, pitchDeg: pitch, groundAtCentroid: gAt(0, 0), correction: [0, 0], chimneys: [] };
  } else if (name === 'gable_asym') {
    // detached gable whose ridge sits off-centre: one long shallow slope, one short steep slope (same eave height)
    const L = rng.uniform(11.5, 14), W = rng.uniform(9.5, 12);
    const p1 = rng.uniform(15, 30), q = rng.uniform(2, 4);
    const p2 = (Math.atan(q * Math.tan((p1 * Math.PI) / 180)) * 180) / Math.PI;
    const steep = rng.u() < 0.5 ? 0 : 2; // S (edge 0) or N (edge 2)
    const kinds: EdgeKind[] = ['eave', 'gable', 'eave', 'gable'];
    const edgePitchDeg = kinds.map((_, i) => (i === steep ? p2 : undefined));
    const e = gAt(0, 0) + rng.uniform(4.8, 6.3);
    addRect('target', -L / 2, L / 2, -W / 2, W / 2, kinds, 'gabled', e, p1, true, 0, edgePitchDeg);
    detachedNeighbours(L);
    const ridge = e + (W * Math.tan((p1 * Math.PI) / 180)) / (1 + 1 / q);
    truth = { name, nParts: 1, type: 'gabled', kinds, eave: e, pitchDeg: p1, groundAtCentroid: gAt(0, 0), correction: [0, 0], chimneys: [], edgePitchDeg, ridge };
  } else if (name === 'cross_L' || name === 'cross_T') {
    // one wall rectangle, compound roof: main gable + perpendicular cross gable reaching the main ridge (no overhang)
    const T = name === 'cross_T';
    const L = T ? rng.uniform(10, 12) : rng.uniform(11, 13), D = rng.uniform(8, 9), p = rng.uniform(30, 45);
    const tp = Math.tan((p * Math.PI) / 180);
    const e = gAt(0, 0) + rng.uniform(4.8, 6.0);
    const R = (u0: number, u1: number, v0: number, v1: number) => rectRing(F, u0, u1, v0, v1);
    let comps: { role: 'main' | 'cross'; ring: Vec2[]; kinds: EdgeKind[]; pitch: number }[], kinds: EdgeKind[], ridge: number;
    if (!T) {
      const Wm = rng.uniform(7.5, Math.min(9.5, L - 2.5)), lo = rng.u() < 0.5;
      const rho = Math.min(rng.uniform(0.9, 1.1), Wm / D);
      const pc = (Math.atan(rho * tp) * 180) / Math.PI;
      const [m0, m1] = lo ? [-L / 2, -L / 2 + Wm] : [L / 2 - Wm, L / 2];
      const uc = (m0 + m1) / 2;
      comps = [
        { role: 'main', ring: R(m0, m1, -D / 2, D / 2), kinds: ['gable', 'eave', 'gable', 'eave'], pitch: p },
        { role: 'cross', ring: lo ? R(uc, L / 2, -D / 2, D / 2) : R(-L / 2, uc, -D / 2, D / 2), kinds: ['eave', 'gable', 'eave', 'gable'], pitch: pc },
      ];
      kinds = lo ? ['gable', 'gable', 'gable', 'eave'] : ['gable', 'eave', 'gable', 'gable'];
      ridge = e + (tp * Wm) / 2;
    } else {
      // detectable front gable: the visible triangle (~w^2/4) needs w >= 4.5 m at 1 m LiDAR (smaller ones read as a gable)
      const w = o.crossWidth ?? rng.uniform(4.5, 6), c = rng.uniform(-1.5, 1.5), lo = rng.u() < 0.5;
      comps = [
        { role: 'main', ring: R(-L / 2, L / 2, -D / 2, D / 2), kinds: ['eave', 'gable', 'eave', 'gable'], pitch: p },
        { role: 'cross', ring: lo ? R(c - w / 2, c + w / 2, -D / 2, 0) : R(c - w / 2, c + w / 2, 0, D / 2), kinds: ['gable', 'eave', 'gable', 'eave'], pitch: p },
      ];
      kinds = lo ? ['gable', 'gable', 'eave', 'gable'] : ['eave', 'gable', 'gable', 'gable'];
      ridge = e + (tp * D) / 2;
    }
    const ring = R(-L / 2, L / 2, -D / 2, D / 2);
    const components: RoofComponent[] = comps.map((k) => ({ role: k.role, footprint: { outer: k.ring }, edgeKinds: k.kinds, pitchDeg: k.pitch }));
    const roof = buildRoof({ outer: ring }, kinds, { type: 'gabled', eaveHeight: e, pitchDeg: p, components });
    const xs = roof.vertices.map((v) => v[0]), ys = roof.vertices.map((v) => v[1]);
    const part: TruthPart = { ring, kinds, type: 'gabled', eave: e, pitchDeg: p, parapet: 0, roof, bb: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
    B.push({ id: 'target', ring, kinds: kinds.map(() => 'eave'), parts: [part], chimneys: [], target: true, bb: part.bb });
    detachedNeighbours(L);
    truth = {
      name, nParts: 1, type: 'gabled', kinds, eave: e, pitchDeg: p, groundAtCentroid: gAt(0, 0), correction: [0, 0], chimneys: [],
      layout: T ? 'T' : 'L', mainRidge: ridge,
      components: components.map((k) => ({ ...k, footprint: { outer: k.footprint.outer.map(([x, y]) => [x + X0, y + Y0] as Vec2) } })),
    };
  } else if (name === 'semi_hip') {
    const L = rng.uniform(7, 8.5), W = rng.uniform(8, 9.5), pitch = rng.uniform(25, 45);
    const e = gAt(L / 2, 0) + rng.uniform(4.8, 6.0);
    const b = addRect('target', 0, L, -W / 2, W / 2, ['eave', 'eave', 'eave', 'party'], 'hipped', e, pitch, true);
    addRect('partner', -L, 0, -W / 2, W / 2, ['eave', 'party', 'eave', 'eave'], 'hipped', e + 0.05 * rng.normal(), pitch);
    if (rng.u() < chP) b.chimneys.push(chim(0, rng.uniform(-0.5, 0.5), rng.uniform(0.3, 0.5), rng.uniform(0.4, 0.75), e + Math.tan((pitch * Math.PI) / 180) * W / 2 + rng.uniform(0.5, 1.5)));
    const gap = rng.uniform(2, 5), u2 = L + gap + L, e2 = gAt(u2, 0) + rng.uniform(4.8, 6);
    addRect('pairA', u2 - L, u2, -W / 2, W / 2, ['eave', 'party', 'eave', 'eave'], 'hipped', e2, pitch);
    addRect('pairB', u2, u2 + L, -W / 2, W / 2, ['eave', 'eave', 'eave', 'party'], 'hipped', e2, pitch);
    truth = { name, nParts: 1, type: 'hipped', kinds: ['eave', 'eave', 'eave', 'party'], eave: e, pitchDeg: pitch, groundAtCentroid: gAt(L / 2, 0), correction: [0, 0], chimneys: [] };
  } else if (name === 'mid_terrace') {
    const Fw = rng.uniform(4.6, 5.4), D = rng.uniform(8.5, 9.5), pitch = rng.uniform(25, 45), eRel = rng.uniform(5, 6.5);
    let tgt: TruthBuilding | null = null, e0 = 0;
    for (let k = 0; k < 5; k++) {
      const idx = k - 2, u0 = idx * Fw - Fw / 2, u1 = u0 + Fw;
      const kinds: EdgeKind[] = ['eave', k < 4 ? 'party' : 'gable', 'eave', k > 0 ? 'party' : 'gable'];
      const e = gAt((u0 + u1) / 2, 0) + eRel + 0.03 * rng.normal();
      const b = addRect(idx === 0 ? 'target' : `row${k}`, u0, u1, -D / 2, D / 2, kinds, 'gabled', e, pitch, idx === 0);
      if (rng.u() < chP && k < 4) b.chimneys.push(chim(u1, rng.uniform(-0.5, 0.5), rng.uniform(0.3, 0.5), rng.uniform(0.4, 0.75), e + Math.tan((pitch * Math.PI) / 180) * D / 2 + rng.uniform(0.5, 1.5)));
      if (idx === 0) { tgt = b; e0 = e; }
    }
    truth = { name, nParts: 1, type: 'gabled', kinds: tgt!.parts[0].kinds, eave: e0, pitchDeg: pitch, groundAtCentroid: gAt(0, 0), correction: [0, 0], chimneys: [] };
  } else if (name === 'L_hip') {
    const L = rng.uniform(10, 12), W = rng.uniform(6, 7), ww = rng.uniform(4, 5), wd = rng.uniform(4, 6), pitch = rng.uniform(25, 45);
    const e = gAt(0, 0) + rng.uniform(4.8, 6.3);
    const ring: Vec2[] = [[-L / 2, -W / 2], [L / 2, -W / 2], [L / 2, W / 2 + wd], [L / 2 - ww, W / 2 + wd], [L / 2 - ww, W / 2], [-L / 2, W / 2]].map(([u, v]) => toW(F, u, v));
    const kinds: EdgeKind[] = ring.map(() => 'eave');
    const part = makePart(ring, kinds, 'hipped', e, pitch, oe(), ov());
    const b: TruthBuilding = { id: 'target', ring, kinds, parts: [part], chimneys: [], target: true, bb: part.bb };
    if (rng.u() < chP) b.chimneys.push(chim(rng.uniform(-L / 2 + 3.5, L / 2 - 3.5), 0, 0.4, 0.5, e + Math.tan((pitch * Math.PI) / 180) * W / 2 + rng.uniform(0.5, 1.5)));
    B.push(b);
    detachedNeighbours(L);
    const c = centroidOf(ring);
    truth = { name, nParts: 1, type: 'hipped', kinds, eave: e, pitchDeg: pitch, groundAtCentroid: ground(c[0], c[1]), correction: [0, 0], chimneys: [] };
  } else { // outrigger: main rectangle (gable or hip) + lower rear outrigger, one footprint polygon
    const L = rng.uniform(9, 10.5), W = rng.uniform(7, 8), ow = rng.uniform(3, 3.6), od = rng.uniform(4, 5);
    const pitch = rng.uniform(30, 45), e = gAt(0, 0) + rng.uniform(5.0, 6.0);
    const hip = rng.u() < 0.5;
    const mk: EdgeKind[] = hip ? ['eave', 'eave', 'eave', 'eave'] : ['eave', 'gable', 'eave', 'gable'];
    const main = makePart(rectRing(F, -L / 2, L / 2, -W / 2, W / 2), mk, hip ? 'hipped' : 'gabled', e, pitch, oe(), ov());
    const ou1 = L / 2, ou0 = ou1 - ow, ov0 = W / 2, ov1 = W / 2 + od; // flush with the east side: L-shaped plan
    const oe2 = gAt((ou0 + ou1) / 2, ov1) + rng.uniform(2.6, 3.0);
    const fam = rng.int(3); // 0 skillion falling away, 1 gable (ridge along v), 2 flat
    const okinds: EdgeKind[] = fam === 0 ? ['gable', 'gable', 'eave', 'gable'] : fam === 1 ? ['gable', 'eave', 'gable', 'eave'] : ['gable', 'eave', 'eave', 'eave'];
    const otype: RoofType = fam === 0 ? 'skillion' : fam === 1 ? 'gabled' : 'flat';
    const opart = makePart(rectRing(F, ou0, ou1, ov0, ov1), okinds, otype, oe2, fam === 0 ? rng.uniform(10, 25) : rng.uniform(25, 40), oe(), ov());
    const clean: Vec2[] = [[-L / 2, -W / 2], [L / 2, -W / 2], [L / 2, ov1], [ou0, ov1], [ou0, W / 2], [-L / 2, W / 2]].map(([u, v]) => toW(F, u, v));
    const b: TruthBuilding = { id: 'target', ring: clean, kinds: clean.map(() => 'eave'), parts: [main, opart], chimneys: [], target: true, bb: mergeBB(main.bb, opart.bb) };
    if (rng.u() < chP) b.chimneys.push(chim(rng.uniform(-L / 2 + 1.5, L / 2 - 1.5) * (hip ? 0.3 : 1), 0, 0.4, 0.5, e + Math.tan((pitch * Math.PI) / 180) * W / 2 + rng.uniform(0.5, 1.5)));
    B.push(b);
    detachedNeighbours(L);
    truth = { name, nParts: 2, type: hip ? 'hipped' : 'gabled', kinds: b.kinds, eave: e, pitchDeg: pitch, groundAtCentroid: gAt(0, 0), correction: [0, 0], chimneys: [], mainKinds: mk, mainType: hip ? 'hipped' : 'gabled', secondaryEave: oe2 };
  }
  const tgt = B.find((b) => b.target)!;
  // every stack touching the target (incl. a neighbour's stack straddling a shared party wall)
  truth.chimneys = B.flatMap((b) => b.chimneys)
    .filter((c) => pointInRing(c.f.cx, c.f.cy, tgt.ring) || tgt.ring.some((p, i) => segD(c.f.cx, c.f.cy, p, tgt.ring[(i + 1) % tgt.ring.length]) <= 0.75))
    .map((c) => [c.f.cx + X0, c.f.cy + Y0] as Vec2);
  // raster: footprints bbox + 14 m, integer metres
  const bb = B.reduce((a, b) => mergeBB(a, b.bb), B[0].bb);
  const x0 = Math.floor(bb[0] + X0 - 14), y1 = Math.ceil(bb[3] + Y0 + 14);
  const nx = Math.ceil(bb[2] + X0 + 14 - x0), ny = Math.ceil(y1 - (bb[1] + Y0 - 14));
  const dsm = new Float32Array(nx * ny), dtm = new Float32Array(nx * ny);
  const offs = Array.from({ length: S }, (_, k) => (k + 0.5) / S - 0.5);
  for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
    const x = x0 + c + 0.5 - X0, y = y1 - r - 0.5 - Y0;
    const near = B.filter((b) => x > b.bb[0] - 1.5 && x < b.bb[2] + 1.5 && y > b.bb[1] - 1.5 && y < b.bb[3] + 1.5);
    let h: number;
    if (!near.length) h = ground(x, y);
    else {
      h = 0;
      for (const oy of offs) for (const ox of offs) {
        const px = x + ox, py = y + oy;
        let z = ground(px, py);
        for (const b of near) z = Math.max(z, buildingHeight(b, px, py));
        h += z;
      }
      h /= S * S;
    }
    let v = h + sigma * rng.normal();
    if (rng.u() < outl) v += rng.uniform(0.5, 4);
    dsm[r * nx + c] = v;
    dtm[r * nx + c] = ground(x, y) + 0.1 * rng.normal();
  }
  const grid = (data: Float32Array): HeightGrid => ({ width: nx, height: ny, originX: x0, originY: y1, res: 1, data });
  // misregistration: all footprints shifted by d; the fitter should find -d
  const a = rng.uniform(0, 2 * Math.PI), d: Vec2 = [misreg * Math.cos(a), misreg * Math.sin(a)];
  truth.correction = [-d[0], -d[1]];
  const fp = (b: TruthBuilding): PolygonM => ({ outer: b.ring.map(([x, y]) => [x + X0 + d[0], y + Y0 + d[1]] as Vec2) });
  const input: ReconstructInput = {
    dsm: grid(dsm), dtm: grid(dtm),
    target: { id: 'target', footprint: fp(tgt), edgeKinds: tgt.kinds },
    neighbours: B.filter((b) => !b.target).map((b, i) => ({ id: b.id, footprint: fp(b), ...(i % 2 ? { edgeKinds: b.kinds } : {}) })),
  };
  truth.groundAtCentroid = truth.groundAtCentroid; // absolute (scene ground is already absolute)
  return { input, truth };
}

function mergeBB(a: [number, number, number, number], b: [number, number, number, number]): [number, number, number, number] {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

function centroidOf(r: Vec2[]): Vec2 {
  let A = 0, cx = 0, cy = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i], q = r[(i + 1) % r.length], c = p[0] * q[1] - q[0] * p[1];
    A += c; cx += (p[0] + q[0]) * c; cy += (p[1] + q[1]) * c;
  }
  return [cx / (3 * A), cy / (3 * A)];
}
