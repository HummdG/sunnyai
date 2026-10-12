// The viewer's public API as the strict root project sees it (`sunny-facade`
// export condition); `facade-check.ts` proves the implementation against it.

export interface RoofViewerOptions {
  spec: unknown;
  highlight?: readonly number[];
  date?: Date;
  minutes?: number;
  reducedMotion?: boolean;
  onWarning?: (message: string) => void;
}

export interface RoofFace {
  id: number;
  partId: string;
  pitchDeg: number;
  azimuthDeg: number | null;
  areaM2: number;
}

export interface ShowPanelsOptions {
  count: number;
  planeIds?: readonly number[];
  moduleLongM?: number;
  moduleShortM?: number;
  animate?: boolean;
}

export interface ShowPanelsResult {
  placed: number;
  unplaced: number;
  perPlane: { faceId: number; count: number; capacity: number }[];
}

/** Structurally the timeline from @sunny/quote-engine's buildSavingsTimeline. */
export interface SavingsTimelineLike {
  months: readonly { monthName: string; month?: string; savingsGbp: number; cumulativeGbp: number }[];
  year1TotalGbp: number;
  twentyFiveYearTotalGbp: number;
  twentyFiveYearNetGbp: number | null;
  assumptions: { energyInflationRate: number; panelDegradationPerYear: number };
}

export interface SavingsSimulationOptions {
  monthMs?: number;
  reducedMotion?: boolean;
  autoplay?: boolean;
  onMonth?(index: number): void;
  onComplete?(): void;
}

export interface SavingsSimulationHandle {
  pause(): void;
  resume(): void;
  skip(): void;
  replay(): void;
  readonly state: 'playing' | 'paused' | 'done';
  dispose(): void;
}

export interface RoofViewerHandle {
  readonly faces: readonly RoofFace[];
  highlight(ids: readonly number[] | null): void;
  setTime(minutes: number): void;
  view(preset: 'front' | 'top' | 'side' | 'reset'): void;
  showPanels(opts: ShowPanelsOptions): ShowPanelsResult;
  clearPanels(): void;
  playSavingsSimulation(timeline: SavingsTimelineLike, opts?: SavingsSimulationOptions): SavingsSimulationHandle;
  dispose(): void;
}

export declare function mountRoofViewer(host: HTMLElement, opts: RoofViewerOptions): RoofViewerHandle;
