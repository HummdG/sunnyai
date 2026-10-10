import { describe, expect, it } from 'vitest';

import { invaders } from '@sunny/games';

const {
  FIELD_COLS,
  FIELD_ROWS,
  FLEET_COLS,
  FLEET_ROWS,
  MAX_BOMBS,
  SHIP_ROW,
  START_LIVES,
  bombChance,
  bottomAliveRow,
  fire,
  fleetHasLanded,
  fleetPeriod,
  invadersLeft,
  invaderAt,
  moveShip,
  newGame,
  pointsFor,
  restart,
  step,
} = invaders;
type Fleet = invaders.Fleet;
type Game = invaders.Game;

/**
 * Space Invaders, tested as an arcade game rather than as a picture.
 *
 * The two injected generators are the whole of the test's control over chance,
 * and they are named for what they *do* rather than for the number they return:
 * `quiet` is a fleet that never drops a bomb, and `eager` is one that always
 * does and always fires from its leftmost column. A test that passed `() => 1`
 * and left the reader to work out that it meant "no bombs" would be a test
 * nobody could change safely.
 */
const quiet = () => 1;
const eager = () => 0;

const FLEET_SIZE = FLEET_ROWS * FLEET_COLS;

/** A game whose fleet has been moved or thinned, for positions play cannot reach. */
function withFleet(game: Game, patch: Partial<Fleet>): Game {
  return { ...game, fleet: { ...game.fleet, ...patch } };
}

/** All invaders alive except the listed ones, in reading order. */
function onlyAlive(alive: readonly number[]): boolean[] {
  return Array.from({ length: FLEET_SIZE }, (_, at) => alive.includes(at));
}

/** Step until `done`, or give up. The bound turns a hang into a failure. */
function until(
  game: Game,
  done: (state: Game) => boolean,
  random: () => number = quiet,
  limit = 400,
): Game {
  let current = game;
  for (let i = 0; i < limit && !done(current); i++) current = step(current, random);
  return current;
}

const aliveCount = (game: Game) => invadersLeft(game.fleet);

describe('the field', () => {
  it('starts full, with the ship in the middle and everything to play for', () => {
    const game = newGame();
    expect(aliveCount(game)).toBe(FLEET_SIZE);
    expect(game.fleet.x).toBe(3);
    expect(game.fleet.y).toBe(1);
    expect(game.fleet.dx).toBe(1);
    expect(game.shipX).toBe(Math.floor(FIELD_COLS / 2));
    expect(game.score).toBe(0);
    expect(game.lives).toBe(START_LIVES);
    expect(game.wave).toBe(1);
    expect(game.status).toBe('playing');
    expect(game.shots).toEqual([]);
    expect(game.bombs).toEqual([]);
  });

  it('keeps the fleet narrower than the field, so the ship always has somewhere to be', () => {
    expect(FLEET_COLS).toBeLessThan(FIELD_COLS);
  });

  it('says which fleet row is still occupied', () => {
    const game = newGame();
    expect(bottomAliveRow(game.fleet)).toBe(FLEET_ROWS - 1);
    // Only the top row left: the fleet's underside is the top row.
    const thinned = withFleet(game, { alive: onlyAlive([0, 1]) });
    expect(bottomAliveRow(thinned.fleet)).toBe(0);
    const empty = withFleet(game, { alive: Array.from({ length: FLEET_SIZE }, () => false) });
    expect(bottomAliveRow(empty.fleet)).toBe(-1);
    expect(invadersLeft(empty.fleet)).toBe(0);
  });
});

describe('the ship', () => {
  it('moves, and stops at the walls rather than wrapping', () => {
    expect(moveShip(newGame(), 1).shipX).toBe(newGame().shipX + 1);
    expect(moveShip(newGame(), -1).shipX).toBe(newGame().shipX - 1);

    // Walked to the wall by hand rather than by `until`, because ticking does
    // not move the ship: only the visitor does.
    let left = newGame();
    while (left.shipX > 0) left = moveShip(left, -1);
    expect(left.shipX).toBe(0);
    expect(moveShip(left, -1).shipX).toBe(0);
    expect(moveShip(moveShip(left, -1), -1).shipX).toBe(0);

    let right = newGame();
    while (right.shipX < FIELD_COLS - 1) right = moveShip(right, 1);
    expect(right.shipX).toBe(FIELD_COLS - 1);
    expect(moveShip(right, 1).shipX).toBe(FIELD_COLS - 1);
  });

  it('fires one shot at a time, and lets the next one go once the first has left', () => {
    const fired = fire(newGame());
    expect(fired.shots).toEqual([{ x: fired.shipX, y: SHIP_ROW - 1 }]);
    // A key held down produces a second `fire`, which is a no-op rather than an
    // error -- and rather than a second shot.
    expect(fire(fired).shots).toHaveLength(1);

    // The shot leaves the top of the field and can be fired again.
    const gone = until(fired, (game) => game.shots.length === 0, quiet, FIELD_ROWS + 1);
    expect(gone.shots).toEqual([]);
    expect(fire(gone).shots).toHaveLength(1);
  });

  it('will not fire from a game that is over', () => {
    const lost: Game = { ...newGame(), status: 'lost' };
    expect(fire(lost).shots).toEqual([]);
    expect(moveShip(lost, 1)).toBe(lost);
  });
});

describe('collision', () => {
  it('finds an invader only where one is', () => {
    const fleet = newGame().fleet; // occupies x 3..8, y 1..4
    expect(invaderAt(fleet, 3, 1)).toBe(0);
    expect(invaderAt(fleet, 8, 4)).toBe(FLEET_SIZE - 1);
    // One cell outside in each direction is empty, and so is the space below.
    expect(invaderAt(fleet, 2, 1)).toBeNull();
    expect(invaderAt(fleet, 9, 1)).toBeNull();
    expect(invaderAt(fleet, 3, 0)).toBeNull();
    expect(invaderAt(fleet, 3, 5)).toBeNull();
  });

  it('does not find an invader that has been killed', () => {
    const game = newGame();
    const killed = withFleet(game, {
      alive: onlyAlive(Array.from({ length: FLEET_SIZE }, (_, i) => i).filter((i) => i !== 0)),
    });
    expect(invaderAt(killed.fleet, 3, 1)).toBeNull();
    expect(invaderAt(killed.fleet, 4, 1)).toBe(1);
  });

  it('is hit by a shot fired straight up at it, and scored for the row it was in', () => {
    // The fleet's bottom row sits on field row 4 and the ship's shot starts on
    // row 10, so six ticks brings them together -- and on the sixth the fleet
    // also steps sideways, which is exactly the case where resolving the shot
    // against the fleet's *old* position is the difference between a hit and a
    // miss. That is why this test is six ticks and not "until something happens".
    const game = moveShip(newGame(), 3 - newGame().shipX);
    expect(game.shipX).toBe(3);

    const fired = fire(game);
    let current = fired;
    for (let i = 0; i < 6; i++) current = step(current, quiet);

    expect(aliveCount(current)).toBe(FLEET_SIZE - 1);
    expect(current.score).toBe(pointsFor(FLEET_ROWS - 1));
    expect(current.shots).toEqual([]);
  });

  it('lets a shot pass through a column with nothing in it and off the top', () => {
    // The fleet starts at column 3, so column 0 is empty however it steps.
    const game = { ...newGame(), shipX: 0 };
    const fired = fire(game);
    const gone = until(fired, (state) => state.shots.length === 0, quiet, FIELD_ROWS + 1);
    expect(gone.score).toBe(0);
    expect(aliveCount(gone)).toBe(FLEET_SIZE);
    expect(gone.shots).toEqual([]);
  });

  it('scores each fleet row for what it is worth, and the top row for the most', () => {
    expect(pointsFor(0)).toBeGreaterThan(pointsFor(FLEET_ROWS - 1));
    for (let row = 0; row < FLEET_ROWS; row++) expect(pointsFor(row)).toBeGreaterThan(0);
    // A row that does not exist is worth nothing rather than throwing: the
    // caller is a shot resolving against a fleet that may already have moved.
    expect(pointsFor(FLEET_ROWS)).toBe(0);
  });

  it('adds up: two kills score the sum of their rows', () => {
    // The first shot: fired from under the fleet's leftmost column at tick 0,
    // landing on the fleet's bottom row at tick 6. Six is also when the fleet
    // steps aside -- and it steps *after* the shot resolves, so the kill is
    // against the column the shot was aimed at.
    const game = { ...newGame(), shipX: 3 };
    const first = until(fire(game), (state) => state.score > 0, quiet, 20);
    expect(first.score).toBe(pointsFor(FLEET_ROWS - 1));
    expect(first.steps).toBe(fleetPeriod(1));
    expect(first.fleet.x).toBe(4);

    // The second shot is aimed *after* that step, at the next column along:
    // aiming at the same field column would now be aiming at empty sky, which is
    // what the first draft of this test did -- and `until` would simply give up
    // and the assertion would be about the timeout rather than about the score.
    const aimed = moveShip(first, first.fleet.x + 1 - first.shipX);
    const second = until(fire(aimed), (state) => state.score > first.score, quiet, 20);
    expect(second.score).toBe(first.score + pointsFor(FLEET_ROWS - 1));
    expect(aliveCount(second)).toBe(FLEET_SIZE - 2);
  });
});

describe('the fleet', () => {
  it('steps on its own cadence, not every tick', () => {
    const period = fleetPeriod(1);
    let current = newGame();
    for (let i = 1; i < period; i++) {
      current = step(current, quiet);
      expect(current.fleet.x, `the fleet moved on tick ${i}`).toBe(3);
    }
    current = step(current, quiet);
    expect(current.fleet.x).toBe(4);
  });

  it('reverses and drops a row when it reaches a wall', () => {
    // Right wall: three steps from x=3 reaches x=6, and the fourth turns it.
    let current = newGame();
    for (let i = 0; i < fleetPeriod(1) * 3; i++) current = step(current, quiet);
    expect(current.fleet.x).toBe(6);
    expect(current.fleet.dx).toBe(1);

    for (let i = 0; i < fleetPeriod(1); i++) current = step(current, quiet);
    expect(current.fleet.x).toBe(6);
    expect(current.fleet.dx).toBe(-1);
    expect(current.fleet.y).toBe(2);
  });

  it('reverses at the left wall too', () => {
    const game = withFleet(newGame(), { x: 0, dx: -1 });
    const moved = until(game, (state) => state.fleet.dx === 1, quiet, 20);
    expect(moved.fleet.x).toBe(0);
    expect(moved.fleet.y).toBe(2);
  });

  it('lands on the ship and ends the game when it gets there', () => {
    const near = withFleet(newGame(), { y: SHIP_ROW - (FLEET_ROWS - 1) });
    expect(fleetHasLanded(near.fleet)).toBe(true);
    const over = step(near, quiet);
    expect(over.status).toBe('lost');
    // And a game that is over does not carry on: further steps change nothing.
    expect(step(over, quiet)).toBe(over);
  });

  it('is not landed while it still has a row between it and the ship', () => {
    const far = withFleet(newGame(), { y: SHIP_ROW - FLEET_ROWS });
    expect(fleetHasLanded(far.fleet)).toBe(false);
    expect(step(far, quiet).status).toBe('playing');
  });
});

describe('the bombs', () => {
  it('drops one from the lowest rank when the fleet fires', () => {
    const bombed = step(newGame(), eager);
    expect(bombed.bombs).toHaveLength(1);
    const bomb = bombed.bombs[0]!;
    // From the fleet's bottom row, in its leftmost occupied column.
    expect(bomb.y).toBe(1 + FLEET_ROWS - 1);
    expect(bomb.x).toBe(3);
  });

  it('gets likelier as the waves go on, without becoming certain', () => {
    let previous = 0;
    for (let wave = 1; wave <= 8; wave++) {
      expect(bombChance(wave)).toBeGreaterThanOrEqual(previous);
      previous = bombChance(wave);
    }
    expect(bombChance(20)).toBeLessThan(1);
    expect(bombChance(20)).toBeLessThanOrEqual(0.35);
  });

  it('falls a cell a tick and leaves the field at the bottom rather than piling up', () => {
    const bombed = step(newGame(), eager);
    const fallen = step(bombed, quiet);
    expect(fallen.bombs[0]!.y).toBe(bombed.bombs[0]!.y + 1);
    const gone = until(bombed, (game) => game.bombs.length === 0, quiet, FIELD_ROWS + 2);
    expect(gone.bombs).toEqual([]);
  });

  it('never has more than the cap in the air, however keen the fleet is', () => {
    const busy = until(newGame(), (game) => game.status === 'lost', eager, 60);
    // A fleet dropping one every tick would otherwise fill the sky; the cap is
    // the thing that keeps the game losable rather than merely unlucky.
    let current = newGame();
    for (let i = 0; i < 40 && current.status === 'playing'; i++) {
      current = step(current, eager);
      expect(current.bombs.length).toBeLessThanOrEqual(MAX_BOMBS);
    }
    expect(busy.status === 'lost' || busy.status === 'playing').toBe(true);
  });

  it('costs a life when a bomb reaches the ship, and ends the game at the last one', () => {
    // The ship is parked under the column the first bomb comes from, so it
    // cannot avoid what it is about to receive -- which is the point: a hit has
    // to be *reachable* to be tested.
    const waiting = { ...newGame(), shipX: 3 };
    const hit = until(waiting, (game) => game.lives < START_LIVES, eager, 30);
    expect(hit.lives).toBe(START_LIVES - 1);
    expect(hit.status).toBe('playing');

    const last = { ...newGame(), shipX: 3, lives: 1 };
    const lost = until(last, (game) => game.status === 'lost', eager, 30);
    expect(lost.lives).toBe(0);
    expect(step(lost, quiet)).toBe(lost);
  });

  it('misses a ship that has moved out from under it', () => {
    const waiting = { ...newGame(), shipX: 3 };
    const bombed = step(waiting, eager);
    // Step aside before the bomb arrives: only the ship's own column is a hit.
    const dodged = until(
      moveShip(moveShip(bombed, 1), 1),
      (game) => game.bombs.length === 0,
      quiet,
      FIELD_ROWS + 2,
    );
    expect(dodged.lives).toBe(START_LIVES);
    expect(dodged.status).toBe('playing');
  });
});

describe('the waves', () => {
  it('replaces a cleared fleet, keeps the score, and clears the sky', () => {
    const empty = withFleet(newGame(), {
      alive: Array.from({ length: FLEET_SIZE }, () => false),
    });
    const next = step(
      { ...empty, score: 90, shots: [{ x: 1, y: 8 }], bombs: [{ x: 2, y: 5 }] },
      quiet,
    );
    expect(next.wave).toBe(2);
    expect(aliveCount(next)).toBe(FLEET_SIZE);
    expect(next.fleet.x).toBe(3);
    expect(next.fleet.y).toBe(1);
    expect(next.score).toBe(90);
    expect(next.shots).toEqual([]);
    expect(next.bombs).toEqual([]);
    expect(next.status).toBe('playing');
  });

  it('clears a fleet by shooting it, not only one emptied by hand', () => {
    // One invader left, in the fleet's *bottom* row rather than its top: the
    // shot leaves the ship five cells above the ship's row and takes a tick per
    // cell, so an invader on the top row would need nine ticks -- and the fleet
    // steps sideways every six, which is enough to walk out from under the shot.
    // The bottom row is one fleet-step away, which is the reach the game is
    // actually played at.
    const last = withFleet(
      { ...newGame(), shipX: 3 },
      { alive: onlyAlive([(FLEET_ROWS - 1) * FLEET_COLS]) },
    );
    const cleared = until(fire(last), (game) => game.wave > 1, quiet, 40);
    expect(cleared.wave).toBe(2);
    expect(cleared.score).toBe(pointsFor(FLEET_ROWS - 1));
    expect(aliveCount(cleared)).toBe(FLEET_SIZE);
    expect(cleared.fleet).toEqual(newGame().fleet);
  });

  it('gets faster every wave and then stops getting faster', () => {
    expect(fleetPeriod(2)).toBeLessThan(fleetPeriod(1));
    expect(fleetPeriod(5)).toBeLessThan(fleetPeriod(4));
    // The floor: a fleet that stepped every tick would be a loss, not a game.
    expect(fleetPeriod(50)).toBe(2);
  });
});

describe('restart', () => {
  it('keeps nothing at all -- not the score, not the wave, not the field', () => {
    const over: Game = {
      ...newGame(4),
      score: 250,
      lives: 0,
      status: 'lost',
      steps: 411,
      shots: [{ x: 1, y: 2 }],
      bombs: [{ x: 5, y: 6 }],
    };
    const fresh = restart();
    expect(fresh).toEqual(newGame());
    expect(fresh.score).toBe(0);
    expect(fresh.wave).toBe(1);
    expect(fresh.lives).toBe(START_LIVES);
    expect(fresh.status).toBe('playing');
    expect(fresh.steps).toBe(0);
    expect(fresh.shots).toEqual([]);
    expect(fresh.bombs).toEqual([]);
    expect(aliveCount(fresh)).toBe(FLEET_SIZE);
    // The position it replaced was genuinely different, so the assertions above
    // are about `restart` rather than about two identical fresh games.
    expect(over.lives).toBe(0);
    expect(over.wave).toBe(4);
  });

  it('leaves the game it restarts untouched', () => {
    const over = until(
      { ...newGame(), shipX: 3, lives: 1 },
      (game) => game.status === 'lost',
      eager,
      40,
    );
    const snapshot = structuredClone(over);
    restart();
    expect(over).toEqual(snapshot);
  });
});

describe('determinism', () => {
  it('plays the same game twice from the same generator', () => {
    // A generator that is a pure counter is the cheapest stand-in for a seeded
    // one: both produce the same sequence, and both make "play it again" mean
    // something a test can assert.
    const counter = () => {
      let n = 0;
      return () => {
        n = (n + 1) % 7;
        return n / 7;
      };
    };
    const play = (random: () => number) => {
      let game = newGame();
      for (let i = 0; i < 120; i++) {
        if (i % 3 === 0) game = fire(game);
        if (i % 11 === 0) game = moveShip(game, i % 22 === 0 ? 1 : -1);
        game = step(game, random);
      }
      return game;
    };
    const first = play(counter());
    const second = play(counter());
    expect(first).toEqual(second);
    // A floor rather than the loop count, because a game that ends stops
    // ticking: `step` on a lost game returns the position it was handed, which
    // is why the `steps` here is below 120. That the same seed loses on the same
    // tick is the claim -- an exact 120 would be a claim about the
    // counter wrapping rather than about the game.
    expect(first.steps).toBeGreaterThan(60);
    expect(first.score).toBeGreaterThan(0);
    expect(first.steps).toBe(second.steps);
  });

  it('does not mutate the position it was handed', () => {
    const game = newGame();
    const before = structuredClone(game);
    fire(moveShip(game, 1));
    step(game, eager);
    expect(game).toEqual(before);
  });
});
