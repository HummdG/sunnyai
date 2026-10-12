// In-browser exports. GLB (three GLTFExporter, binary, `asset.copyright` = attribution from spec.provenance, spec
// summary in extras), OBJ (Z-up), STL (binary, closed 'solid' layers only, Z-up) and the spec JSON.
// Aerial imagery, LiDAR evidence points, measuring helpers and the ground disc are never part of an export.
import { Group, type Object3D } from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import type { HouseModelSpec, LayerKind, MeshLayer } from '@sunny/sunscan-core/types';
import { attributionText, slugify } from './lib/format';
import { Z_UP_ROTATION_X } from './frames';
import type { Viewer, ToggleKey } from './Viewer';

export type ExportFormat = 'glb' | 'obj' | 'stl' | 'json';

export interface ExportResult { filename: string; bytes: number; mime: string }

const ESTIMATED_KINDS: LayerKind[] = ['openings', 'interior', 'stairs'];

export function exportFilename(spec: HouseModelSpec, ext: string): string {
  return `sunscan-${slugify(spec.address.display || spec.id)}.${ext}`;
}

/** Spec summary written to the glTF root node's extras (`sunscan`). */
export function exportExtras(spec: HouseModelSpec, engine: string) {
  return {
    sunscan: {
      schema: spec.schema, id: spec.id, address: spec.address.display, origin: spec.origin, groundElevation: spec.groundElevation,
      axes: 'x = east, y = up, z = -north (metres, glTF y-up)', builtForm: spec.builtForm, era: spec.era,
      quality: spec.quality, estimatedLayers: ESTIMATED_KINDS, synthesis: engine, generator: spec.generator, generatedAt: spec.generatedAt,
      attribution: attributionText(spec), licences: spec.provenance.map((p) => ({ id: p.id, licence: p.licence, attribution: p.attribution })),
    },
  };
}

/** The spec as downloaded: live-only layers (the non-exportable aerial imagery reference) are left out. */
export function exportableSpec(spec: HouseModelSpec): HouseModelSpec {
  const img = spec.context.imagery;
  if (!img || img.exportable) return spec;
  const { imagery: _live, ...context } = spec.context;
  return { ...spec, context };
}

/** Layers included in GLB/OBJ: everything currently switched on except the closed print solid. */
export const visibleLayerFilter = (toggles: Record<ToggleKey, boolean>) => (l: MeshLayer) => l.kind !== 'solid' && toggles[l.kind] !== false;

function zUp(obj: Object3D): Group {
  const g = new Group();
  g.rotation.x = Z_UP_ROTATION_X; // y-up three.js world -> Z-up ENU
  g.add(obj);
  g.updateMatrixWorld(true);
  return g;
}

export async function buildGlb(viewer: Viewer, spec: HouseModelSpec, engine: string): Promise<ArrayBuffer> {
  const root = viewer.exportGroup(visibleLayerFilter(viewer.getToggles()));
  root.name = 'sunscan-house';
  root.userData = exportExtras(spec, engine);
  if (!root.children.length) throw new Error('Nothing to export: switch on at least one layer.');
  const out = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true, trs: false, maxTextureSize: 1024, copyright: attributionText(spec) });
  if (!(out instanceof ArrayBuffer)) throw new Error('GLB export did not produce binary data');
  return out;
}

export function buildObj(viewer: Viewer, spec: HouseModelSpec): string {
  const root = viewer.exportGroup(visibleLayerFilter(viewer.getToggles()));
  if (!root.children.length) throw new Error('Nothing to export: switch on at least one layer.');
  const header = `# SunScan house model: ${spec.address.display}\n# Z-up metres (x = east, y = north, z = up above the ground datum)\n# ${attributionText(spec)}\n`;
  return header + new OBJExporter().parse(zUp(root));
}

export function buildStl(viewer: Viewer): DataView {
  const root = viewer.exportGroup((l) => l.kind === 'solid');
  if (!root.children.length) throw new Error('This model has no closed solid to print.');
  return new STLExporter().parse(zUp(root), { binary: true }) as DataView;
}

export function download(data: BlobPart, filename: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename, rel: 'noopener' });
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function exportModel(format: ExportFormat, viewer: Viewer, spec: HouseModelSpec, engine: string): Promise<ExportResult> {
  switch (format) {
    case 'glb': {
      const data = await buildGlb(viewer, spec, engine);
      const r = { filename: exportFilename(spec, 'glb'), bytes: data.byteLength, mime: 'model/gltf-binary' };
      download(data, r.filename, r.mime);
      return r;
    }
    case 'obj': {
      const text = buildObj(viewer, spec);
      const r = { filename: exportFilename(spec, 'obj'), bytes: text.length, mime: 'text/plain' };
      download(text, r.filename, r.mime);
      return r;
    }
    case 'stl': {
      const dv = buildStl(viewer);
      const r = { filename: exportFilename(spec, 'stl'), bytes: dv.byteLength, mime: 'model/stl' };
      download(new Uint8Array(dv.buffer as ArrayBuffer, dv.byteOffset, dv.byteLength), r.filename, r.mime);
      return r;
    }
    case 'json': {
      const text = JSON.stringify(exportableSpec(spec), null, 2);
      const r = { filename: exportFilename(spec, 'json'), bytes: text.length, mime: 'application/json' };
      download(text, r.filename, r.mime);
      return r;
    }
  }
}
