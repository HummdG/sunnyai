// synthesizeHouse: HouseModelSpec -> HouseMesh (renderer-agnostic layers + roof faces, rooms, openings, stats,
// validation). Deterministic: the same spec and options always give identical arrays.
import { polygonArea, type Ring } from '../geometry/geom.js';
import type {
  BuildingPartSpec, HouseMesh, HouseModelSpec, HouseStats, MeshLayer, RoofFaceInfo, RoomInfo, StoreyLevel as HouseStoreyLevel,
  SynthesisOptions, Vec2,
} from '../types.js';
import { LayerSet } from './builder.js';
import { emitChimneys, emitNeighbours, emitPlinth, emitTerrain, terrainSampler, validTerrain } from './context.js';
import { findFront, planOpenings, type PlannedOpening } from './facade.js';
import { emitSlab, insetOf, type InsetInfo, type SlabPlan, planSlabs } from './floors.js';
import { emitInteriorWalls, emitRoomFloors, emitStairs, type RoofTopFn } from './interior-mesh.js';
import { attached, hallInterval, type LayoutInteriorFn, type LayoutRun, resolveInteriorProvider, runInterior, stairwellHoles } from './interior-run.js';
import { levelParams, storeyLevels, type StoreyLevel } from './levels.js';
import { emitLinings } from './linings.js';
import { emitOpenings } from './openings-mesh.js';
import { buildPartGeometry, emitPartLayers, MAX_ROOF_RISE, type PartGeometry, type RoofBuilder, roofAt } from './part.js';
import { emitRoofSkin } from './skin.js';

/** synthesizeHouse options: the public SynthesisOptions plus test / integration hooks. */
export interface ModelSynthesisOptions extends SynthesisOptions {
  /** Interior layout provider; defaults to core/interior's layoutInterior when that module exports it. */
  layoutInterior?: LayoutInteriorFn;
  /** Perpendicular thickness of the rendered roof skin (m), default 0.15. */
  skinThickness?: number;
  /** Roof builder (default: the geometry engine's buildRoof); tests use it to simulate engine failures. */
  buildRoof?: RoofBuilder;
}

const DEFAULTS: Required<SynthesisOptions> = { openings: true, floors: true, interior: true, chimneys: true, roofSkin: true, neighbours: true, terrain: true };

/**
 * Build the renderable / exportable house from a spec: per-part closed solids ('solid'), wall and roof views,
 * overhanging roof skin, procedural openings, storey slabs, interior (walls, room floors, stairs, linings),
 * chimneys, neighbours and terrain. Never throws on bad input: problems are reported in validation.issues.
 */
export function synthesizeHouse(spec: HouseModelSpec, opts: ModelSynthesisOptions = {}): HouseMesh {
  const o = { ...DEFAULTS, ...opts };
  const issues: string[] = [];
  const set = new LayerSet();
  const era = spec.era ?? 'unknown';
  const thickness = Number.isFinite(opts.skinThickness) && (opts.skinThickness as number) > 0 ? (opts.skinThickness as number) : 0.15;

  // 1. parts: closed solids + split views + roof faces + skins (unusable roofs become flat-topped blocks)
  const parts: PartGeometry[] = [];
  const build = opts.buildRoof;
  (spec.parts ?? []).forEach((p, i) => {
    const ridge = knownRidge(spec, p);
    const g = buildPartGeometry(p, i, issues, { ...(ridge !== undefined ? { fallbackTop: ridge } : {}), ...(build ? { build } : {}) });
    if (g) parts.push(g);
  });
  if (!parts.length) issues.push('no buildable parts in the spec');
  let main = parts.findIndex((p) => p.part.role === 'main');
  if (main < 0) main = 0;
  const roofFaces: RoofFaceInfo[] = [];
  for (const pg of parts) {
    const rf = emitPartLayers(pg, set, roofFaces.length);
    roofFaces.push(...rf);
    if (o.roofSkin) emitRoofSkin(pg, set, rf, thickness, build);
  }
  const clearance = Math.max(0.2, ...parts.map((pg) => (pg.roof.params.type === 'flat' ? thickness : thickness / Math.cos((Math.min(pg.roof.params.pitchDeg, 60) * Math.PI) / 180)))) + 0.03;
  const roofTop: RoofTopFn = (p: Vec2) => {
    let best: number | null = null;
    for (const pg of parts) { const h = roofAt(pg, p); if (h !== null && (best === null || h > best)) best = h; }
    return best;
  };

  // 2. storey levels: attached parts share the main block's floor levels (continuous floors, joint interior)
  const levels: StoreyLevel[][] = parts.map(() => []);
  const mainPg = parts[main];
  if (mainPg) {
    const mp = levelParams(mainPg.part, era);
    parts.forEach((pg, i) => {
      const align = i !== main && pg.part.role !== 'garage' && Math.abs(pg.base - mainPg.base) < 0.3 && attached(pg, mainPg);
      levels[i] = storeyLevels(pg.part, era, align ? { plinth: mp.plinth + mainPg.base - pg.base, floorToFloor: mp.floorToFloor } : {});
    });
  }

  // 3. facade front, interior layout (its hall positions the front door), openings
  const front = findFront(spec, parts, main);
  let runs: LayoutRun[] = [];
  if (o.interior && parts.length) {
    const provider = opts.layoutInterior ?? resolveInteriorProvider();
    if (!provider) issues.push('interior: layoutInterior is not available yet; rooms, partitions and stairs skipped');
    else runs = runInterior(spec, parts, levels, main, front, provider, issues);
  }
  if (o.openings && !front && parts.length) issues.push('facade: no street-facing wall found; openings use default orientation');
  const planned: PlannedOpening[] = o.openings && parts.length ? planOpenings({ spec, parts, levels, main, front, hall: hallInterval(runs, front) }) : [];
  emitOpenings(set, planned);

  // 4. slabs (with stairwell openings)
  const holes = stairwellHoles(runs, parts);
  const holesFor = (pid: string, storey: number): Ring[] => holes.get(`${pid}|${storey}`) ?? [];
  const insets = new Map<PartGeometry, InsetInfo | null>();
  const slabs: SlabPlan[] = [];
  parts.forEach((pg, i) => {
    const inset = insetOf(pg);
    insets.set(pg, inset);
    slabs.push(...planSlabs(pg, levels[i], inset, clearance));
  });
  if (o.floors) {
    for (const s of slabs) {
      const pid = s.part.part.id;
      const b = set.get({ id: `${pid}/${s.loft ? 'loft' : `storey-${s.storey}`}/slab`, kind: 'floors', material: 'floor-slab', partId: pid, storey: s.storey });
      emitSlab(b, s.loops, s.top, holesFor(pid, s.storey));
    }
  }

  // 5. interior: partitions, room floors, stairs, wall linings
  const rooms: RoomInfo[] = [];
  if (o.interior) {
    for (const run of runs) {
      const pid = run.pg.part.id;
      const level = (k: number) => run.levels[k];
      const skipped = emitInteriorWalls(set, pid, run.layout.walls, level, roofTop, clearance);
      if (skipped) issues.push(`interior ${pid}: ${skipped} wall(s) without a storey level skipped`);
      emitStairs(set, pid, run.layout.stairs, level);
      const start = rooms.length;
      rooms.push(...run.layout.rooms);
      emitRoomFloors(set, run.layout.rooms.map((room, k) => ({ room, index: start + k })), holesFor);
    }
    parts.forEach((pg, i) => {
      const inset = insets.get(pg);
      if (inset && pg.part.role !== 'garage') emitLinings(set, pg, levels[i], inset, planned.filter((p) => p.part === pg), roofTop, clearance);
    });
  }

  // 6. context
  const grid = validTerrain(spec.context?.terrain);
  if (spec.context?.terrain && !grid) issues.push('terrain: invalid grid ignored; flat ground used');
  const ground = grid ? terrainSampler(grid) : null;
  if (o.chimneys) for (const pg of parts) if (pg.part.chimneys?.length) emitChimneys(set, pg, pg.part.chimneys, roofTop, issues);
  if (ground) for (const pg of parts) emitPlinth(set, pg, ground);
  if (o.neighbours && spec.context?.neighbours?.length) emitNeighbours(set, spec.context.neighbours, ground, issues, build);
  if (o.terrain) emitTerrain(set, grid, parts);

  // 7. stats + validation
  const openings = planned.map((p) => p.info);
  const stats = houseStats(parts, main, levels, slabs, roofFaces, openings.filter((x) => x.type === 'window').length, openings.filter((x) => x.type === 'door').length);
  const solidIssues: string[] = [];
  for (const pg of parts) {
    const r = pg.report;
    if (!r.watertight) solidIssues.push(`solid ${pg.part.id}: not watertight (boundary ${r.boundaryEdges}, non-manifold ${r.nonManifoldEdges}, flipped ${r.sameDirectionEdges})`);
    if (!(r.volume > 0)) solidIssues.push(`solid ${pg.part.id}: non-positive volume ${r.volume}`);
    if (r.degenerateTriangles) solidIssues.push(`solid ${pg.part.id}: ${r.degenerateTriangles} degenerate triangle(s)`);
    if (r.duplicateVertices) solidIssues.push(`solid ${pg.part.id}: ${r.duplicateVertices} duplicate vertex position(s)`);
  }
  const solidsWatertight = parts.length > 0 && parts.every((pg) => pg.report.watertight && pg.report.volume > 0);
  const layers = dropRunawayLayers(set.build(), spec, issues);
  const levelList: HouseStoreyLevel[] = parts.flatMap((pg, i) =>
    levels[i].map((l) => ({ partId: pg.part.id, storey: l.storey, floorZ: l.floorZ, ceilingZ: l.ceilingZ, inRoof: l.inRoof })));
  return { layers, roofFaces, rooms, openings, levels: levelList, stats, validation: { solidsWatertight, issues: [...solidIssues, ...issues] } };
}

/**
 * Ridge height of a part when the spec knows it (the LiDAR fit that produced the part's roof reports it), used as the
 * top of the flat-topped block that replaces an unusable roof.
 */
function knownRidge(spec: HouseModelSpec, part: BuildingPartSpec): number | undefined {
  if (part?.source?.roof !== 'lidar') return undefined;
  const r = spec.fit?.parts?.find((f) => f.partId === part.id)?.ridgeHeight;
  return typeof r === 'number' && Number.isFinite(r) && r >= part.eaveHeight && r <= part.eaveHeight + MAX_ROOF_RISE ? r : undefined;
}

/**
 * Last line of defence against exploding geometry: layers with a non-finite vertex or one far outside the scene (the
 * parts' footprints and roof-height band, neighbours and terrain, plus a generous margin) are dropped and reported, so
 * a broken skeleton never reaches a renderer or an export.
 */
export function dropRunawayLayers(layers: MeshLayer[], spec: HouseModelSpec, issues: string[]): MeshLayer[] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, zHi = 0, zLo = 0;
  const addXY = (x: number, y: number) => { if (Number.isFinite(x) && Number.isFinite(y)) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } };
  const addZ = (z: unknown) => { if (typeof z === 'number' && Number.isFinite(z)) { zHi = Math.max(zHi, z); zLo = Math.min(zLo, z); } };
  for (const p of spec.parts ?? []) {
    for (const q of p?.footprint?.outer ?? []) addXY(q[0], q[1]);
    addZ(p?.baseHeight);
    if (Number.isFinite(p?.eaveHeight)) addZ(p.eaveHeight + MAX_ROOF_RISE);
  }
  for (const n of spec.context?.neighbours ?? []) {
    for (const q of n?.footprint?.outer ?? []) addXY(q[0], q[1]);
    addZ(n?.height);
  }
  const t = spec.context?.terrain;
  if (t && Number.isFinite(t.originX) && Number.isFinite(t.originY) && t.cellSize > 0) {
    addXY(t.originX, t.originY);
    addXY(t.originX + t.width * t.cellSize, t.originY - t.height * t.cellSize);
    for (const h of t.heights ?? []) addZ(h);
  }
  if (!(x1 >= x0)) return layers;
  const m = Math.max(100, x1 - x0, y1 - y0); // the flat ground square reaches 60 m+ beyond the parts
  const zMin = zLo - 50, zMax = zHi + 50;
  return layers.filter((l) => {
    const P = l.positions;
    for (let i = 0; i < P.length; i += 3) {
      const x = P[i], y = P[i + 1], z = P[i + 2];
      if (!(x >= x0 - m && x <= x1 + m && y >= y0 - m && y <= y1 + m && z >= zMin && z <= zMax)) {
        issues.push(`layer ${l.id}: runaway vertex (${x.toExponential(2)}, ${y.toExponential(2)}, ${z.toExponential(2)}); layer dropped`);
        return false;
      }
    }
    return true;
  });
}

function houseStats(parts: PartGeometry[], main: number, levels: StoreyLevel[][], slabs: SlabPlan[], roofFaces: RoofFaceInfo[], windows: number, doors: number): HouseStats {
  let wallArea = 0, partyWallArea = 0;
  for (const pg of parts) {
    for (const f of pg.solid.faces) {
      if (f.kind === 'wall') { if (f.edgeKind === 'party') partyWallArea += f.area; else wallArea += f.area; }
      else if (f.kind === 'party') partyWallArea += f.area;
      else if (f.kind === 'gable' || f.kind === 'riser') wallArea += f.area;
    }
  }
  const mp = parts[main];
  return {
    footprintArea: parts.reduce((s, pg) => s + polygonArea(pg.roof.prepared.poly), 0),
    grossFloorArea: slabs.filter((s) => !s.loft).reduce((s, x) => s + x.area, 0),
    volume: parts.reduce((s, pg) => s + pg.report.volume, 0),
    eaveHeight: mp ? mp.eave : 0,
    ridgeHeight: parts.length ? Math.max(...parts.map((pg) => pg.top)) : 0,
    roofArea: roofFaces.reduce((s, f) => s + f.area, 0),
    roofPlanArea: roofFaces.reduce((s, f) => s + f.planArea, 0),
    wallArea,
    partyWallArea,
    storeys: mp ? levels[main].length : 0,
    windows,
    doors,
  };
}
