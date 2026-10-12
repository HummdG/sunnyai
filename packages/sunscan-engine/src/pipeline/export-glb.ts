// House GLB for the CLI (and any server-side export): core/model `exportHouseGLB(synthesizeHouse(spec), spec)` —
// glTF 2.0 binary, y-up (x = E, y = U, z = −N), one node per rendered layer, palette materials, provenance in
// asset.copyright and the root extras. Optional live layers (spec.context.imagery) are never part of the file.
import type { HouseMesh, HouseModelSpec } from '@sunny/sunscan-core';
import { exportHouseGLB, synthesizeHouse, type GLBExportOptions } from '@sunny/sunscan-core/model';

/** Result of {@link exportHouseGlb}. */
export interface GlbExport {
  glb: Uint8Array;
  /** Exporter id (recorded in report.md). */
  method: string;
  /** Mesh validation issues reported by core/model. */
  issues: string[];
  mesh: HouseMesh;
}

/** Exporter id of {@link exportHouseGlb}. */
export const GLB_METHOD = 'core/model exportHouseGLB';

/** Synthesize the house mesh with core/model and export it as GLB. */
export function exportHouseGlb(spec: HouseModelSpec, opts: GLBExportOptions = {}): GlbExport {
  const mesh = synthesizeHouse(spec);
  return { glb: exportHouseGLB(mesh, spec, opts), method: GLB_METHOD, issues: mesh.validation.issues, mesh };
}
