/**
 * Tic-tac-toe, as rules rather than as a picture.
 *
 * The plan asks for a *real* 3x3 game against Sunny, and the gate is legal
 * turns, wins, draws and replays. None of those four words is about animation,
 * which is why this file imports nothing: the rules are a pure function from a
 * position to the next position, and they can be tested -- exhaustively, in
 * milliseconds -- without a rig, a frame time or a DOM.
 *
 * The split matters because the two halves fail differently. A rule that lets a
 * mark land on an occupied square is a bug a screenshot cannot see; a board that
 * does not *look* like a board is one no assertion can see. Keeping the rules
 * free of the renderer is what lets each half be tested by the means that suit
 * it rather than by the means that suit the other.
 *
 * Everything here is immutable. `move` returns a new game rather than mutating
 * one, because the replay log (`moves`) is only useful if the positions it
 * describes cannot be edited underneath it -- and because the visitor's undo, of
 * which there is one, is "start again".
 */

/** A mark. The visitor plays X and moves first; Sunny plays O. */
export type Mark = 'X' | 'O';

/** One square: a mark, or `null` for empty. */
export type Square = Mark | null;

/** How many squares a board has. */
export const CELLS = 9;

/**
 * The eight ways to win, as cell indices in reading order. Exported because the
 * board has to draw the winning line, and a renderer that recomputed the
 * geometry would be a second definition of "a win" waiting to disagree with this
 * one.
 */
export const LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

const CENTRE = 4;
const CORNERS: readonly number[] = [0, 2, 6, 8];

/** Every square a mark could still be played on, in reading order. */
export function freeCells(squares: readonly Square[]): number[] {
  const out: number[] = [];
  for (let cell = 0; cell < CELLS; cell++) {
    if (squares[cell] === null) out.push(cell);
  }
  return out;
}

/** The other mark. */
export const other = (mark: Mark): Mark => (mark === 'X' ? 'O' : 'X');

export type Status = 'playing' | 'won' | 'drawn';

/**
 * A game, whole.
 *
 * `moves` is the replay log: the cell indices in the order they were played,
 * from which `replay()` rebuilds this exact position. It is carried on the
 * position rather than kept beside it because "what happened" is part of what a
 * position *is* -- X has played three marks, and which three is not recoverable
 * from the board alone once a square can be either mark.
 */
export interface Game {
  readonly squares: readonly Square[];
  /**
   * Whose turn it is. When the game is over this is the mark that *would* have
   * played next, which is what makes a "X to move" label safe to render without
   * first asking whether the game is still going.
   */
  readonly turn: Mark;
  readonly moves: readonly number[];
  readonly status: Status;
  /** The winner, when `status` is `won`. */
  readonly winner: Mark | null;
  /** The three cells that won it, so the board can strike through them. */
  readonly line: readonly number[] | null;
}

interface Verdict {
  status: Status;
  winner: Mark | null;
  line: readonly number[] | null;
}

/**
 * Judge a board: who has won, or whether there is anything left to play.
 *
 * A win is looked for before fullness, and that order is the whole of the
 * draw rule: a board whose last move completed a line is won, not drawn, and a
 * full board with no line is the only draw.
 */
function judge(squares: readonly Square[]): Verdict {
  for (const line of LINES) {
    const [a, b, c] = line;
    const mark = squares[a];
    if (!mark) continue;
    if (mark === squares[b] && mark === squares[c]) {
      return { status: 'won', winner: mark, line };
    }
  }
  return freeCells(squares).length > 0
    ? { status: 'playing', winner: null, line: null }
    : { status: 'drawn', winner: null, line: null };
}

/** A fresh board. `first` exists so a test can hand Sunny the opening move. */
export function newGame(first: Mark = 'X'): Game {
  return {
    squares: Array.from({ length: CELLS }, () => null),
    turn: first,
    moves: [],
    status: 'playing',
    winner: null,
    line: null,
  };
}

/**
 * Whether a move would be accepted.
 *
 * Exported alongside `move` rather than instead of it, because the two callers
 * want different things: a board wants to *disable* a square it cannot play
 * (asking first, then acting), and a test or a replay wants an illegal move to
 * be an error rather than a silent no-op.
 */
export function isLegal(game: Game, cell: number): boolean {
  return (
    Number.isInteger(cell) &&
    cell >= 0 &&
    cell < CELLS &&
    game.status === 'playing' &&
    game.squares[cell] === null
  );
}

/**
 * Play a mark. Throws on an illegal move rather than returning the position
 * unchanged: every caller here has already asked `isLegal`, so an illegal move
 * that reaches this function is a bug in the caller, and a bug that throws is
 * one that gets fixed.
 */
export function move(game: Game, cell: number): Game {
  if (!Number.isInteger(cell) || cell < 0 || cell >= CELLS) {
    throw new RangeError(`${cell} is not a cell`);
  }
  if (game.status !== 'playing') {
    throw new Error(`the game is over (${game.status})`);
  }
  if (game.squares[cell] !== null) {
    throw new Error(`cell ${cell} is already taken`);
  }

  const squares = [...game.squares];
  squares[cell] = game.turn;
  const verdict = judge(squares);
  return {
    squares,
    turn: other(game.turn),
    moves: [...game.moves, cell],
    ...verdict,
  };
}

/**
 * Rebuild a position from its move log.
 *
 * This is the replay the plan asks for, and it is the same thing as the undo
 * feature: a game is a starting board plus a list of moves, so both "play it
 * again" and "step back through it" are `replay(moves.slice(0, n))` rather than
 * a second implementation of the rules that can drift from the first.
 */
export function replay(moves: readonly number[], first: Mark = 'X'): Game {
  return moves.reduce((game, cell) => move(game, cell), newGame(first));
}

/** The cell that would complete a line for `mark`, or null if none does. */
function winningCell(squares: readonly Square[], mark: Mark): number | null {
  for (const line of LINES) {
    let owned = 0;
    let empty = -1;
    for (const cell of line) {
      const square = squares[cell];
      if (square === mark) owned++;
      else if (square === null) empty = cell;
      else {
        owned = -1; // the opponent is in this line; it is not a threat
        break;
      }
    }
    if (owned === 2 && empty !== -1) return empty;
  }
  return null;
}

/** One of `cells`, chosen by `random`. Uniform, and a pure function of it. */
function pick(cells: readonly number[], random: () => number): number {
  const index = Math.min(cells.length - 1, Math.floor(random() * cells.length));
  return cells[index]!;
}

/**
 * Sunny's move.
 *
 * **A heuristic, not a solver, and that is deliberate.** Tic-tac-toe is a solved
 * draw: an opponent that plays perfectly can never be beaten, and a game you
 * cannot win is not a game -- it is a wall that tells you the answer. So Sunny
 * looks one move ahead: it takes a win, blocks the visitor's, prefers the
 * centre, then a corner. That is strong enough to punish a casual mistake and
 * blind to a two-move fork, which is the one thing the visitor has to *see* to
 * win. The tests pin both halves of that: it blocks a single threat, and it
 * loses to a double one.
 *
 * `random` is injected because the tie-break has to be choosable. It is only
 * ever used to pick between moves Sunny does not care about, so a caller that
 * passes a seeded generator gets a reproducible game and a caller that passes
 * `Math.random` gets an opponent that does not play the same game twice.
 */
export function sunnyMove(game: Game, random: () => number = Math.random): number {
  if (game.status !== 'playing') {
    throw new Error(`the game is over (${game.status})`);
  }

  const win = winningCell(game.squares, game.turn);
  if (win !== null) return win;

  const block = winningCell(game.squares, other(game.turn));
  if (block !== null) return block;

  const free = freeCells(game.squares);
  if (free.includes(CENTRE)) return CENTRE;

  const corners = free.filter((cell) => CORNERS.includes(cell));
  if (corners.length > 0) return pick(corners, random);

  return pick(free, random);
}
