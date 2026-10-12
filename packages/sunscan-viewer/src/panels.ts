// Sunny addition: lay a quote's PV panels out on the model's real roof planes.
//
// The layout is pure (mesh in, panel placements out) so it can be tested in Node;
// `buildPanelObjects` turns placements into three.js instanced meshes for the viewer.
//
// The module size, edge setback and the "which planes take panels" rules mirror
// @sunny/sunscan-adapter's ROOF_LAYOUT and isSuitable (kept in step by a parity
// test) -- the viewer cannot import the adapter, which would pull the engine into
// the browser bundle.
import {
  BoxGeometry, CanvasTexture, Color, Group, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion,
  SRGBColorSpace, Vector3,
} from 'three';
import type { HouseMesh, RoofFaceInfo } from '@sunny/sunscan-core/types';

/** Same values as @sunny/sunscan-adapter ROOF_LAYOUT. */
export const PANEL_LAYOUT = {
  edgeSetbackM: 0.4,
  panelLongM: 1.722,
  panelShortM: 1.134,
  gapM: 0.02,
  /** How far the array sits off the roof surface (rails). */
  liftM: 0.09,
} as const;

const SUITABLE_PITCH = { min: 10, max: 60 };
const SUITABLE_AZIMUTH = { from: 67.5, to: 292.5 };
const MIN_PLANE_M2 = 4;

type V3 = [number, number, number];

export interface PanelPlacement {
  faceId: number;
  /** Panel centre, local ENU metres (x east, y north, z up). */
  center: V3;
  /** Unit vectors in ENU: along the eave, up the slope, out of the roof. */
  across: V3;
  up: V3;
  normal: V3;
  widthM: number;
  heightM: number;
  /** Row from the top of the plane, then position along the row. */
  row: number;
  col: number;
}

export interface PanelLayoutOptions {
  count: number;
  /** Planes to use, best first (e.g. the summary's suitable plane ids). Defaults to a ranking of suitable planes. */
  planeIds?: readonly number[];
  moduleLongM?: number;
  moduleShortM?: number;
}

export interface PanelLayout {
  placements: PanelPlacement[];
  perPlane: { faceId: number; count: number; capacity: number }[];
  /** Panels asked for that did not fit on the chosen planes. */
  unplaced: number;
}

export function isSuitablePlane(face: Pick<RoofFaceInfo, 'kind' | 'pitchDeg' | 'azimuthDeg' | 'area'>): boolean {
  if (face.area < MIN_PLANE_M2) return false;
  if (face.kind === 'flat' || !Number.isFinite(face.azimuthDeg)) return true;
  const a = ((face.azimuthDeg % 360) + 360) % 360;
  return face.pitchDeg >= SUITABLE_PITCH.min && face.pitchDeg <= SUITABLE_PITCH.max && a >= SUITABLE_AZIMUTH.from && a <= SUITABLE_AZIMUTH.to;
}

/** South-facing and big first: the order an installer would fill planes. */
export function rankPlanes(faces: readonly RoofFaceInfo[]): RoofFaceInfo[] {
  const score = (f: RoofFaceInfo) => {
    const flat = f.kind === 'flat' || !Number.isFinite(f.azimuthDeg);
    const southness = flat ? 0.85 : (1 + Math.cos(((f.azimuthDeg - 180) * Math.PI) / 180)) / 2;
    return southness * 1000 + f.area;
  };
  return faces.filter((f) => (f.kind === 'roof' || f.kind === 'flat') && isSuitablePlane(f)).sort((a, b) => score(b) - score(a));
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const add = (...vs: V3[]): V3 => vs.reduce((s, v) => [s[0] + v[0], s[1] + v[1], s[2] + v[2]], [0, 0, 0] as V3);
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** The plane's triangles from the roof skin, in ENU. */
function faceTriangles(mesh: HouseMesh, faceId: number): [V3, V3, V3][] {
  const out: [V3, V3, V3][] = [];
  for (const layer of mesh.layers) {
    if (layer.kind !== 'roof-skin' || !layer.triangleTags) continue;
    for (let t = 0; t < layer.triangleTags.length; t++) {
      if (layer.triangleTags[t] !== faceId) continue;
      const tri = [0, 1, 2].map((k) => {
        const v = layer.indices[3 * t + k]!;
        return [layer.positions[3 * v]!, layer.positions[3 * v + 1]!, layer.positions[3 * v + 2]!] as V3;
      });
      out.push(tri as [V3, V3, V3]);
    }
  }
  return out;
}

type P2 = [number, number];
function inTriangle(p: P2, a: P2, b: P2, c: P2): boolean {
  const s = (p1: P2, p2: P2, p3: P2) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
  const d1 = s(p, a, b), d2 = s(p, b, c), d3 = s(p, c, a);
  const neg = d1 < -1e-9 || d2 < -1e-9 || d3 < -1e-9;
  const pos = d1 > 1e-9 || d2 > 1e-9 || d3 > 1e-9;
  return !(neg && pos);
}

/** Every panel position that fits on one plane, top row first, centred along each row. */
function fitPlane(mesh: HouseMesh, face: RoofFaceInfo, longM: number, shortM: number): PanelPlacement[] {
  const tris = faceTriangles(mesh, face.id);
  if (tris.length === 0) return [];
  const normal = norm(face.normal as V3);
  const flat = face.kind === 'flat' || !Number.isFinite(face.azimuthDeg);
  // Downslope in the plane: the horizontal downslope bearing projected onto the plane.
  const az = (face.azimuthDeg * Math.PI) / 180;
  const horiz: V3 = flat ? [0, 1, 0] : [Math.sin(az), Math.cos(az), 0];
  const down = norm(sub(horiz, scale(normal, dot(horiz, normal))));
  const up = scale(down, -1);
  const across = norm(cross(up, normal));
  const origin = face.centroid as V3;
  const to2 = (p: V3): P2 => { const r = sub(p, origin); return [dot(r, across), dot(r, up)]; };
  const tri2 = tris.map((t) => t.map(to2) as [P2, P2, P2]);
  const inside = (p: P2) => tri2.some(([a, b, c]) => inTriangle(p, a, b, c));

  let sMin = Infinity, sMax = -Infinity, tMin = Infinity, tMax = -Infinity;
  for (const t of tri2) for (const [s, u] of t) { sMin = Math.min(sMin, s); sMax = Math.max(sMax, s); tMin = Math.min(tMin, u); tMax = Math.max(tMax, u); }

  const g = PANEL_LAYOUT.gapM, sb = PANEL_LAYOUT.edgeSetbackM;

  // Every grid cell a w x h panel fits in (tried at three offsets each way).
  const gridCells = (w: number, h: number): { s: number; t: number }[] => {
    const fits = (cs: number, ct: number) => {
      const hw = w / 2 + sb, hh = h / 2 + sb;
      for (const [dx, dy] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh], [0, -hh], [0, hh], [-hw, 0], [hw, 0], [0, 0]] as const) {
        if (!inside([cs + dx, ct + dy])) return false;
      }
      return true;
    };
    let found: { s: number; t: number }[] = [];
    for (const os of [0, 1 / 3, 2 / 3]) {
      for (const ot of [0, 1 / 3, 2 / 3]) {
        const cells: { s: number; t: number }[] = [];
        for (let t = tMax - sb - h / 2 - ot * (h + g); t - h / 2 >= tMin + sb - 1e-6; t -= h + g) {
          for (let s = sMin + sb + w / 2 + os * (w + g); s + w / 2 <= sMax - sb + 1e-6; s += w + g) {
            if (fits(s, t)) cells.push({ s, t });
          }
        }
        if (cells.length > found.length) found = cells;
      }
    }
    return found;
  };

  // Portrait (short side along the eave) or landscape, whichever fits more --
  // the same choice the adapter's capacity estimate makes.
  let best: { s: number; t: number }[] = [];
  let w = shortM, h = longM;
  for (const [pw, ph] of [[shortM, longM], [longM, shortM]] as const) {
    const cells = gridCells(pw, ph);
    if (cells.length > best.length) { best = cells; w = pw; h = ph; }
  }

  // Rows from the top, each row centred: fill order is row by row, middle out.
  const rows = [...new Set(best.map((c) => Math.round(c.t * 1000)))].sort((a, b) => b - a);
  const out: PanelPlacement[] = [];
  rows.forEach((rowKey, row) => {
    const cells = best.filter((c) => Math.round(c.t * 1000) === rowKey).sort((a, b) => a.s - b.s);
    const mid = (cells.length - 1) / 2;
    const order = cells.map((c, i) => ({ c, i })).sort((a, b) => Math.abs(a.i - mid) - Math.abs(b.i - mid) || a.i - b.i);
    for (const { c, i } of order) {
      out.push({
        faceId: face.id,
        center: add(origin, scale(across, c.s), scale(up, c.t), scale(normal, PANEL_LAYOUT.liftM)),
        across, up, normal, widthM: w, heightM: h, row, col: i,
      });
    }
  });
  return out;
}

export function layoutPanels(mesh: HouseMesh, opts: PanelLayoutOptions): PanelLayout {
  const longM = opts.moduleLongM ?? PANEL_LAYOUT.panelLongM;
  const shortM = opts.moduleShortM ?? PANEL_LAYOUT.panelShortM;
  const byId = new Map(mesh.roofFaces.map((f) => [f.id, f]));
  const planes = opts.planeIds
    ? opts.planeIds.map((id) => byId.get(id)).filter((f): f is RoofFaceInfo => !!f)
    : rankPlanes(mesh.roofFaces);
  const want = Math.max(0, Math.floor(opts.count));
  const placements: PanelPlacement[] = [];
  const perPlane: PanelLayout['perPlane'] = [];
  for (const face of planes) {
    const all = fitPlane(mesh, face, longM, shortM);
    const take = all.slice(0, Math.max(0, want - placements.length));
    placements.push(...take);
    perPlane.push({ faceId: face.id, count: take.length, capacity: all.length });
    if (placements.length >= want) break;
  }
  return { placements, perPlane, unplaced: want - placements.length };
}

// ------------------------------------------------------------------ three.js objects

/** ENU -> three.js (y up, z = -north), as the viewer's meshes use. */
const toThree = (v: V3) => new Vector3(v[0], v[2], -v[1]);

function cellTexture(): CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 120; canvas.height = 180;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#16264a';
  ctx.fillRect(0, 0, 120, 180);
  ctx.strokeStyle = 'rgba(160,190,235,0.35)';
  ctx.lineWidth = 1.2;
  for (let x = 20; x < 120; x += 20) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 180); ctx.stroke(); }
  for (let y = 18; y < 180; y += 18) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(120, y); ctx.stroke(); }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

export interface PanelObjects {
  group: Group;
  /** Set each panel's drop-in progress (0 = above the roof and tiny, 1 = seated). */
  setProgress(progress: (index: number) => number): void;
  dispose(): void;
}

export function buildPanelObjects(layout: PanelLayout): PanelObjects {
  const n = layout.placements.length;
  const group = new Group();
  group.name = 'sunny-panels';
  const first = layout.placements[0];
  const w = first?.widthM ?? PANEL_LAYOUT.panelShortM, h = first?.heightM ?? PANEL_LAYOUT.panelLongM;
  const frameGeo = new BoxGeometry(w, h, 0.035);
  const cellGeo = new BoxGeometry(w - 0.05, h - 0.05, 0.04);
  const frameMat = new MeshStandardMaterial({ color: new Color('#c9ced6'), metalness: 0.6, roughness: 0.38 });
  const map = cellTexture();
  const cellMat = new MeshStandardMaterial({ color: new Color(map ? '#ffffff' : '#16264a'), map, metalness: 0.25, roughness: 0.22 });
  const frames = new InstancedMesh(frameGeo, frameMat, Math.max(1, n));
  const cells = new InstancedMesh(cellGeo, cellMat, Math.max(1, n));
  frames.count = n; cells.count = n;
  // Receive the house's shadows, cast none: instanced meshes in the shadow (depth) pass failed shader
  // validation on SwiftShader, and panels shading their own roof adds nothing a homeowner can see.
  frames.castShadow = cells.castShadow = false;
  frames.receiveShadow = cells.receiveShadow = true;
  group.add(frames, cells);

  const seats = layout.placements.map((p) => {
    const q = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(toThree(p.across), toThree(p.up), toThree(p.normal)));
    return { pos: toThree(p.center), q, normal: toThree(p.normal) };
  });
  const m = new Matrix4(), pos = new Vector3(), s = new Vector3();
  const setProgress = (progress: (i: number) => number) => {
    seats.forEach((seat, i) => {
      const k = Math.max(0, Math.min(1, progress(i)));
      // Overshoot-and-settle on scale; drop from 1.6 m above along the roof normal.
      const eased = k >= 1 ? 1 : 1 - Math.pow(1 - k, 3);
      const sc = k <= 0 ? 0.0001 : k >= 1 ? 1 : eased * (1 + 0.12 * Math.sin(Math.PI * k));
      pos.copy(seat.pos).addScaledVector(seat.normal, (1 - eased) * 1.6);
      s.set(sc, sc, sc);
      m.compose(pos, seat.q, s);
      frames.setMatrixAt(i, m);
      m.compose(pos.clone().addScaledVector(seat.normal, 0.004), seat.q, s);
      cells.setMatrixAt(i, m);
    });
    frames.instanceMatrix.needsUpdate = true;
    cells.instanceMatrix.needsUpdate = true;
  };
  setProgress(() => 1);
  return {
    group,
    setProgress,
    dispose() {
      frameGeo.dispose(); cellGeo.dispose(); frameMat.dispose(); cellMat.dispose(); map?.dispose();
      frames.dispose(); cells.dispose();
    },
  };
}
