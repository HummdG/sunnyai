import { describe, expect, it } from 'vitest';

import {
  CELLS,
  LINES,
  freeCells,
  isLegal,
  move,
  newGame,
  other,
  replay,
  sunnyMove,
  type Game,
  type Square,
} from '@sunny/games';

/** Build a board directly, for the positions a legal sequence cannot reach. */
function board(marks: Record<number, 'X' | 'O'>, turn: 'X' | 'O' = 'X'): Game {
  const squares: Square[] = Array.from({ length: CELLS }, () => null);
  for (const [cell, mark] of Object.entries(marks)) squares[Number(cell)] = mark;
  return { squares, turn, moves: [], status: 'playing', winner: null, line: null };
}

/** A generator that always returns the same value, for a choosable tie-break. */
const fixed = (value: number) => () => value;

describe('the rules', () => {
  it('starts empty, with the visitor to move', () => {
    const game = newGame();
    expect(game.squares).toHaveLength(9);
    expect(new Set(game.squares)).toEqual(new Set([null]));
    expect(game.turn).toBe('X');
    expect(game.status).toBe('playing');
    expect(game.moves).toEqual([]);
  });

  it('accepts any of the nine squares as an opening move', () => {
    expect(freeCells(newGame().squares)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    for (let cell = 0; cell < CELLS; cell++) {
      const played = move(newGame(), cell);
      expect(played.squares[cell]).toBe('X');
      expect(played.turn).toBe('O');
    }
  });

  it('alternates the mark and keeps the log', () => {
    const game = replay([0, 1, 2, 3]);
    expect(game.squares.slice(0, 4)).toEqual(['X', 'O', 'X', 'O']);
    expect(game.turn).toBe('X');
    expect(game.moves).toEqual([0, 1, 2, 3]);
    expect(game.status).toBe('playing');
  });

  it('refuses a square that is already taken', () => {
    const game = move(newGame(), 4);
    expect(isLegal(game, 4)).toBe(false);
    expect(() => move(game, 4)).toThrow(/already taken/);
  });

  it('refuses a cell that is not on the board', () => {
    for (const cell of [-1, CELLS, 2.5, Number.NaN]) {
      expect(isLegal(newGame(), cell)).toBe(false);
      expect(() => move(newGame(), cell)).toThrow(RangeError);
    }
  });

  it('refuses to keep playing once the game is over', () => {
    // X takes the top row; O has played 3, 4 and 5 by the time it is done.
    const won = replay([0, 3, 1, 4, 2]);
    expect(won.status).toBe('won');
    expect(isLegal(won, 8)).toBe(false);
    expect(() => move(won, 8)).toThrow(/game is over/);
  });
});

describe('winning', () => {
  it('finds every one of the eight lines', () => {
    // Each line in turn, with the opponent's marks placed harmlessly in the
    // cells the line does not use. Written as a loop over `LINES` rather than as
    // eight hand-built boards, so a line added to the list is tested by existing.
    const harmless: Record<string, number[]> = {
      '0,1,2': [3, 4],
      '3,4,5': [0, 1],
      '6,7,8': [0, 1],
      '0,3,6': [1, 2],
      '1,4,7': [0, 2],
      '2,5,8': [0, 1],
      '0,4,8': [1, 2],
      '2,4,6': [0, 1],
    };
    for (const line of LINES) {
      const [a, b, c] = line;
      const [x, y] = harmless[line.join(',')]!;
      const game = replay([a, x!, b, y!, c]);
      expect(game.status, `line ${line.join(',')}`).toBe('won');
      expect(game.winner).toBe('X');
      expect(game.line).toEqual([a, b, c]);
    }
  });

  it('names the winner and not just the fact of one', () => {
    const sunnys = replay([0, 3, 2, 4, 8, 5]);
    expect(sunnys.status).toBe('won');
    expect(sunnys.winner).toBe('O');
    expect(sunnys.line).toEqual([3, 4, 5]);
  });

  it('prefers the win to the fullness when the last move completes a line', () => {
    // The ninth and final square is the one that completes X's diagonal, and it
    // is the only line it completes -- swapping 1 for 6 in X's earlier marks
    // makes the last move finish two lines at once, and the judge then reports
    // whichever comes first in `LINES` rather than the one a test author meant.
    // A judge that counted the board as full first would call this a draw.
    const game = replay([0, 2, 1, 3, 8, 5, 6, 7, 4]);
    expect(game.moves).toHaveLength(9);
    expect(freeCells(game.squares)).toEqual([]);
    expect(game.status).toBe('won');
    expect(game.winner).toBe('X');
    expect(game.line).toEqual([0, 4, 8]);
  });
});

describe('drawing', () => {
  it('draws a full board with no line', () => {
    // The canonical drawn game: no mark ever reaches three in a row.
    const game = replay([4, 0, 8, 2, 6, 3, 5, 7, 1]);
    expect(game.moves).toHaveLength(9);
    expect(game.status).toBe('drawn');
    expect(game.winner).toBeNull();
    expect(game.line).toBeNull();
    expect(freeCells(game.squares)).toEqual([]);
  });

  it('is not drawn while a square is free', () => {
    const game = replay([4, 0, 8, 2, 6, 3, 5, 7]);
    expect(game.status).toBe('playing');
  });
});

describe('replay', () => {
  it('rebuilds the position the moves were played in', () => {
    const moves = [4, 0, 8, 2, 6, 3, 5, 7, 1];
    let played = newGame();
    for (const cell of moves) played = move(played, cell);
    expect(replay(moves)).toEqual(played);
  });

  it('replays a finished game to the same winner', () => {
    const moves = [0, 3, 1, 4, 2];
    expect(replay(moves).winner).toBe('X');
    expect(replay(moves).line).toEqual([0, 1, 2]);
  });

  it('can be stopped part-way, which is what an undo is', () => {
    const moves = [4, 0, 8, 2, 6, 3, 5, 7, 1];
    expect(replay(moves.slice(0, 5)).moves).toEqual(moves.slice(0, 5));
    expect(replay(moves.slice(0, 5)).status).toBe('playing');
    expect(replay(moves.slice(0, 5)).turn).toBe('O');
  });

  it('can hand the opening move to Sunny', () => {
    const game = replay([], 'O');
    expect(game.turn).toBe('O');
    expect(move(game, 4).squares[4]).toBe('O');
  });

  it('refuses a log that is not a legal game', () => {
    expect(() => replay([4, 4])).toThrow(/already taken/);
    expect(() => replay([0, 3, 1, 4, 2, 8])).toThrow(/game is over/);
  });
});

describe('the opponent', () => {
  it('plays on a fresh board without a hint', () => {
    const game = newGame('O');
    const cell = sunnyMove(game, fixed(0));
    expect(isLegal(game, cell)).toBe(true);
    expect(cell).toBe(4);
  });

  it('takes a win when there is one', () => {
    // O has 3 and 4; 5 completes the middle row. X is nowhere near finishing.
    const game = board({ 3: 'O', 4: 'O', 0: 'X', 1: 'X' }, 'O');
    expect(sunnyMove(game, fixed(0.9))).toBe(5);
  });

  it('takes the win rather than blocking, when both are on offer', () => {
    // O can finish 6-7-8; X threatens 0-1-2. A opponent that blocked first would
    // be handing over a game it had already won.
    const game = board({ 6: 'O', 7: 'O', 0: 'X', 1: 'X' }, 'O');
    expect(sunnyMove(game, fixed(0))).toBe(8);
  });

  it('blocks the visitor’s line when it cannot win', () => {
    const game = board({ 0: 'X', 1: 'X', 6: 'O' }, 'O');
    expect(sunnyMove(game, fixed(0))).toBe(2);
  });

  it('takes the centre when there is nothing to answer', () => {
    const game = board({ 0: 'X' }, 'O');
    expect(sunnyMove(game, fixed(0))).toBe(4);
  });

  it('takes a corner when the centre is gone', () => {
    const game = board({ 0: 'X', 4: 'O' }, 'O');
    expect(sunnyMove(game, fixed(0.99))).toBe(8);
  });

  it('plays the last free square rather than falling off the board', () => {
    const game = board({ 0: 'X', 1: 'O', 2: 'X', 3: 'X', 4: 'O', 5: 'O', 6: 'O', 7: 'X' }, 'X');
    expect(sunnyMove(game, fixed(0.5))).toBe(8);
  });

  it('never plays a taken square, from any position it can be handed', () => {
    // A shallow sweep: everything reachable in the first four plies, with both
    // sides playing Sunny's own heuristic, plus a spread of tie-break values so
    // the corners step is exercised rather than always resolving the same way.
    let positions = 0;
    for (let seed = 0; seed < 8; seed++) {
      const random = fixed(seed / 8);
      let game = newGame();
      for (let ply = 0; ply < 4; ply++) {
        const cell = sunnyMove(game, random);
        expect(game.squares[cell], `seed ${seed} ply ${ply}`).toBeNull();
        game = move(game, cell);
        positions++;
      }
    }
    expect(positions).toBe(32);
  });

  it('refuses to move in a game that is over', () => {
    expect(() => sunnyMove(replay([0, 3, 1, 4, 2]))).toThrow(/game is over/);
  });

  it('is deterministic for a given tie-break', () => {
    const game = board({ 0: 'X', 4: 'O', 8: 'X' }, 'O');
    expect(sunnyMove(game, fixed(0.3))).toBe(sunnyMove(game, fixed(0.3)));
  });

  it('is not perfect: a fork beats it', () => {
    // X has the two opposite corners and a free square at 6. Playing it makes
    // two threats at once -- 0-3-6 and 6-7-8 -- and no single block answers both.
    // This is the test that says the game is winnable, which is the difference
    // between an opponent and a wall.
    //
    // Sunny's two marks are 1 and 5 on purpose: they share no line, so it has no
    // threat of its own to play instead of blocking. An earlier version of this
    // test used 1 and 4, which quietly gave Sunny an immediate win at 7 -- it
    // passed for the wrong reason until the fork was re-checked by hand.
    const forked = move(board({ 0: 'X', 8: 'X', 1: 'O', 5: 'O' }, 'X'), 6);
    expect(forked.status).toBe('playing');

    const block = sunnyMove(forked, fixed(0));
    expect([3, 7], 'the fork has two answers and Sunny can only give one').toContain(block);

    const winningCell = block === 3 ? 7 : 3;
    expect(move(forked, block).status).toBe('playing');
    expect(move(move(forked, block), winningCell).winner).toBe('X');
  });

  it('cannot be beaten by a visitor who does not think', () => {
    // The mirror of the test above, and the reason the heuristic is worth
    // having: against a visitor who always plays the lowest-numbered free
    // square, Sunny never loses. Four seeds, all nine cells.
    for (let seed = 0; seed < 4; seed++) {
      let game = newGame();
      while (game.status === 'playing') {
        const careless = freeCells(game.squares)[0]!;
        game = move(game, careless);
        if (game.status !== 'playing') break;
        game = move(game, sunnyMove(game, fixed(seed / 4)));
      }
      expect(game.winner, `seed ${seed}`).not.toBe('X');
    }
  });
});

describe('the marks', () => {
  it('are each other’s other', () => {
    expect(other('X')).toBe('O');
    expect(other('O')).toBe('X');
    expect(other(other('X'))).toBe('X');
  });
});
