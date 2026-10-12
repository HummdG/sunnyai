// @sunny/character-rive — plays the animator-authored Rive Sunny (ADR-007).
//
// Public surface:
//   contract — every name the code reads or writes inside the .riv file
//   mount    — mountRiveSunny(host, options) -> controller
//   connect  — connectAnimator(controller, animator): app behaviour -> Rive state

export * from './contract.js';
export * from './mount.js';
export * from './connect.js';
export type { RiveRuntimeLike, RiveInstanceLike, ViewModelInstanceLike } from './runtime.js';
export { loadCanvasLite } from './runtime.js';
