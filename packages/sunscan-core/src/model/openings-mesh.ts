// Opening geometry on solid walls (no holes in the external walls): frames, glazing bars, sills and door panels
// as thin boxes 3-5 cm proud of the wall plane, glass as a quad 1 cm proud. Door panels also have an inner face
// (seen from inside through the lining reveal); doors above a raised ground floor get stone steps.
import type { MaterialKey, Vec3 } from '../types.js';
import type { BoxFace, LayerBuilder, LayerSet } from './builder.js';
import type { PlannedOpening } from './facade.js';

const F = 0.065; // frame member width
const BAR = 0.05; // glazing bar width
const PROUD = 0.045; // frame projection in front of the wall plane
const BACK = -0.01; // embedded into the wall to avoid cracks
const GLASS = 0.01;

/** Mesh all planned openings; triangles are tagged with the opening's index in HouseMesh.openings. */
export function emitOpenings(set: LayerSet, planned: PlannedOpening[], tagOffset = 0): void {
  planned.forEach((op, i) => {
    const pid = op.part.part.id, k = op.info.storey;
    const get = (suffix: string, material: MaterialKey) =>
      set.get({ id: `${pid}/storey-${k}/${suffix}`, kind: 'openings', material, partId: pid, storey: k });
    const frames = get('frames', 'frame'), glass = get('glass', 'glass'), doors = get('doors', 'door'), sills = get('sills', 'sill');
    const w = op.wall;
    const O: Vec3 = [w.a[0], w.a[1], 0], U: Vec3 = [w.d[0], w.d[1], 0], V: Vec3 = [0, 0, 1], W: Vec3 = [w.n[0], w.n[1], 0];
    const tag = tagOffset + i;
    const box = (b: LayerBuilder, u0: number, u1: number, v0: number, v1: number, w0: number, w1: number, skip: BoxFace[] = ['-w']) =>
      b.box(O, U, V, W, [u0, u1, v0, v1, w0, w1], skip, tag);
    const pane = (u0: number, u1: number, v0: number, v1: number) => {
      const P = (u: number, v: number): Vec3 => [O[0] + U[0] * u + W[0] * GLASS, O[1] + U[1] * u + W[1] * GLASS, v];
      glass.quad(P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1), W, undefined, tag);
    };
    const { s0, s1, z0, z1 } = op;
    if (op.style === 'door' || op.style === 'garage') {
      box(frames, s0, s0 + F, z0, z1 - F, BACK, PROUD);
      box(frames, s1 - F, s1, z0, z1 - F, BACK, PROUD);
      box(frames, s0, s1, z1 - F, z1, BACK, PROUD);
      const fan = op.fanlight;
      const panelTop = fan > 0 ? z1 - F - fan - BAR : z1 - F;
      box(doors, s0 + F, s1 - F, z0, panelTop, BACK, 0.03, []);
      if (fan > 0) {
        box(frames, s0 + F, s1 - F, panelTop, panelTop + BAR, BACK, 0.035);
        pane(s0 + F, s1 - F, panelTop + BAR, z1 - F);
      }
      if (op.style === 'garage') {
        for (let v = z0 + 0.3; v < panelTop - 0.15; v += 0.3) box(doors, s0 + F, s1 - F, v - 0.012, v + 0.012, 0.02, 0.04);
      }
      // stone steps up to a raised ground floor
      const rise = z0 - op.part.base;
      if (op.style === 'door' && rise >= 0.1) {
        const n = Math.ceil(rise / 0.19 - 1e-9);
        for (let j = 0; j < n; j++) box(sills, s0 - 0.15, s1 + 0.15, op.part.base, z0 - (j * rise) / n, 0, 0.3 * (j + 1), ['-w', '-v']);
      }
      return;
    }
    pane(s0, s1, z0, z1);
    box(frames, s0, s1, z1 - F, z1, BACK, PROUD); // head
    box(frames, s0, s1, z0, z0 + F, BACK, PROUD); // bottom rail
    box(frames, s0, s0 + F, z0 + F, z1 - F, BACK, PROUD); // jambs
    box(frames, s1 - F, s1, z0 + F, z1 - F, BACK, PROUD);
    const width = s1 - s0, height = z1 - z0;
    const vbar = (u: number) => box(frames, u - BAR / 2, u + BAR / 2, z0 + F, z1 - F, BACK, 0.03);
    const hbar = (v: number) => box(frames, s0 + F, s1 - F, v - BAR / 2, v + BAR / 2, BACK, 0.03);
    if (op.style === 'sash') {
      hbar((z0 + z1) / 2); // meeting rail
      if (width >= 0.9) vbar((s0 + s1) / 2); // 2-over-2
    } else {
      const m = Math.max(0, Math.round(width / 0.7) - 1);
      for (let j = 1; j <= m; j++) vbar(s0 + (width * j) / (m + 1));
      if (height >= 0.9) hbar(z1 - F - 0.32); // top lights
    }
    box(sills, s0 - 0.05, s1 + 0.05, z0 - 0.06, z0, BACK, 0.05);
  });
}
