// Sunny addition: lay a quote's PV panels out on the model's real roof planes.
//
// The pure layout lives in @sunny/sunscan-core/layout (shared with the server); this file re-exports it and
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
import { PANEL_LAYOUT, type PanelLayout } from '@sunny/sunscan-core/layout';

export { isSuitablePlane, layoutPanels, PANEL_LAYOUT, rankPlanes } from '@sunny/sunscan-core/layout';
export type { PanelLayout, PanelLayoutOptions, PanelPlacement } from '@sunny/sunscan-core/layout';

type V3 = [number, number, number];

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
