import { armTo, defaultRig, rayTip, renderSunny } from '@sunny/character';
import type { SunnyRig, Vec2 } from '@sunny/character';
import { pingPong } from '@sunny/games';

import { el } from './dom.js';
import type { GameHost } from './game.js';

/**
 * Ping pong, as the visitor plays it (A09).
 *
 * The row reads "Paddle from ray, rally, optional user control", and the three
 * of them are three different kinds of work, so the file is arranged around
 * them:
 *
 * - **Paddle from ray** is the ray-to-arm morph, and it is why the character is
 *   in the scene at all rather than a sprite: one of Sunny's eight rays is aimed
 *   at where her bat is and stretched until its tip is there (`armTo`), and the
 *   `paddle` prop hangs off that tip. Nothing else about her moves -- an arm that
 *   moved her whole body would not read as an arm.
 * - **The rally** is `@sunny/games` and not one line of it is restated here. The
 *   rules own the ball, the bounces and the score; this file owns pixels.
 * - **Optional user control** is the arrow keys. Nothing has to be taken over for
 *   the rally to run -- Sunny plays both ends until someone presses a key, which
 *   is what makes the control optional rather than a prerequisite.
 *
 * **The clock is the stage's, on a fixed step.** A06's board borrows the stage
 * clock so the debug slider can pause and scrub it, and a rally wants the same.
 * The difference is the accumulator: the ball moves a fixed distance per tick, so
 * a tick has to exist before the ball can move in it, and stepping by the frame's
 * own delta would make the ball's speed a function of the frame rate. Owed ticks
 * are capped, so a backgrounded tab resumes where it was rather than with the
 * rally already lost.
 *
 * Unlike the arcade this is *not* a bundle of its own. A08's fourth word is
 * "lazy-loaded" and this row's is not, so there is nothing here for a separate
 * file to prove -- and it shares the stage clock with the board, which a separate
 * bundle could not reach.
 */

/** How long one tick of the rally lasts, in stage-clock milliseconds. */
export const STEP_MS = 16;

/**
 * The most ticks that may be owed at once. A backgrounded tab owes hundreds;
 * capping them means the visitor finds the rally where they left it.
 */
const MAX_CATCHUP = STEP_MS * 6;

/**
 * The scene, in SVG units, and where the court sits inside it.
 *
 * The court is 200 x 200 -- `@sunny/games`' own coordinates, mapped 1:1 -- and
 * the gutter to its left is the character's. She has to stand *outside* the
 * court: the ball is served from the middle and a miss is watched travelling
 * past her bat, so a character standing over the back wall would hide the one
 * frame that says the point was lost. Every number below is that constraint
 * worked out rather than chosen.
 */
const SVG_WIDTH = 308;
const SVG_HEIGHT = 200;
const COURT_X = 106;

/**
 * Where she stands. `CHAR_X` is the one number with a real limit on it: her rays
 * reach 75.5 body units in every direction, so at this scale the leftmost ray tip
 * is at x = 1.6 and stays inside the picture. Any further left and her own rays
 * would be cropped by the viewBox.
 */
const CHAR_X = 62;
const CHAR_Y = 100;
const CHAR_SCALE = 0.8;

/**
 * Which of her eight rays becomes the arm.
 *
 * The third points right at rest (91.5 degrees), which is the side the court is
 * on, so the morph is mostly the ray growing rather than the ray appearing to
 * swing round her body. The other seven stay as they are: the rig's control is
 * "independent ray transforms", and hiding them would be this file deciding that
 * the reference character's rays are arms.
 */
const ARM_RAY = 2;

export interface PongPanel {
  readonly element: HTMLElement;
  /**
   * Advance the rally on the stage clock. Returns whether the ball moved, so a
   * caller that redraws on change does not have to redraw every frame.
   */
  tick(now: number): boolean;
}

/**
 * Build the table and start playing. `host` is the same three things A06's board
 * is handed -- the animator to talk to, the clock to run on, and the redraw to
 * call -- so the two panels are mounted the same way rather than two ways.
 */
export function pongPanel(host: GameHost): PongPanel {
  let game = pingPong.newGame();
  /** Ticks owed to the clock, accrued so a slow frame is not a lost tick. */
  let owed = 0;
  /** The last stage-clock reading, or null before the first tick. */
  let last: number | null = null;
  /** Keys held down, so the visitor's bat moves on the tick and not on the repeat. */
  const held = new Set<'up' | 'down'>();

  const scene = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  scene.setAttribute('viewBox', `0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`);
  scene.setAttribute('role', 'img');
  scene.setAttribute('aria-label', 'Sunny at a ping pong table, mid-rally');

  const surface = el('div', { class: 'pong-surface', tabindex: '0', role: 'application' });
  surface.setAttribute('aria-label', 'Ping pong: the up and down arrows move your bat');
  surface.append(scene);

  const message = el('p', { class: 'game-status', 'data-readout': 'status' });
  const leftScore = el('span', { class: 'mono', 'data-readout': 'sunny' });
  const rightScore = el('span', { class: 'mono', 'data-readout': 'you' });
  const rally = el('span', { class: 'mono', 'data-readout': 'rally' });

  const up = el('button', { class: 'btn small', type: 'button', text: '▲', 'data-key': 'up' });
  const down = el('button', { class: 'btn small', type: 'button', text: '▼', 'data-key': 'down' });
  const take = el('button', { class: 'btn small', type: 'button', text: 'Hand back to Sunny' });
  const again = el('button', { class: 'btn small', type: 'button', text: 'New rally' });

  // A button is a click, not a hold, so it moves the bat one kick. The keys move
  // it per tick at the speed Sunny plays at, which is the fair comparison: a
  // visitor should not lose to the rules' own pacing.
  // Court y grows downwards, as SVG's does, so "up" is the negative move.
  up.addEventListener('click', () => move(-pingPong.PADDLE_KICK));
  down.addEventListener('click', () => move(pingPong.PADDLE_KICK));
  take.addEventListener('click', () => {
    game = pingPong.takeOver(game, null);
    draw();
  });
  again.addEventListener('click', () => restart());

  const keys = (event: KeyboardEvent, down: boolean): void => {
    if (event.key === 'ArrowUp' || event.key === 'w' || event.key === 'W') {
      if (down) held.add('up');
      else held.delete('up');
    } else if (event.key === 'ArrowDown' || event.key === 's' || event.key === 'S') {
      if (down) held.add('down');
      else held.delete('down');
    } else {
      return;
    }
    event.preventDefault();
  };
  surface.addEventListener('keydown', (event) => keys(event, true));
  surface.addEventListener('keyup', (event) => keys(event, false));
  // A blurred panel never sees the keyup, and a bat that went on moving forever
  // would be the one bug a visitor could not correct.
  surface.addEventListener('blur', () => held.clear());

  const element = el('div', { class: 'pong' }, [
    surface,
    el('div', { class: 'pong-side' }, [
      message,
      el('div', { class: 'arcade-readout' }, [
        labelled('Sunny', leftScore),
        labelled('You', rightScore),
        labelled('Rally', rally),
      ]),
      el('div', { class: 'btn-row' }, [up, down, take, again]),
      el('p', {
        class: 'note',
        text:
          'Arrow keys or W and S move the bat, and the first press is what takes it over — ' +
          'until then Sunny plays both ends, which is the whole of "optional". She aims her ' +
          'returns at the side of the court your bat is not on; her one weakness is that she ' +
          'predicts in a straight line, so a ball that bounces off a wall on its way in ' +
          'arrives where she is not.',
      }),
    ]),
  ]);

  /** Move the visitor's bat by `dy` court units, which also takes it over. */
  function move(dy: number): void {
    game = pingPong.moveVisitor(game, dy);
    draw();
  }

  function restart(): void {
    game = pingPong.newGame();
    owed = 0;
    held.clear();
    host.animator().dispatch({ type: 'play_started' }, host.now());
    draw();
    host.redraw();
  }

  /**
   * Her pose for this frame: a whole character with one ray morphed into an arm.
   *
   * The target is the bat's centre expressed in *her* body frame, which is where
   * `armTo` works -- the rig's coordinates are the body's, not the picture's, and
   * the renderer applies the scale on the way out. Getting this wrong is the one
   * mistake that looks almost right: the arm points the right way and is simply
   * the wrong length.
   */
  function poseRig(): SunnyRig {
    const rig = defaultRig();
    rig.x = CHAR_X;
    rig.y = CHAR_Y;
    rig.scale = CHAR_SCALE;
    const target: Vec2 = {
      x: (COURT_X + pingPong.PADDLE_LEFT_X - CHAR_X) / CHAR_SCALE,
      y: (game.paddles.left.y - CHAR_Y) / CHAR_SCALE,
    };
    const arm = armTo(rig.rays[ARM_RAY]!, target);
    rig.rays[ARM_RAY] = arm;
    const tip = rayTip(arm);
    // The prop is drawn in the body frame and scaled with it, so the inverse
    // scale puts the bat back at the court's own size: the blade is authored to
    // `PADDLE_HALF`, and the bounce lands on it because of that and not by luck.
    rig.props = [
      { id: 'paddle', x: tip.x, y: tip.y, rotation: 0, scale: 1 / CHAR_SCALE, opacity: 1 },
    ];
    return rig;
  }

  function draw(): void {
    const at = (x: number): number => COURT_X + x;
    const bat = game.paddles.right;
    const over = game.score.left >= pingPong.WIN_SCORE || game.score.right >= pingPong.WIN_SCORE;
    scene.innerHTML = [
      // The table, and then the part of it the ball can actually be in. The walls
      // are the edges of the second rect rather than lines drawn near them,
      // because the ball's edge meets the wall and a wall that is not where the
      // bounce happens is a lie about the rules.
      `<rect class="pong-court" x="${COURT_X}" y="1" width="${pingPong.COURT_WIDTH}" height="${pingPong.COURT_HEIGHT - 2}" rx="16"/>`,
      `<rect class="pong-field" x="${at(0)}" y="${pingPong.WALL_TOP}" width="${pingPong.COURT_WIDTH}" height="${pingPong.WALL_BOTTOM - pingPong.WALL_TOP}"/>`,
      renderSunny(poseRig(), { title: 'Sunny at the table', uniqueIds: true }),
      `<line class="pong-wall" x1="${at(0)}" y1="${pingPong.WALL_TOP}" x2="${at(pingPong.COURT_WIDTH)}" y2="${pingPong.WALL_TOP}"/>`,
      `<line class="pong-wall" x1="${at(0)}" y1="${pingPong.WALL_BOTTOM}" x2="${at(pingPong.COURT_WIDTH)}" y2="${pingPong.WALL_BOTTOM}"/>`,
      `<line class="pong-centre" x1="${at(pingPong.COURT_WIDTH / 2)}" y1="${pingPong.WALL_TOP}" x2="${at(pingPong.COURT_WIDTH / 2)}" y2="${pingPong.WALL_BOTTOM}"/>`,
      // Only the right bat is drawn: Sunny's is the paddle on the end of her arm.
      `<rect class="pong-bat" x="${at(pingPong.PADDLE_RIGHT_X - pingPong.PADDLE_HALF_WIDTH)}" y="${bat.y - pingPong.PADDLE_HALF}" width="${pingPong.PADDLE_HALF_WIDTH * 2}" height="${pingPong.PADDLE_HALF * 2}" rx="3"/>`,
      `<circle class="pong-ball" cx="${at(game.ball.x)}" cy="${game.ball.y}" r="${pingPong.BALL_RADIUS}"/>`,
    ].join('');

    leftScore.textContent = String(game.score.left);
    rightScore.textContent = String(game.score.right);
    rally.textContent = String(game.hits);
    message.textContent = over
      ? game.score.left >= pingPong.WIN_SCORE
        ? 'Sunny took the game. New rally?'
        : 'You took the game. New rally?'
      : game.controlled === 'right'
        ? 'Your bat. Arrow keys or W and S.'
        : 'Sunny is playing both ends — press a key to take the right bat.';
    take.disabled = game.controlled !== 'right';

    // The facts, as facts, so a test asserts on the game rather than on prose.
    element.dataset.status = game.status;
    element.dataset.score = `${game.score.left}-${game.score.right}`;
    element.dataset.hits = String(game.hits);
    element.dataset.controlled = game.controlled ?? 'sunny';
    element.dataset.steps = String(game.steps);
    element.dataset.ball = `${game.ball.x.toFixed(1)},${game.ball.y.toFixed(1)}`;
    element.dataset.speed = pingPong.ballSpeed(game).toFixed(2);
  }

  // A game starting is the moment the catalogue says Sunny shows off, whether or
  // not the visitor pressed anything to cause it.
  host.animator().dispatch({ type: 'play_started' }, host.now());
  draw();
  host.redraw();

  return {
    element,
    tick(now: number): boolean {
      // The scrubber can move the stage clock backwards. The rally is not a pure
      // function of that clock -- it is a running game -- so a rewind drops the
      // ticks it was owed and plays on from where it is, rather than replaying.
      if (last === null || now < last) {
        last = now;
        owed = 0;
      }
      owed += now - last;
      last = now;

      if (game.status !== 'playing') {
        owed = 0;
        return false;
      }
      owed = Math.min(owed, MAX_CATCHUP);

      let moved = false;
      while (owed >= STEP_MS) {
        owed -= STEP_MS;
        moved = true;
        const direction = (held.has('down') ? 1 : 0) - (held.has('up') ? 1 : 0);
        if (direction !== 0) game = pingPong.moveVisitor(game, direction * pingPong.PADDLE_SPEED);
        const before = game.score.left + game.score.right;
        game = pingPong.step(game);
        if (game.score.left + game.score.right > before) {
          // A point is a moment: hers to be quietly pleased about, the visitor's
          // to be pleased *for*. The vocabulary's own reading, as A06's board has
          // it.
          host
            .animator()
            .dispatch({ type: game.lastPoint === 'left' ? 'impress' : 'celebrate' }, now);
          host.redraw();
        }
      }

      if (moved) draw();
      return moved;
    },
  };
}

function labelled(label: string, control: HTMLElement): HTMLElement {
  return el('label', { class: 'field' }, [
    el('span', { class: 'field-label', text: label }),
    control,
  ]);
}
