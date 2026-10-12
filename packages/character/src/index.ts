// @sunny/character — Sunny's canonical rig, geometry, tokens and SVG renderer.
//
// Public surface:
//   tokens     — brand colours and theme presets
//   geometry   — measured canonical proportions
//   rig        — the serialisable pose model + default pose + interpolation
//   render     — pure rig -> SVG

export * from './tokens.js';
export * from './geometry.js';
export * from './rig.js';
export * from './render.js';
export * from './view.js';
export * from './limbs.js';
export * from './boil.js';
export { TRACED_HANDS } from './traced-hands.js';
