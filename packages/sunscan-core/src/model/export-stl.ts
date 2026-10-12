// Binary STL writer for a HouseMesh: by default the closed watertight part solids, z-up ENU, metres or millimetres.
import type { HouseMesh, LayerKind } from '../types.js';
import { selectLayers } from './export-common.js';

/** Options of exportHouseSTL. */
export interface STLExportOptions {
  /** Layer kinds to include (default ['solid']). */
  layers?: LayerKind[];
  /** Output units (default 'm'; slicers usually expect 'mm'). */
  units?: 'm' | 'mm';
}

/** Serialise selected layers as binary STL (84-byte header + 50 bytes per triangle, z-up ENU). */
export function exportHouseSTL(mesh: HouseMesh, opts: STLExportOptions = {}): Uint8Array {
  const layers = selectLayers(mesh, opts.layers ?? 'stl');
  const k = opts.units === 'mm' ? 1000 : 1;
  const count = layers.reduce((s, l) => s + l.indices.length / 3, 0);
  const out = new Uint8Array(84 + 50 * count);
  const header = `SunScan house model - binary STL - z-up ENU (x east, y north) - units ${opts.units === 'mm' ? 'mm' : 'm'}`;
  for (let i = 0; i < 80; i++) out[i] = i < header.length ? header.charCodeAt(i) & 0x7f : 0x20;
  const dv = new DataView(out.buffer);
  dv.setUint32(80, count, true);
  let o = 84;
  for (const l of layers) {
    const P = l.positions, I = l.indices;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz);
      if (len > 0) { nx /= len; ny /= len; nz /= len; } else { nx = ny = nz = 0; }
      dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true);
      for (const [j, v] of [[0, a], [1, b], [2, c]] as const) {
        dv.setFloat32(o + 12 + j * 12, P[v] * k, true);
        dv.setFloat32(o + 16 + j * 12, P[v + 1] * k, true);
        dv.setFloat32(o + 20 + j * 12, P[v + 2] * k, true);
      }
      dv.setUint16(o + 48, 0, true);
      o += 50;
    }
  }
  return out;
}
