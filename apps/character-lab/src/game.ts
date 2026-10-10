import type { SunnyAnimator } from '@sunny/animation-engine';
import { ticTacToe } from '@sunny/games';

const { CELLS, isLegal, move, newGame, sunnyMove } = ticTacToe;
type Mark = ticTacToe.Mark;

import { el } from './dom.js';

/**
 * Tic-tac-toe, as a visitor plays it.
 *
 * The rules are `@sunny/games` and nothing about them is repeated here: this
 * file moves marks on a board and tells the character what happened. That split
 * is the point of A06 -- a rule that lets two marks share a square is invisible
 * in a screenshot, and a board that does not read as a board is invisible to an
 * assertion, so each half is tested by the means that can see it.
 *
 * **The board is a page surface, not a pose.** A 3x3 grid is not something the
 * character holds, and bending the prop vocabulary into "nine sparkles in a
 * square" would have been a lie about what props are for. What the character
 * contributes is her *reactions*, which are already in the catalogue: she shows
 * off when a game starts, thinks on her turn, and takes a moment when it ends.
 * A game therefore has no state of its own in the machine -- the machine's
 * states are conversational, and the honest mapping is that a board is a
 * surface that talks to the character rather than a mode the character is in.
 */

/** The visitor's mark, and the one that moves first. */
export const HUMAN: Mark = 'X';
/** Sunny's mark. */
export const SUNNY: Mark = 'O';

/**
 * How long Sunny appears to think, in stage-clock milliseconds.
 *
 * Long enough for the thinking spin to be seen -- it is the only part of the
 * turn the visitor gets to watch -- and short enough not to feel like a stall.
 */
export const THINK_MS = 700;

export interface GameHost {
  /**
   * The animator to talk to, re-read every time rather than captured: the lab
   * builds a new one whenever the intensity or reduced-motion setting changes,
   * and a board holding the old one would go on driving a character that is no
   * longer on screen.
   */
  animator: () => SunnyAnimator;
  /**
   * The stage clock, in the same units the stage is drawn with.
   *
   * The board's timing has to be the stage's timing, not wall-clock: the lab can
   * be paused and scrubbed, and a game that ran on `performance.now()` would
   * carry on silently while everything the visitor can see stood still.
   */
  now: () => number;
  /** Redraw the character after telling it something. */
  redraw: () => void;
}

export interface GamePanel {
  readonly element: HTMLElement;
  /**
   * Advance the board's clock. Returns whether the board changed, so a caller
   * that redraws on change does not have to redraw every frame.
   */
  tick(now: number): boolean;
}

export function gamePanel(host: GameHost): GamePanel {
  let game = newGame(HUMAN);
  /**
   * When Sunny's move is due, in stage-clock ms, or null when it is not her
   * turn. Held as a deadline rather than a timeout because the clock it is
   * measured against can be paused and rewound by the scrubber.
   */
  let dueAt: number | null = null;
  /** The last clock reading, so a rewind can be noticed and absorbed. */
  let lastSeen = 0;

  const status = el('p', { class: 'game-status' });
  const log = el('div', { class: 'mono game-log' });
  const board = el('div', { class: 'board', role: 'grid', 'aria-label': 'Tic-tac-toe board' });

  const cells: HTMLButtonElement[] = [];
  for (let cell = 0; cell < CELLS; cell++) {
    const button = el('button', {
      class: 'cell',
      type: 'button',
      'data-cell': String(cell),
      'aria-label': `Square ${cell}`,
    });
    button.addEventListener('click', () => play(cell));
    cells.push(button);
    board.append(button);
  }

  const fresh = el('button', { class: 'btn', type: 'button', text: 'New game' });
  fresh.addEventListener('click', () => start());

  const element = el('div', { class: 'game' }, [
    board,
    el('div', { class: 'game-side' }, [
      status,
      fresh,
      log,
      el('p', {
        class: 'note',
        text:
          'You are X and move first. Sunny plays a heuristic — she takes a win, blocks yours, ' +
          'prefers the centre, then a corner — so she punishes a slip but cannot see a fork. ' +
          'The log below is the move history the rules can replay from.',
      }),
    ]),
  ]);

  /** Whether the visitor may play right now. */
  function visitorToPlay(): boolean {
    return game.status === 'playing' && game.turn === HUMAN && dueAt === null;
  }

  /** What the line under the board says. */
  function statusText(): string {
    if (game.status === 'drawn') return 'A draw. Neither of us got three.';
    if (game.status === 'won') return game.winner === SUNNY ? 'Sunny wins.' : 'You win!';
    if (dueAt !== null) return 'Sunny is thinking…';
    return game.turn === HUMAN ? 'Your turn — you are X' : 'Sunny’s turn';
  }

  function render(): void {
    for (let cell = 0; cell < CELLS; cell++) {
      const button = cells[cell]!;
      const mark = game.squares[cell];
      button.textContent = mark ?? '';
      button.dataset.square = mark ?? 'empty';
      button.disabled = !visitorToPlay() || mark !== null;
      if (game.line?.includes(cell)) button.dataset.win = '1';
      else delete button.dataset.win;
    }

    status.textContent = statusText();
    // The outcome as a fact rather than as a sentence, so a test asserts on the
    // game rather than on prose that someone will reword.
    status.dataset.outcome =
      game.status === 'playing' ? 'playing' : game.status === 'drawn' ? 'drawn' : game.winner!;

    log.textContent =
      game.moves.length === 0
        ? 'no moves yet'
        : game.moves.map((cell, i) => `${i % 2 === 0 ? HUMAN : SUNNY}${cell}`).join('  ');
    log.dataset.moves = game.moves.join(',');
  }

  /** Tell the character how it went, once, when the game ends. */
  function settle(): void {
    if (game.status === 'won') {
      // `impress` is Sunny's own quiet confidence and `celebrate` is pleasure on
      // the visitor's behalf, so the two outcomes are different moments rather
      // than one moment wearing two faces.
      host
        .animator()
        .dispatch({ type: game.winner === SUNNY ? 'impress' : 'celebrate' }, host.now());
    }
    // A draw gets no moment at all. Nothing in the vocabulary means "evenly
    // matched", and the nearest one, `confused`, would say she got something
    // wrong -- so the honest answer is that she simply settles.
    host.redraw();
  }

  function play(cell: number): void {
    if (!visitorToPlay() || !isLegal(game, cell)) return;
    const now = host.now();
    game = move(game, cell);
    if (game.status === 'playing') {
      dueAt = now + THINK_MS;
      // The thinking spin, so the visitor has something to look at between
      // their move and hers.
      host.animator().dispatch({ type: 'turn_started' }, now);
    }
    render();
    if (game.status === 'playing') host.redraw();
    else settle();
  }

  function start(): void {
    game = newGame(HUMAN);
    dueAt = null;
    // The play move, which is what the catalogue says `play_started` is for: a
    // game starting is the moment Sunny shows off.
    host.animator().dispatch({ type: 'play_started' }, host.now());
    render();
    host.redraw();
  }

  // The opening game is a game like any other: it begins with Sunny showing
  // off, so the board on first paint is the board the New game button produces.
  start();

  return {
    element,
    tick(now: number): boolean {
      // The scrubber can move the stage clock backwards. A deadline in the
      // future would then be further away than it was, and a visitor who
      // scrubbed back far enough would leave Sunny thinking for ever -- so a
      // rewind re-arms the clock she is waiting on rather than preserving it.
      if (now < lastSeen && dueAt !== null) dueAt = now + THINK_MS;
      lastSeen = now;

      if (dueAt === null || now < dueAt) return false;
      dueAt = null;

      game = move(game, sunnyMove(game));
      host.animator().dispatch({ type: 'turn_finished' }, now);
      render();
      if (game.status === 'playing') host.redraw();
      else settle();
      return true;
    },
  };
}
