import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import {
  bearingOfEnuDir, bearingOfThreeDir, enuBufferToThree, enuToThree, normalizeVectors, threeToEnu, threeToZUp, Z_UP_ROTATION_X,
} from '../src/frames';

const cross = (u: number[], v: number[]) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];

describe('ENU <-> three.js world', () => {
  it('maps east/north/up to x / -z / y', () => {
    expect(enuToThree(1, 0, 0)).toEqual([1, 0, -0]);
    expect(enuToThree(0, 1, 0)).toEqual([0, 0, -1]); // north is -z
    expect(enuToThree(0, 0, 1)).toEqual([0, 1, -0]); // up is +y
    expect(enuToThree(3.5, -2, 7)).toEqual([3.5, 7, 2]);
  });

  it('round-trips through threeToEnu', () => {
    const pts: [number, number, number][] = [[1, 2, 3], [-4.551, 2.769, 5.14], [0, -10, 0.15]];
    for (const p of pts) {
      const t = enuToThree(p[0], p[1], p[2]);
      expect(threeToEnu(t[0], t[1], t[2]).map((v) => v + 0)).toEqual(p); // +0 normalises -0
    }
  });

  it('converts flat buffers and rejects ragged ones', () => {
    const out = enuBufferToThree([1, 2, 3, 4, 5, 6]);
    expect(Array.from(out)).toEqual([1, 3, -2, 4, 6, -5]);
    expect(out).toBeInstanceOf(Float32Array);
    expect(() => enuBufferToThree([1, 2])).toThrow(/multiple of 3/);
  });

  it('is a proper rotation: winding and outward normals are preserved', () => {
    // south-facing wall triangle in ENU (CCW seen from the south), outward normal (0, -1, 0)
    const a = [0, 0, 0], b = [1, 0, 0], c = [1, 0, 1];
    const nEnu = cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]);
    expect(nEnu).toEqual([0, -1, 0]);
    const [A, B, C] = [a, b, c].map((p) => enuToThree(p[0], p[1], p[2]));
    const nThree = cross([B[0] - A[0], B[1] - A[1], B[2] - A[2]], [C[0] - A[0], C[1] - A[1], C[2] - A[2]]);
    expect(nThree.map((v) => v + 0)).toEqual(enuToThree(0, -1, 0).map((v) => v + 0)); // (0, 0, +1): south is +z
  });

  it('Z-up export rotation (+90° about X) gives ENU back, matching three.js', () => {
    const enu: [number, number, number] = [2.5, -4, 8.8];
    const t = enuToThree(...enu);
    expect(threeToZUp(...t).map((v) => v + 0)).toEqual(enu);
    const v = new Vector3(...t).applyAxisAngle(new Vector3(1, 0, 0), Z_UP_ROTATION_X);
    expect(v.x).toBeCloseTo(enu[0], 9);
    expect(v.y).toBeCloseTo(enu[1], 9);
    expect(v.z).toBeCloseTo(enu[2], 9);
  });
});

describe('normalizeVectors', () => {
  it('normalises in place and replaces degenerate vectors', () => {
    const buf = new Float32Array([0, 3, 4, 0, 0, 0, Number.NaN, 1, 1]);
    expect(normalizeVectors(buf)).toBe(2);
    expect(Array.from(buf.slice(0, 3)).map((v) => +v.toFixed(6))).toEqual([0, 0.6, 0.8]);
    expect(Array.from(buf.slice(3))).toEqual([0, 1, 0, 0, 1, 0]);
  });
});

describe('bearings', () => {
  it('reads compass bearings from three.js and ENU directions', () => {
    expect(bearingOfThreeDir(0, -1)).toBeCloseTo(0);
    expect(bearingOfThreeDir(1, 0)).toBeCloseTo(90);
    expect(bearingOfThreeDir(0, 1)).toBeCloseTo(180);
    expect(bearingOfThreeDir(-1, 0)).toBeCloseTo(270);
    expect(bearingOfEnuDir(1, 1)).toBeCloseTo(45);
  });
});
