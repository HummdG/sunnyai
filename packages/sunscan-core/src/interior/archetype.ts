// UK archetype room programmes on a rectangle (port of plan_storey in research/methods/roofit/layout.py).
// Coordinates are rectangle-local: x in [0, W] along the front wall, y in [0, D] from the front wall.
import type { BuiltForm } from '../types.js';
import { INTERIOR_RULES as RULES } from './constants.js';
import type { PartySides } from './frame.js';
import type { Rect } from './lir.js';

/** Plan archetype (research 05 §7.4): side-hall terrace / semi, central-hall or side-hall detached, spine bungalow. */
export type Archetype = 'terrace' | 'semi' | 'detached' | 'bungalow';
/** Circulation side: strip along the left (x = 0) or right (x = W) wall, or a central spine. */
export type Side = 'L' | 'R' | 'C';
/** Semantic class of a room: drives doors (circulation), NDSS checks/numbering (bedroom) and validity checks. */
export type RoomKind = 'circulation' | 'bedroom' | 'bathroom' | 'habitable' | 'service';

/** A labelled rectangle that seeds a room (the room may grow by absorbing leftover slivers). */
export interface Seed {
  rect: Rect;
  label: string;
  kind: RoomKind;
  /** Stable slot name, unique per storey and part (used in room ids). */
  slot: string;
  /** Sort key for bedroom numbering within a storey. */
  order: number;
}

/** Inputs of the main-block programme (all in rectangle-local metres). */
export interface MainPlan {
  W: number;
  D: number;
  storeys: number;
  arch: Archetype;
  side: Side;
  boxRoom: boolean;
  /** Stair: first riser at y = yS0, stair head at y = yTop, flight x-range [sx0, sx0 + stairWidth]. */
  yS0: number;
  yTop: number;
  /** Storeys (from the ground) on which an attached rear part / wing provides kitchen or bathroom. */
  rearStoreys: number;
}

const seed = (x0: number, x1: number, y0: number, y1: number, label: string, kind: RoomKind, slot: string, order = 0): Seed =>
  ({ rect: { x0, x1, y0, y1 }, label, kind, slot, order });

/** Python's round() (half to even), so band splits match the prototype bit for bit. */
export function roundHalfEven(v: number): number {
  const f = Math.floor(v), d = v - f;
  if (d === 0.5) return f % 2 === 0 ? f : f + 1;
  return Math.round(v);
}

/** Archetype from the built form and storey count; 'unknown'/'block' fall back on the party-wall count. */
export function chooseArchetype(form: BuiltForm, storeys: number, party: PartySides): Archetype {
  if (storeys <= 1) return 'bungalow';
  if (form === 'mid-terrace' || form === 'end-terrace') return 'terrace';
  if (form === 'semi-detached') return 'semi';
  if (form === 'detached' || form === 'block') return 'detached';
  const n = Number(party.left) + Number(party.right);
  return n === 2 ? 'terrace' : n === 1 ? 'semi' : 'detached';
}

/**
 * Circulation side: terrace -> the outrigger side (else the left party wall, else the right one);
 * semi -> the party wall; detached -> central if W >= 8.5 m else left; bungalow -> central spine
 * (side hall when narrower than 4.7 m). `rearX` is the rear part's x-range when it sits behind the block.
 */
export function chooseSide(arch: Archetype, W: number, party: PartySides, rearX?: [number, number]): Side {
  const partySide: Side = party.left ? 'L' : party.right ? 'R' : 'L';
  if (arch === 'bungalow') return W >= RULES.bungalowSpineMinWidth ? 'C' : partySide;
  if (arch === 'terrace') {
    if (rearX) {
      const dL = rearX[0], dR = W - rearX[1];
      if (Math.abs(dL - dR) > 0.3) return dL < dR ? 'L' : 'R';
    }
    return partySide;
  }
  if (arch === 'semi') return partySide;
  return W >= RULES.centralHallMinWidth ? 'C' : 'L';
}

/** Ground-hall / upper-strip x-range for a storey. */
export function stripRange(p: MainPlan, ground: boolean): [number, number] {
  const { W, side } = p;
  const wc = ground
    ? p.arch === 'bungalow'
      ? RULES.bungalowHallWidth
      : side !== 'C'
        ? Math.min(RULES.maxSideHallWidth, Math.max(RULES.hallWidth, W - RULES.sideHallWidthOffset))
        : RULES.hallWidth
    : RULES.landingStripWidth;
  return side === 'L' ? [0, wc] : side === 'R' ? [W - wc, W] : [W / 2 - wc / 2, W / 2 + wc / 2];
}

/** x of the stair's left side: against the hall wall on the circulation side (same on every storey). */
export function stairX(p: MainPlan): number {
  const [cx0, cx1] = stripRange(p, true);
  return p.side === 'R' ? cx1 - RULES.stairWidth : cx0;
}

/** Room seeds of one storey of the main block (research 05 §7.4 steps 2-7, prototype plan_storey). */
export function mainSeeds(p: MainPlan, storey: number): Seed[] {
  const { W, D, side } = p;
  const bungalow = p.arch === 'bungalow';
  const ground = storey === 0;
  const rearHere = storey < p.rearStoreys;
  const [cx0, cx1] = stripRange(p, ground);
  const ySplit = roundHalfEven(D * 0.5 * 4) / 4;
  const circ = ground ? 'hall' : 'landing';
  const strip: Seed[] = [];
  if (!ground && p.boxRoom) {
    const yb = p.yS0 + RULES.boxRoomOverhang;
    strip.push(seed(cx0, cx1, 0, yb, 'box room', 'habitable', 'box'), seed(cx0, cx1, yb, D, circ, 'circulation', circ));
  } else strip.push(seed(cx0, cx1, 0, D, circ, 'circulation', circ));
  const zones: [number, number][] = side === 'L' ? [[cx1, W]] : side === 'R' ? [[0, cx0]] : [[0, cx0], [cx1, W]];
  const bathNeeded = (!ground && storey === 1) || (bungalow && ground);
  // the rear part's upper storey hosts the bathroom (bungalow rear parts are kitchens: bathroom stays here)
  let bathDone = bathNeeded && rearHere && !bungalow;
  const zoneRooms: Seed[] = [];
  zones.forEach(([zx0, zx1], zi) => {
    const zw = zx1 - zx0;
    let fl: [string, RoomKind], bl: [string, RoomKind];
    if (ground) {
      if (bungalow) {
        fl = zones.length === 1 ? ['kitchen / living', 'habitable'] : zi === 0 ? ['living room', 'habitable'] : rearHere ? ['dining room', 'habitable'] : ['kitchen / diner', 'habitable'];
        bl = ['bedroom', 'bedroom'];
      } else if (side === 'C') {
        fl = zi === 0 ? ['living room', 'habitable'] : ['dining room', 'habitable'];
        bl = zi === 0 ? ['study / utility', 'habitable'] : rearHere ? ['family room', 'habitable'] : ['kitchen', 'habitable'];
      } else {
        fl = ['front room / living', 'habitable'];
        bl = rearHere ? ['dining room', 'habitable'] : ['kitchen / diner', 'habitable'];
      }
    } else {
      fl = ['bedroom', 'bedroom'];
      bl = ['bedroom', 'bedroom'];
    }
    const front = seed(zx0, zx1, 0, ySplit, fl[0], fl[1], `z${zi}f`, 2 * zi);
    const back = seed(zx0, zx1, ySplit, D, bl[0], bl[1], `z${zi}b`, 2 * zi + 1);
    let parts: Seed[] = [front, back];
    if (ground && !bungalow && side !== 'C' && !rearHere && zw >= RULES.kitchenSplitMinWidth) {
      const kw = RULES.kitchenWidth; // wide back band: kitchen next to the hall + dining room
      parts = side === 'L'
        ? [front, seed(zx0, zx0 + kw, ySplit, D, 'kitchen', 'habitable', `z${zi}k`, 2 * zi + 1), seed(zx0 + kw, zx1, ySplit, D, 'dining room', 'habitable', `z${zi}d`, 2 * zi + 1)]
        : [front, seed(zx1 - kw, zx1, ySplit, D, 'kitchen', 'habitable', `z${zi}k`, 2 * zi + 1), seed(zx0, zx1 - kw, ySplit, D, 'dining room', 'habitable', `z${zi}d`, 2 * zi + 1)];
    }
    if (bathNeeded && !bathDone && zi === zones.length - 1 && zw >= RULES.bathroomBandMinWidth) {
      const bw = RULES.bathroomDepth; // bathroom 2.2 m off the back band, next to the strip
      const rest = { ...back };
      parts = side !== 'R'
        ? [front, seed(zx0, zx0 + bw, ySplit, D, 'bathroom', 'bathroom', `z${zi}w`), { ...rest, rect: { x0: zx0 + bw, x1: zx1, y0: ySplit, y1: D } }]
        : [front, seed(zx1 - bw, zx1, ySplit, D, 'bathroom', 'bathroom', `z${zi}w`), { ...rest, rect: { x0: zx0, x1: zx1 - bw, y0: ySplit, y1: D } }];
      bathDone = true;
    }
    zoneRooms.push(...parts);
  });
  if (bathNeeded && !bathDone) {
    const last = strip[strip.length - 1];
    const yHead = p.storeys > 1 ? p.yTop : 0;
    const yb = D - RULES.bathroomDepth;
    if (yb - Math.max(ySplit, yHead) >= 0 && yb - ySplit >= RULES.minLandingBeforeBathroom && yb - last.rect.y0 >= RULES.minRoomWidth) {
      strip[strip.length - 1] = { ...last, rect: { ...last.rect, y1: yb } };
      strip.push(seed(cx0, cx1, yb, D, 'bathroom', 'bathroom', 'bath'));
    } else {
      // last resort: the smallest back-band room becomes the bathroom
      let best: Seed | null = null;
      for (const s of zoneRooms)
        if (s.rect.y0 >= ySplit - 1e-9 && (!best || area(s.rect) < area(best.rect) - 1e-12)) best = s;
      if (best) { best.label = 'bathroom'; best.kind = 'bathroom'; }
    }
  }
  return [...strip, ...zoneRooms];
}

const area = (r: Rect) => (r.x1 - r.x0) * (r.y1 - r.y0);

/**
 * Rear part / outrigger programme on a w x d rectangle whose y = 0 side faces the main block:
 * ground = kitchen (+ utility / WC 1.8 m at the far end when d >= 4.5 m); upper storeys = bathroom
 * (behind a bedroom when d >= 4.6 m and w >= 2.15 m). Too small (< 1.2 m) -> one store room.
 */
export function rearSeeds(w: number, d: number, storey: number, slot = 'rear'): Seed[] {
  const o = 10;
  if (!rearViable(w, d)) return [seed(0, w, 0, d, 'store', 'service', `${slot}0`, o)];
  if (storey === 0)
    return d >= RULES.rearUtilityMinDepth
      ? [seed(0, w, 0, d - RULES.rearUtilityDepth, 'kitchen', 'habitable', `${slot}0`, o), seed(0, w, d - RULES.rearUtilityDepth, d, 'utility / WC', 'service', `${slot}1`, o + 1)]
      : [seed(0, w, 0, d, 'kitchen', 'habitable', `${slot}0`, o)];
  return d >= RULES.rearBedroomMinDepth && w >= RULES.ndssMinWidth
    ? [seed(0, w, 0, d - RULES.bathroomDepth, 'bedroom', 'bedroom', `${slot}0`, o), seed(0, w, d - RULES.bathroomDepth, d, 'bathroom', 'bathroom', `${slot}1`, o + 1)]
    : [seed(0, w, 0, d, 'bathroom', 'bathroom', `${slot}0`, o)];
}

/** True when a rear rectangle is big enough to host the kitchen / bathroom programme. */
export const rearViable = (w: number, d: number) => w >= RULES.rearMinSize && d >= RULES.rearMinSize;

/** Label of a leftover room (outside the main rectangle) by storey and size. */
export function extraSeed(rect: Rect, ground: boolean, slot: string): Seed {
  const a = area(rect);
  const o = 20;
  if (a < 3.5) return seed(rect.x0, rect.x1, rect.y0, rect.y1, 'store', 'service', slot, o);
  if (ground)
    return a < 10 ? seed(rect.x0, rect.x1, rect.y0, rect.y1, 'utility', 'service', slot, o) : seed(rect.x0, rect.x1, rect.y0, rect.y1, 'other', 'habitable', slot, o);
  return seed(rect.x0, rect.x1, rect.y0, rect.y1, 'bedroom', 'bedroom', slot, o);
}

/**
 * Compact plan for storeys too small for the strip archetype (W < 2.75 m or D < 4 m): one room per
 * storey, plus a 2.2 m bathroom across the deeper axis where one is required and fits.
 */
export function compactSeeds(W: number, D: number, storey: number, storeys: number): Seed[] {
  const ground = storey === 0;
  const main: [string, RoomKind] = ground ? (storeys === 1 ? ['living room / bedroom', 'habitable'] : ['living room', 'habitable']) : ['bedroom', 'bedroom'];
  const bathNeeded = (storeys === 1 && ground) || storey === 1;
  const b = RULES.bathroomDepth;
  if (bathNeeded && D - b >= 2.0 && W >= RULES.minRoomWidth)
    return [seed(0, W, 0, D - b, main[0], main[1], 'c0'), seed(0, W, D - b, D, 'bathroom', 'bathroom', 'c1')];
  if (bathNeeded && W - b >= 2.0 && D >= RULES.minRoomWidth)
    return [seed(0, W - b, 0, D, main[0], main[1], 'c0'), seed(W - b, W, 0, D, 'bathroom', 'bathroom', 'c1')];
  return [seed(0, W, 0, D, main[0], main[1], 'c0')];
}
