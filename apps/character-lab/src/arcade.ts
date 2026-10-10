import { invaders } from '@sunny/games';

/**
 * Space Invaders, as an arcade cabinet rather than as a moment.
 *
 * A08's fourth word is "lazy-loaded", and that word is the reason this file is
 * a **separate bundle** rather than another section of `lab.ts`. Nothing here is
 * fetched until a visitor asks for the arcade: `lab.ts` injects this file's
 * script tag on the click, and a test watches the network to prove it. Bundling
 * it into the lab would have made "lazy-loaded" a description of an intention
 * rather than of a byte count.
 *
 * **It imports the rules and nothing else.** The character is reached through a
 * two-method interface rather than through `SunnyAnimator`, because importing
 * the engine here would ship a second copy of it inside this bundle -- and a
 * lazily-loaded chunk that carries the whole engine is a lazy load in name only.
 *
 * The clock is this module's own `requestAnimationFrame` loop on a fixed tick,
 * rather than the lab's scrubbable stage clock. That is deliberate and is the
 * opposite of the choice A06's board makes: a board has no notion of its own
 * time, so it borrows the stage's, but an arcade game *is* its tick -- it is the
 * thing that makes a shot move one cell and the fleet descend -- and running it
 * on a clock a debug slider can rewind would make the game's only rule a
 * function of the debugger.
 */

/** How long a tick lasts. The fleet's own cadence is measured in ticks. */
export const TICK_MS = 110;

/** What an arcade game is allowed to say to the character. */
export interface Reactions {
  /** Say one machine event. The arcade does not need to know more than this. */
  dispatch(type: string): void;
}

interface Cell {
  readonly node: HTMLElement;
  readonly x: number;
  readonly y: number;
}

/**
 * Draw the arcade into `container` and start playing.
 *
 * Returns nothing. The clock and the key handler live as long as the panel does,
 * and the panel is appended once and never replaced -- so there is no caller to
 * hand a stop button to, and an unused one would be an API describing a life
 * cycle this page does not have. If the lab ever grows a teardown, the thing to
 * add is the handle back, not an unused one now.
 */
export function mount(container: HTMLElement, reactions: Reactions): void {
  let game = invaders.newGame();
  /** Ticks owed to the clock, accrued so a slow frame is not a lost tick. */
  let owed = 0;
  let last = performance.now();

  const field = el('div', { class: 'arcade-field' });
  const cells: Cell[] = [];
  for (let y = 0; y < invaders.FIELD_ROWS; y++) {
    for (let x = 0; x < invaders.FIELD_COLS; x++) {
      const node = el('div', { class: 'arcade-cell', 'data-cell': `${x},${y}` });
      field.append(node);
      cells.push({ node, x, y });
    }
  }

  const score = el('span', { class: 'mono', 'data-readout': 'score' });
  const lives = el('span', { class: 'mono', 'data-readout': 'lives' });
  const wave = el('span', { class: 'mono', 'data-readout': 'wave' });
  const message = el('p', { class: 'game-status', 'data-readout': 'status' });

  const move = (dx: number) => () => {
    game = invaders.moveShip(game, dx);
    draw();
  };
  const left = el('button', { class: 'btn small', type: 'button', text: '◀', 'data-key': 'left' });
  const right = el('button', {
    class: 'btn small',
    type: 'button',
    text: '▶',
    'data-key': 'right',
  });
  const shoot = el('button', {
    class: 'btn small',
    type: 'button',
    text: 'Fire',
    'data-key': 'fire',
  });
  const again = el('button', {
    class: 'btn small',
    type: 'button',
    text: 'Restart',
    'data-key': 'restart',
  });
  left.addEventListener('click', move(-1));
  right.addEventListener('click', move(1));
  shoot.addEventListener('click', () => {
    game = invaders.fire(game);
    draw();
  });
  again.addEventListener('click', () => {
    game = invaders.restart();
    reactions.dispatch('play_started');
    draw();
  });

  /**
   * Keyboard, on the panel rather than on the document.
   *
   * A document-level handler would let a visitor's arrow key move the ship while
   * they were reading a different part of the lab, and would keep doing it after
   * the panel had been replaced. The panel is focusable and says so.
   */
  const keys = (event: KeyboardEvent): void => {
    const handled = (): void => event.preventDefault();
    switch (event.key) {
      case 'ArrowLeft':
        game = invaders.moveShip(game, -1);
        handled();
        break;
      case 'ArrowRight':
        game = invaders.moveShip(game, 1);
        handled();
        break;
      case 'a':
      case 'A':
        game = invaders.moveShip(game, -1);
        break;
      case 'd':
      case 'D':
        game = invaders.moveShip(game, 1);
        break;
      case ' ':
      case 'Enter':
        game = invaders.fire(game);
        handled();
        break;
      case 'r':
      case 'R':
        game = invaders.restart();
        reactions.dispatch('play_started');
        break;
      default:
        return;
    }
    draw();
  };
  field.addEventListener('keydown', keys);
  field.setAttribute('tabindex', '0');
  field.setAttribute('role', 'application');
  field.setAttribute('aria-label', 'Space Invaders: arrow keys move, space fires, R restarts');

  container.append(
    el('div', { class: 'arcade' }, [
      field,
      el('div', { class: 'arcade-side' }, [
        message,
        el('div', { class: 'arcade-readout' }, [
          labelled('Score', score),
          labelled('Lives', lives),
          labelled('Wave', wave),
        ]),
        el('div', { class: 'btn-row' }, [left, right, shoot, again]),
        el('p', {
          class: 'note',
          text:
            'Arrow keys move, space fires, R starts again. One shot in the air at a time, as the ' +
            'original had it. This cabinet is a bundle of its own, fetched when the page was asked ' +
            'for it and not before.',
        }),
      ]),
    ]),
  );

  const statusText = (): string => {
    if (game.status === 'lost') return 'The fleet got through. R or Restart to try again.';
    if (invaders.invadersLeft(game.fleet) <= 0) return 'Wave cleared.';
    return 'Defend the bottom row.';
  };

  function draw(): void {
    for (const cell of cells) {
      const at = invaders.invaderAt(game.fleet, cell.x, cell.y);
      const shot = game.shots.some((s) => s.x === cell.x && s.y === cell.y);
      const bomb = game.bombs.some((s) => s.x === cell.x && s.y === cell.y);
      const ship = cell.y === invaders.SHIP_ROW && cell.x === game.shipX;
      // A shot and a bomb are drawn over whatever is in the cell, and a bomb
      // starts life *inside* the invader that dropped it -- so the order here is
      // the difference between a bomb you can see coming and one you cannot.
      const occupant = shot
        ? 'shot'
        : bomb
          ? 'bomb'
          : at !== null
            ? 'invader'
            : ship
              ? 'ship'
              : 'empty';
      if (cell.node.dataset.occupant !== occupant) cell.node.dataset.occupant = occupant;
    }

    score.textContent = String(game.score);
    lives.textContent = String(game.lives);
    wave.textContent = String(game.wave);
    message.textContent = statusText();
    container.dataset.status = game.status;
    container.dataset.score = String(game.score);
    container.dataset.lives = String(game.lives);
    container.dataset.wave = String(game.wave);
    container.dataset.steps = String(game.steps);
    container.dataset.invaders = String(invaders.invadersLeft(game.fleet));
  }

  /** Advance the game to the tick the wall clock says is due, reacting to it. */
  function advance(now: number): void {
    owed += now - last;
    last = now;
    // A backgrounded tab can owe hundreds of ticks at once. Capping the catch-up
    // means a visitor who returns to the tab finds the game where they left it
    // rather than already lost -- and the cap is in ticks, so the game stays the
    // same game whatever the frame rate does.
    owed = Math.min(owed, TICK_MS * 6);
    while (owed >= TICK_MS) {
      owed -= TICK_MS;
      const before = game;
      game = invaders.step(game);
      if (before.status === 'playing' && game.status === 'lost') {
        reactions.dispatch('impress');
      } else if (game.wave > before.wave) {
        reactions.dispatch('celebrate');
      }
      if (game.status === 'lost') owed = 0;
    }
  }

  function loop(now: number): void {
    requestAnimationFrame(loop);
    advance(now);
    draw();
  }

  // The game begins the way the plan's play move is described: a game starting
  // is Sunny showing off, whether or not the visitor asked for one.
  reactions.dispatch('play_started');
  draw();
  requestAnimationFrame(loop);
}

function labelled(label: string, control: HTMLElement): HTMLElement {
  return el('label', { class: 'field' }, [
    el('span', { class: 'field-label', text: label }),
    control,
  ]);
}

/**
 * The one DOM helper this bundle needs.
 *
 * Copied from the lab rather than imported from it, because an import would drag
 * `lab.ts` -- and therefore the engine, the catalogue and the whole grid -- into
 * a bundle whose entire purpose is not to be that bundle.
 */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: readonly (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

declare global {
  interface Window {
    SunnyArcade?: { mount: typeof mount; TICK_MS: number };
  }
}

// The hand-off to the lab, which loads this file by injecting a script tag and
// then calls what it finds here. A dynamic `import()` would be tidier but cannot
// be used from an IIFE bundle without giving up the separate-file build that
// makes this lazily loadable at all.
window.SunnyArcade = { mount, TICK_MS };
