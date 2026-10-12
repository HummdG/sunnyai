// Module 'interior': indicative UK-archetype floor plans (rooms, internal walls with doors, stairs) per storey.
// Interiors are not in any open dataset: every output is an ESTIMATE (RoomInfo.estimated = true).
/** layoutInterior(input: InteriorInput): InteriorLayout - the module's entry point (see layout.ts). */
export { layoutInterior } from './layout.js';
/** Planning dimensions/thresholds and the labels of circulation spaces. */
export { INTERIOR_RULES, CIRCULATION_LABELS } from './constants.js';
/** Riser count of a straight flight for a floor-to-floor height (ceil(ff / 0.20)). */
export { stairRisers } from './stairs.js';
