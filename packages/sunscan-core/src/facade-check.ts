// Compile-time proof that the implementation satisfies `public.d.ts`, the
// declaration the strict root project compiles against. Checked by
// tsconfig.sunscan.json; never imported at runtime.
//
// The facade describes the spec and the mesh by a subset of their fields, so
// the checks run in the direction that matters: everything the core returns
// satisfies what the facade promises, the options a root caller passes are
// accepted, and every real spec meets the facade's description of one. The
// root only ever passes `layoutPanels` a mesh `synthesizeHouse` returned.

import type * as Facade from './public.js';
import type * as Model from './model/index.js';
import type * as Layout from './layout/index.js';
import type * as Types from './types.js';

type Assert<T extends true> = T;
type Extends<A, B> = [A] extends [B] ? true : false;

export type FacadeChecks = [
  Assert<Extends<ReturnType<typeof Model.synthesizeHouse>, Facade.HouseMesh>>,
  Assert<Extends<Types.HouseModelSpec, Facade.HouseModelSpec>>,
  Assert<Extends<ReturnType<typeof Layout.layoutPanels>, Facade.PanelLayout>>,
  Assert<Extends<Facade.PanelLayoutOptions, Parameters<typeof Layout.layoutPanels>[1]>>,
  Assert<Extends<typeof Layout.PANEL_LAYOUT, typeof Facade.PANEL_LAYOUT>>,
  Assert<Extends<Types.RoofFaceInfo, Facade.RoofFaceInfo>>,
  Assert<Extends<Types.MeshLayer, Facade.MeshLayer>>,
];
