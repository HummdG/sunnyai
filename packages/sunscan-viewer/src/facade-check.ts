// Compile-time proof that the implementation satisfies `public.d.ts`, the
// declaration the strict root project compiles against. Checked by
// tsconfig.sunscan.json; never imported at runtime.

import type * as Facade from './public.js';
import type * as Impl from './index';

type Assert<T extends true> = T;
type Extends<A, B> = [A] extends [B] ? true : false;

export type FacadeChecks = [
  Assert<Extends<typeof Impl.mountRoofViewer, typeof Facade.mountRoofViewer>>,
  Assert<Extends<Facade.RoofViewerOptions, Impl.RoofViewerOptions>>,
  Assert<Extends<Impl.RoofViewerHandle, Facade.RoofViewerHandle>>,
];
