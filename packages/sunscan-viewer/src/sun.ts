// Sun position for the shadow study (suncalc 2.x conventions: DEGREES, azimuth clockwise from NORTH,
// apparent altitude). Direction TO the sun in the three.js world (x = east, y = up, z = -north):
//   (cos a · sin z, sin a, -cos a · cos z)   with a = altitude, z = azimuth
import { getPosition } from 'suncalc';
import type { V3 } from './frames';

const D2R = Math.PI / 180;

export interface SunState {
  azimuthDeg: number;
  altitudeDeg: number;
  /** Unit vector pointing from the scene towards the sun (three.js world). */
  direction: V3;
  aboveHorizon: boolean;
}

export function sunDirectionThree(azimuthDeg: number, altitudeDeg: number): V3 {
  const a = altitudeDeg * D2R, z = azimuthDeg * D2R;
  return [Math.cos(a) * Math.sin(z), Math.sin(a), -Math.cos(a) * Math.cos(z)];
}

export function sunState(date: Date, lat: number, lon: number): SunState {
  const { azimuth, altitude } = getPosition(date, lat, lon);
  return { azimuthDeg: azimuth, altitudeDeg: altitude, direction: sunDirectionThree(azimuth, altitude), aboveHorizon: altitude > 0 };
}

export interface SunPathSample { minutes: number; azimuthDeg: number; altitudeDeg: number }

/** Samples the sun over one civil day: `toUtc(minutes)` maps local clock minutes (0..1440) to a UTC instant. */
export function sunPath(toUtc: (minutes: number) => Date, lat: number, lon: number, stepMinutes = 10): SunPathSample[] {
  const out: SunPathSample[] = [];
  for (let m = 0; m <= 1440; m += stepMinutes) {
    const { azimuth, altitude } = getPosition(toUtc(m), lat, lon);
    out.push({ minutes: m, azimuthDeg: azimuth, altitudeDeg: altitude });
  }
  return out;
}

/** Polar sun-path diagram projection: zenith at the centre, horizon at radius R, north up, east right. */
export function polarPoint(azimuthDeg: number, altitudeDeg: number, R: number): [number, number] {
  const r = (R * (90 - Math.max(0, Math.min(90, altitudeDeg)))) / 90;
  return [r * Math.sin(azimuthDeg * D2R), -r * Math.cos(azimuthDeg * D2R)];
}
