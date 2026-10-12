import { describe, expect, it } from 'vitest';

import { ROOF_LAYOUT } from '../../sunscan-adapter/src/types';
import { isSuitable } from '../../sunscan-adapter/src/summary';
import { isSuitablePlane, layoutPanels, PANEL_LAYOUT, rankPlanes } from '../src/panels';
import { synthesize } from '../src/synthesize';
import { forthlinSpec } from './fixtures';

const { mesh } = synthesize(forthlinSpec);
const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

describe('panels on the roof', () => {
  it('uses the same module size, setback and plane rules as the adapter', () => {
    expect(PANEL_LAYOUT.panelLongM).toBe(ROOF_LAYOUT.panelLongM);
    expect(PANEL_LAYOUT.panelShortM).toBe(ROOF_LAYOUT.panelShortM);
    expect(PANEL_LAYOUT.edgeSetbackM).toBe(ROOF_LAYOUT.edgeSetbackM);
    for (const f of mesh.roofFaces.filter((r) => r.kind === 'roof' || r.kind === 'flat')) {
      const azimuthDeg = f.kind === 'flat' || !Number.isFinite(f.azimuthDeg) ? null : f.azimuthDeg;
      expect(isSuitablePlane(f)).toBe(isSuitable({ pitchDeg: f.pitchDeg, azimuthDeg, areaM2: f.area }));
    }
  });

  it('fills the south-facing plane first and never more panels than were asked for', () => {
    const ranked = rankPlanes(mesh.roofFaces);
    expect(ranked.length).toBeGreaterThan(0);
    const south = ranked[0]!;
    expect(Math.abs(((south.azimuthDeg - 180 + 540) % 360) - 180)).toBeLessThan(60);
    const layout = layoutPanels(mesh, { count: 6 });
    expect(layout.placements).toHaveLength(6);
    expect(layout.unplaced).toBe(0);
    expect(layout.placements.every((p) => p.faceId === south.id)).toBe(true);
  });

  it('seats each panel flat on its plane, just off the surface, without overlaps', () => {
    const layout = layoutPanels(mesh, { count: 30 });
    expect(layout.placements.length).toBeGreaterThan(0);
    for (const p of layout.placements) {
      const face = mesh.roofFaces.find((f) => f.id === p.faceId)!;
      expect(Math.abs(dot(p.normal, face.normal as number[]) - 1)).toBeLessThan(1e-6);
      const offset = dot(
        [p.center[0] - face.centroid[0], p.center[1] - face.centroid[1], p.center[2] - face.centroid[2]],
        face.normal as number[],
      );
      expect(offset).toBeCloseTo(PANEL_LAYOUT.liftM, 5);
      expect(Math.abs(dot(p.across, p.up))).toBeLessThan(1e-9);
    }
    // No two panels on a plane closer than a panel width apart.
    for (const a of layout.placements) {
      for (const b of layout.placements) {
        if (a === b || a.faceId !== b.faceId) continue;
        const d = Math.hypot(a.center[0] - b.center[0], a.center[1] - b.center[1], a.center[2] - b.center[2]);
        expect(d).toBeGreaterThan(PANEL_LAYOUT.panelShortM);
      }
    }
  });

  it('reports what did not fit rather than stacking panels', () => {
    const layout = layoutPanels(mesh, { count: 500 });
    const capacity = layout.perPlane.reduce((a, p) => a + p.capacity, 0);
    expect(layout.placements).toHaveLength(capacity);
    expect(layout.unplaced).toBe(500 - capacity);
  });

  it('is deterministic and honours an explicit plane order', () => {
    expect(layoutPanels(mesh, { count: 8 })).toEqual(layoutPanels(mesh, { count: 8 }));
    const ids = rankPlanes(mesh.roofFaces).map((f) => f.id).reverse();
    const layout = layoutPanels(mesh, { count: 2, planeIds: ids });
    expect(layout.placements[0]!.faceId).toBe(ids.find((id) => layout.perPlane.some((p) => p.faceId === id && p.count > 0)));
  });
});
