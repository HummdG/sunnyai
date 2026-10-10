"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // packages/games/src/invaders.ts
  var invaders_exports = {};
  __export(invaders_exports, {
    FIELD_COLS: () => FIELD_COLS,
    FIELD_ROWS: () => FIELD_ROWS,
    FLEET_COLS: () => FLEET_COLS,
    FLEET_ROWS: () => FLEET_ROWS,
    MAX_BOMBS: () => MAX_BOMBS,
    SHIP_ROW: () => SHIP_ROW,
    START_LIVES: () => START_LIVES,
    bombChance: () => bombChance,
    bottomAliveRow: () => bottomAliveRow,
    fire: () => fire,
    fleetHasLanded: () => fleetHasLanded,
    fleetPeriod: () => fleetPeriod,
    invaderAt: () => invaderAt,
    invadersLeft: () => invadersLeft,
    moveShip: () => moveShip,
    newGame: () => newGame,
    pointsFor: () => pointsFor,
    restart: () => restart,
    step: () => step
  });
  var FIELD_COLS = 12;
  var FIELD_ROWS = 12;
  var FLEET_ROWS = 4;
  var FLEET_COLS = 6;
  var SHIP_ROW = FIELD_ROWS - 1;
  var MAX_BOMBS = 3;
  var START_LIVES = 3;
  var POINTS_BY_ROW = [30, 20, 10, 10];
  var index = (row, col) => row * FLEET_COLS + col;
  function fullFleet(x, y) {
    return {
      x,
      y,
      dx: 1,
      alive: Array.from({ length: FLEET_ROWS * FLEET_COLS }, () => true)
    };
  }
  function newGame(wave = 1) {
    return {
      fleet: fullFleet(3, 1),
      shipX: Math.floor(FIELD_COLS / 2),
      shots: [],
      bombs: [],
      score: 0,
      lives: START_LIVES,
      wave,
      status: "playing",
      steps: 0
    };
  }
  function restart() {
    return newGame(1);
  }
  function pointsFor(row) {
    return POINTS_BY_ROW[row] ?? 0;
  }
  function fleetPeriod(wave) {
    return Math.max(2, 7 - wave);
  }
  function bombChance(wave) {
    return Math.min(0.35, 0.06 * wave);
  }
  function bottomAliveRow(fleet) {
    for (let row = FLEET_ROWS - 1; row >= 0; row--) {
      for (let col = 0; col < FLEET_COLS; col++) {
        if (fleet.alive[index(row, col)] === true) return row;
      }
    }
    return -1;
  }
  function invadersLeft(fleet) {
    return fleet.alive.reduce((count, alive) => count + (alive ? 1 : 0), 0);
  }
  function invaderAt(fleet, x, y) {
    const col = x - fleet.x;
    const row = y - fleet.y;
    if (row < 0 || row >= FLEET_ROWS || col < 0 || col >= FLEET_COLS) return null;
    const at = index(row, col);
    return fleet.alive[at] === true ? at : null;
  }
  function fleetHasLanded(fleet) {
    const bottom = bottomAliveRow(fleet);
    return bottom >= 0 && fleet.y + bottom >= SHIP_ROW;
  }
  function kill(alive, at) {
    const next = [...alive];
    next[at] = false;
    return next;
  }
  function moveShip(game, dx) {
    if (game.status !== "playing") return game;
    const shipX = Math.max(0, Math.min(FIELD_COLS - 1, game.shipX + dx));
    return shipX === game.shipX ? game : { ...game, shipX };
  }
  function fire(game) {
    if (game.status !== "playing" || game.shots.length > 0) return game;
    return { ...game, shots: [{ x: game.shipX, y: SHIP_ROW - 1 }] };
  }
  function shooterColumn(fleet, random) {
    const bottom = bottomAliveRow(fleet);
    if (bottom < 0) return null;
    const columns = [];
    for (let col = 0; col < FLEET_COLS; col++) {
      if (fleet.alive[index(bottom, col)] === true) columns.push(col);
    }
    if (columns.length === 0) return null;
    const picked = columns[Math.min(columns.length - 1, Math.floor(random() * columns.length))];
    return fleet.x + picked;
  }
  function advance(fleet) {
    const x = fleet.x + fleet.dx;
    if (x < 0 || x + FLEET_COLS > FIELD_COLS) {
      return { ...fleet, dx: fleet.dx === 1 ? -1 : 1, y: fleet.y + 1 };
    }
    return { ...fleet, x };
  }
  function step(game, random = Math.random) {
    if (game.status !== "playing") return game;
    const steps = game.steps + 1;
    let fleet = game.fleet;
    let score = game.score;
    let lives = game.lives;
    let status = "playing";
    if (invadersLeft(fleet) === 0) {
      return nextWave(game, steps);
    }
    const shots = [];
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
    if (fleetHasLanded(fleet)) status = "lost";
    const bombs = [];
    for (const bomb of game.bombs) {
      const y = bomb.y + 1;
      if (y >= FIELD_ROWS) continue;
      if (y === SHIP_ROW && bomb.x === game.shipX) {
        lives -= 1;
        if (lives <= 0) status = "lost";
        continue;
      }
      bombs.push({ x: bomb.x, y });
    }
    if (status === "playing" && bombs.length < MAX_BOMBS && random() < bombChance(game.wave)) {
      const x = shooterColumn(fleet, random);
      const bottom = bottomAliveRow(fleet);
      if (x !== null && bottom >= 0) bombs.push({ x, y: fleet.y + bottom });
    }
    const cleared = status === "playing" && invadersLeft(fleet) === 0;
    if (cleared) {
      return nextWave({ ...game, fleet, score, lives, steps }, steps);
    }
    return { ...game, fleet, shots, bombs, score, lives, status, steps };
  }
  function nextWave(game, steps) {
    return {
      ...game,
      fleet: fullFleet(3, 1),
      shots: [],
      bombs: [],
      wave: game.wave + 1,
      status: "playing",
      steps
    };
  }

  // packages/games/src/ping-pong.ts
  var WALL_TOP = 26;
  var WALL_BOTTOM = 174;
  var PADDLE_HALF = 17;
  var MAX_BOUNCE_DEG = 62;
  var MAX_BOUNCE_RAD = MAX_BOUNCE_DEG * Math.PI / 180;
  var PADDLE_LOW = WALL_TOP + PADDLE_HALF;
  var PADDLE_HIGH = WALL_BOTTOM - PADDLE_HALF;

  // apps/character-lab/src/arcade.ts
  var TICK_MS = 110;
  function mount(container, reactions) {
    let game = invaders_exports.newGame();
    let owed = 0;
    let last = performance.now();
    const field = el("div", { class: "arcade-field" });
    const cells = [];
    for (let y = 0; y < invaders_exports.FIELD_ROWS; y++) {
      for (let x = 0; x < invaders_exports.FIELD_COLS; x++) {
        const node = el("div", { class: "arcade-cell", "data-cell": `${x},${y}` });
        field.append(node);
        cells.push({ node, x, y });
      }
    }
    const score = el("span", { class: "mono", "data-readout": "score" });
    const lives = el("span", { class: "mono", "data-readout": "lives" });
    const wave = el("span", { class: "mono", "data-readout": "wave" });
    const message = el("p", { class: "game-status", "data-readout": "status" });
    const move = (dx) => () => {
      game = invaders_exports.moveShip(game, dx);
      draw();
    };
    const left = el("button", { class: "btn small", type: "button", text: "\u25C0", "data-key": "left" });
    const right = el("button", {
      class: "btn small",
      type: "button",
      text: "\u25B6",
      "data-key": "right"
    });
    const shoot = el("button", {
      class: "btn small",
      type: "button",
      text: "Fire",
      "data-key": "fire"
    });
    const again = el("button", {
      class: "btn small",
      type: "button",
      text: "Restart",
      "data-key": "restart"
    });
    left.addEventListener("click", move(-1));
    right.addEventListener("click", move(1));
    shoot.addEventListener("click", () => {
      game = invaders_exports.fire(game);
      draw();
    });
    again.addEventListener("click", () => {
      game = invaders_exports.restart();
      reactions.dispatch("play_started");
      draw();
    });
    const keys = (event) => {
      const handled = () => event.preventDefault();
      switch (event.key) {
        case "ArrowLeft":
          game = invaders_exports.moveShip(game, -1);
          handled();
          break;
        case "ArrowRight":
          game = invaders_exports.moveShip(game, 1);
          handled();
          break;
        case "a":
        case "A":
          game = invaders_exports.moveShip(game, -1);
          break;
        case "d":
        case "D":
          game = invaders_exports.moveShip(game, 1);
          break;
        case " ":
        case "Enter":
          game = invaders_exports.fire(game);
          handled();
          break;
        case "r":
        case "R":
          game = invaders_exports.restart();
          reactions.dispatch("play_started");
          break;
        default:
          return;
      }
      draw();
    };
    field.addEventListener("keydown", keys);
    field.setAttribute("tabindex", "0");
    field.setAttribute("role", "application");
    field.setAttribute("aria-label", "Space Invaders: arrow keys move, space fires, R restarts");
    container.append(
      el("div", { class: "arcade" }, [
        field,
        el("div", { class: "arcade-side" }, [
          message,
          el("div", { class: "arcade-readout" }, [
            labelled("Score", score),
            labelled("Lives", lives),
            labelled("Wave", wave)
          ]),
          el("div", { class: "btn-row" }, [left, right, shoot, again]),
          el("p", {
            class: "note",
            text: "Arrow keys move, space fires, R starts again. One shot in the air at a time, as the original had it. This cabinet is a bundle of its own, fetched when the page was asked for it and not before."
          })
        ])
      ])
    );
    const statusText = () => {
      if (game.status === "lost") return "The fleet got through. R or Restart to try again.";
      if (invaders_exports.invadersLeft(game.fleet) <= 0) return "Wave cleared.";
      return "Defend the bottom row.";
    };
    function draw() {
      for (const cell of cells) {
        const at = invaders_exports.invaderAt(game.fleet, cell.x, cell.y);
        const shot = game.shots.some((s) => s.x === cell.x && s.y === cell.y);
        const bomb = game.bombs.some((s) => s.x === cell.x && s.y === cell.y);
        const ship = cell.y === invaders_exports.SHIP_ROW && cell.x === game.shipX;
        const occupant = shot ? "shot" : bomb ? "bomb" : at !== null ? "invader" : ship ? "ship" : "empty";
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
      container.dataset.invaders = String(invaders_exports.invadersLeft(game.fleet));
    }
    function advance2(now) {
      owed += now - last;
      last = now;
      owed = Math.min(owed, TICK_MS * 6);
      while (owed >= TICK_MS) {
        owed -= TICK_MS;
        const before = game;
        game = invaders_exports.step(game);
        if (before.status === "playing" && game.status === "lost") {
          reactions.dispatch("impress");
        } else if (game.wave > before.wave) {
          reactions.dispatch("celebrate");
        }
        if (game.status === "lost") owed = 0;
      }
    }
    function loop(now) {
      requestAnimationFrame(loop);
      advance2(now);
      draw();
    }
    reactions.dispatch("play_started");
    draw();
    requestAnimationFrame(loop);
  }
  function labelled(label, control) {
    return el("label", { class: "field" }, [
      el("span", { class: "field-label", text: label }),
      control
    ]);
  }
  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === "text") node.textContent = value;
      else node.setAttribute(key, value);
    }
    node.append(...children);
    return node;
  }
  window.SunnyArcade = { mount, TICK_MS };
})();
//# sourceMappingURL=arcade.js.map
