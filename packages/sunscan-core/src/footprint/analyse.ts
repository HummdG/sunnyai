// Footprint analysis: party walls per edge + built form (spec §5.3, research 01 §3.5).
//   party piece : parallel <= 10 deg, offset <= 0.3 m, overlap >= 0.5 m
//   party edge  : >= 60 % of the edge shared (the whole edge becomes party)
//   attached    : total shared length with a dwelling-like neighbour >= 2 m
//   built form  : 0 attached -> detached; 1 -> semi-detached, or end-terrace when that neighbour is itself attached to
//                 another dwelling; 2 on opposite sides (>= 120 deg apart) -> mid-terrace; otherwise block.
//   multi-dwelling outline (a terrace row / block of flats mapped as one building) -> block, multiDwelling = true.
// Ancillary neighbours (garage, shed, ... or < 25 m2) never create party walls and never change the form.
import type { BuiltForm, EdgeKind } from '../types.js';
import { distPointSeg, pointInPolygon, ringArea, type PolygonM, type Vec2 } from '../geometry/geom.js';
import { minAreaRect } from '../geo/geo.js';
import { DEFAULT_PARTY_TOLERANCE, edgeSharing, sharedLengthBetween, type PartyTolerance } from './party.js';
import { expandHouseNumbers, isAncillaryTags } from './tags.js';

/** A neighbouring footprint (same local frame as the target). */
export interface FootprintNeighbour {
  id: string;
  footprint: PolygonM;
  tags?: Record<string, string>;
}

/** An OSM address point (node with addr:housenumber and/or addr:housename) in the target's local frame. */
export interface AddressPoint {
  xy: Vec2;
  tags: Record<string, string>;
}

/** Options of {@link analyseFootprint}. */
export interface AnalyseFootprintOptions extends Partial<PartyTolerance> {
  /** Fraction of an edge that must be shared for the whole edge to become party (default 0.6). */
  wholeEdgeFraction?: number;
  /** Total shared length (m) for a neighbour to count as attached (default 2.0). */
  attachMinShared?: number;
  /** Neighbours smaller than this (m2) are treated as ancillary (default 25). */
  minDwellingArea?: number;
  /** OSM tags of the target (multi-dwelling detection, tag cross-checks). */
  targetTags?: Record<string, string>;
  /** addr:housenumber values of address nodes already known to lie inside the target outline. */
  addressNumbersInside?: string[];
  /**
   * Address points around the target (same frame). Those at least {@link ADDRESS_INSIDE_MARGIN} m inside the outline
   * feed the multi-dwelling test (points on or next to a shared wall are digitising noise and are ignored).
   */
  addressPoints?: AddressPoint[];
}

/** Result of {@link analyseFootprint}. Arrays are indexed by target edge (outer ring edges first, then holes). */
export interface FootprintAnalysis {
  edgeKinds: EdgeKind[];
  sharedLength: number[];
  /** Ids of the neighbours sharing each edge. */
  partyNeighbours: string[][];
  builtForm: BuiltForm;
  /** Dwelling-like neighbours sharing >= attachMinShared of wall with the target, longest shared wall first. */
  attached: string[];
  sharedFraction: number[];
  sharedIntervals: [number, number][][];
  /** Ancillary/small structures touching the target (reported, but no party walls). */
  ancillaryAttached: string[];
  /** Neighbour id -> total shared length with the target (dwelling-like neighbours only). */
  sharedWith: Record<string, number>;
  /**
   * The outline probably covers several dwellings (a terrace row or a block of flats mapped as one building); the
   * built form is then 'block'. See {@link multiDwellingReason} for the rules.
   */
  multiDwelling: boolean;
  reasons: string[];
}

/** Address points closer than this (m) to the outline do not count as inside it. */
export const ADDRESS_INSIDE_MARGIN = 0.5;
/** building=* values that describe blocks of flats (several dwellings by definition). */
export const MULTI_DWELLING_BUILDINGS: ReadonlySet<string> = new Set(['apartments', 'dormitory']);
/** A row-like outline: minimum-area rectangle at least this long (m) ... */
export const ROW_MIN_LENGTH = 20;
/** ... and at least this elongated (long side / short side). */
export const ROW_MIN_ASPECT = 2.5;
/** building=terrace without an own house number counts as a whole row above this area (m2). */
export const TERRACE_ROW_MIN_AREA = 150;

const AREA = (p: PolygonM) => Math.abs(ringArea(p.outer)) - (p.holes ?? []).reduce((s, h) => s + Math.abs(ringArea(h)), 0);
const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
const angDiff = (p: number, q: number) => Math.abs(((p - q + 540) % 360) - 180);

/** Outward-normal compass azimuth (deg) of edge a->b of a ring with signed area `orient` (>0 CCW). */
function facingDeg(a: Vec2, b: Vec2, orient: number): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  // CCW ring: outward normal is to the right of travel (dy, -dx); CW ring: to the left
  const nx = orient >= 0 ? dy : -dy;
  const ny = orient >= 0 ? -dx : dx;
  return ((Math.atan2(nx, ny) * 180) / Math.PI + 360) % 360;
}

/** Distance from a point to the nearest edge of a polygon (outer ring and holes). */
function boundaryDistance(p: Vec2, poly: PolygonM): number {
  let d = Infinity;
  for (const r of [poly.outer, ...(poly.holes ?? [])]) for (let i = 0; i < r.length; i++) d = Math.min(d, distPointSeg(p, r[i], r[(i + 1) % r.length]));
  return d;
}

/** Address label of a point: house number (with suffix) and/or house name, normalised; '' if none. */
const addressLabel = (tags: Record<string, string>) =>
  [tags['addr:housenumber'], tags['addr:housename']].filter((s) => s && s.trim()).map((s) => s.trim().toLowerCase().replace(/\s+/g, ' ')).join('|');

/**
 * Why the target outline probably covers several dwellings, or null. Rules, in order:
 *  (a) its own addr:housenumber lists several numbers ("1-3", "10;12");
 *  (b) a block-of-flats tag (building=apartments | dormitory);
 *  (c) >= 2 distinct house numbers on it: with its own single number, the first number of every address point inside
 *      counts (own 48 + a museum node "48-49" stays one dwelling); without one, every number listed inside counts;
 *  (d) a row-like outline (>= ROW_MIN_LENGTH m, >= ROW_MIN_ASPECT : 1) with >= 2 distinct address labels inside
 *      (house numbers with suffixes or house names, e.g. a row of named cottages);
 *  (e) building=terrace without an own number covering more than TERRACE_ROW_MIN_AREA m2.
 */
export function multiDwellingReason(
  target: PolygonM, tags: Record<string, string> | undefined, numbersInside: string[] = [], points: AddressPoint[] = [],
): string | null {
  const ownTag = tags?.['addr:housenumber'];
  const own = expandHouseNumbers(ownTag);
  const building = (tags?.building ?? '').toLowerCase();
  if (own.length > 1) return `own addr:housenumber "${ownTag}" lists ${own.length} numbers`;
  if (MULTI_DWELLING_BUILDINGS.has(building)) return `building=${building} (block of flats)`;

  const inside = points.filter((p) => pointInPolygon(p.xy, target) && boundaryDistance(p.xy, target) >= ADDRESS_INSIDE_MARGIN);
  const values = [...numbersInside, ...inside.map((p) => p.tags['addr:housenumber']).filter((s): s is string => !!s)];
  const numbers = new Set<number>(own);
  for (const v of values) {
    const n = expandHouseNumbers(v);
    if (own.length === 1) { if (n.length) numbers.add(n[0]); } else for (const x of n) numbers.add(x);
  }
  if (numbers.size > 1) {
    const list = [...numbers].sort((x, y) => x - y).join(',');
    return own.length === 1
      ? `address points inside carry ${numbers.size} different house numbers (${list}), own number ${own[0]}`
      : `${numbers.size} different house numbers on address points inside (${list})`;
  }

  const area = AREA(target);
  const labels = new Set(inside.map((p) => addressLabel(p.tags)).filter(Boolean));
  if (labels.size > 1 && target.outer.length >= 3) {
    const r = minAreaRect(target.outer);
    if (r.length >= ROW_MIN_LENGTH && r.length >= ROW_MIN_ASPECT * Math.max(r.width, 1e-9)) {
      return `row-like outline (${r.length.toFixed(1)} x ${r.width.toFixed(1)} m) with ${labels.size} different address points inside`;
    }
  }
  if (own.length === 0 && building === 'terrace' && area > TERRACE_ROW_MIN_AREA) return `building=terrace, no own address, ${Math.round(area)} m2`;
  return null;
}

/**
 * Party walls, per-edge kinds and built form of `target` among `neighbours` (all in the same local metric frame).
 * The returned arrays follow the caller's vertex order; edges that are not party are 'eave' (gables are a roof decision).
 */
export function analyseFootprint(target: PolygonM, neighbours: FootprintNeighbour[], opts: AnalyseFootprintOptions = {}): FootprintAnalysis {
  const tol: PartyTolerance = {
    offsetTol: opts.offsetTol ?? DEFAULT_PARTY_TOLERANCE.offsetTol,
    angleTolDeg: opts.angleTolDeg ?? DEFAULT_PARTY_TOLERANCE.angleTolDeg,
    minOverlap: opts.minOverlap ?? DEFAULT_PARTY_TOLERANCE.minOverlap,
  };
  const wholeFrac = opts.wholeEdgeFraction ?? 0.6;
  const attachMin = opts.attachMinShared ?? 2.0;
  const minArea = opts.minDwellingArea ?? 25;
  const rings = [target.outer, ...(target.holes ?? [])];
  const reasons: string[] = [];

  const dwelling = (n: FootprintNeighbour) => !isAncillaryTags(n.tags) && AREA(n.footprint) >= minArea;
  const partyCapable = neighbours.filter(dwelling);
  const sharing = edgeSharing(rings, partyCapable.map((n) => ({ id: n.id, ring: n.footprint.outer })), tol);

  const edgeKinds: EdgeKind[] = sharing.map((e) => (e.length > 0 && e.fraction >= wholeFrac ? 'party' : 'eave'));
  const partial = sharing.filter((e) => e.shared >= tol.minOverlap && e.fraction < wholeFrac).length;
  if (partial) reasons.push(`${partial} edge(s) partly shared (< ${Math.round(wholeFrac * 100)} %): kept as external walls`);

  const sharedWith: Record<string, number> = {};
  for (const e of sharing) for (const [id, len] of e.byNeighbour) sharedWith[id] = (sharedWith[id] ?? 0) + len;
  const attached = Object.entries(sharedWith).filter(([, v]) => v >= attachMin).sort((x, y) => y[1] - x[1]).map(([k]) => k);
  const ancillaryAttached = neighbours
    .filter((n) => !dwelling(n))
    .filter((n) => rings.some((r) => sharedLengthBetween(r, n.footprint.outer, tol) >= attachMin))
    .map((n) => n.id);

  // built form
  let builtForm: BuiltForm = 'unknown';
  const multi = multiDwellingReason(target, opts.targetTags, opts.addressNumbersInside, opts.addressPoints);
  if (multi) {
    builtForm = 'block';
    reasons.push(`target outline probably covers several dwellings: ${multi}`);
  } else if (attached.length === 0) {
    builtForm = 'detached';
    reasons.push(`no wall shared (>= ${attachMin} m, <= ${tol.offsetTol} m offset) with another dwelling-sized building`);
  } else if (attached.length === 1) {
    const nb = partyCapable.find((n) => n.id === attached[0])!;
    const others = partyCapable.filter((p) => p.id !== nb.id && sharedLengthBetween(nb.footprint.outer, p.footprint.outer, tol) >= attachMin);
    if (others.length) {
      builtForm = 'end-terrace';
      reasons.push(`attached to ${nb.id}, which is itself attached to ${others.map((p) => p.id).join(', ')}`);
    } else {
      builtForm = 'semi-detached';
      reasons.push(`attached only to ${nb.id}, which has no other attached dwelling`);
    }
  } else {
    // length-weighted mean outward normal of the walls shared with each attached neighbour
    const facing = attached.map((id) => {
      let sx = 0;
      let sy = 0;
      let k = 0;
      rings.forEach((ring) => {
        const orient = ringArea(ring);
        for (let i = 0; i < ring.length; i++, k++) {
          const len = sharing[k].byNeighbour.get(id) ?? 0;
          if (!len) continue;
          const f = (facingDeg(ring[i], ring[(i + 1) % ring.length], orient) * Math.PI) / 180;
          sx += Math.sin(f) * len;
          sy += Math.cos(f) * len;
        }
      });
      return { id, az: ((Math.atan2(sx, sy) * 180) / Math.PI + 360) % 360 };
    });
    if (attached.length === 2 && angDiff(facing[0].az, facing[1].az) >= 120) {
      builtForm = 'mid-terrace';
      reasons.push(`attached on opposite sides to ${facing.map((f) => `${f.id} (facing ${Math.round(f.az)} deg)`).join(' and ')}`);
    } else {
      builtForm = 'block';
      reasons.push(`attached to ${attached.length} dwellings: ${facing.map((f) => `${f.id} (facing ${Math.round(f.az)} deg)`).join(', ')}`);
    }
  }
  if (ancillaryAttached.length) reasons.push(`touches ancillary/small structure(s) (no party wall): ${ancillaryAttached.join(', ')}`);
  const hint = tagHint(opts.targetTags);
  if (hint && hint !== builtForm && !(hint === 'terrace' && (builtForm === 'mid-terrace' || builtForm === 'end-terrace'))) {
    reasons.push(`note: OSM tags suggest ${hint}`);
  }
  return {
    edgeKinds,
    sharedLength: sharing.map((e) => round(e.shared)),
    partyNeighbours: sharing.map((e) => [...e.byNeighbour.keys()].filter((id) => (e.byNeighbour.get(id) ?? 0) >= tol.minOverlap)),
    builtForm,
    attached,
    sharedFraction: sharing.map((e) => round(e.fraction)),
    sharedIntervals: sharing.map((e) => e.intervals.map(([x, y]) => [round(x), round(y)] as [number, number])),
    ancillaryAttached,
    sharedWith: Object.fromEntries(Object.entries(sharedWith).map(([k, v]) => [k, round(v)])),
    multiDwelling: multi !== null,
    reasons,
  };
}

function tagHint(tags: Record<string, string> | undefined): string | undefined {
  const b = tags?.building;
  const h = tags?.house;
  if (b === 'semidetached_house' || h === 'semi-detached' || h === 'semi_detached') return 'semi-detached';
  if (b === 'detached' || h === 'detached') return 'detached';
  if (h === 'terraced' || h === 'terrace') return 'terrace';
  return undefined;
}
