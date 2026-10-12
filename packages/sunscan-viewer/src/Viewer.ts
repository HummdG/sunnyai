// three.js viewer: WebGL2 renderer (PCF shadows), orbit / walk / measure modes, layer toggles, storey cutaway via a
// clipping plane, a suncalc-driven shadow-casting sun, LiDAR evidence points, and on-demand rendering.
import {
  Box3, BufferAttribute, BufferGeometry, Color, DirectionalLight, DoubleSide, Fog, Group, HemisphereLight, Mesh, MeshBasicMaterial,
  NeutralToneMapping, PCFShadowMap, PerspectiveCamera, Plane,
  Points, Scene, Timer, Vector3, WebGLRenderer, type Material, type Object3D,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { HouseMesh, HouseModelSpec, LayerKind, MeshLayer } from '@sunny/sunscan-core/types';
import { CONTEXT_KEYS, MaterialLibrary, resolvePalette } from './materials';
import { layerProblem, layerToGeometry } from './meshAdapter';
import { evidencePoints, groundDisc, imageryPlane } from './context';
import { WalkController, type WalkKey } from './walk';
import { MeasureTool, type MeasureResult } from './measure';
import { bearingOfThreeDir } from './frames';
import type { SunState } from './sun';
import type { CutLevel } from './storeys';

export type ToggleKey = LayerKind | 'evidence' | 'imagery';
export type ViewMode = 'orbit' | 'walk' | 'measure';
export type ViewPreset = 'front' | 'top' | 'side' | 'reset';

export const DEFAULT_TOGGLES: Record<ToggleKey, boolean> = {
  solid: false, walls: true, roof: true, 'roof-skin': true, openings: true, floors: true, interior: true, stairs: true,
  chimneys: true, neighbours: true, terrain: true, evidence: false, imagery: false,
};

export interface ViewerEvents {
  onView?(bearingDeg: number): void;
  onMeasure?(r: MeasureResult): void;
  onWalkLock?(locked: boolean): void;
  onWarning?(message: string): void;
}

interface Entry { layer: MeshLayer; object: Mesh }
const SKY = new Color('#dde6eb'), DUSK = new Color('#8f9cab');
const HOUSE_KINDS = new Set<LayerKind>(['walls', 'roof', 'roof-skin', 'chimneys', 'openings', 'solid']);
const SOLID_KINDS = new Set<LayerKind>(['walls', 'chimneys', 'neighbours', 'interior']);
const WALKABLE_KINDS = new Set<LayerKind>(['floors', 'stairs', 'terrain']);

export class Viewer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(40, 1, 0.1, 3000);
  readonly controls: OrbitControls;
  private readonly sun = new DirectionalLight('#fff3e2', 2.6);
  private readonly hemi = new HemisphereLight('#e4eef5', '#8b8473', 1.0);
  private readonly houseRoot = new Group();
  private readonly helperRoot = new Group();
  private readonly materials = new MaterialLibrary(resolvePalette(undefined));
  private readonly clipPlane = new Plane(new Vector3(0, -1, 0), 0);
  private readonly timer = new Timer();
  private readonly walk: WalkController;
  private readonly measure: MeasureTool;
  private readonly resizeObs: ResizeObserver;
  private entries: Entry[] = [];
  private evidence: Points | null = null;
  private imagery: Mesh | null = null;
  private ground: Mesh | null = null;
  private toggles: Record<ToggleKey, boolean> = { ...DEFAULT_TOGGLES };
  private cut: CutLevel | null = null;
  private mode: ViewMode = 'orbit';
  private spec: HouseModelSpec | null = null;
  private center = new Vector3();
  private radius = 10;
  private front = new Vector3(0, 0, 1);
  private orbitPose: { pos: Vector3; target: Vector3 } | null = null;
  private sunState: SunState | null = null;
  private shadows = true;
  private dirty = true;
  private raf = 0;
  private lastBearing = NaN;

  constructor(private readonly host: HTMLElement, private readonly events: ViewerEvents = {}, palette?: unknown) {
    if (palette) this.materials = new MaterialLibrary(resolvePalette(palette));
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap; // PCFSoftShadowMap was removed in r186
    this.renderer.localClippingEnabled = true;
    this.renderer.toneMapping = NeutralToneMapping;
    const canvas = this.renderer.domElement;
    canvas.className = 'viewer__canvas';
    canvas.tabIndex = 0;
    host.appendChild(canvas);

    this.scene.background = SKY.clone();
    this.scene.fog = new Fog(SKY.clone(), 220, 900);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 2;
    this.houseRoot.name = 'house';
    this.helperRoot.name = 'helpers';
    this.scene.add(this.hemi, this.sun, this.sun.target, this.houseRoot, this.helperRoot);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.screenSpacePanning = true;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 400;
    this.controls.listenToKeyEvents(canvas); // arrows pan, Shift/Ctrl + arrows orbit
    canvas.addEventListener('keydown', this.onCanvasKey);

    this.walk = new WalkController(this.camera, canvas, {
      solids: () => this.visibleObjects((e) => SOLID_KINDS.has(e.layer.kind) && e.layer.material !== 'room-floor'),
      floors: () => [...this.visibleObjects((e) => WALKABLE_KINDS.has(e.layer.kind) || e.layer.material === 'room-floor'), ...(this.ground ? [this.ground] : [])],
    }, (locked) => this.events.onWalkLock?.(locked));
    this.measure = new MeasureTool(this.camera, canvas, () => this.visibleObjects(() => true), (r) => { this.dirty = true; this.events.onMeasure?.(r); });
    this.helperRoot.add(this.measure.group);

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(host);
    this.resize();
    this.raf = requestAnimationFrame(this.loop);
  }

  // ------------------------------------------------------------------ model
  setModel(spec: HouseModelSpec, mesh: HouseMesh, opts: { resetCamera?: boolean } = {}): void {
    this.clearModel();
    this.spec = spec;
    const box = new Box3(), all = new Box3();
    for (const layer of mesh.layers) {
      const problem = layerProblem(layer);
      if (problem) { this.events.onWarning?.(problem); continue; }
      const def = this.materials.def(layer.material);
      const geo = layerToGeometry(layer, {
        uvTile: def.texture ? def.tile : null, uvMode: def.slopeUv ? 'slope' : 'keep',
        flatNormals: layer.kind === 'solid', // the closed print solid is welded with smooth normals
      });
      const object = new Mesh(geo, this.materials.get(layer.material, this.overrideColour(spec, layer)));
      object.name = layer.id;
      object.userData = { kind: layer.kind, partId: layer.partId, storey: layer.storey, material: layer.material };
      object.castShadow = layer.material !== 'glass' && layer.kind !== 'terrain';
      object.receiveShadow = true;
      this.houseRoot.add(object);
      this.entries.push({ layer, object });
      if (geo.boundingBox) {
        all.union(geo.boundingBox);
        if (HOUSE_KINDS.has(layer.kind)) box.union(geo.boundingBox);
      }
    }
    const b = box.isEmpty() ? all : box;
    if (!b.isEmpty()) {
      b.getCenter(this.center);
      this.radius = Math.max(4, b.getSize(new Vector3()).length() / 2);
    }
    this.front = this.frontDirection(spec);
    if (spec.evidence) {
      this.evidence = evidencePoints(spec.evidence);
      if (this.evidence) this.helperRoot.add(this.evidence);
    }
    if (spec.context.imagery) {
      this.imagery = imageryPlane(spec.context.imagery, () => { this.dirty = true; });
      this.helperRoot.add(this.imagery);
    }
    const terrainMin = this.entries.filter((e) => e.layer.kind === 'terrain').reduce((m, e) => Math.min(m, e.object.geometry.boundingBox?.min.y ?? 0), 0);
    this.ground = groundDisc(Math.min(-0.03, terrainMin - 0.05), this.materials.def('terrain').color);
    this.helperRoot.add(this.ground);
    this.fitShadowCamera();
    this.setCutaway(this.cut);
    this.applyVisibility();
    if (opts.resetCamera || !this.orbitPose) this.viewPreset('reset');
    if (this.sunState) this.setSun(this.sunState, this.shadows);
    this.dirty = true;
  }

  private overrideColour(spec: HouseModelSpec, layer: MeshLayer): string | undefined {
    const part = layer.partId ? spec.parts.find((p) => p.id === layer.partId) : undefined;
    if (!part) return undefined;
    if (layer.material.startsWith('wall-')) return part.material.wallColour;
    if (layer.material.startsWith('roof-') && layer.material !== 'roof-underside') return part.material.roofColour;
    return undefined;
  }

  private frontDirection(spec: HouseModelSpec): Vector3 {
    const f = spec.facade.front;
    const part = f ? spec.parts.find((p) => p.id === f.partId) : undefined;
    const ring = part?.footprint.outer;
    if (!f || !ring || f.edge < 0 || f.edge >= ring.length) return new Vector3(0, 0, 1);
    const a = ring[f.edge], b = ring[(f.edge + 1) % ring.length];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return new Vector3(dy / l, 0, dx / l); // outward normal (dy, -dx) in ENU -> three (x, 0, -n)
  }

  // ------------------------------------------------------------------ roof highlight (Sunny addition)
  private highlight: Mesh | null = null;

  /**
   * Overlay the given roof faces (RoofFaceInfo ids, the 'roof-skin' layer's triangle tags) in a translucent accent,
   * or clear the overlay with null. Added in Sunny so a roof plane named in the summary can be pointed at.
   */
  highlightRoofFaces(mesh: HouseMesh, ids: readonly number[] | null, colour = '#ff7900'): void {
    if (this.highlight) {
      this.helperRoot.remove(this.highlight);
      this.highlight.geometry.dispose();
      (this.highlight.material as MeshBasicMaterial).dispose();
      this.highlight = null;
    }
    if (ids && ids.length > 0) {
      const want = new Set(ids);
      const positions: number[] = [];
      for (const layer of mesh.layers) {
        if (layer.kind !== 'roof-skin' || !layer.triangleTags) continue;
        for (let t = 0; t < layer.triangleTags.length; t++) {
          if (!want.has(layer.triangleTags[t])) continue;
          for (let k = 0; k < 3; k++) {
            const v = layer.indices[3 * t + k];
            // ENU (z up) -> three.js (y up, z = -north), lifted 3 cm off the skin so it never z-fights.
            positions.push(layer.positions[3 * v], layer.positions[3 * v + 2] + 0.03, -layer.positions[3 * v + 1]);
          }
        }
      }
      if (positions.length > 0) {
        const geo = new BufferGeometry();
        geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
        const mat = new MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.55, side: DoubleSide, depthWrite: false });
        this.highlight = new Mesh(geo, mat);
        this.highlight.name = 'roof-highlight';
        this.helperRoot.add(this.highlight);
      }
    }
    this.dirty = true;
  }

  // ------------------------------------------------------------------ overlays (Sunny addition)
  /** Add an object (e.g. the quote's panels) to the helper layer, which stays above the model. */
  addHelper(object: Object3D): void { this.helperRoot.add(object); this.dirty = true; }

  removeHelper(object: Object3D): void { this.helperRoot.remove(object); this.dirty = true; }

  /** Draw the next frame (for animations driven from outside the viewer). */
  requestRender(): void { this.dirty = true; }

  /** Screen position (CSS px relative to the host) of a local ENU point, or null when behind the camera. */
  projectToScreen(enu: readonly [number, number, number]): { x: number; y: number } | null {
    const v = new Vector3(enu[0], enu[2], -enu[1]).project(this.camera);
    if (v.z < -1 || v.z > 1) return null;
    const w = this.host.clientWidth, h = this.host.clientHeight;
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h };
  }

  private clearModel(): void {
    for (const e of this.entries) { this.houseRoot.remove(e.object); e.object.geometry.dispose(); }
    this.entries = [];
    for (const o of [this.evidence, this.imagery, this.ground]) {
      if (!o) continue;
      this.helperRoot.remove(o);
      o.geometry.dispose();
      const mat = o.material as Material & { map?: { dispose(): void } | null };
      mat.map?.dispose(); // the aerial photo texture (one per model build)
      mat.dispose();
    }
    this.evidence = this.imagery = this.ground = null;
  }

  private fitShadowCamera(): void {
    const r = Math.min(70, Math.max(22, this.radius + 18));
    const cam = this.sun.shadow.camera;
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r; cam.near = 1; cam.far = 400;
    cam.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ view state
  setToggles(t: Partial<Record<ToggleKey, boolean>>): void {
    this.toggles = { ...this.toggles, ...t };
    this.applyVisibility();
  }

  getToggles(): Record<ToggleKey, boolean> { return { ...this.toggles }; }

  /** Show storeys up to `level.storey` (roof hidden, walls cut at level.topZ); null shows the whole house. */
  setCutaway(level: CutLevel | null): void {
    this.cut = level;
    this.clipPlane.constant = level ? level.topZ : 0;
    this.materials.setClipping(level ? [this.clipPlane] : null);
    if (this.evidence) {
      const m = this.evidence.material as Material;
      m.clippingPlanes = level ? [this.clipPlane] : null;
      m.needsUpdate = true;
    }
    this.applyVisibility();
  }

  private applyVisibility(): void {
    // the aerial photo is the ground while it is shown (the ±30 m LiDAR terrain would cover parts of the ±60 m photo)
    const photoGround = !!this.imagery && this.toggles.imagery;
    for (const { layer, object } of this.entries) {
      let v = this.toggles[layer.kind] ?? true;
      if (photoGround && layer.kind === 'terrain') v = false;
      if (this.cut) {
        if (layer.kind === 'roof' || layer.kind === 'roof-skin') v = false;
        if (layer.storey !== undefined && layer.storey > this.cut.storey) v = false;
      }
      object.visible = v;
    }
    if (this.evidence) this.evidence.visible = this.toggles.evidence;
    if (this.imagery) this.imagery.visible = this.toggles.imagery;
    this.dirty = true;
  }

  setSun(state: SunState, shadows: boolean): void {
    this.sunState = state;
    this.shadows = shadows;
    const [dx, dy, dz] = state.direction;
    const t = new Vector3(this.center.x, 0, this.center.z);
    this.sun.target.position.copy(t);
    this.sun.position.set(t.x + dx * 120, t.y + dy * 120, t.z + dz * 120);
    this.sun.target.updateMatrixWorld();
    const k = Math.max(0, Math.min(1, (state.altitudeDeg + 1) / 9)); // fade through dawn / dusk
    this.sun.intensity = 2.6 * k;
    this.sun.castShadow = shadows && state.altitudeDeg > 0;
    this.hemi.intensity = 0.42 + 0.68 * k;
    const sky = DUSK.clone().lerp(SKY, k);
    (this.scene.background as Color).copy(sky);
    this.scene.fog?.color.copy(sky);
    this.dirty = true;
  }

  setMode(mode: ViewMode): void {
    if (mode === this.mode) return;
    if (this.mode === 'walk') {
      this.walk.stop();
      if (this.orbitPose) { this.camera.position.copy(this.orbitPose.pos); this.controls.target.copy(this.orbitPose.target); }
      this.camera.up.set(0, 1, 0);
    }
    if (this.mode === 'measure') this.measure.enable(false);
    this.mode = mode;
    this.controls.enabled = mode !== 'walk';
    if (mode === 'walk') {
      this.orbitPose = { pos: this.camera.position.clone(), target: this.controls.target.clone() };
      const start = this.walkStart();
      this.walk.start(start, new Vector3(this.center.x, 0, this.center.z));
    }
    if (mode === 'measure') this.measure.enable(true);
    this.controls.update();
    this.dirty = true;
  }

  getMode(): ViewMode { return this.mode; }
  walkPress(key: WalkKey, down: boolean): void { this.walk.press(key, down); }
  walkLock(): void { this.walk.lock(); }
  clearMeasure(): void { this.measure.clear(); }
  measureAt(px: number, py: number): boolean { return this.measure.pick(px, py); }

  /** Walk start: 4.5 m in front of the middle of the front wall. */
  private walkStart(): Vector3 {
    const f = this.spec?.facade.front;
    const ring = f ? this.spec?.parts.find((p) => p.id === f.partId)?.footprint.outer : undefined;
    if (f && ring && ring[f.edge]) {
      const a = ring[f.edge], b = ring[(f.edge + 1) % ring.length];
      return new Vector3((a[0] + b[0]) / 2, 0, -(a[1] + b[1]) / 2).addScaledVector(this.front, 4.5);
    }
    return this.center.clone().setY(0).addScaledVector(this.front, this.radius + 3);
  }

  viewPreset(p: ViewPreset): void {
    if (this.mode === 'walk') this.setMode('orbit');
    const c = this.center, d = Math.max(15, this.radius * 3.4);
    const side = new Vector3(-this.front.z, 0, this.front.x);
    let pos: Vector3;
    if (p === 'top') pos = c.clone().add(new Vector3(0, d * 1.25, 0.01));
    else if (p === 'front') pos = c.clone().addScaledVector(this.front, d).add(new Vector3(0, d * 0.18, 0));
    else if (p === 'side') pos = c.clone().addScaledVector(side, d).add(new Vector3(0, d * 0.25, 0));
    else pos = c.clone().addScaledVector(this.front.clone().applyAxisAngle(new Vector3(0, 1, 0), -0.62), d).add(new Vector3(0, d * 0.34, 0));
    this.camera.position.copy(pos);
    this.controls.target.copy(c);
    this.controls.update();
    this.orbitPose = { pos: pos.clone(), target: c.clone() };
    this.dirty = true;
  }

  zoomBy(factor: number): void {
    const off = this.camera.position.clone().sub(this.controls.target);
    const len = Math.min(this.controls.maxDistance, Math.max(this.controls.minDistance, off.length() * factor));
    this.camera.position.copy(this.controls.target).add(off.setLength(len));
    this.controls.update();
    this.dirty = true;
  }

  private onCanvasKey = (e: KeyboardEvent) => {
    if (this.mode === 'walk') return;
    if (e.key === '+' || e.key === '=') { this.zoomBy(0.85); e.preventDefault(); }
    else if (e.key === '-' || e.key === '_') { this.zoomBy(1.18); e.preventDefault(); }
  };

  // ------------------------------------------------------------------ exports & queries
  /** Fresh group of meshes (shared geometry/materials) for the layers accepted by `include`; nothing transient. */
  exportGroup(include: (layer: MeshLayer) => boolean): Group {
    const g = new Group();
    for (const { layer, object } of this.entries) {
      if (!include(layer)) continue;
      const m = new Mesh(object.geometry, object.material);
      m.name = layer.id;
      m.userData = { kind: layer.kind, ...(layer.partId ? { partId: layer.partId } : {}), ...(layer.storey !== undefined ? { storey: layer.storey } : {}), ...(['openings', 'interior', 'stairs'].includes(layer.kind) ? { estimated: true } : {}) };
      g.add(m);
    }
    return g;
  }

  private visibleObjects(pred: (e: Entry) => boolean): Object3D[] {
    return this.entries.filter((e) => e.object.visible && pred(e)).map((e) => e.object);
  }

  layerSummary(): { id: string; kind: LayerKind; visible: boolean; triangles: number; clipped: boolean }[] {
    return this.entries.map(({ layer, object }) => ({
      id: layer.id, kind: layer.kind, visible: object.visible, triangles: (object.geometry.getIndex()?.count ?? 0) / 3,
      clipped: !CONTEXT_KEYS.has(layer.material) && !!this.cut,
    }));
  }

  sunInfo() {
    return { intensity: this.sun.intensity, castShadow: this.sun.castShadow, position: this.sun.position.toArray(), ...(this.sunState ?? {}) };
  }

  /** Renders now and returns luma statistics of the frame (used by the E2E pixel-variance check). */
  pixelStats(): { width: number; height: number; mean: number; std: number; distinct: number } {
    this.render();
    const gl = this.renderer.getContext();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let n = 0, sum = 0, sum2 = 0;
    const colours = new Set<number>();
    for (let i = 0; i < px.length; i += 16) {
      const y = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      sum += y; sum2 += y * y; n++;
      colours.add(((px[i] >> 3) << 10) | ((px[i + 1] >> 3) << 5) | (px[i + 2] >> 3));
    }
    const mean = sum / n;
    return { width: w, height: h, mean, std: Math.sqrt(Math.max(0, sum2 / n - mean * mean)), distinct: colours.size };
  }

  // ------------------------------------------------------------------ loop
  private resize(): void {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private loop = (time: number) => {
    this.raf = requestAnimationFrame(this.loop);
    this.timer.update(time);
    const dt = this.timer.getDelta();
    const moved = this.mode === 'walk' ? this.walk.update(dt) : this.controls.update(dt);
    if (moved || this.dirty) {
      this.dirty = false;
      this.render();
      const dir = new Vector3();
      this.camera.getWorldDirection(dir);
      const bearing = bearingOfThreeDir(dir.x, dir.z);
      if (!(Math.abs(bearing - this.lastBearing) < 0.5)) { this.lastBearing = bearing; this.events.onView?.(bearing); }
    }
  };

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.renderer.domElement.removeEventListener('keydown', this.onCanvasKey);
    this.walk.dispose();
    this.measure.dispose();
    this.controls.dispose();
    this.clearModel();
    this.materials.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
