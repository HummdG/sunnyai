// Point-to-point measuring: click two points on the model; reports the 3D distance and its horizontal / vertical parts.
import {
  BufferGeometry, Group, Line, LineBasicMaterial, Mesh, MeshBasicMaterial, Raycaster, SphereGeometry, Vector2, Vector3,
  type Object3D, type PerspectiveCamera,
} from 'three';

export interface MeasureResult {
  points: [number, number, number][]; // three.js world
  distance: number | null;
  horizontal: number | null;
  vertical: number | null;
}

export class MeasureTool {
  readonly group = new Group();
  private readonly ray = new Raycaster();
  private readonly markerGeo = new SphereGeometry(0.07, 16, 12);
  private readonly markerMat = new MeshBasicMaterial({ color: '#0b7a75', depthTest: false });
  private readonly lineMat = new LineBasicMaterial({ color: '#0b7a75', depthTest: false });
  private points: Vector3[] = [];
  private down: { x: number; y: number } | null = null;
  private enabled = false;

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly dom: HTMLElement,
    private readonly targets: () => Object3D[],
    private readonly onChange: (r: MeasureResult) => void,
  ) {
    this.group.name = 'measure';
    this.group.renderOrder = 10;
  }

  enable(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    if (on) {
      this.dom.addEventListener('pointerdown', this.onDown);
      this.dom.addEventListener('pointerup', this.onUp);
    } else {
      this.dom.removeEventListener('pointerdown', this.onDown);
      this.dom.removeEventListener('pointerup', this.onUp);
      this.clear();
    }
  }

  clear(): void {
    this.points = [];
    this.redraw();
  }

  /** Adds a measuring point at a canvas-relative pixel position (also used by tests). Returns false on a miss. */
  pick(px: number, py: number): boolean {
    const rect = this.dom.getBoundingClientRect();
    const ndc = new Vector2((px / rect.width) * 2 - 1, -(py / rect.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const hit = this.ray.intersectObjects(this.targets(), false)[0];
    if (!hit) return false;
    if (this.points.length >= 2) this.points = [];
    this.points.push(hit.point.clone());
    this.redraw();
    return true;
  }

  private onDown = (e: PointerEvent) => { if (e.button === 0) this.down = { x: e.clientX, y: e.clientY }; };

  private onUp = (e: PointerEvent) => {
    if (!this.down || e.button !== 0) return;
    const moved = Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y);
    this.down = null;
    if (moved > 5) return; // a drag orbits the camera, not a click
    const rect = this.dom.getBoundingClientRect();
    this.pick(e.clientX - rect.left, e.clientY - rect.top);
  };

  private redraw(): void {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      if (c instanceof Line) c.geometry.dispose();
    }
    for (const p of this.points) {
      const m = new Mesh(this.markerGeo, this.markerMat);
      m.position.copy(p);
      m.renderOrder = 10;
      this.group.add(m);
    }
    if (this.points.length === 2) {
      const line = new Line(new BufferGeometry().setFromPoints(this.points), this.lineMat);
      line.renderOrder = 10;
      this.group.add(line);
    }
    const [a, b] = this.points;
    this.onChange({
      points: this.points.map((p) => [p.x, p.y, p.z]),
      distance: a && b ? a.distanceTo(b) : null,
      horizontal: a && b ? Math.hypot(b.x - a.x, b.z - a.z) : null,
      vertical: a && b ? b.y - a.y : null,
    });
  }

  dispose(): void {
    this.enable(false);
    this.markerGeo.dispose();
    this.markerMat.dispose();
    this.lineMat.dispose();
  }
}
