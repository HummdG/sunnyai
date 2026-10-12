// @sunny/quote-engine — SunScan v1's quote engine, ported (see PROVENANCE.md),
// plus Sunny's tenant pricing and quote-input assembly.

export * from './types.js';
export * from './solarCalculations.js';
export * from './consumption.js';
export * from './tariff.js';
export * from './mcs.js';
export * from './geometry.js';
export * from './panelLayout.js';
export * from './pricing/types.js';
export * from './pricing/computeQuote.js';
export * from './pricing/tiers.js';
export * from './pricing/tierHardware.js';
export * from './pricing/siteContext.js';
export * from './recommend/optionTypes.js';
export * from './recommend/ladderTypes.js';
export * from './recommend/sentinel.js';
export * from './recommend/evaluateConfig.js';
export * from './recommend/buildBudgetLadder.js';
export * from './recommend/buildOptionSet.js';
export * from './recommend/roofCapacity.js';
export * from './recommend/deriveGeometry.js';
export * from './input.js';
export * from './pricing-source.js';
export * from './savings-timeline.js';
