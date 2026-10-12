import type {
  RiveConstructorParams,
  RiveInstanceLike,
  RiveRuntimeLike,
  ViewModelInstanceLike,
} from '../src/runtime.js';
import type { MountEnvironment } from '../src/mount.js';
import { APP_TRIGGERS, MOMENT_NAME_PROPERTY, PROPERTIES, SIGNALS } from '../src/contract.js';

type Callback = (event: unknown) => void;

class FakeValue {
  callbacks = new Set<Callback>();
  writes: unknown[] = [];
  fired = 0;
  #value: unknown;
  constructor(initial: unknown) {
    this.#value = initial;
  }
  get value(): unknown {
    return this.#value;
  }
  set value(v: unknown) {
    this.#value = v;
    this.writes.push(v);
  }
  get values(): string[] {
    return [];
  }
  on(cb: Callback): void {
    this.callbacks.add(cb);
  }
  off(cb?: Callback): void {
    if (cb) this.callbacks.delete(cb);
    else this.callbacks.clear();
  }
  trigger(): void {
    this.fired++;
    for (const cb of [...this.callbacks]) cb({});
  }
}

/** A view model holding every contract name, minus any listed in `omit`. */
export class FakeViewModel implements ViewModelInstanceLike {
  values = new Map<string, FakeValue>();
  constructor(omit: readonly string[] = []) {
    const names = [
      ...Object.keys(PROPERTIES),
      ...APP_TRIGGERS,
      ...SIGNALS,
      MOMENT_NAME_PROPERTY,
    ].filter((n) => !omit.includes(n));
    for (const name of names)
      this.values.set(name, new FakeValue(name === MOMENT_NAME_PROPERTY ? '' : 0));
  }
  get(name: string): FakeValue {
    const v = this.values.get(name);
    if (!v) throw new Error(`no fake value ${name}`);
    return v;
  }
  #lookup = (name: string): never => (this.values.get(name) ?? null) as never;
  number = this.#lookup;
  boolean = this.#lookup;
  string = this.#lookup;
  enum = this.#lookup;
  color = this.#lookup;
  trigger = this.#lookup;
}

export class FakeRive implements RiveInstanceLike {
  plays = 0;
  pauses = 0;
  resizes = 0;
  cleaned = false;
  constructor(
    readonly params: RiveConstructorParams,
    readonly viewModelInstance: FakeViewModel | null,
  ) {}
  play(): void {
    this.plays++;
  }
  pause(): void {
    this.pauses++;
  }
  resizeDrawingSurfaceToCanvas(): void {
    this.resizes++;
  }
  cleanup(): void {
    this.cleaned = true;
  }
}

export interface FakeRuntime extends RiveRuntimeLike {
  instances: FakeRive[];
  wasmUrl: string | null;
}

/**
 * A runtime whose `createRive` loads synchronously-on-next-tick: `outcome`
 * decides whether `onLoad` or `onLoadError` is called.
 */
export function fakeRuntime(
  outcome: 'load' | 'error' = 'load',
  viewModel: () => FakeViewModel | null = () => new FakeViewModel(),
): FakeRuntime {
  const runtime: FakeRuntime = {
    instances: [],
    wasmUrl: null,
    createRive(params) {
      const instance = new FakeRive(params, viewModel());
      runtime.instances.push(instance);
      queueMicrotask(() => (outcome === 'load' ? params.onLoad() : params.onLoadError({})));
      return instance;
    },
    containLayout: () => ({ fit: 'contain' }),
    setWasmUrl(url) {
      runtime.wasmUrl = url;
    },
  };
  return runtime;
}

export class FakeElement {
  children: unknown[] = [];
  style: Record<string, string> = {};
  attributes: Record<string, string> = {};
  constructor(readonly tagName = 'div') {}
  replaceChildren(...nodes: unknown[]): void {
    this.children = nodes;
  }
  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }
}

export class FakeObserver {
  static instances: FakeObserver[] = [];
  observed: unknown[] = [];
  disconnected = false;
  constructor(readonly callback: (entries: { isIntersecting: boolean }[]) => void) {
    FakeObserver.instances.push(this);
  }
  observe(target: unknown): void {
    this.observed.push(target);
  }
  disconnect(): void {
    this.disconnected = true;
  }
}

export interface FakeEnv {
  env: Partial<MountEnvironment>;
  setHidden(hidden: boolean): void;
  setReducedMotion(reduced: boolean): void;
  intersection(): FakeObserver;
  resize(): FakeObserver;
  listenerCount(): number;
}

export function fakeEnvironment(initial: { reduced?: boolean; wasm?: boolean } = {}): FakeEnv {
  let visibility: DocumentVisibilityState = 'visible';
  const docListeners = new Set<() => void>();
  let reduced = initial.reduced ?? false;
  const mqListeners = new Set<() => void>();

  let resize: FakeObserver | null = null;
  let intersect: FakeObserver | null = null;
  const remember = (observer: FakeObserver, kind: 'resize' | 'intersect'): void => {
    if (kind === 'resize') resize = observer;
    else intersect = observer;
  };

  const env: Partial<MountEnvironment> = {
    hasWebAssembly: initial.wasm ?? true,
    document: {
      get visibilityState() {
        return visibility;
      },
      createElement: ((tag: string) => new FakeElement(tag)) as never,
      addEventListener: ((_: string, cb: () => void) => docListeners.add(cb)) as never,
      removeEventListener: ((_: string, cb: () => void) => docListeners.delete(cb)) as never,
    },
    matchMedia: (() => ({
      get matches() {
        return reduced;
      },
      addEventListener: (_: string, cb: () => void) => mqListeners.add(cb),
      removeEventListener: (_: string, cb: () => void) => mqListeners.delete(cb),
    })) as never,
    ResizeObserver: class extends FakeObserver {
      constructor(cb: never) {
        super(cb);
        remember(this, 'resize');
      }
    } as never,
    IntersectionObserver: class extends FakeObserver {
      constructor(cb: never) {
        super(cb);
        remember(this, 'intersect');
      }
    } as never,
  };

  return {
    env,
    setHidden(hidden) {
      visibility = hidden ? 'hidden' : 'visible';
      for (const cb of [...docListeners]) cb();
    },
    setReducedMotion(next) {
      reduced = next;
      for (const cb of [...mqListeners]) cb();
    },
    intersection: () => intersect!,
    resize: () => resize!,
    listenerCount: () => docListeners.size + mqListeners.size,
  };
}
