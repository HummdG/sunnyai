import { describe, expect, it } from 'vitest';

import { pingPong } from '../src/index.js';
import type { Game } from '../src/ping-pong.js';

const {
  BALL_RADIUS,
  BALL_STEP,
  WIN_SCORE,
  WALL_BOTTOM,
  WALL_TOP,
  COURT_HEIGHT,
  COURT_WIDTH,
  MAX_BALL_STEP,
  PADDLE_HALF,
  PADDLE_LEFT_X,
  PADDLE_RIGHT_X,
  PADDLE_SPEED,
  facePlane,
  ballSpeed,
  movePaddle,
  moveVisitor,
  newGame,
  step,
  sunnyBatY,
  sunnyTarget,
  takeOver,
} = pingPong;

/** A deterministic generator, so a rally can be asserted rather than sampled. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const level = (): Record<'left' | 'right', { y: number }> => ({
  left: { y: COURT_HEIGHT / 2 },
  right: { y: COURT_HEIGHT / 2 },
});

/**
 * A game built to order, because most of these tests are about one collision and
 * building one by serving would mean replaying a rally to reach the interesting
 * frame. The boards below are the rules' own inputs, not a second copy of them.
 */
function arranged(over: Partial<Game> = {}): Game {
  return {
    ball: { x: COURT_WIDTH / 2, y: COURT_HEIGHT / 2, vx: BALL_STEP, vy: 0 },
    paddles: level(),
    score: { left: 0, right: 0 },
    hits: 0,
    controlled: null,
    status: 'playing',
    steps: 0,
    lastPoint: null,
    ...over,
  };
}

describe('the court', () => {
  it('keeps the two faces either side of the middle, and inside the bat', () => {
    expect(PADDLE_LEFT_X).toBeLessThan(PADDLE_RIGHT_X);
    expect(facePlane('left')).toBeGreaterThan(PADDLE_LEFT_X);
    expect(facePlane('right')).toBeLessThan(PADDLE_RIGHT_X);
    expect(facePlane('left')).toBeLessThan(facePlane('right'));
  });

  it('serves a new rally toward Sunny, level, at the court centre', () => {
    const game = newGame(seeded(1));
    expect(game.status).toBe('playing');
    expect(game.score).toEqual({ left: 0, right: 0 });
    expect(game.hits).toBe(0);
    expect(game.controlled).toBeNull();
    expect(game.ball.x).toBe(COURT_WIDTH / 2);
    expect(game.ball.vx).toBeLessThan(0);
    expect(ballSpeed(game)).toBeCloseTo(BALL_STEP, 6);
  });
});

describe('moving a paddle', () => {
  it('clamps to the court rather than letting the bat leave it', () => {
    const high = movePaddle({ y: WALL_TOP + PADDLE_HALF }, -1000);
    const low = movePaddle({ y: WALL_BOTTOM - PADDLE_HALF }, 1000);
    expect(high.y).toBe(WALL_TOP + PADDLE_HALF);
    expect(low.y).toBe(WALL_BOTTOM - PADDLE_HALF);
  });

  it('is taken over by the visitor on their first move, and only on the right', () => {
    const game = moveVisitor(newGame(seeded(1)), 4);
    expect(game.controlled).toBe('right');
    expect(game.paddles.right.y).toBe(COURT_HEIGHT / 2 + 4);
    expect(game.paddles.left.y).toBe(COURT_HEIGHT / 2);
  });

  it('hands the bat back, leaving it where it was', () => {
    const taken = moveVisitor(newGame(seeded(1)), 6);
    const back = takeOver(taken, null);
    expect(back.controlled).toBeNull();
    expect(back.paddles.right.y).toBe(taken.paddles.right.y);
  });
});

describe('the rally', () => {
  it('returns a ball that meets the bat, and counts the return', () => {
    const game = arranged({
      ball: { x: facePlane('left') + 2, y: 100, vx: -BALL_STEP, vy: 0 },
    });
    const played = step(game);
    expect(played.hits).toBe(1);
    expect(played.ball.vx).toBeGreaterThan(0);
    expect(played.ball.x).toBe(facePlane('left'));
  });

  it('does not return a ball the bat is not level with, and awards the point', () => {
    // The left bat is parked low and the ball passes high, so nothing bounces and
    // the ball reaches the back wall behind it.
    let game = arranged({
      ball: { x: facePlane('left') + 2, y: 150, vx: -BALL_STEP, vy: 0 },
      paddles: { left: { y: WALL_TOP + PADDLE_HALF }, right: { y: 100 } },
      controlled: 'right',
    });
    for (let i = 0; i < 60 && game.score.right === 0; i++) game = step(game);
    expect(game.hits).toBe(0);
    expect(game.score.right).toBe(1);
    expect(game.lastPoint).toBe('right');
    // The ball is served again, from the centre, toward the side that conceded.
    expect(game.ball.x).toBe(COURT_WIDTH / 2);
    expect(game.ball.vx).toBeLessThan(0);
  });

  it('will not let a ball tunnel through a bat it crosses in one tick', () => {
    // The ball is more than a bat thick past the plane in a single tick, which is
    // exactly the frame a "is it inside the paddle now" test misses.
    const game = arranged({
      ball: { x: facePlane('left') + 26, y: 100, vx: -30, vy: 0 },
    });
    const played = step(game);
    expect(played.hits).toBe(1);
    expect(played.ball.vx).toBeGreaterThan(0);
    expect(played.ball.x).toBe(facePlane('left'));
  });

  it('bounces off the walls and stays inside the court', () => {
    let game = arranged({ ball: { x: 100, y: WALL_TOP + BALL_RADIUS + 1, vx: 1, vy: -4 } });
    for (let i = 0; i < 200; i++) {
      game = step(game);
      if (game.status !== 'playing') break;
      expect(game.ball.y - BALL_RADIUS).toBeGreaterThanOrEqual(WALL_TOP - 1e-9);
      expect(game.ball.y + BALL_RADIUS).toBeLessThanOrEqual(WALL_BOTTOM + 1e-9);
    }
  });

  it('sends the ball away at an angle set by where it met the bat', () => {
    // The visitor's bat, because the rules never move it: whatever y the test
    // gives it is the y the ball meets, which is the variable under test. Sunny's
    // own bat is being aimed this tick, so it is not a fixed edge to aim at.
    const at = (y: number) =>
      step(
        arranged({
          controlled: 'right',
          ball: { x: facePlane('right') - 2, y, vx: BALL_STEP, vy: 0 },
        }),
      );
    const middle = at(100);
    const edge = at(100 + PADDLE_HALF + 4);
    expect(Math.abs(middle.ball.vy)).toBeLessThan(0.001);
    expect(edge.ball.vy).toBeGreaterThan(1);
    expect(edge.ball.vx).toBeLessThan(0);
  });

  it('speeds the ball up on every return, up to a ceiling', () => {
    // A whole game is played and the speed is read only on the ticks where a bat
    // actually returned the ball. Overriding the bats to force that would be
    // testing a game the rules cannot reach, and the speed-up is a fact about
    // the rules.
    const rng = seeded(5);
    let game = newGame(rng);
    let scored = 0;
    const rallies: number[][] = [[]];
    for (let i = 0; i < 40_000 && game.status === 'playing'; i++) {
      const hits = game.hits;
      game = step(game, rng);
      if (game.hits < hits) rallies.push([]); // a point started a fresh rally
      if (game.hits > hits) rallies.at(-1)!.push(ballSpeed(game));
      if (game.score.left + game.score.right > scored) scored = game.score.left + game.score.right;
    }

    const all = rallies.flat();
    expect(all.length).toBeGreaterThan(10);
    for (const speed of all) expect(speed).toBeLessThanOrEqual(MAX_BALL_STEP + 1e-9);

    // Each return is a little faster than the one before it in the same rally.
    // Once the cap is reached the speed stops rising, and hypot's rounding on the
    // way back out leaves it a hair either side of the ceiling, so the comparison
    // is monotone within a tolerance rather than strictly.
    const sustained = rallies.filter((r) => r.length >= 4);
    expect(sustained.length).toBeGreaterThan(0);
    for (const speeds of sustained) {
      for (let i = 1; i < speeds.length; i++) {
        expect(speeds[i]!).toBeGreaterThan(speeds[i - 1]! - 1e-9);
      }
      expect(speeds.at(-1)!).toBeGreaterThan(speeds[0]!);
    }

    // ...and the ceiling is a real ceiling: a rally reaches it and stops there.
    expect(Math.max(...all)).toBeCloseTo(MAX_BALL_STEP, 6);
  });

  it('is over, and stays over, once a side reaches the winning score', () => {
    let game = arranged({
      score: { left: 0, right: WIN_SCORE - 1 },
      ball: { x: facePlane('left') + 2, y: 150, vx: -BALL_STEP, vy: 0 },
      paddles: { left: { y: WALL_TOP + PADDLE_HALF }, right: { y: 100 } },
      controlled: 'right',
    });
    for (let i = 0; i < 60 && game.status === 'playing'; i++) game = step(game);
    expect(game.status).toBe('over');
    expect(game.score.right).toBe(WIN_SCORE);
    expect(step(game)).toBe(game);
  });
});

describe("Sunny's play", () => {
  it('aims where the ball will cross her face, not at where it is', () => {
    const game = arranged({
      ball: { x: 120, y: 100, vx: -BALL_STEP, vy: BALL_STEP },
      paddles: { left: { y: 100 }, right: { y: 100 } },
    });
    // Arriving low and getting lower: her target is below the ball's own height.
    expect(sunnyTarget(game, 'left')).toBeGreaterThan(game.ball.y);
  });

  it('never asks for a paddle outside the court, however flat the guess', () => {
    for (let vy = -6; vy <= 6; vy += 0.5) {
      for (let x = 60; x < 140; x += 5) {
        for (let opponent = 60; opponent <= 140; opponent += 10) {
          const game = arranged({
            ball: { x, y: 100, vx: -BALL_STEP, vy },
            paddles: { left: { y: 100 }, right: { y: opponent } },
          });
          for (const asked of [sunnyTarget(game, 'left'), sunnyBatY(game, 'left')]) {
            expect(asked).toBeGreaterThanOrEqual(WALL_TOP + PADDLE_HALF - 1e-9);
            expect(asked).toBeLessThanOrEqual(WALL_BOTTOM - PADDLE_HALF + 1e-9);
          }
        }
      }
    }
  });

  it('rallies: with nobody playing, the ball comes back', () => {
    // The acceptance A09 is actually about. The generator is fixed, so this is a
    // rally and not a sample of rallies.
    let game = newGame(seeded(7));
    let best = 0;
    for (let i = 0; i < 6000 && game.status === 'playing'; i++) {
      game = step(game);
      best = Math.max(best, game.hits);
    }
    expect(best).toBeGreaterThanOrEqual(3);
  });

  it('can be beaten: two of her ends play a game out to a winner', () => {
    // The property that failed first, and the reason `sunnyBatY` exists. With the
    // prediction alone, both bats met the ball dead centre, the ball levelled off
    // and the rally never ended -- 20,000 ticks without a single point, for every
    // seed. The prediction is linear and unaware of the walls, so a ball that
    // bounces off one arrives somewhere she did not expect; that, and the ball
    // getting faster, has to be worth points.
    for (const seed of [7, 11, 3, 42]) {
      let game = newGame(seeded(seed));
      const rng = seeded(seed * 1000 + 1);
      for (let i = 0; i < 20_000 && game.status === 'playing'; i++) game = step(game, rng);
      expect(game.status, `seed ${seed}`).toBe('over');
      expect(Math.max(game.score.left, game.score.right), `seed ${seed}`).toBe(WIN_SCORE);
    }
  });

  it('returns the ball to the side of the court the other bat is not on', () => {
    // The aiming, stated as the thing it is for. Her bat is deliberately off the
    // crossing point, and the return leaves at an angle because of it.
    const game = arranged({
      ball: { x: 120, y: 100, vx: -BALL_STEP, vy: 0 },
      paddles: { left: { y: 100 }, right: { y: WALL_TOP + PADDLE_HALF } },
    });
    const crossing = sunnyTarget(game, 'left');
    // The other bat is at the top, so she sends the ball down: her bat sits above
    // the crossing point, and the ball meets it low.
    expect(sunnyBatY(game, 'left')).toBeLessThan(crossing);
    // The bat still covers the ball -- the offset is the return tolerance.
    expect(Math.abs(sunnyBatY(game, 'left') - crossing)).toBeLessThanOrEqual(
      PADDLE_HALF + BALL_RADIUS + 1e-9,
    );
  });

  it('does not move the visitor’s bat once they have taken it', () => {
    const game = arranged({
      controlled: 'right',
      ball: { x: 120, y: 100, vx: BALL_STEP, vy: 3 },
      paddles: { left: { y: 100 }, right: { y: 100 } },
    });
    const played = step(game);
    expect(played.paddles.right.y).toBe(100);
    // Sunny keeps the left bat moving at her own speed and no faster.
    expect(Math.abs(played.paddles.left.y - 100)).toBeLessThanOrEqual(PADDLE_SPEED + 1e-9);
  });
});
