// Frame conversions between the spec's local ENU metres and the three.js / glTF world.
//
//   local ENU :  x = east, y = north, z = up
//   three/glTF:  x = east, y = up,    z = -north   (+z points SOUTH; right-handed, y-up)
//
// The map (e, n, u) -> (e, u, -n) is a proper rotation (-90° about X, determinant +1), so triangle winding and
// outward normals are preserved. STL/OBJ "Z-up" exports rotate the three.js object +90° about X, which gives ENU back.
export type V3 = [number, number, number];

export const enuToThree = (e: number, n: number, u: number): V3 => [e, u, -n];
export const threeToEnu = (x: number, y: number, z: number): V3 => [x, -z, y];

/** Converts a flat ENU xyz buffer (positions or normals) to a new three.js-world Float32Array. */
export function enuBufferToThree(src: ArrayLike<number>): Float32Array {
  if (src.length % 3 !== 0) throw new Error(`xyz buffer length ${src.length} is not a multiple of 3`);
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    out[i] = src[i];
    out[i + 1] = src[i + 2];
    out[i + 2] = -src[i + 1];
  }
  return out;
}

/** Rotation about X (radians) applied to a y-up three.js object to obtain Z-up ENU coordinates (STL/OBJ). */
export const Z_UP_ROTATION_X = Math.PI / 2;

/** Where a three.js-world point lands after the Z-up export rotation (+90° about X): (x, y, z) -> (x, -z, y). */
export const threeToZUp = (x: number, y: number, z: number): V3 => [x, -z, y];

/**
 * Normalises xyz vectors in place. Zero or non-finite vectors are replaced by `fallback` so the glTF NORMAL
 * accessor stays unit length (the Khronos validator reports ACCESSOR_NON_UNIT as an error). Returns the number fixed.
 */
export function normalizeVectors(buf: Float32Array, fallback: V3 = [0, 1, 0]): number {
  let fixed = 0;
  for (let i = 0; i < buf.length; i += 3) {
    const l = Math.hypot(buf[i], buf[i + 1], buf[i + 2]);
    if (!Number.isFinite(l) || l < 1e-12) {
      buf[i] = fallback[0]; buf[i + 1] = fallback[1]; buf[i + 2] = fallback[2];
      fixed++;
    } else if (Math.abs(l - 1) > 1e-6) {
      buf[i] /= l; buf[i + 1] /= l; buf[i + 2] /= l;
    }
  }
  return fixed;
}

/** Compass bearing (degrees clockwise from north) of a horizontal three.js-world direction (x = east, z = -north). */
export function bearingOfThreeDir(x: number, z: number): number {
  return ((Math.atan2(x, -z) * 180) / Math.PI + 360) % 360;
}

/** Compass bearing of a plan (ENU) direction. */
export function bearingOfEnuDir(e: number, n: number): number {
  return ((Math.atan2(e, n) * 180) / Math.PI + 360) % 360;
}
