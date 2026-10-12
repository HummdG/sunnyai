// Straight-flight stairs (Approved Document K, private stair) and their position in the circulation strip.
import { INTERIOR_RULES as RULES } from './constants.js';

/** One flight from storey `storey` to `storey + 1`. */
export interface FlightSpec {
  storey: number;
  /** Floor-to-floor height climbed (m). */
  ff: number;
  risers: number;
  rise: number;
  going: number;
  /** Plan length of the flight = (risers - 1) x going (the top riser lands on the upper floor). */
  length: number;
}

/**
 * Number of risers for a floor-to-floor height: n = ceil(ff / 0.20) (rise <= 200 mm, i.e. <= 220 mm and
 * pitch <= 41.6 deg with the 225 mm going). A 1e-9 guard keeps exact multiples of 0.2 m at rise = 200 mm.
 */
export function stairRisers(ff: number): number {
  return Math.max(2, Math.ceil(ff / RULES.maxRise - 1e-9));
}

/** Flights for every storey transition of `levels` (floor-to-floor = difference of floor levels). */
export function flightSpecs(levels: { floorZ: number }[], storeys: number, warnings: string[]): FlightSpec[] {
  const out: FlightSpec[] = [];
  for (let s = 0; s + 1 < storeys; s++) {
    const ff = levels[s + 1].floorZ - levels[s].floorZ;
    if (!(ff > 0.5) || !(ff < 10)) {
      warnings.push(`storey ${s}: floor-to-floor height ${ff.toFixed(2)} m is implausible; no stair generated`);
      continue;
    }
    const risers = stairRisers(ff);
    out.push({ storey: s, ff, risers, rise: ff / risers, going: RULES.going, length: (risers - 1) * RULES.going });
  }
  return out;
}

/**
 * First-riser position (depth from the front of the plan rectangle) shared by all flights:
 * 1.2 m (2.0 m with a box room over the front lobby), pulled forward to keep a 1.0 m landing at the
 * stair head, never closer than 0.6 m (prototype rule). If even then the longest flight overruns the
 * depth it is moved to the back wall; if it is longer than the depth, the going is scaled down and
 * the result flagged (pitch beyond Approved Document K).
 */
export function placeFlights(D: number, flights: FlightSpec[], boxRoom: boolean, warnings: string[]): { yS0: number; yTop: number } {
  const Ls = flights.reduce((m, f) => Math.max(m, f.length), 0);
  let yS0 = Math.min(boxRoom ? RULES.stairStartBoxRoom : RULES.stairStart, Math.max(RULES.minStairStart, D - Ls - RULES.stairHeadLanding));
  if (!flights.length) return { yS0, yTop: yS0 };
  if (yS0 + Ls > D + 1e-9) {
    if (Ls <= D) {
      yS0 = Math.max(0, D - Ls);
      warnings.push(`stair: the ${Ls.toFixed(2)} m straight flight leaves no landing in the ${D.toFixed(2)} m deep plan (quarter-landing stair likely)`);
    } else {
      const k = D / Ls;
      for (const f of flights) {
        f.going *= k;
        f.length *= k;
      }
      yS0 = 0;
      warnings.push(`stair: straight flight does not fit the ${D.toFixed(2)} m deep plan; going reduced to ${(RULES.going * k * 1000).toFixed(0)} mm (beyond Approved Document K)`);
    }
  } else if (D - (yS0 + Ls) < 0.9 - 1e-9) {
    warnings.push(`stair: only ${(D - yS0 - Ls).toFixed(2)} m of landing beyond the stair head`);
  }
  const top = flights.reduce((m, f) => Math.max(m, f.length), 0);
  return { yS0, yTop: yS0 + top };
}
