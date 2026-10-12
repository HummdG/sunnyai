import { describe, expect, it } from 'vitest';
import type { MeshLayer } from '@sunny/sunscan-core/types';
import { enuBounds, layerProblem, layerToGeometry } from '../src/meshAdapter';

/** 2 x 3 m floor quad at z = 0.15 (ENU), facing up, metre UVs = plan x / y. */
function floorLayer(): MeshLayer {
  return {
    id: 'main/storey-0/floor', kind: 'floors', material: 'floor-slab', storey: 0,
    positions: new Float32Array([0, 0, 0.15, 2, 0, 0.15, 2, 3, 0.15, 0, 3, 0.15]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    uvs: new Float32Array([0, 0, 2, 0, 2, 3, 0, 3]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  };
}

describe('layerToGeometry', () => {
  it('keeps buffer sizes and converts ENU to three.js axes', () => {
    const g = layerToGeometry(floorLayer());
    expect(g.getAttribute('position').count).toBe(4);
    expect(g.getAttribute('position').array).toHaveLength(12);
    expect(g.getAttribute('normal').count).toBe(4);
    expect(g.getIndex()!.count).toBe(6);
    expect(g.getIndex()!.array).toBeInstanceOf(Uint16Array);
    expect(g.getAttribute('uv')).toBeUndefined(); // untextured: no TEXCOORD_0 in exports
    const p = g.getAttribute('position');
    expect([p.getX(2), p.getY(2), p.getZ(2)].map((v) => +v.toFixed(5))).toEqual([2, 0.15, -3]); // (E, U, -N)
    const n = g.getAttribute('normal');
    expect([n.getX(0), n.getY(0), n.getZ(0)].map((v) => v + 0)).toEqual([0, 1, 0]);
    expect(g.boundingBox!.max.y).toBeCloseTo(0.15, 5);
  });

  it('scales metre UVs by the texture tile size', () => {
    const g = layerToGeometry(floorLayer(), { uvTile: [0.5, 1.5], uvMode: 'keep' });
    const uv = g.getAttribute('uv');
    expect(uv.count).toBe(4);
    expect([uv.getX(2), uv.getY(2)]).toEqual([4, 2]);
  });

  it('switches to 32-bit indices above 65 535 vertices', () => {
    const n = 70_000;
    const layer: MeshLayer = {
      id: 'big', kind: 'terrain', material: 'terrain',
      positions: new Float32Array(n * 3).map((_, i) => (i % 3 === 0 ? i : i % 3 === 1 ? i * 0.5 : 0)),
      normals: new Float32Array(n * 3).map((_, i) => (i % 3 === 2 ? 1 : 0)),
      uvs: new Float32Array(n * 2), indices: new Uint32Array([0, 1, n - 1]),
    };
    const g = layerToGeometry(layer);
    expect(g.getIndex()!.array).toBeInstanceOf(Uint32Array);
    expect(g.getAttribute('position').count).toBe(n);
  });

  it("'slope' UVs run along the eave and up the roof slope (unwelded)", () => {
    // 45° roof plane facing south: eave along x at y = 0, z = 5; ridge at y = 2, z = 7
    const roof: MeshLayer = {
      id: 'main/roof', kind: 'roof', material: 'roof-tile',
      positions: new Float32Array([0, 0, 5, 4, 0, 5, 4, 2, 7, 0, 2, 7]),
      normals: new Float32Array(12), uvs: new Float32Array(8), indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    };
    const g = layerToGeometry(roof, { uvTile: [1, 1], uvMode: 'slope' });
    expect(g.getAttribute('position').count).toBe(6);
    const uv = g.getAttribute('uv'), nrm = g.getAttribute('normal');
    // vertices 0 (eave, x=0) and 2 (ridge, x=4) of the first triangle
    expect(uv.getX(2) - uv.getX(0)).toBeCloseTo(4, 5);
    expect(uv.getY(2) - uv.getY(0)).toBeCloseTo(Math.SQRT2 * 2, 5); // slope length
    // zero input normals are replaced by unit normals
    expect(Math.hypot(nrm.getX(0), nrm.getY(0), nrm.getZ(0))).toBeCloseTo(1, 5);
  });

  it('flat normals: a welded corner shared by two faces gets one normal per face', () => {
    // two triangles meeting at a right-angle edge, welded (shared vertices 0 and 1), smooth normals averaged
    const s = Math.SQRT1_2;
    const welded: MeshLayer = {
      id: 'main/solid', kind: 'solid', material: 'wall-brick',
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0]),
      normals: new Float32Array([0, -s, -s, 0, -s, -s, 0, -1, 0, 0, 0, -1]),
      uvs: new Float32Array(8), indices: new Uint32Array([0, 1, 2, 0, 3, 1]),
    };
    const g = layerToGeometry(welded, { flatNormals: true });
    expect(g.getIndex()).toBeNull();
    expect(g.getAttribute('position').count).toBe(6);
    const n = g.getAttribute('normal');
    const at = (i: number) => [n.getX(i), n.getY(i), n.getZ(i)].map((v) => Math.round(v * 1e6) / 1e6 + 0);
    // wall triangle faces south (-N = +z in three), floor triangle faces down (-y)
    for (const i of [0, 1, 2]) expect(at(i)).toEqual([0, 0, 1]);
    for (const i of [3, 4, 5]) expect(at(i)).toEqual([0, -1, 0]);
  });

  it('reports malformed layers', () => {
    const bad = { ...floorLayer(), indices: new Uint32Array([0, 1, 9]) };
    expect(layerProblem(bad)).toMatch(/out of range/);
    expect(() => layerToGeometry(bad)).toThrow(/out of range/);
    expect(layerProblem({ ...floorLayer(), positions: new Float32Array([0, 0]) })).toMatch(/multiple of 3/);
    expect(layerProblem(floorLayer())).toBeNull();
  });

  it('computes ENU bounds over layers', () => {
    expect(enuBounds([floorLayer()])).toEqual([0, 0, expect.closeTo(0.15, 5), 2, 3, expect.closeTo(0.15, 5)]);
    expect(enuBounds([])).toBeNull();
  });
});
