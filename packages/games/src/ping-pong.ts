/**
 * Ping pong, as rules rather than as a picture.
 *
 * A09's acceptance is "working interaction", which is the vaguest line in the
 * backlog and therefore the one that needs the most care in the reading: a rally
 * that only looks like a rally is exactly what a mock-up produces, so the
 * working part has to be something an assertion can hold. Here that is the ball
 * -- where it is, which way it is going, what it bounced off and who scored --
 * and none of it mentions a rig, a sun ray or a pixel.
 *
 * **The court is a continuous plane, not a grid, and that is the one decision
 * worth defending.** Space Invaders is cells because a bullet either is or is not
 * in a cell; a rally is *angles*, and an angle quantised to a cell is not a
 * rally. So the ball carries a velocity, and the two things that can go wrong
 * with floats are handled head on rather than wished away:
 *
 * - **Tunnelling.** A ball moving faster than a paddle is thick can pass clean
 *   through it between two ticks. The collision test is therefore a *crossing* --
 *   it compares the ball's position before and after the tick against the
 *   paddle's plane -- rather than "is the ball inside the paddle now", which is
 *   the test that misses exactly the fast balls the game is about.
 * - **Wall re-entry.** A ball that bounces off the top wall and is then tested
 *   against the top wall again would stick; the reflection clamps the ball back
 *   onto the wall in the same tick it reflects.
 *
 * Everything is immutable, so "the score went up by exactly one and the ball was
 * served toward the side that conceded" is an assertion rather than a screenshot.
 */

/** The court, in court units. Its own space; the renderer maps it onto a stage. */
export const COURT_WIDTH = 200;
export const COURT_HEIGHT = 200;

/** The walls the ball bounces off. The ball's edge meets them, not its centre. */
export const WALL_TOP = 26;
export const WALL_BOTTOM = 174;

/** Where each paddle's centre is, and how wide it is. */
export const PADDLE_LEFT_X = 40;
export const PADDLE_RIGHT_X = 160;
export const PADDLE_HALF_WIDTH = 9;

/**
 * Half the bat's length, and it is not a free number: the prop the character
 * draws (`paddle` in `@sunny/character`) is authored to this half-length, so the
 * bounce lands on the bat's edge instead of inside it or short of it. A ball
 * bounces when its centre is within `PADDLE_HALF + BALL_RADIUS` of the bat's
 * centre, which is the edge test written as arithmetic.
 */
export const PADDLE_HALF = 17;
export const BALL_RADIUS = 5;

/** How far the ball travels in one tick, how fast it may get, and how it gets there. */
export const BALL_STEP = 2.2;
export const MAX_BALL_STEP = 4.6;
/** Each paddle hit multiplies the speed by this, so a long rally accelerates. */
export const STEP_GAIN = 1.05;

/** How far a paddle moves in one tick. Sunny's own speed, and one keypress. */
export const PADDLE_SPEED = 2.9;
export const PADDLE_KICK = 5;

/** The steepest a paddle can send the ball, in degrees from the horizontal. */
const MAX_BOUNCE_DEG = 62;
const MAX_BOUNCE_RAD = (MAX_BOUNCE_DEG * Math.PI) / 180;

/** How far a bat's centre may travel: both walls, less the bat's own half-length. */
const PADDLE_LOW = WALL_TOP + PADDLE_HALF;
const PADDLE_HIGH = WALL_BOTTOM - PADDLE_HALF;

/** Points that win a rally. */
export const WIN_SCORE = 5;

export type Side = 'left' | 'right';
export type Status = 'playing' | 'over';

export interface Ball {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
}

/** A paddle, as the one number the rules care about: where its centre is. */
export interface Paddle {
  readonly y: number;
}

export interface Game {
  readonly ball: Ball;
  readonly paddles: Readonly<Record<Side, Paddle>>;
  readonly score: Readonly<Record<Side, number>>;
  /**
   * How many times a paddle has returned the ball in the current rally. This is
   * the scoreboard's "rally" and the thing A09's acceptance is actually about: a
   * game where the ball is never returned is a game with no rally in it.
   */
  readonly hits: number;
  /**
   * The side the visitor has taken over, or null while Sunny plays both ends.
   * A09's fourth word is "optional": the rally has to work when nobody is
   * playing it, so taking over is a choice rather than a requirement.
   */
  readonly controlled: Side | null;
  readonly status: Status;
  /** Ticks taken. Exposed so a test can bound a rally rather than run forever. */
  readonly steps: number;
  /** The side the last point went to, or null before the first point. */
  readonly lastPoint: Side | null;
}

const other = (side: Side): Side => (side === 'left' ? 'right' : 'left');

/** The plane a paddle's face presents to the ball, in ball-centre coordinates. */
export function facePlane(side: Side): number {
  return side === 'left'
    ? PADDLE_LEFT_X + PADDLE_HALF_WIDTH + BALL_RADIUS
    : PADDLE_RIGHT_X - PADDLE_HALF_WIDTH - BALL_RADIUS;
}

/**
 * Where the ball leaves the court: the back wall behind each paddle. It is the
 * court's edge rather than the paddle's plane, so a miss is something the visitor
 * *sees* -- the ball carries on past the bat for a beat before the point is
 * awarded -- instead of a teleport the instant it is past the bat's face.
 */
function backWall(side: Side): number {
  return side === 'left' ? 4 : COURT_WIDTH - 4;
}

const clamp = (v: number, low: number, high: number): number =>
  v < low ? low : v > high ? high : v;

/**
 * Serve the ball from the centre of the court toward `toward`.
 *
 * The angle comes from the injected generator so the opening ball is neither
 * always level (a rally with no angle in it never ends) nor irreproducible (a
 * test cannot assert a rally it cannot repeat).
 */
function serve(toward: Side, random: () => number): Ball {
  const angle = (random() - 0.5) * 0.7;
  const step = BALL_STEP;
  const sign = toward === 'right' ? 1 : -1;
  return {
    x: COURT_WIDTH / 2,
    y: COURT_HEIGHT / 2,
    vx: Math.cos(angle) * step * sign,
    vy: Math.sin(angle) * step,
  };
}

/** A fresh rally. Sunny serves it toward herself, so the first ball is hers to return. */
export function newGame(random: () => number = Math.random): Game {
  return {
    ball: serve('left', random),
    paddles: { left: centre(), right: centre() },
    score: { left: 0, right: 0 },
    hits: 0,
    controlled: null,
    status: 'playing',
    steps: 0,
    lastPoint: null,
  };
}

const centre = (): Paddle => ({ y: COURT_HEIGHT / 2 });

/** Move a paddle's centre by `dy`, clamped so the bat stays inside the court. */
export function movePaddle(paddle: Paddle, dy: number): Paddle {
  return { y: clamp(paddle.y + dy, PADDLE_LOW, PADDLE_HIGH) };
}

/**
 * Take over the right paddle, or hand it back with `null`.
 *
 * The paddle's position is left alone on the way in and out: a visitor who takes
 * over mid-rally inherits the bat where Sunny was holding it rather than having
 * it jump under their hand.
 */
export function takeOver(game: Game, side: Side | null): Game {
  return game.controlled === side ? game : { ...game, controlled: side };
}

/**
 * The visitor's own move.
 *
 * It takes the paddle over implicitly, which is what "optional user control"
 * means in practice: the first time someone presses up, they are playing -- and
 * a rally nobody touches still runs, because Sunny keeps both bats until then.
 */
export function moveVisitor(game: Game, dy: number): Game {
  if (game.status !== 'playing') return game;
  const side: Side = 'right';
  return {
    ...game,
    controlled: side,
    paddles: { ...game.paddles, [side]: movePaddle(game.paddles[side], dy) },
  };
}

/**
 * Where the ball will cross a paddle's face, as a y in the paddle's own band.
 *
 * She *predicts where the ball will cross* rather than chasing where it is,
 * which is what a player does and what makes her look like one. The prediction
 * is linear and unaware of the walls, so a ball that bounces off one on its way
 * in arrives somewhere she did not expect -- that, and the ball getting faster
 * on every return, is how she can be beaten. She is wrong the way a player is
 * wrong, not because a die was rolled against her.
 *
 * This is the prediction alone, and it is deliberately separate from where she
 * then puts her bat (`sunnyBatY`): a test about prediction should not have to
 * unpick a test about aiming, and vice versa.
 */
export function sunnyTarget(game: Game, side: Side): number {
  const incoming = side === 'left' ? game.ball.vx < 0 : game.ball.vx > 0;
  if (!incoming) return COURT_HEIGHT / 2;
  const ticksToArrive = Math.abs((facePlane(side) - game.ball.x) / game.ball.vx);
  const predicted = game.ball.y + game.ball.vy * ticksToArrive;
  // A ball bouncing off a wall changes vertical direction; the linear guess does
  // not, so mirror the guess back into the court instead of letting it run off.
  const span = PADDLE_HIGH - PADDLE_LOW;
  const period = span * 2;
  let reflected = (((predicted - PADDLE_LOW) % period) + period) % period;
  if (reflected > span) reflected = period - reflected;
  return PADDLE_LOW + reflected;
}

/**
 * Where Sunny puts her bat this tick, which is her prediction plus her aim.
 *
 * **Aim is what stops the rally being a metronome, and it is not a flourish.**
 * The bounce angle comes only from *where on the bat* the ball lands, so a bat
 * whose centre is always exactly at the crossing point returns a perfectly level
 * ball -- and two such bats rally forever in a dead straight line, hitting
 * nothing. That is not a rally; it is a pendulum. It is also exactly what a
 * prediction-based player does if you leave it at that, which is why every seed
 * of the naive version ended the same way.
 *
 * So she plays the ball rather than blocking it: she sends it to the side of the
 * court the other bat is *not* on, which means meeting it off-centre, which means
 * placing her bat away from the crossing point by the offset that produces that
 * angle. The bat still covers the ball -- the offset is exactly the tolerance
 * the return test allows -- and the rally picks up an angle, a wall bounce and a
 * mistake to make.
 */
export function sunnyBatY(game: Game, side: Side): number {
  const crossing = sunnyTarget(game, side);
  const incoming = side === 'left' ? game.ball.vx < 0 : game.ball.vx > 0;
  // Nothing is coming: hold the ready position, which is the middle.
  if (!incoming) return crossing;

  const opponentY = game.paddles[other(side)].y;
  const middle = (PADDLE_LOW + PADDLE_HIGH) / 2;
  const aim = opponentY < middle ? PADDLE_HIGH : PADDLE_LOW;
  const span = Math.abs(facePlane(other(side)) - facePlane(side));
  const angle = clamp(Math.atan2(aim - crossing, span), -MAX_BOUNCE_RAD, MAX_BOUNCE_RAD);
  // `bounce` is the inverse of this line: angle = offset * MAX_BOUNCE. The bat
  // therefore sits `offset` bat-radii off the crossing point, on the far side
  // from where she wants the ball to go.
  const offset = angle / MAX_BOUNCE_RAD;
  return clamp(crossing - offset * (PADDLE_HALF + BALL_RADIUS), PADDLE_LOW, PADDLE_HIGH);
}

/** Move a paddle toward `target`, by at most `PADDLE_SPEED`. */
function track(paddle: Paddle, target: number): Paddle {
  const delta = target - paddle.y;
  if (Math.abs(delta) <= PADDLE_SPEED) return { y: target };
  return movePaddle(paddle, Math.sign(delta) * PADDLE_SPEED);
}

/** Reflect the ball off a paddle, with the angle set by where on the bat it landed. */
function bounce(ball: Ball, paddle: Paddle, side: Side): Ball {
  const offset = clamp((ball.y - paddle.y) / (PADDLE_HALF + BALL_RADIUS), -1, 1);
  const step = Math.min(MAX_BALL_STEP, Math.hypot(ball.vx, ball.vy) * STEP_GAIN);
  const angle = (offset * MAX_BOUNCE_DEG * Math.PI) / 180;
  const outward = side === 'left' ? 1 : -1;
  return {
    x: facePlane(side),
    y: ball.y,
    vx: Math.cos(angle) * step * outward,
    vy: Math.sin(angle) * step,
  };
}

/**
 * Take one tick.
 *
 * The order is load-bearing. **Paddles move first**, because a paddle that
 * moved after the ball was tested would return a ball it was never level with.
 * **Then the ball moves**, and **then it is judged against where it was and where
 * it now is** -- the crossing tests below -- because that is the only comparison
 * a fast ball cannot slip through.
 */
export function step(game: Game, random: () => number = Math.random): Game {
  if (game.status !== 'playing') return game;

  const steps = game.steps + 1;
  let paddles = game.paddles;
  for (const side of ['left', 'right'] as const) {
    // The visitor's bat is theirs: Sunny does not fight them for it, and a bat
    // nobody has taken over is one she has to play herself.
    if (side === 'right' && game.controlled === 'right') continue;
    paddles = { ...paddles, [side]: track(paddles[side], sunnyBatY(game, side)) };
  }

  const before = game.ball;
  const ball: Ball = {
    x: before.x + before.vx,
    y: before.y + before.vy,
    vx: before.vx,
    vy: before.vy,
  };

  // Walls: reflect AND clamp in the same tick, so a ball cannot reflect twice off
  // the wall it is already past.
  let vy = ball.vy;
  let y = ball.y;
  if (y - BALL_RADIUS < WALL_TOP && vy < 0) {
    y = WALL_TOP + BALL_RADIUS;
    vy = -vy;
  } else if (y + BALL_RADIUS > WALL_BOTTOM && vy > 0) {
    y = WALL_BOTTOM - BALL_RADIUS;
    vy = -vy;
  }

  let next: Ball = { x: ball.x, y, vx: ball.vx, vy };

  // Paddles: the crossing test, and the only place a rally is extended.
  let hits = game.hits;
  for (const side of ['left', 'right'] as const) {
    const plane = facePlane(side);
    const crossed =
      side === 'left' ? before.x >= plane && ball.x < plane : before.x <= plane && ball.x > plane;
    if (!crossed) continue;
    const paddle = paddles[side];
    if (Math.abs(next.y - paddle.y) > PADDLE_HALF + BALL_RADIUS) continue;
    next = bounce(next, paddle, side);
    hits += 1;
  }

  // Scoring: the ball reaches a back wall. Only a miss can get there, because a
  // hit has already been turned around.
  for (const side of ['left', 'right'] as const) {
    const scored = side === 'left' ? next.x < backWall('left') : next.x > backWall('right');
    if (!scored) continue;
    const conceded = side;
    const winner = other(conceded);
    const score = { ...game.score, [winner]: game.score[winner] + 1 };
    const over = score[winner] >= WIN_SCORE;
    if (over) {
      return {
        ...game,
        ball: next,
        paddles,
        score,
        hits,
        status: 'over',
        steps,
        lastPoint: winner,
      };
    }
    return {
      ...game,
      ball: serve(conceded, random),
      paddles,
      score,
      hits: 0,
      steps,
      lastPoint: winner,
    };
  }

  return { ...game, ball: next, paddles, hits, steps };
}

/** Which side is ahead, or null when the score is level. Used by the status line. */
export function leader(game: Game): Side | null {
  if (game.score.left === game.score.right) return null;
  return game.score.left > game.score.right ? 'left' : 'right';
}

/** How far the ball is travelling, in court units per tick. */
export function ballSpeed(game: Game): number {
  return Math.hypot(game.ball.vx, game.ball.vy);
}
