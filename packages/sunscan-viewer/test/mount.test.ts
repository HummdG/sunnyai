import { describe, expect, it } from 'vitest';

import { mountRoofViewer } from '../src/index';
import { synthesize } from '../src/synthesize';
import { forthlinSpec } from './fixtures';

// The viewer needs WebGL, which Node has not got; what can be checked here is everything around the canvas:
// that the spec the API serves rebuilds into a mesh whose roof planes carry the ids the highlight uses.
describe('the embedded roof viewer', () => {
  it('rebuilds the served spec into a mesh with tagged, highlightable roof planes', () => {
    const { mesh } = synthesize(forthlinSpec);
    const roofFaces = mesh.roofFaces.filter((f) => f.kind === 'roof');
    expect(roofFaces.length).toBeGreaterThanOrEqual(2);
    const skin = mesh.layers.filter((l) => l.kind === 'roof-skin');
    expect(skin.length).toBeGreaterThan(0);
    const tags = new Set(skin.flatMap((l) => [...(l.triangleTags ?? [])]));
    for (const face of roofFaces) expect(tags.has(face.id), `face ${face.id} is tagged`).toBe(true);
  });

  it('refuses anything that is not a SunScan house model before touching WebGL', () => {
    const host = {} as HTMLElement;
    expect(() => mountRoofViewer(host, { spec: { schema: 'something-else' } })).toThrow(/Not a SunScan house model/);
    expect(() => mountRoofViewer(host, { spec: null })).toThrow();
  });
});
