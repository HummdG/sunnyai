/**
 * The games Sunny plays, one namespace each.
 *
 * Both games want to export `newGame`, `Game` and `Status`, and neither of those
 * names is wrong -- they describe exactly what they say. Re-exporting them flat
 * would mean one game's `Game` shadowing the other's, and a reader having to
 * remember which one a bare `newGame()` meant; renaming them at this boundary
 * would put a name on the public API that the module itself does not use.
 *
 * So each game gets a namespace, and the names inside it are the names the game
 * chose. `ticTacToe.replay(...)` says which game it is replaying, and the next
 * game (A09's ping pong) will add a third without reopening this decision.
 */
export * as ticTacToe from './tic-tac-toe.js';
export * as invaders from './invaders.js';
