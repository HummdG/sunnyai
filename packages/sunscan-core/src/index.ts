// @sunscan/core — isomorphic (browser + Node), no I/O.
// Shared contracts at the top level; each module is namespaced to avoid name clashes.
// Deep imports are also available: '@sunny/sunscan-core/geometry', '@sunny/sunscan-core/fit', ...
export * from './types.js';
export * as geometry from './geometry/index.js';
export * as geo from './geo/index.js';
export * as fit from './fit/index.js';
export * as model from './model/index.js';
export * as interior from './interior/index.js';
export * as footprint from './footprint/index.js';
