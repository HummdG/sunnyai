// Module 'model': HouseModelSpec -> HouseMesh (layers, roof faces, rooms, openings, stats, validation), the shared
// material palette, storey levels and the house exporters (GLB / OBJ / STL).
export { synthesizeHouse, type ModelSynthesisOptions } from './synthesize.js';
export { MATERIALS, type MaterialDef, wallMaterialKey, roofMaterialKey, parseHexColour, srgbToLinear, hexToLinearRgb } from './materials.js';
export { storeyLevels, inferStoreys, levelParams, type StoreyLevel, type StoreyLevelOptions, ERA_PLINTH, ERA_FLOOR_TO_FLOOR, WALL_THICKNESS, SLAB_THICKNESS } from './levels.js';
export { ERA_WINDOW, ERA_DOOR, PIER, MODULE } from './facade.js';
export { resolveInteriorProvider, type LayoutInteriorFn } from './interior-run.js';
export { NO_TAG } from './builder.js';
export { exportHouseGLB, type GLBExportOptions } from './export-glb.js';
export { exportHouseOBJ, type OBJExportOptions } from './export-obj.js';
export { exportHouseSTL, type STLExportOptions } from './export-stl.js';
export { DEFAULT_RENDER_LAYERS, DEFAULT_PRINT_LAYERS, attributionOf } from './export-common.js';
