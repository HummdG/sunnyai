// Viewer-only helpers that are never exported: LiDAR evidence points, the horizon ground disc and the optional
// aerial imagery ground plane (Esri, live layer only).
import {
  BufferAttribute, BufferGeometry, CircleGeometry, Color, Mesh, MeshStandardMaterial, PlaneGeometry, Points, PointsMaterial,
  SRGBColorSpace, TextureLoader,
} from 'three';
import type { ImageryRef, LidarEvidence } from '@sunny/sunscan-core/types';

/** Diverging colour for a residual (observed - fitted, metres): blue below the roof, red above, pale at 0. */
export function residualColour(r: number, range = 0.6): [number, number, number] {
  const t = Math.max(-1, Math.min(1, r / range));
  const mid = new Color('#f4f1ea'), lo = new Color('#2f6db0'), hi = new Color('#c2412d');
  const c = mid.clone().lerp(t < 0 ? lo : hi, Math.abs(t));
  return [c.r, c.g, c.b];
}

/** Height ramp colour when no residuals are available. */
function heightColour(z: number, zMax: number): [number, number, number] {
  const c = new Color('#3b5f7a').lerp(new Color('#e3b04b'), Math.max(0, Math.min(1, z / Math.max(1, zMax))));
  return [c.r, c.g, c.b];
}

export function evidencePoints(ev: LidarEvidence): Points | null {
  const n = Math.floor(ev.points.length / 3);
  if (!n) return null;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let zMax = 0;
  for (let i = 0; i < n; i++) zMax = Math.max(zMax, ev.points[3 * i + 2]);
  for (let i = 0; i < n; i++) {
    const x = ev.points[3 * i], y = ev.points[3 * i + 1], z = ev.points[3 * i + 2];
    pos[3 * i] = x; pos[3 * i + 1] = z; pos[3 * i + 2] = -y;
    const r = ev.residuals?.[i];
    const c = r !== undefined && Number.isFinite(r) ? residualColour(r) : heightColour(z, zMax);
    col.set(c, 3 * i);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('color', new BufferAttribute(col, 3));
  const size = Math.max(0.25, Math.min(0.8, ev.resolution * 0.55)); // about half a LiDAR pixel
  const pts = new Points(g, new PointsMaterial({ size, vertexColors: true, sizeAttenuation: true, depthTest: true }));
  pts.name = 'lidar-evidence';
  pts.renderOrder = 2;
  return pts;
}

/** Large ground disc reaching the horizon (helper; receives shadows). */
export function groundDisc(y: number, colour = '#a8b496'): Mesh {
  const m = new Mesh(new CircleGeometry(600, 64), new MeshStandardMaterial({ color: colour, roughness: 1, metalness: 0 }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  m.receiveShadow = true;
  m.name = 'ground';
  return m;
}

/** Aerial imagery draped on a ground plane over its ENU bounds (async texture; never exported). */
export function imageryPlane(ref: ImageryRef, onLoad: () => void): Mesh {
  const [minX, minY, maxX, maxY] = ref.bounds;
  const tex = new TextureLoader().load(ref.url, () => onLoad());
  tex.colorSpace = SRGBColorSpace;
  const m = new Mesh(new PlaneGeometry(maxX - minX, maxY - minY), new MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1 }));
  m.rotation.x = -Math.PI / 2;
  m.position.set((minX + maxX) / 2, 0.02, -(minY + maxY) / 2);
  m.receiveShadow = true;
  m.name = 'imagery';
  return m;
}
