import { STATES, INTENSITIES, type Intensity, type SunnyState } from '@sunny/animation-engine';

/**
 * The contract between the application and the animator's Rive file.
 *
 * This file is the single source of truth for every name the code reads or
 * writes inside `sunny.riv`. `docs/design/rive-animator-brief.md` §5 is the
 * same contract written for the animator; a change here is a change there.
 *
 * The contract is expressed as one **view model** (Rive data binding), not as
 * state machine inputs and Rive Events: Rive's documentation marks Events as
 * deprecated in favour of data binding, and drives state machine transitions
 * from data-bound properties. Signals that flow back to the application are
 * view model triggers the state machine fires, which the runtime lets us
 * observe.
 */

/** The `.riv` files the brief asks for. */
export const FILES = {
  core: 'sunny.riv',
  props: 'sunny-props.riv',
} as const;

export const ARTBOARD = 'Sunny';
export const STATE_MACHINE = 'SunnyMachine';
export const VIEW_MODEL = 'SunnyVM';

/** Behavioural states, written to the `state` enum by name. */
export const RIVE_STATES: readonly SunnyState[] = STATES;

export const SEASONS = ['none', 'spring', 'summer', 'autumn', 'winter'] as const;
export type Season = (typeof SEASONS)[number];

export { INTENSITIES, type Intensity, type SunnyState };

/** Properties the application writes. Name -> view model property type. */
export const PROPERTIES = {
  state: 'enum',
  intensity: 'enum',
  season: 'enum',
  reducedMotion: 'boolean',
  lookX: 'number',
  lookY: 'number',
  pointAngle: 'number',
  popX: 'number',
  popY: 'number',
  bodyColor: 'color',
} as const;
export type PropertyName = keyof typeof PROPERTIES;

/** One-shot moments in the core file (brief §4.1, §4.2). */
export const CORE_MOMENTS = [
  'eureka',
  'sunglasses',
  'charge',
  'open',
  'celebrate',
  'spin',
] as const;

/** One-shot moments that live only in the props file (brief §4.3). */
export const LIBRARY_MOMENTS = [
  'deckchair',
  'balloon',
  'pop',
  'shuffle',
  'run',
  'dance',
  'roll',
  'flower',
  'kickflip',
  'barrelRoll',
  'iceCream',
  'rubiks',
  'impossibleCube',
] as const;

export type Moment = (typeof CORE_MOMENTS)[number] | (typeof LIBRARY_MOMENTS)[number];

/** Triggers the application fires: every moment, plus `interrupt`. */
export const APP_TRIGGERS = ['interrupt', ...CORE_MOMENTS, ...LIBRARY_MOMENTS] as const;
export type AppTrigger = (typeof APP_TRIGGERS)[number];

/**
 * Triggers the Rive state machine fires and the application observes.
 *
 * - `momentStarted` / `momentFinished`: a one-shot moment began, or has fully
 *   returned to rest with props cleared. The `moment` string property names it.
 * - `openExpand`: the frame the chat bubble starts expanding; the app opens the
 *   panel on this frame.
 * - `openSettled`: Sunny has landed in the header position.
 * - `popHit`: the balloon burst.
 */
export const SIGNALS = [
  'momentStarted',
  'momentFinished',
  'openExpand',
  'openSettled',
  'popHit',
] as const;
export type Signal = (typeof SIGNALS)[number];

/** String property naming the moment a `momentStarted`/`momentFinished` refers to. */
export const MOMENT_NAME_PROPERTY = 'moment';

const MOMENTS: ReadonlySet<string> = new Set<string>([...CORE_MOMENTS, ...LIBRARY_MOMENTS]);

export function isMoment(value: string): value is Moment {
  return MOMENTS.has(value);
}

/**
 * Parse a tenant colour into the ARGB integer Rive colour properties take.
 *
 * Only `#rgb` and `#rrggbb` are accepted, always fully opaque. Anything else
 * returns `null` and is never written: the colour comes from tenant
 * configuration, and the character must not become see-through or take a value
 * the brand rules never approved.
 */
export function parseHexColor(value: string): number | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  let hex = match[1]!;
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join('');
  return (0xff000000 | parseInt(hex, 16)) >>> 0;
}
