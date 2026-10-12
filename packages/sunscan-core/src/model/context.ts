// Context geometry: chimney stacks (box from below the roof to the stack top, corbel cap, pots), neighbouring
// buildings (prisms, or simple roofs via buildRoof), terrain (grid mesh from TerrainGrid, or a flat ground square),
// and a plinth skirt where the terrain falls away below a part's base.
import { autoGableKinds, buildRoof, type EdgeKind } from '../geometry/roof.js';
import { buildSolid, type SolidMesh } from '../geometry/solid.js';
import { pointInPolygon, type PolygonM } from '../geometry/geom.js';
import type { ChimneySpec, NeighbourSpec, TerrainGrid, Vec2, Vec3 } from '../types.js';
import { type LayerBuilder, type LayerSet, cross3, planUV, sub3, unit3, wallUV } from './builder.js';
import type { RoofTopFn } from './interior-mesh.js';
import { wallMaterialKey } from './materials.js';
import { type PartGeometry, type RoofBuilder, ringBounds, roofProblem } from './part.js';
import { finite } from './polyops.js';

/** Highest a chimney stack may rise above the roof surface around it (m); taller tops are clipped. */
export const MAX_CHIMNEY_STACK = 8;

/** Stack, corbel cap and pots of every chimney of a part. */
export function emitChimneys(set: LayerSet, pg: PartGeometry, chimneys: ChimneySpec[], roofTop: RoofTopFn, issues: string[]): void {
  const pid = pg.part.id;
  const [x0, y0, x1, y1] = ringBounds(pg.roof.prepared.poly.outer);
  chimneys.forEach((c, i) => {
    if (!c || !finite(c.center?.[0], c.center?.[1], c.width, c.depth, c.top) || c.width <= 0.05 || c.depth <= 0.05) {
      issues.push(`chimney ${pid}#${i}: invalid geometry, skipped`);
      return;
    }
    if (c.center[0] < x0 - 2 || c.center[0] > x1 + 2 || c.center[1] < y0 - 2 || c.center[1] > y1 + 2) {
      issues.push(`chimney ${pid}#${i}: centre outside the part, skipped`);
      return;
    }
    const a = ((Number.isFinite(c.angleDeg) ? c.angleDeg : 0) * Math.PI) / 180;
    const U: Vec3 = [Math.cos(a), Math.sin(a), 0], V: Vec3 = [-Math.sin(a), Math.cos(a), 0], Z: Vec3 = [0, 0, 1];
    const hw = Math.min(c.width, 4) / 2, hd = Math.min(c.depth, 4) / 2;
    const P = (u: number, v: number): Vec2 => [c.center[0] + U[0] * u + V[0] * v, c.center[1] + U[1] * u + V[1] * v];
    const samples = [P(0, 0), P(-hw, -hd), P(hw, -hd), P(hw, hd), P(-hw, hd)].map(roofTop).filter((z): z is number => z !== null);
    const lo = samples.length ? Math.min(...samples) : pg.eave;
    const hi = samples.length ? Math.max(...samples) : pg.eave;
    let top = c.top;
    if (top < hi + 0.3) {
      issues.push(`chimney ${pid}#${i}: top ${c.top.toFixed(2)} m is not above the roof; raised to ${(hi + 0.6).toFixed(2)} m`);
      top = hi + 0.6;
    } else if (top > hi + MAX_CHIMNEY_STACK) {
      issues.push(`chimney ${pid}#${i}: top ${c.top.toFixed(2)} m is implausibly high; clipped to ${(hi + MAX_CHIMNEY_STACK).toFixed(2)} m`);
      top = hi + MAX_CHIMNEY_STACK;
    }
    const O: Vec3 = [c.center[0], c.center[1], 0];
    const stack = set.get({ id: `${pid}/chimneys`, kind: 'chimneys', material: 'chimney', partId: pid });
    stack.box(O, U, V, Z, [-hw, hw, -hd, hd, Math.max(pg.base, lo - 0.4), top - 0.1], ['-w'], i);
    stack.box(O, U, V, Z, [-hw - 0.05, hw + 0.05, -hd - 0.05, hd + 0.05, top - 0.1, top], [], i);
    // terracotta pots along the width
    const pots = set.get({ id: `${pid}/chimney-pots`, kind: 'chimneys', material: 'roof-tile', partId: pid });
    const n = Math.max(1, Math.min(6, Math.floor((2 * hw) / 0.45)));
    for (let k = 0; k < n; k++) {
      const u = -hw + ((k + 0.5) * 2 * hw) / n;
      octagonPrism(pots, P(u, 0), Math.min(0.13, hd * 0.8), top, top + 0.45, i);
    }
  });
}

function octagonPrism(b: LayerBuilder, c: Vec2, r: number, z0: number, z1: number, tag: number): void {
  const ring: Vec2[] = Array.from({ length: 8 }, (_, k) => {
    const t = ((k + 0.5) * Math.PI) / 4;
    return [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)];
  });
  for (let k = 0; k < 8; k++) {
    const p = ring[k], q = ring[(k + 1) % 8];
    b.quad([p[0], p[1], z0], [q[0], q[1], z0], [q[0], q[1], z1], [p[0], p[1], z1], undefined, undefined, tag);
  }
  b.convex(ring.map((p): Vec3 => [p[0], p[1], z1]), [0, 0, 1], undefined, tag);
}

/** Emit a closed solid's faces (except the floor) into a walls layer and a roofs layer, flat-shaded. */
export function emitSolidFaces(solid: SolidMesh, walls: LayerBuilder, roofs: LayerBuilder, tag: number): void {
  const byFace = new Map<number, [number, number, number][]>();
  solid.triangles.forEach((t, i) => {
    let l = byFace.get(solid.triFace[i]);
    if (!l) byFace.set(solid.triFace[i], (l = []));
    l.push(t);
  });
  const P = solid.positions;
  for (const f of solid.faces) {
    const tris = byFace.get(f.id);
    if (!tris || f.kind === 'floor') continue;
    let nx = 0, ny = 0, nz = 0;
    for (const [a, b, c] of tris) { const n = cross3(sub3(P[b], P[a]), sub3(P[c], P[a])); nx += n[0]; ny += n[1]; nz += n[2]; }
    const n = unit3([nx, ny, nz]);
    const vertical = Math.abs(n[2]) < 0.3;
    const layer = vertical ? walls : roofs;
    const uv = vertical ? wallUV(n) : planUV;
    const map = new Map<number, number>();
    const vid = (g: number) => {
      let v = map.get(g);
      if (v === undefined) { v = layer.vertex(P[g], n, uv(P[g])); map.set(g, v); }
      return v;
    };
    for (const [a, b, c] of tris) layer.triangle(vid(a), vid(b), vid(c), tag);
  }
}

/**
 * Neighbouring buildings: simple roofs when given (and sane), flat-topped prisms otherwise. Tagged with the neighbour
 * index.
 */
export function emitNeighbours(set: LayerSet, neighbours: NeighbourSpec[], ground: TerrainSampler | null, issues: string[], build: RoofBuilder = buildRoof): void {
  const walls = set.get({ id: 'neighbours/walls', kind: 'neighbours', material: 'neighbour-wall' });
  const roofs = set.get({ id: 'neighbours/roofs', kind: 'neighbours', material: 'neighbour-roof' });
  neighbours.forEach((nb, i) => {
    const outer = nb?.footprint?.outer;
    if (!outer || outer.length < 3 || !outer.every((p) => finite(p[0], p[1])) || !finite(nb.height) || nb.height < 1) {
      issues.push(`neighbour ${nb?.id ?? i}: invalid footprint or height, skipped`);
      return;
    }
    const fp: PolygonM = { outer, holes: (nb.footprint.holes ?? []).filter((h) => h.length >= 3 && h.every((p) => finite(p[0], p[1]))) };
    const gz = ground ? outer.map((p) => ground(p)).filter((z): z is number => z !== null) : [];
    const base = Math.min(gz.length ? Math.min(...gz) - 0.3 : 0, nb.height - 1);
    const nE = outer.length + (fp.holes ?? []).reduce((s, h) => s + h.length, 0);
    let solid: SolidMesh | null = null;
    if (nb.roof?.type && nb.roof.type !== 'flat') {
      try {
        const kinds: EdgeKind[] = nb.edgeKinds?.length === nE ? nb.edgeKinds : nb.roof.type === 'gabled' ? autoGableKinds(fp) : Array(nE).fill('eave');
        let eave = finite(nb.eaveHeight ?? NaN) ? (nb.eaveHeight as number) - base : NaN;
        if (!Number.isFinite(eave)) {
          const probe = build(fp, kinds, { ...nb.roof, eaveHeight: 0 });
          eave = roofProblem(probe, fp) ? NaN : nb.height - base - probe.vertices.reduce((m, v) => Math.max(m, v[2]), 0);
        }
        if (eave >= 1.5) {
          const roof = build(fp, kinds, { ...nb.roof, eaveHeight: eave });
          const bad = roofProblem(roof, fp);
          if (bad) issues.push(`neighbour ${nb.id}: roof unusable (${bad}); flat-topped prism used`);
          else solid = buildSolid(roof);
        }
      } catch {
        solid = null;
      }
    }
    if (!solid) {
      try { solid = buildSolid(build(fp, Array(nE).fill('eave'), { type: 'flat', eaveHeight: nb.height - base })); } catch (e) {
        issues.push(`neighbour ${nb.id}: ${(e as Error).message}`);
        return;
      }
    }
    for (const p of solid.positions) p[2] += base;
    emitSolidFaces(solid, walls, roofs, i);
  });
}

/** Height of the terrain (m above datum) at a plan point, bilinear between cell-centre samples; null if unknown. */
export type TerrainSampler = (p: Vec2) => number | null;

/** Validated terrain grid or null. */
export function validTerrain(t: TerrainGrid | undefined): TerrainGrid | null {
  if (!t || !(t.width >= 2 && t.height >= 2) || !(t.cellSize > 0) || !finite(t.originX, t.originY) || t.heights?.length !== t.width * t.height) return null;
  return t;
}

/** Bilinear sampler over the cell-centre samples of a terrain grid (unknown cells are skipped). */
export function terrainSampler(t: TerrainGrid): TerrainSampler {
  const H = (r: number, c: number) => {
    if (r < 0 || c < 0 || r >= t.height || c >= t.width) return null;
    const v = t.heights[r * t.width + c];
    return v === null || !Number.isFinite(v) ? null : v;
  };
  return ([x, y]) => {
    const fc = (x - t.originX) / t.cellSize - 0.5, fr = (t.originY - y) / t.cellSize - 0.5;
    const c0 = Math.floor(fc), r0 = Math.floor(fr), tx = fc - c0, ty = fr - r0;
    const q = [[r0, c0, (1 - tx) * (1 - ty)], [r0, c0 + 1, tx * (1 - ty)], [r0 + 1, c0, (1 - tx) * ty], [r0 + 1, c0 + 1, tx * ty]] as const;
    let s = 0, w = 0;
    for (const [r, c, k] of q) { const v = H(r, c); if (v !== null && k > 0) { s += v * k; w += k; } }
    if (w > 1e-9) return s / w;
    const v = H(Math.round(fr), Math.round(fc));
    return v;
  };
}

/** Terrain grid mesh (cell-centre vertices, quads where all four samples are known), or a flat ground square. */
export function emitTerrain(set: LayerSet, grid: TerrainGrid | null, parts: PartGeometry[]): void {
  const b = set.get({ id: 'terrain', kind: 'terrain', material: 'terrain' });
  const inside = (p: Vec2) => parts.find((pg) => pg.base < 0.5 && pointInPolygon(p, pg.roof.prepared.poly));
  if (!grid) {
    let minX = 0, minY = 0, maxX = 0, maxY = 0;
    for (const pg of parts) for (const w of pg.walls) {
      minX = Math.min(minX, w.a[0]); minY = Math.min(minY, w.a[1]); maxX = Math.max(maxX, w.a[0]); maxY = Math.max(maxY, w.a[1]);
    }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, h = Math.max(60, (Math.max(maxX - minX, maxY - minY) + 40) / 2);
    b.quad([cx - h, cy - h, 0], [cx + h, cy - h, 0], [cx + h, cy + h, 0], [cx - h, cy + h, 0], [0, 0, 1], planUV);
    return;
  }
  const { width: W, height: Hh, cellSize: cs } = grid;
  const zAt = (r: number, c: number): number | null => {
    const v = grid.heights[r * W + c];
    return v === null || !Number.isFinite(v) ? null : v;
  };
  const vid = new Map<number, number>();
  const pos: Vec3[] = [];
  const acc: Vec3[] = [];
  const tris: [number, number, number][] = [];
  const vertex = (r: number, c: number) => {
    const k = r * W + c;
    let v = vid.get(k);
    if (v === undefined) {
      const p: Vec2 = [grid.originX + (c + 0.5) * cs, grid.originY - (r + 0.5) * cs];
      let z = zAt(r, c) as number;
      const pg = inside(p);
      if (pg) z = Math.min(z, pg.base - 0.05); // keep the ground under the house floor
      v = pos.length; pos.push([p[0], p[1], z]); acc.push([0, 0, 0]); vid.set(k, v);
    }
    return v;
  };
  for (let r = 0; r + 1 < Hh; r++) {
    for (let c = 0; c + 1 < W; c++) {
      if (zAt(r, c) === null || zAt(r, c + 1) === null || zAt(r + 1, c) === null || zAt(r + 1, c + 1) === null) continue;
      const nw = vertex(r, c), ne = vertex(r, c + 1), sw = vertex(r + 1, c), se = vertex(r + 1, c + 1);
      tris.push([sw, se, ne], [sw, ne, nw]);
    }
  }
  for (const [a, b2, c] of tris) {
    const n = cross3(sub3(pos[b2], pos[a]), sub3(pos[c], pos[a]));
    for (const i of [a, b2, c]) acc[i] = [acc[i][0] + n[0], acc[i][1] + n[1], acc[i][2] + n[2]];
  }
  const ids = pos.map((p, i) => b.vertex(p, unit3(acc[i]), planUV(p)));
  for (const [a, b2, c] of tris) b.triangle(ids[a], ids[b2], ids[c]);
}

/** Wall skirt from a part's base down to the terrain where the ground falls away (sloping sites). */
export function emitPlinth(set: LayerSet, pg: PartGeometry, ground: TerrainSampler): void {
  const b = set.get({ id: `${pg.part.id}/plinth`, kind: 'walls', material: wallMaterialKey(pg.part.material?.wall), partId: pg.part.id });
  for (const w of pg.walls) {
    const n = Math.max(1, Math.ceil(w.length));
    let lo = Infinity;
    for (let i = 0; i <= n; i++) {
      const s = (w.length * i) / n;
      const z = ground([w.a[0] + w.d[0] * s + w.n[0] * 0.2, w.a[1] + w.d[1] * s + w.n[1] * 0.2]);
      if (z !== null) lo = Math.min(lo, z);
    }
    if (!(lo < pg.base - 0.05)) continue;
    const z0 = lo - 0.1, z1 = pg.base;
    const nn: Vec3 = [w.n[0], w.n[1], 0];
    b.quad([w.a[0], w.a[1], z0], [w.b[0], w.b[1], z0], [w.b[0], w.b[1], z1], [w.a[0], w.a[1], z1], nn, wallUV(nn, w.u0 - (w.a[0] * w.d[0] + w.a[1] * w.d[1])), w.srcEdges[0]);
  }
}
