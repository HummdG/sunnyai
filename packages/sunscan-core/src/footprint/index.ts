// Module 'footprint' (spec §6): party walls + built form, regularisation, street-facing edge, WGS84 <-> local helpers.
// Pure TypeScript, browser-safe, no I/O.
export {
  analyseFootprint, multiDwellingReason, ADDRESS_INSIDE_MARGIN, MULTI_DWELLING_BUILDINGS, ROW_MIN_LENGTH, ROW_MIN_ASPECT,
  TERRACE_ROW_MIN_AREA, type AddressPoint, type AnalyseFootprintOptions, type FootprintAnalysis, type FootprintNeighbour,
} from './analyse.js';
export {
  sharedPiecesOnEdge, sharedLengthBetween, unionIntervals, edgeSharing, DEFAULT_PARTY_TOLERANCE,
  type PartyTolerance, type SharedPiece, type EdgeSharing,
} from './party.js';
export {
  regularizeFootprint, regularizeFootprintDetailed, mapEdgeKinds, type RegularizeOptions, type RegularizeResult,
} from './regularize.js';
export { frontEdge, type FrontEdgeOptions, type FrontEdgeResult, type FrontRoad } from './front.js';
export {
  lonLatToLocal, localToLonLat, polygonToLocal, frameAtCentroid, openLonLatRing, type LocalFrame, type LonLat,
} from './frame.js';
export { ANCILLARY_BUILDINGS, isAncillaryTags, expandHouseNumbers, normaliseStreetName } from './tags.js';
