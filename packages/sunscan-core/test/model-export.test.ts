import { describe, expect, it } from 'vitest';
import validator from 'gltf-validator';
import { DEFAULT_RENDER_LAYERS, MATERIALS, exportHouseGLB, exportHouseOBJ, exportHouseSTL, hexToLinearRgb, synthesizeHouse } from '../src/model/index.js';
import type { HouseMesh, HouseModelSpec, LayerKind, Vec3 } from '../src/types.js';
import { ALL_SPECS } from './fixtures/model/specs.js';
import { fixtureProvider } from './fixtures/model/interior.js';
import { accessorFloats, openEdgesOfSoup, parseGLB, soupVolume } from './fixtures/model/check.js';

type Name = keyof typeof ALL_SPECS;
const NAMES = Object.keys(ALL_SPECS) as Name[];
const ALL_KINDS: LayerKind[] = ['solid', 'walls', 'roof', 'roof-skin', 'openings', 'floors', 'interior', 'stairs', 'chimneys', 'neighbours', 'terrain'];
const build = (name: Name): { spec: HouseModelSpec; m: HouseMesh } => {
  const spec = ALL_SPECS[name]();
  return { spec, m: synthesizeHouse(spec, { layoutInterior: fixtureProvider }) };
};

describe('exportHouseGLB', () => {
  for (const name of NAMES) {
    it(`${name}: passes the Khronos glTF validator (default, solids only, every layer)`, async () => {
      const { spec, m } = build(name);
      for (const layers of [undefined, ['solid'] as LayerKind[], ALL_KINDS]) {
        const glb = exportHouseGLB(m, spec, layers ? { layers } : {});
        const report = await validator.validateBytes(new Uint8Array(glb));
        expect(report.issues.messages.filter((x) => x.severity <= 1)).toEqual([]);
        expect(report.issues.numErrors).toBe(0);
        expect(report.issues.numWarnings).toBe(0);
      }
    });
  }

  it('structure: y-up positions, one named node per layer, palette materials, provenance metadata', () => {
    const { spec, m } = build('midTerrace');
    const glb = exportHouseGLB(m, spec);
    const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
    expect([dv.getUint32(0, true), dv.getUint32(4, true), dv.getUint32(8, true)]).toEqual([0x46546c67, 2, glb.byteLength]);
    const { json, bin } = parseGLB(glb);
    expect(json.asset.version).toBe('2.0');
    expect(json.asset.copyright).toBe('© OpenStreetMap contributors (ODbL); © Environment Agency copyright and/or database right 2022 (OGL v3)');
    expect(json.extras.id).toBe(spec.id);
    expect(json.extras.address).toEqual(spec.address);
    expect(json.extras.quality).toEqual(spec.quality);
    expect(json.extras.provenance).toEqual(spec.provenance);
    expect(json.extras.stats).toEqual(m.stats);
    const selected = m.layers.filter((l) => DEFAULT_RENDER_LAYERS.includes(l.kind));
    expect(selected.some((l) => l.kind === 'solid' || l.kind === 'roof')).toBe(false);
    expect(json.nodes[0].children).toEqual(selected.map((_, i) => i + 1));
    expect(json.nodes.slice(1).map((n: { name: string }) => n.name)).toEqual(selected.map((l) => l.id));
    expect(json.nodes.slice(1).map((n: { extras: { kind: string } }) => n.extras.kind)).toEqual(selected.map((l) => l.kind));
    // geometry: ENU (x, y, z) -> glTF (x, z, -y), bit-exact in float32
    selected.forEach((l, k) => {
      const prim = json.meshes[json.nodes[k + 1].mesh].primitives[0];
      const pos = accessorFloats(json, bin, prim.attributes.POSITION);
      const nrm = accessorFloats(json, bin, prim.attributes.NORMAL);
      for (let i = 0; i < l.positions.length / 3; i++) {
        expect([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]).toEqual([l.positions[i * 3], l.positions[i * 3 + 2], -l.positions[i * 3 + 1]]);
        expect(nrm[i * 3 + 1]).toBeCloseTo(l.normals[i * 3 + 2], 6);
      }
      const mat = json.materials[prim.material];
      const def = MATERIALS[l.material];
      expect(mat.pbrMetallicRoughness.roughnessFactor).toBe(def.roughness);
      if ((def.opacity ?? 1) < 1) {
        expect(mat.alphaMode).toBe('BLEND');
        expect(mat.pbrMetallicRoughness.baseColorFactor[3]).toBe(def.opacity);
      } else expect(mat.alphaMode).toBeUndefined();
    });
    expect(json.materials.some((x: { name: string; alphaMode?: string }) => x.name === 'glass' && x.alphaMode === 'BLEND')).toBe(true);
    // the tallest thing is the chimney pot top (y-up)
    const maxY = Math.max(...json.accessors.filter((a: { type: string; max?: number[] }) => a.type === 'VEC3' && a.max).map((a: { max: number[] }) => a.max[1]));
    expect(maxY).toBeCloseTo(10.65, 4);
  });

  it('solid layers are welded and written without normals (flat shading by the viewer)', () => {
    const { spec, m } = build('semi');
    const { json } = parseGLB(exportHouseGLB(m, spec, { layers: ['solid'], uvs: false }));
    expect(json.meshes).toHaveLength(1);
    expect(Object.keys(json.meshes[0].primitives[0].attributes)).toEqual(['POSITION']);
    expect(json.accessors[0].count).toBe(m.layers.find((l) => l.kind === 'solid')!.positions.length / 3);
  });

  it('applies per-part colour overrides from the spec', () => {
    const { spec, m } = build('semi');
    const { json } = parseGLB(exportHouseGLB(m, spec));
    const mat = json.materials.find((x: { name: string }) => x.name === 'wall-render:main');
    expect(mat).toBeDefined();
    const want = hexToLinearRgb('#efe6d2');
    mat.pbrMetallicRoughness.baseColorFactor.slice(0, 3).forEach((c: number, i: number) => expect(c).toBeCloseTo(want[i], 12));
    const { json: plain } = parseGLB(exportHouseGLB(m, spec, { partColours: false }));
    expect(plain.materials.some((x: { name: string }) => x.name === 'wall-render')).toBe(true);
  });

  it('an empty selection still yields a valid GLB', async () => {
    const { spec, m } = build('semi');
    const report = await validator.validateBytes(exportHouseGLB(m, spec, { layers: [] }));
    expect(report.issues.numErrors).toBe(0);
  });
});

/** Triangles of a binary STL. */
function readSTL(stl: Uint8Array): { n: number; tris: Vec3[][]; normals: Vec3[] } {
  const dv = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
  const n = dv.getUint32(80, true);
  const tris: Vec3[][] = [], normals: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const o = 84 + 50 * i;
    const f = (k: number) => dv.getFloat32(o + 4 * k, true);
    normals.push([f(0), f(1), f(2)]);
    tris.push([[f(3), f(4), f(5)], [f(6), f(7), f(8)], [f(9), f(10), f(11)]]);
  }
  return { n, tris, normals };
}

describe('exportHouseSTL', () => {
  for (const name of NAMES) {
    it(`${name}: binary layout and triangle count of the closed solids`, () => {
      const { m } = build(name);
      const stl = exportHouseSTL(m);
      const solidTris = m.layers.filter((l) => l.kind === 'solid').reduce((s, l) => s + l.indices.length / 3, 0);
      const { n, normals } = readSTL(stl);
      expect(n).toBe(solidTris);
      expect(stl.byteLength).toBe(84 + 50 * n);
      expect(new TextDecoder().decode(stl.subarray(0, 5))).not.toBe('solid');
      for (const v of normals) expect(Math.hypot(...v)).toBeCloseTo(1, 5);
    });
  }

  it('a single-part house is a closed shell with the solid volume, in metres or millimetres', () => {
    const { m } = build('midTerrace');
    const mStl = readSTL(exportHouseSTL(m));
    expect(openEdgesOfSoup(mStl.tris)).toBe(0);
    expect(Math.abs(soupVolume(mStl.tris) - m.stats.volume) / m.stats.volume).toBeLessThan(1e-5);
    const mm = readSTL(exportHouseSTL(m, { units: 'mm' }));
    expect(mm.tris[5][1][2]).toBeCloseTo(mStl.tris[5][1][2] * 1000, 1);
    const wallTris = m.layers.filter((l) => l.kind === 'walls').reduce((s, l) => s + l.indices.length / 3, 0); // walls + plinth skirt
    expect(exportHouseSTL(m, { layers: ['walls'] }).byteLength).toBe(84 + 50 * wallTris);
  });
});

/** Minimal OBJ parser (v / vt / vn / f / o / usemtl). */
function parseOBJ(obj: string) {
  const v: Vec3[] = [];
  let vt = 0, vn = 0;
  const objects: { name: string; mtl: string; faces: number[][] }[] = [];
  for (const line of obj.split('\n')) {
    const [t, ...a] = line.trim().split(/\s+/);
    if (t === 'v') v.push(a.map(Number) as Vec3);
    else if (t === 'vt') vt++;
    else if (t === 'vn') vn++;
    else if (t === 'o') objects.push({ name: a[0], mtl: '', faces: [] });
    else if (t === 'usemtl') objects[objects.length - 1].mtl = a[0];
    else if (t === 'f') objects[objects.length - 1].faces.push(a.map((x) => x.split('/').map(Number)).flat());
  }
  return { v, vt, vn, objects };
}

describe('exportHouseOBJ', () => {
  it('parses: objects per layer, valid indices, materials in the MTL', () => {
    const { m } = build('terraceOutrigger');
    const { obj, mtl } = exportHouseOBJ(m, { mtlName: 'x.mtl' });
    expect(obj).toContain('mtllib x.mtl');
    const p = parseOBJ(obj);
    const layers = m.layers.filter((l) => DEFAULT_RENDER_LAYERS.includes(l.kind));
    expect(p.objects.map((o) => o.name)).toEqual(layers.map((l) => l.id));
    expect(p.v.length).toBe(layers.reduce((s, l) => s + l.positions.length / 3, 0));
    expect(p.vt).toBe(p.v.length);
    for (const o of p.objects) {
      expect(mtl).toContain(`newmtl ${o.mtl}`);
      for (const f of o.faces) {
        expect(f).toHaveLength(9);
        expect(f.every((x) => Number.isInteger(x) && x >= 1)).toBe(true);
        expect(Math.max(f[0], f[3], f[6])).toBeLessThanOrEqual(p.v.length);
        expect(Math.max(f[2], f[5], f[8])).toBeLessThanOrEqual(p.vn);
      }
    }
    expect(mtl).toMatch(/newmtl glass[\s\S]*?d 0\.55/);
  });

  it('solid layers stay welded (watertight) and the y-up option swaps axes', () => {
    const { m } = build('flatRoofParts');
    const { obj } = exportHouseOBJ(m, { layers: ['solid'] });
    const p = parseOBJ(obj);
    for (const o of p.objects) {
      const tris = o.faces.map((f) => [p.v[f[0] - 1], p.v[f[3] - 1], p.v[f[6] - 1]]);
      expect(openEdgesOfSoup(tris), o.name).toBe(0);
      expect(soupVolume(tris)).toBeGreaterThan(0);
    }
    const y = parseOBJ(exportHouseOBJ(m, { layers: ['solid'], up: 'y' }).obj);
    expect(y.v[3][1]).toBeCloseTo(p.v[3][2], 4);
    expect(y.v[3][2]).toBeCloseTo(-p.v[3][1], 4);
  });
});
