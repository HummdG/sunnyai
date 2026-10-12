// Wavefront OBJ + MTL writer for a HouseMesh. Z-up ENU metres by default (research 04 §2.1: STL/OBJ keep the
// ENU axes), optional y-up. One object per layer with `usemtl` = palette key; 'solid' layers keep their welded
// vertices (watertight for printing / CAD) and get one flat normal per triangle.
import type { HouseMesh, LayerKind } from '../types.js';
import { MATERIALS, parseHexColour } from './materials.js';
import { selectLayers } from './export-common.js';

/** Options of exportHouseOBJ. */
export interface OBJExportOptions {
  /** Layer kinds to include (default: the rendered model, as for GLB). */
  layers?: LayerKind[];
  /** File name written in the `mtllib` statement (default 'house.mtl'). */
  mtlName?: string;
  /** 'z' keeps ENU (x east, y north, z up; default), 'y' writes (x, z, -y) like glTF. */
  up?: 'z' | 'y';
  /** Decimal places for coordinates (default 4 = 0.1 mm). */
  precision?: number;
}

const name = (s: string) => s.replace(/[^A-Za-z0-9_.\-/]/g, '_');

/** Serialise selected layers as OBJ text plus the matching MTL library. */
export function exportHouseOBJ(mesh: HouseMesh, opts: OBJExportOptions = {}): { obj: string; mtl: string } {
  const layers = selectLayers(mesh, opts.layers ?? 'glb');
  const yUp = opts.up === 'y';
  const dp = Math.max(1, Math.min(8, Math.round(opts.precision ?? 4)));
  const f = (x: number) => (Object.is(x, -0) ? 0 : x).toFixed(dp);
  const f4 = (x: number) => (Math.abs(x) < 5e-5 ? 0 : x).toFixed(4);
  const P = (a: Float32Array, i: number): [number, number, number] => (yUp ? [a[i * 3], a[i * 3 + 2], -a[i * 3 + 1]] : [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]]);
  const out: string[] = [
    '# SunScan house model (procedural details are estimates)',
    `# units: metres; axes: ${yUp ? 'y-up (x = east, y = up, z = -north)' : 'z-up ENU (x = east, y = north, z = up)'}`,
    `mtllib ${opts.mtlName ?? 'house.mtl'}`,
  ];
  const used: string[] = [];
  let vBase = 1, tBase = 1, nBase = 1;
  for (const l of layers) {
    const n = l.positions.length / 3;
    out.push(`o ${name(l.id)}`, `usemtl ${l.material}`);
    if (!used.includes(l.material)) used.push(l.material);
    for (let i = 0; i < n; i++) { const p = P(l.positions, i); out.push(`v ${f(p[0])} ${f(p[1])} ${f(p[2])}`); }
    for (let i = 0; i < n; i++) out.push(`vt ${f4(l.uvs[i * 2])} ${f4(l.uvs[i * 2 + 1])}`);
    const idx = l.indices;
    if (l.kind === 'solid') {
      // flat normal per triangle on shared (welded) positions
      out.push('s off');
      for (let t = 0; t < idx.length; t += 3) {
        const a = P(l.positions, idx[t]), b = P(l.positions, idx[t + 1]), c = P(l.positions, idx[t + 2]);
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const nx = u[1] * v[2] - u[2] * v[1], ny = u[2] * v[0] - u[0] * v[2], nz = u[0] * v[1] - u[1] * v[0];
        const len = Math.hypot(nx, ny, nz) || 1;
        out.push(`vn ${f4(nx / len)} ${f4(ny / len)} ${f4(nz / len)}`);
      }
      for (let t = 0; t < idx.length; t += 3) {
        const k = nBase + t / 3;
        out.push(`f ${vBase + idx[t]}/${tBase + idx[t]}/${k} ${vBase + idx[t + 1]}/${tBase + idx[t + 1]}/${k} ${vBase + idx[t + 2]}/${tBase + idx[t + 2]}/${k}`);
      }
      nBase += idx.length / 3;
    } else {
      for (let i = 0; i < n; i++) { const q = P(l.normals, i); out.push(`vn ${f4(q[0])} ${f4(q[1])} ${f4(q[2])}`); }
      for (let t = 0; t < idx.length; t += 3) {
        const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
        out.push(`f ${vBase + a}/${tBase + a}/${nBase + a} ${vBase + b}/${tBase + b}/${nBase + b} ${vBase + c}/${tBase + c}/${nBase + c}`);
      }
      nBase += n;
    }
    vBase += n;
    tBase += n;
  }
  const mtl: string[] = ['# SunScan material library (palette colours, sRGB)'];
  for (const key of used) {
    const m = MATERIALS[key as keyof typeof MATERIALS];
    const c = parseHexColour(m.color) ?? [0.7, 0.7, 0.7];
    const d = m.opacity ?? 1;
    mtl.push('', `newmtl ${key}`, `Ka 0 0 0`, `Kd ${c.map((x) => x.toFixed(4)).join(' ')}`, `Ks 0.04 0.04 0.04`,
      `Ns ${Math.round((1 - m.roughness) ** 2 * 900 + 10)}`, `d ${d}`, `Tr ${+(1 - d).toFixed(3)}`, `illum ${d < 1 ? 4 : 2}`,
      `Pr ${m.roughness}`, `Pm ${m.metalness}`);
  }
  return { obj: out.join('\n') + '\n', mtl: mtl.join('\n') + '\n' };
}
