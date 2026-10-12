import { describe, expect, it } from 'vitest';
import { bearing } from '../src/geometry/roof.js';
import { ERA_DOOR, ERA_WINDOW, NO_TAG, PIER, inferStoreys, storeyLevels, synthesizeHouse, type ModelSynthesisOptions } from '../src/model/index.js';
import type { HouseMesh, HouseModelSpec, MeshLayer, OpeningInfo, Vec2 } from '../src/types.js';
import { ALL_SPECS, part, rect, spec as mkSpec } from './fixtures/model/specs.js';
import { fixtureProvider } from './fixtures/model/interior.js';

type Name = keyof typeof ALL_SPECS;
const NAMES = Object.keys(ALL_SPECS) as Name[];
const build = (name: Name, opts: ModelSynthesisOptions = {}): { spec: HouseModelSpec; m: HouseMesh } => {
  const spec = ALL_SPECS[name]();
  return { spec, m: synthesizeHouse(spec, { layoutInterior: fixtureProvider, ...opts }) };
};
const layer = (m: HouseMesh, id: string) => m.layers.find((l) => l.id === id)!;
const tan = (d: number) => Math.tan((d * Math.PI) / 180);

/** Along-edge position / offset of an opening on its spec edge. */
function onEdge(spec: HouseModelSpec, o: OpeningInfo) {
  const r = spec.parts.find((p) => p.id === o.partId)!.footprint.outer;
  const a = r[o.edge], b = r[(o.edge + 1) % r.length];
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const d: Vec2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], n: Vec2 = [d[1], -d[0]];
  const v = [o.center[0] - a[0], o.center[1] - a[1]];
  return { L, s: v[0] * d[0] + v[1] * d[1], off: v[0] * n[0] + v[1] * n[1], n };
}

/** Level options that align an attached part with the main block (as synthesizeHouse does). */
function alignedTo(spec: HouseModelSpec, p: HouseModelSpec['parts'][number]) {
  const main = spec.parts.find((x) => x.role === 'main')!;
  const L = storeyLevels(main, spec.era);
  const ff = L.length > 1 ? L[1].floorZ - L[0].floorZ : L[0].ceilingZ + 0.2 - L[0].floorZ;
  return p.role === 'garage' ? {} : { plinth: L[0].floorZ - p.baseHeight, floorToFloor: ff };
}

/** Lowest roof height over the opening's width just inside its (gable) wall, from the synthesized roof faces. */
function rakeAt(spec: HouseModelSpec, o: OpeningInfo): number {
  const m = synthesizeHouse(spec, { interior: false, openings: false, floors: false, terrain: false, neighbours: false, chimneys: false, roofSkin: false });
  const { n } = onEdge(spec, o);
  const r = spec.parts.find((p) => p.id === o.partId)!.footprint.outer;
  const a = r[o.edge], b = r[(o.edge + 1) % r.length];
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  const s = onEdge(spec, o).s;
  let lo = Infinity;
  for (const t of [s - o.width / 2, s, s + o.width / 2]) {
    const p: Vec2 = [a[0] + d[0] * t - n[0] * 0.02, a[1] + d[1] * t - n[1] * 0.02];
    for (const f of m.roofFaces.filter((x) => x.partId === o.partId)) {
      if (f.normal[2] < 1e-9) continue;
      const z = f.centroid[2] - ((p[0] - f.centroid[0]) * f.normal[0] + (p[1] - f.centroid[1]) * f.normal[1]) / f.normal[2];
      lo = Math.min(lo, Math.max(z, 0));
    }
  }
  return lo;
}

/** Area of the upward-facing triangles of a layer lying at height z. */
function topArea(l: MeshLayer, z: number): number {
  let A = 0;
  const P = l.positions, I = l.indices;
  for (let t = 0; t < I.length; t += 3) {
    const [a, b, c] = [I[t] * 3, I[t + 1] * 3, I[t + 2] * 3];
    if ([a, b, c].some((i) => Math.abs(P[i + 2] - z) > 1e-4)) continue;
    const cz = ((P[b] - P[a]) * (P[c + 1] - P[a + 1]) - (P[b + 1] - P[a + 1]) * (P[c] - P[a])) / 2;
    if (cz > 0) A += cz;
  }
  return A;
}

const bbox = (l: MeshLayer) => {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < l.positions.length; i++) { const k = i % 3; mn[k] = Math.min(mn[k], l.positions[i]); mx[k] = Math.max(mx[k], l.positions[i]); }
  return { mn, mx };
};

describe('openings: UK facade rules', () => {
  for (const name of NAMES) {
    for (const interior of [false, true]) {
      it(`${name} (interior ${interior}): never on party walls, inside the wall with 0.45 m piers, below the eave, aligned`, () => {
        const { spec, m } = build(name, interior ? {} : { interior: false });
        expect(m.openings.length).toBeGreaterThan(0);
        const groups = new Map<string, { s0: number; s1: number }[]>();
        for (const o of m.openings) {
          const p = spec.parts.find((x) => x.id === o.partId)!;
          expect(p.edgeKinds[o.edge], o.id).not.toBe('party');
          const { L, s, off, n } = onEdge(spec, o);
          expect(Math.abs(off)).toBeLessThan(1e-9);
          expect(s - o.width / 2, o.id).toBeGreaterThanOrEqual(PIER - 1e-6);
          expect(s + o.width / 2, o.id).toBeLessThanOrEqual(L - PIER + 1e-6);
          // below the eave; only gable-end windows of storeys in the roof may rise above it (still under the rake)
          const levels = storeyLevels(p, spec.era, p.role === 'main' ? {} : alignedTo(spec, p));
          const gableAttic = p.edgeKinds[o.edge] === 'gable' && levels[o.storey]?.inRoof;
          if (!gableAttic) expect(o.center[2] + o.height / 2, o.id).toBeLessThanOrEqual(p.eaveHeight + 1e-9);
          else expect(o.center[2] + o.height / 2, o.id).toBeLessThanOrEqual(rakeAt(spec, o) - 0.15 + 1e-9);
          expect(o.center[2] - o.height / 2).toBeGreaterThanOrEqual(p.baseHeight - 1e-9);
          expect(o.facingDeg).toBeCloseTo(bearing(n), 9);
          expect(o.estimated).toBe(true);
          const key = `${o.partId}|${o.edge}|${o.storey}`;
          groups.set(key, [...(groups.get(key) ?? []), { s0: s - o.width / 2, s1: s + o.width / 2 }]);
        }
        for (const [, g] of groups) {
          g.sort((x, y) => x.s0 - y.s0);
          for (let i = 1; i < g.length; i++) expect(g[i].s0 - g[i - 1].s1).toBeGreaterThanOrEqual(PIER - 1e-6);
        }
        // upper-storey windows sit above ground-floor openings of the same wall
        for (const o of m.openings.filter((x) => x.storey > 0)) {
          const ground = m.openings.filter((x) => x.storey === 0 && x.partId === o.partId && x.edge === o.edge).map((x) => onEdge(spec, x).s);
          if (ground.length) expect(ground.some((s) => Math.abs(s - onEdge(spec, o).s) < 1e-6), o.id).toBe(true);
        }
        // one front door on the main part's street edge (edge 0 in every fixture), at ground-floor level
        const doors = m.openings.filter((o) => o.type === 'door' && o.partId === 'main' && o.edge === 0);
        expect(doors).toHaveLength(1);
        const main = spec.parts.find((p) => p.role === 'main')!;
        expect(doors[0].center[2] - doors[0].height / 2).toBeCloseTo(storeyLevels(main, spec.era)[0].floorZ, 9);
        expect(doors[0].width).toBeLessThanOrEqual(ERA_DOOR[spec.era].w + 1e-9);
        // era window sizes on the front ground floor
        const front = m.openings.filter((o) => o.type === 'window' && o.partId === 'main' && o.edge === 0 && o.storey === 0);
        expect(Math.max(...front.map((o) => o.width))).toBeCloseTo(ERA_WINDOW[spec.era].w, 9);
        expect(m.openings.map((o) => o.id)).toEqual([...new Set(m.openings.map((o) => o.id))]);
      });
    }
  }

  it('mid-terrace: door with fanlight at the hall end, sash windows', () => {
    const { spec, m } = build('midTerrace', { interior: false });
    const door = m.openings.find((o) => o.type === 'door' && o.edge === 0)!;
    expect(onEdge(spec, door).s).toBeLessThan(5.5 / 2);
    expect(door.height).toBeCloseTo(ERA_DOOR['pre-1919'].h, 9);
    expect(m.layers.some((l) => l.id === 'main/storey-0/glass' && l.triangleTags!.includes(m.openings.indexOf(door)))).toBe(true); // fanlight
    expect(m.openings.filter((o) => o.type === 'window').every((o) => o.width <= 0.95 + 1e-9)).toBe(true);
    expect(m.openings.filter((o) => o.type === 'door')).toHaveLength(2); // front + back
  });

  it('semi: front door next to the party wall', () => {
    const { spec, m } = build('semi', { interior: false });
    const door = m.openings.find((o) => o.type === 'door' && o.edge === 0)!;
    expect(onEdge(spec, door).s).toBeCloseTo(PIER + ERA_DOOR['1919-1944'].w / 2, 9);
  });

  it('terrace + outrigger: nothing where the outrigger covers the back wall; back door on the outrigger end', () => {
    const { spec, m } = build('terraceOutrigger', { interior: false });
    for (const o of m.openings.filter((x) => x.partId === 'main' && x.edge === 2)) expect(onEdge(spec, o).s - o.width / 2).toBeGreaterThanOrEqual(2.9 + PIER - 1e-6);
    expect(m.openings.filter((o) => o.type === 'door').map((o) => `${o.partId}:${o.edge}`).sort()).toEqual(['main:0', 'rear-1:2']);
    const front = m.openings.find((o) => o.type === 'door' && o.partId === 'main')!;
    expect(onEdge(spec, front).s).toBeGreaterThan(2.5); // hall on the outrigger (east) side
  });

  it('flat-roof parts: garage door only, extension carries the back door, covered gable stays blank', () => {
    const { m } = build('flatRoofParts', { interior: false });
    const garage = m.openings.filter((o) => o.partId === 'garage');
    expect(garage).toHaveLength(1);
    expect(garage[0].type).toBe('door');
    expect(garage[0].width).toBeGreaterThanOrEqual(1.8);
    expect(m.openings.some((o) => o.partId === 'ext' && o.type === 'door' && o.edge === 2)).toBe(true);
    expect(m.openings.some((o) => o.partId === 'main' && o.type === 'door' && o.edge === 2)).toBe(false);
    expect(m.openings.some((o) => o.partId === 'main' && o.edge === 1)).toBe(false);
  });

  it('detached L: windows on the long side, only landing windows on short sides', () => {
    const { m } = build('detachedL', { interior: false });
    const side = (e: number) => m.openings.filter((o) => o.partId === 'main' && o.edge === e);
    expect(side(1).some((o) => o.storey === 0) && side(1).some((o) => o.storey === 1)).toBe(true);
    for (const e of [3, 5]) {
      expect(side(e).length).toBeGreaterThan(0);
      expect(side(e).every((o) => o.storey >= 1 && Math.abs(o.width - 0.6) < 1e-9)).toBe(true);
    }
  });

  it('opening meshes are tagged with the opening index', () => {
    const { m } = build('semi');
    const tags = new Set<number>();
    for (const l of m.layers.filter((x) => x.kind === 'openings')) for (const t of l.triangleTags!) tags.add(t);
    expect([...tags].sort((a, b) => a - b)).toEqual(m.openings.map((_, i) => i));
  });
});

describe('storey levels and floor slabs', () => {
  it('storeyLevels fits floor-to-floor to the eave within the era band', () => {
    const modern = storeyLevels({ baseHeight: 0, eaveHeight: 5.2, storeys: 2 }, 'post-2000');
    expect(modern.map((l) => l.floorZ)).toEqual([0.15, expect.closeTo(2.725, 9)]);
    expect(modern[1].ceilingZ).toBeCloseTo(5.1, 9);
    expect(modern.every((l) => !l.inRoof)).toBe(true);
    const victorian = storeyLevels({ baseHeight: 0, eaveHeight: 6.0, storeys: 2 }, 'pre-1919');
    expect(victorian.map((l) => l.floorZ)).toEqual([0.45, expect.closeTo(0.45 + 2.825, 9)]);
    const chalet = storeyLevels({ baseHeight: 1, eaveHeight: 4, storeys: 2 }, '1945-1964');
    expect(chalet[0].floorZ).toBeCloseTo(1.2, 9);
    expect(chalet[1].floorZ - chalet[0].floorZ).toBeCloseTo(2.4, 9); // clamped: the upper storey is in the roof
    expect(chalet[1].inRoof).toBe(true);
    const forced = storeyLevels({ baseHeight: 0, eaveHeight: 4.6, storeys: 2 }, 'unknown', { plinth: 0.3, floorToFloor: 2.8 });
    expect(forced.map((l) => l.floorZ)).toEqual([0.3, expect.closeTo(3.1, 9)]);
    expect(inferStoreys(5.2, 'post-2000')).toBe(2);
    expect(inferStoreys(7.8, 'post-2000')).toBe(3);
    expect(storeyLevels({ baseHeight: 0, eaveHeight: 2.6, storeys: Number.NaN }, 'post-2000')).toHaveLength(1);
  });

  it('slabs: one per storey plus the loft, inset by the wall thickness, stairwell opening trimmed by headroom', () => {
    const { spec, m } = build('midTerrace');
    const L = storeyLevels(spec.parts[0], spec.era);
    const inset = (5.5 - 0.6) * (8.5 - 0.6);
    const s0 = layer(m, 'main/storey-0/slab'), s1 = layer(m, 'main/storey-1/slab'), loft = layer(m, 'main/loft/slab');
    expect([s0.storey, s1.storey, loft.storey]).toEqual([0, 1, 2]);
    expect(topArea(s0, L[0].floorZ)).toBeCloseTo(inset, 4);
    const ff = L[1].floorZ - L[0].floorZ, risers = Math.ceil(ff / 0.2), R = ff / risers, run = (risers - 1) * 0.225;
    const open = run - Math.floor((ff - 0.2 - 2.0) / R + 1e-9) * 0.225;
    expect(topArea(s1, L[1].floorZ)).toBeCloseTo(inset - 0.85 * open, 4);
    const T = L[1].ceilingZ + 0.2 + 0.23 - 6.0; // loft floor + roof clearance above the eave
    expect(topArea(loft, L[1].ceilingZ + 0.2)).toBeCloseTo(4.9 * (8.5 - 2 * Math.max(0.3, T / tan(38))), 4);
    expect(bbox(s0).mn[2]).toBeCloseTo(L[0].floorZ - 0.2, 5);
  });
});

describe('interior meshing', () => {
  it('partitions split at doors with a 2.0 m head, tagged room floors, stepped stairs', () => {
    const { spec, m } = build('midTerrace');
    const L = storeyLevels(spec.parts[0], spec.era);
    expect(m.rooms).toHaveLength(7);
    const floors = m.layers.filter((l) => l.id.endsWith('room-floors'));
    for (const l of floors) for (const t of l.triangleTags!) expect(m.rooms[t].storey).toBe(l.storey);
    for (const [i, r] of m.rooms.entries()) {
      if (r.storey !== 0) continue;
      const l = layer(m, `main/storey-0/room-floors`);
      let A = 0;
      const P = l.positions, I = l.indices;
      for (let t = 0; t < I.length; t += 3) {
        if (l.triangleTags![t / 3] !== i) continue;
        const [a, b, c] = [I[t] * 3, I[t + 1] * 3, I[t + 2] * 3];
        A += ((P[b] - P[a]) * (P[c + 1] - P[a + 1]) - (P[b + 1] - P[a + 1]) * (P[c] - P[a])) / 2;
      }
      expect(A).toBeCloseTo(r.area, 4);
    }
    // the hall partition (x = 1.3) has a door gap y in [0.82, 1.58] below 2.0 m and a lintel above it
    const walls = layer(m, 'main/storey-0/interior-walls');
    let inGap = 0, lintel = 0;
    const P = walls.positions, I = walls.indices;
    for (let t = 0; t < I.length; t += 3) {
      const c = [0, 1, 2].map((k) => (P[I[t] * 3 + k] + P[I[t + 1] * 3 + k] + P[I[t + 2] * 3 + k]) / 3);
      if (Math.abs(c[0] - 1.3) > 0.06 || c[1] < 0.84 || c[1] > 1.56) continue;
      if (c[2] < L[0].floorZ + 1.99) inGap++;
      else lintel++;
    }
    expect(inGap).toBe(0);
    expect(lintel).toBeGreaterThan(0);
    const stairs = layer(m, 'main/storey-0/stairs');
    const ff = L[1].floorZ - L[0].floorZ, n = Math.ceil(ff / 0.2);
    expect(bbox(stairs).mx[2]).toBeCloseTo(L[0].floorZ + ((n - 1) * ff) / n, 5);
    const treads = new Set<string>();
    for (let t = 0; t < stairs.indices.length; t += 3) if (stairs.normals[stairs.indices[t] * 3 + 2] > 0.99) treads.add(stairs.positions[stairs.indices[t] * 3 + 2].toFixed(4));
    expect(treads.size).toBe(n - 1);
    expect(m.layers.some((l) => l.id === 'main/storey-1/linings')).toBe(true);
  });

  it('attic storeys: partitions and linings stay under the roof', () => {
    const chalet = part('main', 'main', rect(0, 0, 8, 7), ['eave', 'gable', 'eave', 'gable'], 3.0, { type: 'gabled', pitchDeg: 45 }, { overhang: 0.3 });
    const spec = mkSpec('chalet', 'detached', '1945-1964', [chalet]);
    const m = synthesizeHouse(spec, { layoutInterior: fixtureProvider });
    const roof = (x: number, y: number) => 3.0 + Math.min(y, 7 - y) * tan(45);
    let checked = 0;
    for (const l of m.layers.filter((x) => x.storey === 1 && (x.id.endsWith('interior-walls') || x.id.endsWith('linings')))) {
      for (let i = 0; i < l.positions.length; i += 3) {
        expect(l.positions[i + 2]).toBeLessThanOrEqual(roof(l.positions[i], l.positions[i + 1]) - 0.15);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(m.openings.filter((o) => o.storey === 1).every((o) => o.edge === 1 || o.edge === 3)).toBe(true); // gable windows only
  });
});

describe('roof skin', () => {
  it('top surface lies on the solid roof planes and overhangs eaves / verges, not party walls', () => {
    for (const [name, x0, x1, y0, y1] of [['midTerrace', 0, 5.5, -0.25, 8.75], ['flatRoofParts', -0.1, 9.1, -0.3, 7.3], ['semi', 0, 7.95, -0.35, 8.75]] as const) {
      const { m } = build(name);
      const top = layer(m, 'main/roof-skin');
      for (let t = 0; t < top.indices.length; t += 3) {
        const tag = top.triangleTags![t / 3];
        expect(tag).not.toBe(NO_TAG);
        const f = m.roofFaces[tag];
        for (let k = 0; k < 3; k++) {
          const i = top.indices[t + k] * 3;
          const d = (top.positions[i] - f.centroid[0]) * f.normal[0] + (top.positions[i + 1] - f.centroid[1]) * f.normal[1] + (top.positions[i + 2] - f.centroid[2]) * f.normal[2];
          expect(Math.abs(d)).toBeLessThan(2e-4);
        }
      }
      const b = bbox(top);
      expect([b.mn[0], b.mx[0], b.mn[1], b.mx[1]].map((v) => +v.toFixed(4))).toEqual([x0, x1, y0, y1]);
    }
    const { m } = build('midTerrace');
    expect(bbox(layer(m, 'main/roof-skin')).mn[2]).toBeCloseTo(6.0 - 0.25 * tan(38), 4);
    const under = layer(m, 'main/roof-skin-underside');
    expect(bbox(under).mn[2]).toBeCloseTo(6.0 - 0.25 * tan(38) - 0.15 / Math.cos((38 * Math.PI) / 180), 4);
  });

  it('parapet roofs keep the deck inside the parapet; skin thickness is configurable', () => {
    const { m } = build('flatRoofParts', { skinThickness: 0.25 });
    const deck = bbox(layer(m, 'garage/roof-skin'));
    expect([deck.mn[0], deck.mx[0], deck.mn[2], deck.mx[2]].map((v) => +v.toFixed(4))).toEqual([9.2, 11.8, 2.6, 2.6]);
    expect(bbox(layer(m, 'ext/roof-skin-underside')).mn[2]).toBeCloseTo(2.9 - 0.25, 5);
  });
});

describe('context: chimneys, neighbours, terrain', () => {
  it('chimney stacks rise from below the roof to the given top, with pots', () => {
    const { m } = build('midTerrace');
    const stack = bbox(layer(m, 'main/chimneys')), pots = bbox(layer(m, 'main/chimney-pots'));
    expect(stack.mx[2]).toBeCloseTo(10.2, 5);
    expect(stack.mn[2]).toBeLessThan(6.0 + 4.25 * tan(38) - 0.3);
    expect(pots.mx[2]).toBeCloseTo(10.65, 5);
  });

  it('neighbours: roofs when given, prisms otherwise, tagged per neighbour', () => {
    const { m } = build('midTerrace');
    const walls = layer(m, 'neighbours/walls'), roofs = layer(m, 'neighbours/roofs');
    expect([...new Set(walls.triangleTags)].sort()).toEqual([0, 1, 2]);
    expect([...new Set(roofs.triangleTags)].sort()).toEqual([0, 1, 2]);
    const top = [-Infinity, -Infinity, -Infinity];
    for (let t = 0; t < roofs.indices.length; t++) {
      const k = roofs.triangleTags![Math.floor(t / 3)];
      top[k] = Math.max(top[k], roofs.positions[roofs.indices[t] * 3 + 2]);
    }
    expect(top[0]).toBeCloseTo(6.0 + 4.25 * tan(38), 4); // roof from the given eave height
    expect(top[1]).toBeCloseTo(9.6, 4); // no eave given: the ridge goes to the representative height
    expect(top[2]).toBeCloseTo(7.5, 4); // flat-topped prism
  });

  it('terrain grid skips unknown cells; flat ground square otherwise; plinth skirt on slopes', () => {
    const { m } = build('midTerrace');
    expect(layer(m, 'terrain').indices.length / 3).toBe(2 * (39 * 39 - 18));
    expect(m.layers.some((l) => l.id === 'main/plinth')).toBe(true);
    const flat = layer(build('semi').m, 'terrain');
    const b = bbox(flat);
    expect(flat.indices.length).toBe(6);
    expect(b.mx[0] - b.mn[0]).toBeGreaterThanOrEqual(120);
    expect([b.mn[2], b.mx[2]]).toEqual([0, 0]);
  });
});
