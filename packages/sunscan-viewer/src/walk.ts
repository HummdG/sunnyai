// First-person walk mode: PointerLockControls for mouse look (when the browser grants pointer lock), WASD / arrow
// keys or on-screen buttons to move, eye height 1.6 m above the floor under the camera, and simple collision against
// walls (horizontal rays at knee and chest height, sliding along the hit wall).
import { Euler, Raycaster, Vector3, type Object3D, type PerspectiveCamera } from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

export type WalkKey = 'forward' | 'back' | 'left' | 'right' | 'turnLeft' | 'turnRight' | 'run';

const KEYMAP: Record<string, WalkKey> = {
  KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', KeyD: 'right',
  ArrowLeft: 'turnLeft', KeyQ: 'turnLeft', ArrowRight: 'turnRight', KeyE: 'turnRight', ShiftLeft: 'run', ShiftRight: 'run',
};

export interface WalkTargets {
  /** Visible objects that block movement (walls, chimneys, neighbours, interior walls). */
  solids(): Object3D[];
  /** Visible walkable surfaces (floors, stairs, terrain, ground). */
  floors(): Object3D[];
}

export const EYE_HEIGHT = 1.6;
const RADIUS = 0.3, STEP_UP = 0.45, WALK = 1.5, RUN = 3.5, TURN = 1.7;

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable);

export class WalkController {
  readonly controls: PointerLockControls;
  private readonly held = new Set<WalkKey>();
  private readonly ray = new Raycaster();
  private readonly euler = new Euler(0, 0, 0, 'YXZ');
  private floorY = 0;
  private active = false;

  constructor(private readonly camera: PerspectiveCamera, private readonly dom: HTMLElement, private readonly targets: WalkTargets, onLock: (locked: boolean) => void) {
    this.controls = new PointerLockControls(camera, dom);
    this.controls.enabled = false;
    this.controls.addEventListener('lock', () => onLock(true));
    this.controls.addEventListener('unlock', () => onLock(false));
  }

  get isActive() { return this.active; }

  start(position: Vector3, lookAt: Vector3): void {
    this.active = true;
    this.controls.enabled = true;
    this.held.clear();
    this.floorY = this.floorBelow(position.x, position.z, position.y + 2) ?? 0;
    this.camera.position.set(position.x, this.floorY + EYE_HEIGHT, position.z);
    this.camera.lookAt(lookAt.x, this.floorY + EYE_HEIGHT, lookAt.z);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    window.addEventListener('blur', this.onBlur);
  }

  stop(): void {
    this.active = false;
    this.controls.enabled = false;
    this.held.clear();
    if (this.controls.isLocked) this.controls.unlock();
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    window.removeEventListener('blur', this.onBlur);
  }

  /** Requests pointer lock (needs a user gesture); failures are harmless — keys and buttons still work. */
  lock(): void {
    try {
      const r = this.controls.domElement?.requestPointerLock?.() as unknown;
      if (r instanceof Promise) r.catch(() => undefined);
    } catch { /* not supported */ }
  }

  /** On-screen controls. */
  press(key: WalkKey, down: boolean): void {
    if (down) this.held.add(key);
    else this.held.delete(key);
  }

  private onBlur = () => this.held.clear();

  private onKey = (e: KeyboardEvent) => {
    const k = KEYMAP[e.code];
    if (!k || !this.active || isTyping(e.target) || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.target instanceof HTMLElement && e.target !== this.dom && e.target !== document.body && /^(BUTTON|A)$/.test(e.target.tagName) && e.code.startsWith('Arrow')) return;
    e.preventDefault();
    this.press(k, e.type === 'keydown');
  };

  /** Advances by dt seconds; returns true when the camera moved. */
  update(dt: number): boolean {
    if (!this.active || dt <= 0) return false;
    // sub-step slow frames so walking speed is frame-rate independent and collision rays stay short
    let remaining = Math.min(dt, 0.5), moved = false;
    while (remaining > 1e-6) {
      const d = Math.min(remaining, 0.05);
      moved = this.step(d) || moved;
      remaining -= d;
    }
    return moved;
  }

  private step(d: number): boolean {
    let moved = false;
    const turn = (this.held.has('turnLeft') ? 1 : 0) - (this.held.has('turnRight') ? 1 : 0);
    if (turn) {
      this.euler.setFromQuaternion(this.camera.quaternion);
      this.euler.y += turn * TURN * d;
      this.camera.quaternion.setFromEuler(this.euler);
      moved = true;
    }
    const f = (this.held.has('forward') ? 1 : 0) - (this.held.has('back') ? 1 : 0);
    const s = (this.held.has('right') ? 1 : 0) - (this.held.has('left') ? 1 : 0);
    if (f || s) {
      const fwd = new Vector3();
      this.camera.getWorldDirection(fwd);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-8) fwd.set(0, 0, -1);
      fwd.normalize();
      const right = new Vector3(-fwd.z, 0, fwd.x);
      const step = fwd.multiplyScalar(f).add(right.multiplyScalar(s)).normalize().multiplyScalar((this.held.has('run') ? RUN : WALK) * d);
      moved = this.tryMove(step) || moved;
    }
    const floor = this.floorBelow(this.camera.position.x, this.camera.position.z, this.floorY + STEP_UP);
    if (floor !== null && Math.abs(floor - this.floorY) > 1e-4) {
      this.floorY = floor;
      moved = true;
    }
    if (moved) this.camera.position.y = this.floorY + EYE_HEIGHT;
    return moved;
  }

  private tryMove(step: Vector3): boolean {
    let move = step.clone();
    for (let attempt = 0; attempt < 2 && move.lengthSq() > 1e-10; attempt++) {
      const hit = this.blocked(move);
      if (!hit) {
        this.camera.position.add(move);
        return true;
      }
      move = move.sub(hit.multiplyScalar(move.dot(hit))); // slide along the wall
    }
    return false;
  }

  /** Horizontal normal of the nearest blocking surface along `move`, or null when the way is clear. */
  private blocked(move: Vector3): Vector3 | null {
    const solids = this.targets.solids();
    if (!solids.length) return null;
    const dir = move.clone().normalize();
    for (const h of [0.45, 1.2]) {
      const origin = new Vector3(this.camera.position.x, this.floorY + h, this.camera.position.z);
      this.ray.set(origin, dir);
      this.ray.far = move.length() + RADIUS;
      const hit = this.ray.intersectObjects(solids, false)[0];
      if (hit?.face) {
        const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
        n.y = 0;
        if (n.lengthSq() < 1e-6) continue;
        n.normalize();
        if (n.dot(dir) > 0) n.negate(); // two-sided surfaces: face the walker
        return n;
      }
    }
    return null;
  }

  /** Height of the highest walkable surface at (x, z) no higher than `maxY`, or null. */
  private floorBelow(x: number, z: number, maxY: number): number | null {
    const floors = this.targets.floors();
    if (!floors.length) return null;
    this.ray.set(new Vector3(x, maxY + 0.01, z), new Vector3(0, -1, 0));
    this.ray.far = maxY + 50;
    const hit = this.ray.intersectObjects(floors, false)[0];
    return hit ? hit.point.y : null;
  }

  dispose(): void {
    this.stop();
    this.controls.dispose();
  }
}
