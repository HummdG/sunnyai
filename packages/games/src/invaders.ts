/**
 * Space Invaders, as rules rather than as a picture.
 *
 * The plan asks for a "real collision, score, restart" arcade game, and the same
 * argument that put tic-tac-toe in this package applies: none of those three
 * words is about animation, and a collision bug is invisible in a screenshot.
 *
 * **The field is a grid rather than a rectangle of pixels, and that is the one
 * design decision worth defending.** A pixel game needs floating-point overlap
 * tests, sub-stepping to stop a fast bullet tunnelling through a thin invader,
 * and a rule for what happens at the exact boundary; every one of those is a
 * place where "it looked like a hit" and "it was a hit" can disagree, and none
 * of them is the game. Integer cells make a hit a lookup: a shot at `(x, y)` hit
 * an invader iff an alive invader is *in* `(x, y)`, and the answer is the same on
 * every machine. The rendering layer is free to draw the cells as whatever size
 * it likes -- what it cannot do is decide whether something was hit.
 *
 * Everything is immutable, so a caller can hold a position, step a copy, and
 * compare -- which is what makes "the score went up by exactly the points for
 * that row" an assertion rather than a screenshot.
 */

/** The playfield, in cells. The ship occupies the bottom row. */
export const FIELD_COLS = 12;
export const FIELD_ROWS = 12;

/** The fleet, in cells. Its origin is the top-left of the block. */
export const FLEET_ROWS = 4;
export const FLEET_COLS = 6;

/** The row the ship sits in. */
export const SHIP_ROW = FIELD_ROWS - 1;

/** How many bombs the fleet may have in the air at once. */
export const MAX_BOMBS = 3;

/** Lives at the start of a game, and at the start of every game after it. */
export const START_LIVES = 3;

/** The row of the fleet that is worth the most, and what each row is worth. */
const POINTS_BY_ROW: readonly number[] = [30, 20, 10, 10];

export type Direction = 1 | -1;

/** The fleet: where its top-left cell is, which way it is going, who is left. */
export interface Fleet {
  /** Field column of the fleet's leftmost column. */
  readonly x: number;
  /** Field row of the fleet's topmost row. */
  readonly y: number;
  readonly dx: Direction;
  /** `FLEET_ROWS * FLEET_COLS` flags in reading order: is this one still alive? */
  readonly alive: readonly boolean[];
}

/** A shot or a bomb. One cell, moving one cell a tick. */
export interface Shot {
  readonly x: number;
  readonly y: number;
}

export type Status = 'playing' | 'lost';

export interface Game {
  readonly fleet: Fleet;
  /** Where the ship is, along the bottom row. */
  readonly shipX: number;
  /** The visitor's shots, which travel up. */
  readonly shots: readonly Shot[];
  /** The fleet's bombs, which travel down. */
  readonly bombs: readonly Shot[];
  readonly score: number;
  readonly lives: number;
  /** Which wave this is. Each one starts at the top and moves faster. */
  readonly wave: number;
  readonly status: Status;
  /** How many ticks have been taken. Drives the fleet's own cadence. */
  readonly steps: number;
}

const index = (row: number, col: number): number => row * FLEET_COLS + col;

/** A fresh, full fleet at the given origin, heading right. */
function fullFleet(x: number, y: number): Fleet {
  return {
    x,
    y,
    dx: 1,
    alive: Array.from({ length: FLEET_ROWS * FLEET_COLS }, () => true),
  };
}

/**
 * A new game at `wave`.
 *
 * The fleet is deliberately narrower than the field the ship moves in, which is
 * what gives the ship something to do: it can always be somewhere the fleet is
 * not yet, and the fleet's descent is the clock rather than the danger.
 */
export function newGame(wave = 1): Game {
  return {
    fleet: fullFleet(3, 1),
    shipX: Math.floor(FIELD_COLS / 2),
    shots: [],
    bombs: [],
    score: 0,
    lives: START_LIVES,
    wave,
    status: 'playing',
    steps: 0,
  };
}

/**
 * Start again.
 *
 * Distinct from `newGame` in the only way that matters to a caller: `restart`
 * takes a game that may be over and returns one that is not, keeping nothing --
 * not the score, not the wave, not the fleet's position. An arcade cabinet's
 * restart button does not remember how well you did, and a test that asserted
 * only "the score is zero" would pass for a `newGame` that also happened to keep
 * the wave.
 */
export function restart(): Game {
  return newGame(1);
}

/** What an invader in `row` of the fleet is worth. */
export function pointsFor(row: number): number {
  return POINTS_BY_ROW[row] ?? 0;
}

/** How many ticks the fleet waits between steps. Faster every wave. */
export function fleetPeriod(wave: number): number {
  return Math.max(2, 7 - wave);
}

/** How likely the fleet is to drop a bomb on any given tick. */
export function bombChance(wave: number): number {
  return Math.min(0.35, 0.06 * wave);
}

/** The lowest fleet row that still has anyone in it, or -1 for an empty fleet. */
export function bottomAliveRow(fleet: Fleet): number {
  for (let row = FLEET_ROWS - 1; row >= 0; row--) {
    for (let col = 0; col < FLEET_COLS; col++) {
      if (fleet.alive[index(row, col)] === true) return row;
    }
  }
  return -1;
}

/** How many invaders are left. */
export function invadersLeft(fleet: Fleet): number {
  return fleet.alive.reduce((count, alive) => count + (alive ? 1 : 0), 0);
}

/**
 * The index of the alive invader occupying field cell `(x, y)`, or null.
 *
 * This is the collision test, and it is the only one in the file. Everything
 * that can hit anything -- a shot meeting an invader -- goes through it, so
 * there is one definition of "an invader is there" rather than one per caller.
 */
export function invaderAt(fleet: Fleet, x: number, y: number): number | null {
  const col = x - fleet.x;
  const row = y - fleet.y;
  if (row < 0 || row >= FLEET_ROWS || col < 0 || col >= FLEET_COLS) return null;
  const at = index(row, col);
  return fleet.alive[at] === true ? at : null;
}

/** Whether the fleet has reached the ship's row, which ends the game. */
export function fleetHasLanded(fleet: Fleet): boolean {
  const bottom = bottomAliveRow(fleet);
  return bottom >= 0 && fleet.y + bottom >= SHIP_ROW;
}

function kill(alive: readonly boolean[], at: number): boolean[] {
  const next = [...alive];
  next[at] = false;
  return next;
}

/** Move the ship. Clamped to the field rather than wrapping or refusing. */
export function moveShip(game: Game, dx: number): Game {
  if (game.status !== 'playing') return game;
  const shipX = Math.max(0, Math.min(FIELD_COLS - 1, game.shipX + dx));
  return shipX === game.shipX ? game : { ...game, shipX };
}

/**
 * Fire.
 *
 * One shot in the air at a time, which is the original's rule and the whole of
 * the game's aim: you cannot spray, so a miss costs you the ticks it takes the
 * shot to leave the field. A `fire` while a shot is up is a no-op rather than an
 * error, because it is what a key held down produces.
 */
export function fire(game: Game): Game {
  if (game.status !== 'playing' || game.shots.length > 0) return game;
  return { ...game, shots: [{ x: game.shipX, y: SHIP_ROW - 1 }] };
}

/** The column to drop the next bomb from: the lowest rank with anyone in it. */
function shooterColumn(fleet: Fleet, random: () => number): number | null {
  const bottom = bottomAliveRow(fleet);
  if (bottom < 0) return null;
  const columns: number[] = [];
  for (let col = 0; col < FLEET_COLS; col++) {
    if (fleet.alive[index(bottom, col)] === true) columns.push(col);
  }
  if (columns.length === 0) return null;
  const picked = columns[Math.min(columns.length - 1, Math.floor(random() * columns.length))]!;
  return fleet.x + picked;
}

/** Advance the fleet one cell, reversing and dropping at a wall. */
function advance(fleet: Fleet): Fleet {
  const x = fleet.x + fleet.dx;
  if (x < 0 || x + FLEET_COLS > FIELD_COLS) {
    return { ...fleet, dx: fleet.dx === 1 ? -1 : 1, y: fleet.y + 1 };
  }
  return { ...fleet, x };
}

/**
 * Take one tick.
 *
 * The order of the four phases is load-bearing and is the reason this is one
 * function rather than a pipeline of exported steps:
 *
 * 1. **Shots move, then hit.** A shot resolves against the fleet where it was
 *    when the tick began, so a shot and the fleet it hit cannot both move and
 *    then be compared at their new positions -- which is the classic way an
 *    arcade collision test starts missing.
 * 2. **The fleet moves**, on its own cadence, after the shots have resolved.
 * 3. **The fleet's arrival is judged**, so a fleet that lands on the ship's row
 *    this tick ends the game this tick rather than next one.
 * 4. **Bombs move, then hit the ship**, and only then may the fleet fire.
 *
 * `random` is injected for the two things that are genuinely chance: which of
 * the bottom rank fires, and whether anyone does. A seeded generator therefore
 * makes a whole game reproducible, which is what a test needs and what an arcade
 * cabinet never had.
 */
export function step(game: Game, random: () => number = Math.random): Game {
  if (game.status !== 'playing') return game;

  const steps = game.steps + 1;
  let fleet = game.fleet;
  let score = game.score;
  let lives = game.lives;
  let status: Status = 'playing';

  // A fleet whose last invader has just died, or is about to be, is judged after
  // the shots resolve and before anything else moves.
  if (invadersLeft(fleet) === 0) {
    return nextWave(game, steps);
  }

  const shots: Shot[] = [];
  for (const shot of game.shots) {
    const y = shot.y - 1;
    if (y < 0) continue;
    const hit = invaderAt(fleet, shot.x, y);
    if (hit !== null) {
      score += pointsFor(Math.floor(hit / FLEET_COLS));
      fleet = { ...fleet, alive: kill(fleet.alive, hit) };
      continue;
    }
    shots.push({ x: shot.x, y });
  }

  if (steps % fleetPeriod(game.wave) === 0) fleet = advance(fleet);

  if (fleetHasLanded(fleet)) status = 'lost';

  const bombs: Shot[] = [];
  for (const bomb of game.bombs) {
    const y = bomb.y + 1;
    if (y >= FIELD_ROWS) continue;
    if (y === SHIP_ROW && bomb.x === game.shipX) {
      lives -= 1;
      if (lives <= 0) status = 'lost';
      continue;
    }
    bombs.push({ x: bomb.x, y });
  }

  if (status === 'playing' && bombs.length < MAX_BOMBS && random() < bombChance(game.wave)) {
    const x = shooterColumn(fleet, random);
    const bottom = bottomAliveRow(fleet);
    if (x !== null && bottom >= 0) bombs.push({ x, y: fleet.y + bottom });
  }

  const cleared = status === 'playing' && invadersLeft(fleet) === 0;
  if (cleared) {
    return nextWave({ ...game, fleet, score, lives, steps }, steps);
  }

  return { ...game, fleet, shots, bombs, score, lives, status, steps };
}

/**
 * The fleet that replaces a cleared one.
 *
 * The wave number is the only thing that carries, and it is what makes the game
 * get harder in a way a player can name: the fleet steps more often and drops
 * bombs more readily. The score is kept, because clearing a wave is the one
 * thing a player is allowed to be pleased about.
 */
function nextWave(game: Game, steps: number): Game {
  return {
    ...game,
    fleet: fullFleet(3, 1),
    shots: [],
    bombs: [],
    wave: game.wave + 1,
    status: 'playing',
    steps,
  };
}
