import {
  APP_TRIGGERS,
  ARTBOARD,
  INTENSITIES,
  MOMENT_NAME_PROPERTY,
  PROPERTIES,
  RIVE_STATES,
  SEASONS,
  SIGNALS,
  STATE_MACHINE,
  isMoment,
  parseHexColor,
  type AppTrigger,
  type Intensity,
  type Moment,
  type PropertyName,
  type Season,
  type Signal,
  type SunnyState,
} from './contract.js';
import {
  loadCanvasLite,
  type RiveInstanceLike,
  type RiveRuntimeLike,
  type ViewModelInstanceLike,
} from './runtime.js';

/**
 * The browser facilities the mount uses, injectable so tests can run without a
 * DOM. Every field defaults to the real global.
 */
export interface MountEnvironment {
  document: Pick<Document, 'createElement' | 'addEventListener' | 'removeEventListener'> & {
    readonly visibilityState: DocumentVisibilityState;
  };
  matchMedia?: ((query: string) => MediaQueryList) | undefined;
  ResizeObserver?: typeof ResizeObserver | undefined;
  IntersectionObserver?: typeof IntersectionObserver | undefined;
  /** Whether WebAssembly is available; the runtime cannot start without it. */
  hasWebAssembly: boolean;
}

export interface MountOptions {
  /** URL of `sunny.riv` (or `sunny-props.riv`). */
  src: string;
  /** Self-hosted `rive.wasm`; by default the runtime fetches it from unpkg. */
  wasmUrl?: string;
  artboard?: string;
  intensity?: Intensity;
  /** `'auto'` follows `prefers-reduced-motion`, live. Default `'auto'`. */
  reducedMotion?: boolean | 'auto';
  /** Tenant theme colour, `#rgb` or `#rrggbb`. */
  color?: string;
  season?: Season;
  /**
   * Drawn into the host when the file cannot play (no WebAssembly, the file
   * failed to load). The host page keeps working either way.
   */
  fallback?: (host: HTMLElement) => void;
  /** Non-fatal problems: load failures, contract gaps. Never thrown. */
  onError?: (error: RiveSunnyError) => void;
  /** Override for tests and for hosts that bundle the runtime themselves. */
  loadRuntime?: () => Promise<RiveRuntimeLike>;
  environment?: Partial<MountEnvironment>;
}

export type RiveSunnyErrorKind = 'unsupported' | 'load' | 'contract' | 'runtime';

export class RiveSunnyError extends Error {
  constructor(
    readonly kind: RiveSunnyErrorKind,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'RiveSunnyError';
  }
}

export interface SignalEvent {
  signal: Signal;
  /** For `momentStarted` / `momentFinished`: which moment, when the file named one we know. */
  moment: Moment | null;
}

export interface RiveSunnyController {
  /** Resolves `true` once the file is playing, `false` if it fell back. Never rejects. */
  readonly ready: Promise<boolean>;
  /** Contract names the delivered file is missing. Empty until loaded. */
  readonly missing: readonly string[];
  setState(state: SunnyState): void;
  /** Eye aim, each axis clamped to -100..100. */
  look(x: number, y: number): void;
  /** Guiding direction in degrees, 0 = up, clockwise. */
  point(angle: number): void;
  /** Where a balloon pop lands, in artboard coordinates. */
  popAt(x: number, y: number): void;
  fire(trigger: AppTrigger): void;
  interrupt(): void;
  setIntensity(intensity: Intensity): void;
  setReducedMotion(reduced: boolean | 'auto'): void;
  setSeason(season: Season): void;
  /** Returns false (and writes nothing) for anything but `#rgb` / `#rrggbb`. */
  setColor(hex: string): boolean;
  on(signal: Signal, callback: (event: SignalEvent) => void): () => void;
  destroy(): void;
}

type Desired = {
  state: SunnyState;
  intensity: Intensity;
  season: Season;
  reducedMotion: boolean;
  lookX: number;
  lookY: number;
  pointAngle: number;
  popX: number;
  popY: number;
  bodyColor: number | null;
};

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function defaultEnvironment(): MountEnvironment {
  const g = globalThis as typeof globalThis & Partial<Window>;
  return {
    document: g.document,
    matchMedia: typeof g.matchMedia === 'function' ? g.matchMedia.bind(g) : undefined,
    ResizeObserver: g.ResizeObserver,
    IntersectionObserver: g.IntersectionObserver,
    hasWebAssembly: typeof g.WebAssembly === 'object',
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(min, value));
}

/**
 * Mount the Rive Sunny into `host`.
 *
 * Returns synchronously; the file loads in the background. Every setter can be
 * called before load — the latest value is applied when the file is ready, and
 * a value equal to the last one written is not written again.
 */
export function mountRiveSunny(host: HTMLElement, options: MountOptions): RiveSunnyController {
  const env: MountEnvironment = { ...defaultEnvironment(), ...options.environment };
  const report = (error: RiveSunnyError): void => {
    try {
      options.onError?.(error);
    } catch {
      // A broken error handler must not break the host page either.
    }
  };

  const reducedQuery = env.matchMedia?.(REDUCED_MOTION_QUERY) ?? null;
  let reducedSetting: boolean | 'auto' = options.reducedMotion ?? 'auto';
  const effectiveReduced = (): boolean =>
    reducedSetting === 'auto' ? (reducedQuery?.matches ?? false) : reducedSetting;

  const desired: Desired = {
    state: 'idle',
    intensity: options.intensity ?? 'balanced',
    season: options.season ?? 'none',
    reducedMotion: effectiveReduced(),
    lookX: 0,
    lookY: 0,
    pointAngle: 0,
    popX: 0,
    popY: 0,
    bodyColor: options.color === undefined ? null : parseHexColor(options.color),
  };
  if (options.color !== undefined && desired.bodyColor === null) {
    report(new RiveSunnyError('runtime', `Rejected colour ${JSON.stringify(options.color)}`));
  }

  const written = new Map<PropertyName, unknown>();
  const pendingTriggers: AppTrigger[] = [];
  const listeners = new Map<Signal, Set<(event: SignalEvent) => void>>();
  const missing: string[] = [];
  const cleanups: (() => void)[] = [];

  let rive: RiveInstanceLike | null = null;
  let vmi: ViewModelInstanceLike | null = null;
  let destroyed = false;
  let playing = false;
  let onScreen = true;

  // ── writing to the view model ───────────────────────────────────────────

  const write = (name: PropertyName): void => {
    if (!vmi) return;
    const value = desired[name];
    if (value === null || written.get(name) === value) return;
    const kind = PROPERTIES[name];
    let property: { value: unknown } | null = null;
    if (kind === 'enum') property = vmi.enum(name);
    else if (kind === 'boolean') property = vmi.boolean(name);
    else if (kind === 'number') property = vmi.number(name);
    else property = vmi.color(name);
    if (!property) return; // reported once, at load
    try {
      property.value = value;
      written.set(name, value);
    } catch (error) {
      report(new RiveSunnyError('runtime', `Could not set ${name}`, error));
    }
  };

  const set = <K extends keyof Desired>(name: K, value: Desired[K]): void => {
    if (destroyed) return;
    desired[name] = value;
    write(name);
  };

  const fireNow = (trigger: AppTrigger): void => {
    const property = vmi?.trigger(trigger);
    if (!property) return;
    try {
      property.trigger();
    } catch (error) {
      report(new RiveSunnyError('runtime', `Could not fire ${trigger}`, error));
    }
  };

  // ── play / pause ─────────────────────────────────────────────────────────

  const updatePlayback = (): void => {
    if (!rive || destroyed) return;
    const shouldPlay = onScreen && env.document.visibilityState !== 'hidden';
    if (shouldPlay === playing) return;
    playing = shouldPlay;
    if (shouldPlay) rive.play();
    else rive.pause();
  };

  // ── fallback ─────────────────────────────────────────────────────────────

  const fallBack = (error: RiveSunnyError): boolean => {
    report(error);
    if (destroyed) return false;
    host.replaceChildren();
    try {
      options.fallback?.(host);
    } catch (fallbackError) {
      report(new RiveSunnyError('runtime', 'The fallback renderer threw', fallbackError));
    }
    return false;
  };

  // ── load ─────────────────────────────────────────────────────────────────

  const start = async (): Promise<boolean> => {
    if (!env.hasWebAssembly) {
      return fallBack(new RiveSunnyError('unsupported', 'WebAssembly is not available'));
    }

    let runtime: RiveRuntimeLike;
    try {
      runtime = await (options.loadRuntime ?? loadCanvasLite)();
    } catch (error) {
      return fallBack(new RiveSunnyError('load', 'The Rive runtime failed to load', error));
    }
    if (destroyed) return false;
    if (options.wasmUrl) runtime.setWasmUrl(options.wasmUrl);

    const canvas = env.document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    canvas.setAttribute('aria-hidden', 'true');
    host.replaceChildren(canvas);

    return new Promise<boolean>((resolve) => {
      let instance: RiveInstanceLike | undefined;
      try {
        instance = runtime.createRive({
          src: options.src,
          canvas,
          artboard: options.artboard ?? ARTBOARD,
          stateMachine: STATE_MACHINE,
          // Playback starts in `updatePlayback`, so an off-screen launcher never
          // spends a frame.
          autoplay: false,
          autoBind: true,
          isTouchScrollEnabled: true,
          layout: runtime.containLayout(),
          onLoad: () => {
            if (destroyed) return resolve(false);
            if (!instance) return resolve(false);
            rive = instance;
            instance.resizeDrawingSurfaceToCanvas();
            bind(instance);
            updatePlayback();
            resolve(true);
          },
          onLoadError: (event) => {
            instance?.cleanup();
            resolve(fallBack(new RiveSunnyError('load', `Could not load ${options.src}`, event)));
          },
        });
      } catch (error) {
        resolve(fallBack(new RiveSunnyError('load', 'The Rive runtime threw on start', error)));
      }
    });
  };

  const bind = (instance: RiveInstanceLike): void => {
    vmi = instance.viewModelInstance;
    if (!vmi) {
      missing.push('view model (autoBind found no default instance)');
      report(new RiveSunnyError('contract', 'The file has no bound view model'));
      return;
    }
    const v = vmi;

    // Contract check: name everything the file lacks, once. The character still
    // plays; a missing property simply has no effect.
    for (const [name, kind] of Object.entries(PROPERTIES)) {
      const found =
        kind === 'enum'
          ? v.enum(name)
          : kind === 'boolean'
            ? v.boolean(name)
            : kind === 'number'
              ? v.number(name)
              : v.color(name);
      if (!found) missing.push(name);
    }
    for (const name of APP_TRIGGERS) if (!v.trigger(name)) missing.push(name);
    if (!v.string(MOMENT_NAME_PROPERTY)) missing.push(MOMENT_NAME_PROPERTY);

    for (const signal of SIGNALS) {
      const trigger = v.trigger(signal);
      if (!trigger) {
        missing.push(signal);
        continue;
      }
      const handler = (): void => emit(signal);
      trigger.on(handler);
      cleanups.push(() => trigger.off(handler));
    }
    if (missing.length > 0) {
      report(
        new RiveSunnyError('contract', `The file is missing contract names: ${missing.join(', ')}`),
      );
    }

    for (const name of Object.keys(PROPERTIES) as PropertyName[]) write(name);
    for (const trigger of pendingTriggers.splice(0)) fireNow(trigger);
  };

  const emit = (signal: Signal): void => {
    const bucket = listeners.get(signal);
    if (!bucket || bucket.size === 0) return;
    let moment: Moment | null = null;
    if (signal === 'momentStarted' || signal === 'momentFinished') {
      const name = vmi?.string(MOMENT_NAME_PROPERTY)?.value ?? '';
      moment = isMoment(name) ? name : null;
    }
    for (const callback of [...bucket]) {
      try {
        callback({ signal, moment });
      } catch (error) {
        report(new RiveSunnyError('runtime', `A ${signal} listener threw`, error));
      }
    }
  };

  // ── observers ────────────────────────────────────────────────────────────

  if (env.ResizeObserver) {
    const observer = new env.ResizeObserver(() => rive?.resizeDrawingSurfaceToCanvas());
    observer.observe(host);
    cleanups.push(() => observer.disconnect());
  }
  if (env.IntersectionObserver) {
    const observer = new env.IntersectionObserver((entries) => {
      const last = entries[entries.length - 1];
      if (last) onScreen = last.isIntersecting;
      updatePlayback();
    });
    observer.observe(host);
    cleanups.push(() => observer.disconnect());
  }
  const onVisibility = (): void => updatePlayback();
  env.document.addEventListener('visibilitychange', onVisibility);
  cleanups.push(() => env.document.removeEventListener('visibilitychange', onVisibility));
  if (reducedQuery) {
    const onReduced = (): void => set('reducedMotion', effectiveReduced());
    reducedQuery.addEventListener('change', onReduced);
    cleanups.push(() => reducedQuery.removeEventListener('change', onReduced));
  }

  const ready = start().catch((error: unknown) =>
    fallBack(new RiveSunnyError('runtime', 'Unexpected failure while mounting', error)),
  );

  return {
    ready,
    missing,
    setState: (state) => {
      if (RIVE_STATES.includes(state)) set('state', state);
    },
    look: (x, y) => {
      set('lookX', clamp(x, -100, 100));
      set('lookY', clamp(y, -100, 100));
    },
    point: (angle) => set('pointAngle', ((clamp(angle, -1e6, 1e6) % 360) + 360) % 360),
    popAt: (x, y) => {
      set('popX', clamp(x, -1e4, 1e4));
      set('popY', clamp(y, -1e4, 1e4));
    },
    fire: (trigger) => {
      if (destroyed || !(APP_TRIGGERS as readonly string[]).includes(trigger)) return;
      if (vmi) fireNow(trigger);
      else pendingTriggers.splice(0, pendingTriggers.length, trigger); // only the latest matters
    },
    interrupt: () => {
      if (destroyed) return;
      if (vmi) fireNow('interrupt');
      else pendingTriggers.length = 0;
    },
    setIntensity: (intensity) => {
      if (INTENSITIES.includes(intensity)) set('intensity', intensity);
    },
    setReducedMotion: (reduced) => {
      reducedSetting = reduced;
      set('reducedMotion', effectiveReduced());
    },
    setSeason: (season) => {
      if (SEASONS.includes(season)) set('season', season);
    },
    setColor: (hex) => {
      const argb = parseHexColor(hex);
      if (argb === null) return false;
      set('bodyColor', argb);
      return true;
    },
    on: (signal, callback) => {
      let bucket = listeners.get(signal);
      if (!bucket) listeners.set(signal, (bucket = new Set()));
      bucket.add(callback);
      return () => {
        bucket.delete(callback);
      };
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      for (const cleanup of cleanups.splice(0)) cleanup();
      listeners.clear();
      rive?.cleanup();
      rive = null;
      vmi = null;
      host.replaceChildren();
    },
  };
}
