/**
 * What an installer may and may not do to Sunny's own (preset) questions.
 *
 * The questions themselves, their option values and their conditions live in
 * `questionnaire.ts`; this module holds only the editing rules layered on top.
 */

/**
 * The questions every conversation starts with, in this order. They cannot be
 * removed or moved: without an address and a roof check there is no quote.
 * A stored flow that lists them is reworded at most, never reordered.
 */
export const FIXED_START = ['address', 'roof_confidence', 'roof_confirmed'] as const;

/**
 * Fixed-start answers Sunny sets itself, never asked of the visitor (how sure
 * the roof mapping is). They steer the conversation but are not something the
 * visitor told the installer, so a lead's answers leave them out.
 */
export const SYSTEM_SET: ReadonlySet<string> = new Set(['roof_confidence']);

/**
 * Presets that travel with another preset: placed right after it, and removed
 * with it. The key is the preset a stored flow lists; the members follow.
 *
 * The usage follow-ups only make sense after "how would you like to tell me
 * about your electricity use?". The roof fallback pair (size and direction)
 * are one step in SunScan's journey and both stay conditional on an uncertain
 * roof mapping wherever the installer puts them.
 */
export const PRESET_GROUPS: Readonly<Record<string, readonly string[]>> = {
  usage_source: ['annual_kwh', 'monthly_cost', 'household_size'],
  roof_size: ['roof_direction'],
};

/**
 * The removal warning for each preset the quote depends on, shown in Studio
 * before the installer removes it. A preset absent here feeds only the lead.
 */
export const PRESET_WARNINGS: Readonly<Record<string, string>> = {
  roof_shading:
    'Sunny uses this to allow for shade. Without it, quotes assume no shading, so generation and savings may be too high.',
  roof_size:
    'Sunny uses this when it cannot map the roof. Without it, quotes assume a medium roof.',
  roof_direction:
    'Sunny uses this when it cannot map the roof. Without it, quotes assume a south-facing roof, so savings may be too high.',
  usage_source:
    "Sunny uses this to work out savings. Without it, quotes use a typical UK household's usage, so the savings figures will be rougher.",
  lifestyle:
    'Sunny uses this to judge whether a battery and Sentinel suit the home. Without it, those recommendations are more general.',
  tariff_type:
    'Sunny uses this for savings and Sentinel. Without it, quotes assume a standard tariff.',
  existing_system:
    'Sunny uses this to spot homes that already have solar or a battery. Without it, quotes assume a new installation.',
  budget_band: 'Sunny uses this to flag packages over budget. Without it, no package is flagged.',
};

/**
 * A short lower-case topic per price-dependent preset (same keys as
 * `PRESET_WARNINGS`), for a visitor-facing sentence such as "your installer
 * does not ask about roof shading and electricity use".
 */
export const PRESET_TOPICS: Readonly<Record<string, string>> = {
  roof_shading: 'roof shading',
  roof_size: 'roof size',
  roof_direction: 'which way the roof faces',
  usage_source: 'electricity use',
  lifestyle: 'lifestyle',
  tariff_type: 'electricity tariff',
  existing_system: 'existing solar or batteries',
  budget_band: 'budget',
};
