/**
 * The slice of the Rive web runtime this package uses.
 *
 * Declared structurally rather than imported so the runtime can be loaded
 * lazily (the widget must not pay for the WASM before the launcher is on
 * screen) and so tests can substitute a fake. `loadCanvasLite` is the real
 * thing; the types below are checked against it in `loadCanvasLite`'s return.
 */

export interface RiveValueLike {
  on(callback: (event: unknown) => void): void;
  off(callback?: (event: unknown) => void): void;
}

export interface RiveNumberLike extends RiveValueLike {
  value: number;
}
export interface RiveBooleanLike extends RiveValueLike {
  value: boolean;
}
export interface RiveStringLike extends RiveValueLike {
  value: string;
}
export interface RiveEnumLike extends RiveValueLike {
  value: string;
  readonly values: string[];
}
export interface RiveColorLike extends RiveValueLike {
  value: number;
}
export interface RiveTriggerLike extends RiveValueLike {
  trigger(): void;
}

export interface ViewModelInstanceLike {
  number(path: string): RiveNumberLike | null;
  boolean(path: string): RiveBooleanLike | null;
  string(path: string): RiveStringLike | null;
  enum(path: string): RiveEnumLike | null;
  color(path: string): RiveColorLike | null;
  trigger(path: string): RiveTriggerLike | null;
}

export interface RiveInstanceLike {
  readonly viewModelInstance: ViewModelInstanceLike | null;
  play(): void;
  pause(): void;
  resizeDrawingSurfaceToCanvas(customDevicePixelRatio?: number): void;
  cleanup(): void;
}

export interface RiveConstructorParams {
  src: string;
  canvas: HTMLCanvasElement;
  artboard: string;
  stateMachine: string;
  autoplay: boolean;
  autoBind: boolean;
  /** Pointer listeners authored in the file stay on; touch scrolling must still scroll the host page. */
  isTouchScrollEnabled: boolean;
  layout: unknown;
  onLoad: () => void;
  onLoadError: (event: unknown) => void;
}

export interface RiveRuntimeLike {
  createRive(params: RiveConstructorParams): RiveInstanceLike;
  /** A layout that fits the artboard inside the canvas, centred. */
  containLayout(): unknown;
  setWasmUrl(url: string): void;
}

/** Load `@rive-app/canvas-lite` on first use. */
export async function loadCanvasLite(): Promise<RiveRuntimeLike> {
  const rive = await import('@rive-app/canvas-lite');
  return {
    createRive: (params) => new rive.Rive(params as ConstructorParameters<typeof rive.Rive>[0]),
    containLayout: () =>
      new rive.Layout({ fit: rive.Fit.Contain, alignment: rive.Alignment.Center }),
    setWasmUrl: (url) => rive.RuntimeLoader.setWasmUrl(url),
  };
}
