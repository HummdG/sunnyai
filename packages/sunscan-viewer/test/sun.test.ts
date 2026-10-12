import { describe, expect, it } from 'vitest';
import { polarPoint, sunDirectionThree, sunPath, sunState } from '../src/sun';
import { ukLocalToUtc } from '../src/lib/time';

const LONDON = { lat: 51.5074, lon: -0.1278 };

describe('sun position (suncalc 2.x: degrees, azimuth clockwise from north)', () => {
  it('London solar noon on 21 June 2026: ~61.9° altitude, due south, light from +z (south)', () => {
    const s = sunState(new Date('2026-06-21T12:02:21Z'), LONDON.lat, LONDON.lon);
    expect(s.altitudeDeg).toBeCloseTo(61.94, 1);
    expect(Math.abs(s.azimuthDeg - 180)).toBeLessThan(0.5);
    expect(s.aboveHorizon).toBe(true);
    const [x, y, z] = s.direction;
    expect(Math.abs(x)).toBeLessThan(0.01);
    expect(y).toBeCloseTo(0.8825, 3);
    expect(z).toBeCloseTo(0.4704, 3); // +z three = south
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 9);
  });

  it('the same instant entered as UK clock time (13:02 BST) gives the same sun', () => {
    const utc = ukLocalToUtc('2026-06-21', 13 * 60 + 2);
    expect(utc.toISOString()).toBe('2026-06-21T12:02:00.000Z');
    expect(sunState(utc, LONDON.lat, LONDON.lon).altitudeDeg).toBeCloseTo(61.9, 1);
  });

  it('sunrise on 21 June is in the north-east (light from +x, -z) and winter noon is low', () => {
    const rise = sunState(new Date('2026-06-21T03:43:00Z'), LONDON.lat, LONDON.lon);
    expect(rise.azimuthDeg).toBeGreaterThan(40);
    expect(rise.azimuthDeg).toBeLessThan(60);
    expect(rise.direction[0]).toBeGreaterThan(0.6);
    expect(rise.direction[2]).toBeLessThan(-0.5);
    const winter = sunState(new Date('2026-12-21T11:58:00Z'), LONDON.lat, LONDON.lon);
    expect(winter.altitudeDeg).toBeGreaterThan(14.5);
    expect(winter.altitudeDeg).toBeLessThan(15.5);
  });

  it('direction formula matches the documented convention for cardinal cases', () => {
    const near = (v: number[], w: number[]) => v.forEach((c, i) => expect(c).toBeCloseTo(w[i], 9));
    near(sunDirectionThree(0, 0), [0, 0, -1]); // north horizon -> -z
    near(sunDirectionThree(90, 0), [1, 0, 0]); // east -> +x
    near(sunDirectionThree(180, 0), [0, 0, 1]); // south -> +z
    near(sunDirectionThree(123, 90), [0, 1, 0]); // zenith
  });

  it('samples a day path and projects it on the polar diagram', () => {
    const path = sunPath((m) => ukLocalToUtc('2026-06-21', m), LONDON.lat, LONDON.lon, 30);
    expect(path).toHaveLength(49);
    const noon = path.reduce((a, b) => (b.altitudeDeg > a.altitudeDeg ? b : a));
    expect(noon.minutes).toBe(13 * 60); // highest sample at 13:00 BST
    const [x0, y0] = polarPoint(0, 90, 100);
    expect(Math.hypot(x0, y0)).toBeCloseTo(0, 9);
    const [x, y] = polarPoint(180, 0, 100);
    expect(x).toBeCloseTo(0, 9);
    expect(y).toBeCloseTo(100, 9); // south horizon at the bottom
  });
});
