"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // packages/animation-engine/src/types.ts
  var INTENSITIES = ["off", "minimal", "balanced", "playful"];
  var PRIORITY = {
    idle: 0,
    play: 200,
    success: 400,
    chat: 600,
    accessibility: 800,
    interaction: 1e3
  };

  // packages/animation-engine/src/machine.ts
  var TABLE = {
    // `confused` and `celebrate` are deliberately reachable from anywhere: they are
    // reactions, and gating them behind a particular prior state would mean the
    // most expressive moments land only by luck.
    idle: {
      attention: "listening",
      turn_started: "thinking",
      speaking_started: "speaking",
      guiding_started: "guiding",
      celebrate: "celebrating",
      impress: "celebrating",
      confused: "confused",
      play_started: "playing",
      dismissed: "relaxing",
      lookup: "thinking",
      user_typing: "listening",
      idle_timeout: "relaxing"
    },
    listening: {
      turn_started: "thinking",
      speaking_started: "speaking",
      lookup: "thinking",
      impress: "celebrating",
      idle: "idle",
      dismissed: "relaxing",
      confused: "confused"
    },
    thinking: {
      speaking_started: "speaking",
      // A tool that points at the page, asked for mid-turn.
      guiding_started: "guiding",
      impress: "celebrating",
      celebrate: "celebrating",
      turn_failed: "error",
      turn_finished: "idle",
      idle: "idle",
      confused: "confused"
    },
    speaking: {
      turn_finished: "idle",
      // A tool called part-way through an answer: back to working it out.
      lookup: "thinking",
      turn_failed: "error",
      guiding_started: "guiding",
      celebrate: "celebrating",
      impress: "celebrating",
      idle: "idle",
      dismissed: "relaxing"
    },
    guiding: {
      guiding_finished: "idle",
      turn_finished: "idle",
      idle: "idle",
      dismissed: "relaxing"
    },
    celebrating: {
      idle: "idle",
      turn_finished: "idle",
      dismissed: "relaxing"
    },
    confused: {
      idle: "idle",
      turn_started: "thinking",
      user_typing: "listening",
      dismissed: "relaxing"
    },
    relaxing: {
      attention: "listening",
      idle: "idle",
      // Typing wakes Sunny out of the deckchair.
      user_typing: "listening",
      turn_started: "thinking"
    },
    playing: {
      play_finished: "idle",
      idle: "idle",
      turn_started: "thinking",
      dismissed: "relaxing"
    },
    error: {
      idle: "idle",
      attention: "listening",
      turn_started: "thinking",
      user_typing: "listening"
    }
  };
  var SETTLE = {
    listening: { afterMs: 6e4, to: "idle" },
    thinking: { afterMs: 45e3, to: "error" },
    speaking: { afterMs: 9e4, to: "idle" },
    guiding: { afterMs: 2e4, to: "idle" },
    celebrating: { afterMs: 4e3, to: "idle" },
    confused: { afterMs: 3500, to: "idle" },
    // An error used to hold until the next event, so a failed turn left Sunny
    // drooping indefinitely. Eight seconds is long enough to be noticed.
    error: { afterMs: 8e3, to: "idle" }
  };
  var SunnyMachine = class {
    #state;
    #enteredAt;
    constructor(initial = "idle", now = 0) {
      this.#state = initial;
      this.#enteredAt = now;
    }
    get state() {
      return this.#state;
    }
    get enteredAt() {
      return this.#enteredAt;
    }
    /**
     * Apply an event. An event with no transition from the current state is
     * ignored rather than throwing: the world is allowed to be noisy, and a
     * dropped event must never take the character down.
     */
    send(event, now) {
      const next = TABLE[this.#state][event.type];
      if (next === void 0 || next === this.#state) {
        return { state: this.#state, changed: false };
      }
      this.#state = next;
      this.#enteredAt = now;
      return { state: next, changed: true };
    }
    /**
     * Let a transient state expire. Call on every tick; it is a no-op until the
     * state's budget is spent.
     */
    tick(now) {
      const settle2 = SETTLE[this.#state];
      if (!settle2 || now - this.#enteredAt < settle2.afterMs) {
        return { state: this.#state, changed: false };
      }
      this.#state = settle2.to;
      this.#enteredAt = now;
      return { state: settle2.to, changed: true };
    }
    /** States reachable from here in one move. Exposed for testing and tooling. */
    reachable() {
      const row = TABLE[this.#state];
      return [...new Set(Object.values(row))];
    }
    /** Every state that can ever be reached from the initial state. */
    static allReachable() {
      const seen = /* @__PURE__ */ new Set(["idle"]);
      const queue = ["idle"];
      while (queue.length > 0) {
        const current = queue.shift();
        for (const next of Object.values(TABLE[current])) {
          if (!seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
        }
      }
      return [...seen];
    }
  };

  // packages/character/src/tokens.ts
  var SUNNY_THEME = {
    body: "#FF7900",
    ray: "#FF7900",
    ink: "#171717",
    highlight: "#FFF3E2"
  };

  // packages/character/src/geometry.ts
  var VIEWBOX = 200;
  var BODY = {
    /**
     * Radius to the centre-line of the outline stroke. The measured 46 units is
     * the radius of the orange interior, which is the inner edge of the stroke,
     * so the path sits half a stroke further out.
     */
    radius: 46 + 2.51 / 2,
    /** Outline stroke width, measured at 20 px. */
    strokeWidth: 2.51
  };
  var RAY = {
    /**
     * Where the eight rays point, in degrees clockwise from straight up, in the
     * reference's own order. They are NOT evenly spaced: measured angular centres
     * are 0, 49, 91.5, 131.5, 180, 228.5, 268.5, 311. The diagonals are each
     * pressed a few degrees toward the horizontal, and the pattern is symmetric
     * about both axes, so this is deliberate artwork rather than measurement
     * noise. It is reproduced, not regularised to 45.
     */
    anglesDeg: [0, 49, 91.5, 131.5, 180, 228.5, 268.5, 311],
    /** Distance from centre to the visible orange tip: 601.9 px. */
    tipRadius: 75.5,
    /** Distance from centre to the visible orange base: 398.8 px. */
    baseRadius: 50,
    /** Half the visible orange base width: 97.8 px. */
    baseHalfWidth: 12.3,
    /** Rounding of the base corners. The reference's tips are near-pointed. */
    cornerRadius: 3,
    /** Rounding of the apex, which is much sharper than the base corners. */
    apexRadius: 0.6,
    /** Ray outline stroke width, matching the body outline. */
    strokeWidth: 2.51,
    /**
     * The rays are painted stroke-first and then filled, so their outline sits
     * entirely OUTSIDE the orange. This was measured, not assumed: the reference's
     * ray outline extends ~1.25 units beyond the orange, whereas its body outline
     * is centred on the path. This constant compensates for the rounded apex,
     * which would otherwise pull the orange tip in by more than a unit.
     */
    apexCompensation: 0.9
  };

  // packages/character/src/boil.ts
  var BOIL_AMPLITUDE = 0.32;
  var cache = /* @__PURE__ */ new Map();
  var CACHE_LIMIT = 4e3;
  function noise(index2, variant) {
    const s = Math.sin(index2 * 12.9898 + variant * 78.233 + 0.5) * 43758.5453;
    return (s - Math.floor(s)) * 2 - 1;
  }
  function boilPath(d, variant, amplitude = BOIL_AMPLITUDE) {
    if (variant === void 0) return d;
    const key = `${variant}|${amplitude}|${d}`;
    const hit = cache.get(key);
    if (hit !== void 0) return hit;
    let i = 0;
    const out = d.replace(/-?\d*\.?\d+(?:e-?\d+)?/gi, (num) => {
      const v = Number(num);
      const index2 = Math.floor(i / 2);
      const axis = i % 2;
      i += 1;
      const shifted = v + noise(index2 * 2 + axis, variant) * amplitude;
      return String(Math.round(shifted * 100) / 100);
    });
    if (cache.size > CACHE_LIMIT) cache.clear();
    cache.set(key, out);
    return out;
  }

  // packages/character/src/hands.ts
  var OUTLINE = 1.75;
  var CREASE = 0.55;
  var K = 0.5523;
  var r2 = (v) => {
    const r = Math.round(v * 100) / 100;
    return Object.is(r, -0) ? "0" : String(r);
  };
  var pt = (p) => `${r2(p.x)} ${r2(p.y)}`;
  function capsule(a, b, r) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1e-6;
    const u = { x: dx / len, y: dy / len };
    const n4 = { x: -u.y, y: u.x };
    const at = (c, ux, nx) => ({
      x: c.x + u.x * ux * r + n4.x * nx * r,
      y: c.y + u.y * ux * r + n4.y * nx * r
    });
    const p0 = at(b, 0, -1);
    const p1 = at(b, 1, 0);
    const p2 = at(b, 0, 1);
    const p3 = at(a, 0, 1);
    const p4 = at(a, -1, 0);
    const p5 = at(a, 0, -1);
    return [
      `M${pt(p0)}`,
      `C${pt(at(b, K, -1))} ${pt(at(b, 1, -K))} ${pt(p1)}`,
      `C${pt(at(b, 1, K))} ${pt(at(b, K, 1))} ${pt(p2)}`,
      `L${pt(p3)}`,
      `C${pt(at(a, -K, 1))} ${pt(at(a, -1, K))} ${pt(p4)}`,
      `C${pt(at(a, -1, -K))} ${pt(at(a, -K, -1))} ${pt(p5)}`,
      "Z"
    ].join("");
  }
  function ellipse(c, rx, ry, deg = 0) {
    const a = deg * Math.PI / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const at = (x, y) => ({
      x: c.x + x * cos - y * sin,
      y: c.y + x * sin + y * cos
    });
    const q = [at(rx, 0), at(0, ry), at(-rx, 0), at(0, -ry)];
    return [
      `M${pt(q[0])}`,
      `C${pt(at(rx, ry * K))} ${pt(at(rx * K, ry))} ${pt(q[1])}`,
      `C${pt(at(-rx * K, ry))} ${pt(at(-rx, ry * K))} ${pt(q[2])}`,
      `C${pt(at(-rx, -ry * K))} ${pt(at(-rx * K, -ry))} ${pt(q[3])}`,
      `C${pt(at(rx * K, -ry))} ${pt(at(rx, -ry * K))} ${pt(q[0])}`,
      "Z"
    ].join("");
  }
  function partPath(p, grow) {
    return p.kind === "capsule" ? capsule(p.a, p.b, p.r + grow) : ellipse(p.c, p.rx + grow, p.ry + grow, p.deg ?? 0);
  }
  function build(parts, joint, lines = []) {
    return {
      ink: parts.map((p) => partPath(p, OUTLINE)).join(""),
      fill: parts.map((p) => partPath(p, 0)).join(""),
      lines: lines.map(([from, to]) => capsule(from, to, CREASE)).join(""),
      joint
    };
  }
  function edge(f, side, from = 0.15, to = 0.72) {
    if (f.kind !== "capsule") throw new Error("edge() needs a finger");
    const dx = f.b.x - f.a.x;
    const dy = f.b.y - f.a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len * side * (f.r - 0.15);
    const ny = dx / len * side * (f.r - 0.15);
    const at = (t) => ({ x: f.a.x + dx * t + nx, y: f.a.y + dy * t + ny });
    return [at(from), at(to)];
  }
  var P = (x, y) => ({ x, y });
  var wrist = { kind: "capsule", a: P(0, 1), b: P(0, -4), r: 4.1 };
  var palm = (rx = 7.6, ry = 7.1, cy = -9) => ({ kind: "ellipse", c: P(0, cy), rx, ry });
  function finger(base, deg, length, r = 2.45) {
    const a = deg * Math.PI / 180;
    return {
      kind: "capsule",
      a: base,
      b: { x: base.x + Math.sin(a) * length, y: base.y - Math.cos(a) * length },
      r,
      finger: true
    };
  }
  var knuckle = (x, y, rx = 2.5, ry = 2.9, deg = 0) => ({
    kind: "ellipse",
    c: P(x, y),
    rx,
    ry,
    deg,
    finger: true
  });
  var OPEN_F = [
    finger(P(-5, -12.5), -26, 9.5),
    finger(P(-1.7, -14), -8, 11),
    finger(P(1.7, -14), 8, 10.5),
    finger(P(5, -12.5), 25, 8.5, 2.3)
  ];
  var open = build([...OPEN_F, finger(P(-6, -6.5), -72, 7.5, 2.6), palm(), wrist], 8.2, [
    edge(OPEN_F[1], -1, 0.2, 0.4),
    edge(OPEN_F[2], -1, 0.2, 0.45),
    edge(OPEN_F[3], -1, 0.2, 0.35)
  ]);
  var RELAXED_F = [
    finger(P(-4.8, -13), -11, 8.6),
    finger(P(-1.6, -14.2), -3.5, 9.6),
    finger(P(1.6, -14.2), 3.5, 9.2),
    finger(P(4.8, -13), 11, 7.8, 2.3)
  ];
  var relaxed = build(
    [...RELAXED_F, finger(P(-6.2, -7), -48, 6.2, 2.5), palm(7.4, 7.2), wrist],
    8.2,
    [
      edge(RELAXED_F[1], -1, 0.25, 0.8),
      edge(RELAXED_F[2], -1, 0.25, 0.8),
      edge(RELAXED_F[3], -1, 0.25, 0.75)
    ]
  );
  function knuckleGaps(xs, top, depth = 2.6) {
    const out = [];
    for (let i = 0; i + 1 < xs.length; i++) {
      const x = (xs[i] + xs[i + 1]) / 2;
      out.push([P(x, top), P(x, top + depth)]);
    }
    return out;
  }
  var FOLDED_THUMB = {
    kind: "capsule",
    a: P(-7.4, -8.4),
    b: P(-0.6, -12),
    r: 2.5,
    finger: true
  };
  var foldedThumbLine = [P(-6.6, -5.9), P(0.4, -9.6)];
  var fist = build(
    [
      knuckle(-5.4, -15.3),
      knuckle(-1.8, -16.2),
      knuckle(1.8, -16.2),
      knuckle(5.4, -15.3, 2.4, 2.7),
      FOLDED_THUMB,
      palm(8.4, 8, -9.5),
      wrist
    ],
    8.4,
    [...knuckleGaps([-5.4, -1.8, 1.8, 5.4], -15.6), foldedThumbLine]
  );
  var grip = build(
    [
      knuckle(6.2, -15, 2.6, 2.4, 20),
      knuckle(7.6, -11.4, 2.6, 2.4, 10),
      knuckle(7.8, -7.8, 2.6, 2.4),
      knuckle(6.8, -4.4, 2.4, 2.2, -10),
      finger(P(-5.6, -11), -30, 6.5, 2.5),
      palm(7.8, 8.2, -9.5),
      wrist
    ],
    8.4,
    [
      [P(4.8, -13.2), P(7.4, -13.4)],
      [P(5.4, -9.6), P(8, -9.6)],
      [P(5.2, -6.1), P(7.8, -6)]
    ]
  );
  var POINT_INDEX = finger(P(1.4, -14), 0, 13.5, 2.5);
  var point = build(
    [
      POINT_INDEX,
      knuckle(5.6, -13.4, 2.6, 2.3, 15),
      knuckle(6.6, -10.2, 2.6, 2.3),
      knuckle(6.4, -7, 2.4, 2.2, -10),
      finger(P(-5.4, -10.5), -24, 8.5, 2.6),
      palm(7.4, 7.6, -9.5),
      wrist
    ],
    8.2,
    [edge(POINT_INDEX, 1, 0.05, 0.35), [P(4.4, -11.8), P(7, -11.8)], [P(4.6, -8.6), P(7.2, -8.6)]]
  );
  var INDEX_F = finger(P(-0.8, -14.5), -3, 13, 2.5);
  var index = build(
    [
      INDEX_F,
      knuckle(3.4, -15.2, 2.3, 2.7),
      knuckle(6.2, -13.4, 2.3, 2.6, 20),
      knuckle(7.4, -10.2, 2.2, 2.4, 35),
      FOLDED_THUMB,
      palm(7.6, 7.6, -9.5),
      wrist
    ],
    8.2,
    [edge(INDEX_F, 1, 0.05, 0.3), [P(4.9, -14.6), P(4.4, -12.4)], foldedThumbLine]
  );
  var thumb = build(
    [
      { kind: "ellipse", c: P(2.6, -14.6), rx: 6.4, ry: 2.9, finger: true },
      { kind: "ellipse", c: P(3, -10.6), rx: 6.6, ry: 2.9, finger: true },
      { kind: "ellipse", c: P(2.8, -6.6), rx: 6.3, ry: 2.8, finger: true },
      finger(P(-2.6, -15), -4, 8.5, 3.1),
      palm(7.2, 7.8, -10),
      wrist
    ],
    8.4,
    [
      [P(0, -12.6), P(8.4, -12.6)],
      [P(0.2, -8.6), P(8.6, -8.6)],
      [P(0.4, -4.7), P(7.8, -4.7)]
    ]
  );
  var PEACE_F = [
    finger(P(-2.1, -14.5), -14, 12.5, 2.4),
    finger(P(2.1, -14.5), 14, 12.5, 2.4)
  ];
  var peace = build(
    [
      ...PEACE_F,
      knuckle(5.6, -13, 2.3, 2.5, 20),
      knuckle(7, -9.8, 2.2, 2.4, 35),
      FOLDED_THUMB,
      palm(7.6, 7.6, -9.5),
      wrist
    ],
    8.2,
    [edge(PEACE_F[0], 1, 0.05, 0.2), [P(5.8, -11.6), P(4.6, -10)], foldedThumbLine]
  );
  var SHOE_PARTS = [
    { kind: "ellipse", c: P(7.5, 1.6), rx: 12.4, ry: 6.6, deg: -3 },
    { kind: "ellipse", c: P(-3, 2.6), rx: 5.6, ry: 4.6 },
    { kind: "capsule", a: P(-4, 4.4), b: P(14, 4.4), r: 3.6 },
    { kind: "capsule", a: P(0, 0), b: P(0, -4.5), r: 4.2 }
  ];
  var shoe = {
    ink: SHOE_PARTS.map((p) => partPath(p, OUTLINE * 0.85)).join(""),
    fill: SHOE_PARTS.map((p) => partPath(p, 0)).join(""),
    lines: "",
    joint: 8.4
  };
  var HANDS = {
    open,
    relaxed,
    fist,
    grip,
    point,
    index,
    thumb,
    peace,
    shoe
  };
  var SMEAR = build(
    [{ kind: "ellipse", c: P(0, -11.5), rx: 6.4, ry: 10.5 }, palm(7, 6.8), wrist],
    8.2
  );

  // packages/character/src/limbs.ts
  var LIMB_SOCKETS = {
    arms: { left: 247, right: 113 },
    legs: { left: 204, right: 156 }
  };
  var LIMB = {
    /** The ink outline outside the orange, matching the traced rays. */
    outline: 2.4,
    /** Half-width of an arm's hose: thick and even, like the sheet's. */
    armHalf: 5.4,
    /** Half-width at the wrist. */
    wristHalf: 4.6,
    /** Half-width of a leg's hose, and at the ankle. */
    legHalf: 6.6,
    ankleHalf: 6,
    /** The radius at which limbs are rooted: inside the body, so hidden by it. */
    socketRadius: 40,
    /** The size a shoe is drawn at, relative to its art. */
    shoeScale: 1.55,
    /** The body's rest centre in the viewBox, which feet are planted against. */
    restCentre: { x: 100, y: 100 }
  };
  var arm = (hand, bend, shape, handRotation = 0, front = false, morph = 1) => ({ shoulderDeg: 0, hand, bend, shape, handRotation, handScale: 1.5, front, morph });
  var leg = (foot, bend = 0, footRotation = 0, morph = 1) => ({
    hip: { x: 0, y: 0 },
    foot,
    bend,
    footRotation,
    morph
  });
  var ARM_IN_L = arm({ x: -40, y: 18 }, 0, "relaxed", 0, false, 0);
  var ARM_IN_R = arm({ x: 40, y: 18 }, 0, "relaxed", 0, false, 0);
  var LEG_IN_L = leg({ x: -18, y: 44 }, 0, 0, 0);
  var LEG_IN_R = leg({ x: 18, y: 44 }, 0, 0, 0);
  var STAND = {
    left: leg({ x: -23, y: 82 }, -0.1, -4),
    right: leg({ x: 23, y: 82 }, 0.1, 4)
  };
  var SIT_DROP = 20;
  var SIT = {
    left: leg({ x: -44, y: 76 }, 0.35, -28),
    right: leg({ x: 44, y: 76 }, -0.35, 28)
  };
  var HIP_L = arm({ x: -51, y: 22 }, 2.8, "fist", 35, true);
  var HIP_R = arm({ x: 51, y: 22 }, -2.8, "fist", -35, true);
  var DOWN_L = arm({ x: -52, y: 44 }, -0.35, "relaxed", 10);
  var DOWN_R = arm({ x: 52, y: 44 }, 0.35, "relaxed", -10);
  var LIMB_POSES = {
    /** The logo: no limbs out. */
    rest: {
      visible: true,
      arms: { left: ARM_IN_L, right: ARM_IN_R },
      legs: { left: LEG_IN_L, right: LEG_IN_R }
    },
    /** Standing on two legs, arms tucked. */
    stand: {
      visible: true,
      arms: { left: ARM_IN_L, right: ARM_IN_R },
      legs: STAND
    },
    /** Standing easy, arms loose at the sides. */
    easy: {
      visible: true,
      arms: { left: DOWN_L, right: DOWN_R },
      legs: STAND
    },
    /** Hands on hips, elbows out (sheet: bottom right). */
    hips: {
      visible: true,
      arms: { left: HIP_L, right: HIP_R },
      legs: STAND
    },
    /** Waving hello, the other fist on the hip (sheet: top left). */
    wave: {
      visible: true,
      arms: {
        left: arm({ x: -66, y: -26 }, 0.5, "open", -12),
        right: HIP_R
      },
      legs: STAND
    },
    /** Thumbs up, the other fist on the hip (sheet: top row, third). */
    thumbsUp: {
      visible: true,
      arms: {
        left: HIP_L,
        right: arm({ x: 66, y: -6 }, -0.5, "thumb", -70)
      },
      legs: STAND
    },
    /** Finger-guns, one each side (sheet: top right). */
    point: {
      visible: true,
      arms: {
        left: arm({ x: -64, y: 6 }, -0.25, "point", 0),
        right: arm({ x: 66, y: 4 }, 0.25, "point", 0)
      },
      legs: {
        left: leg({ x: -20, y: 82 }, -0.1, -4),
        right: leg({ x: 28, y: 78 }, 0.25, 14)
      }
    },
    /** Both fists up, cheering (sheet: second row, first). */
    cheer: {
      visible: true,
      arms: {
        left: arm({ x: -62, y: -44 }, 0.45, "fist", 0),
        right: arm({ x: 62, y: -44 }, -0.45, "fist", 0)
      },
      legs: {
        left: leg({ x: -30, y: 82 }, -0.15, -8),
        right: leg({ x: 30, y: 82 }, 0.15, 8)
      }
    },
    /** Hand on chin, thinking, the other on the hip (sheet: second row, second). */
    chin: {
      visible: true,
      arms: {
        left: HIP_L,
        right: arm({ x: 6, y: 40 }, 1.4, "index", -150, true)
      },
      legs: STAND
    },
    /** Finger up, "I've got it" (sheet: second row, third). */
    idea: {
      visible: true,
      arms: {
        left: arm({ x: -62, y: -30 }, 0.45, "index", -20),
        right: HIP_R
      },
      legs: STAND
    },
    /** Peace sign (sheet: bottom left). */
    peace: {
      visible: true,
      arms: {
        left: arm({ x: -62, y: -30 }, 0.45, "peace", -20),
        right: HIP_R
      },
      legs: STAND
    },
    /** Arms out, palms up: a shrug. */
    shrug: {
      visible: true,
      arms: {
        left: arm({ x: -66, y: 10 }, 0.6, "open", -60),
        right: arm({ x: 66, y: 10 }, -0.6, "open", 60)
      },
      legs: STAND
    },
    /** Mid-jump, arms flung up, legs kicked out (sheet: bottom row, second). */
    jump: {
      visible: true,
      arms: {
        left: arm({ x: -70, y: -30 }, 0.35, "open", -20),
        right: arm({ x: 70, y: -30 }, -0.35, "open", 20)
      },
      legs: {
        left: leg({ x: -36, y: 70 }, -0.5, -24),
        right: leg({ x: 36, y: 70 }, 0.5, 24)
      }
    },
    /** Drooping: arms hang limp, knees buckle. */
    droop: {
      visible: true,
      arms: {
        left: arm({ x: -46, y: 50 }, -0.3, "relaxed", 10),
        right: arm({ x: 46, y: 50 }, 0.3, "relaxed", -10)
      },
      legs: {
        left: leg({ x: -20, y: 82 }, 0.45, 6),
        right: leg({ x: 20, y: 82 }, -0.45, -6)
      }
    },
    /** Sitting on the ground, legs out in front, hands at the sides. */
    sit: {
      visible: true,
      arms: { left: DOWN_L, right: DOWN_R },
      legs: SIT
    },
    /** Holding an open book in both hands (sheet: third row, second). */
    read: {
      visible: true,
      arms: {
        left: arm({ x: -33, y: 36 }, -0.9, "grip", 100, true),
        right: arm({ x: 33, y: 36 }, 0.9, "grip", -100, true)
      },
      legs: SIT
    },
    /** Typing on a laptop on the lap (sheet: third row, third). */
    type: {
      visible: true,
      arms: {
        left: arm({ x: -14, y: 48 }, -1.4, "relaxed", 175, true),
        right: arm({ x: 18, y: 48 }, 1.4, "relaxed", -175, true)
      },
      legs: SIT
    },
    /** A magnifying glass held up to one eye (sheet: third row, fourth). */
    magnify: {
      visible: true,
      arms: {
        left: arm({ x: -44, y: 4 }, -1, "grip", 20, true),
        right: arm({ x: 54, y: 26 }, -0.4, "relaxed", -20)
      },
      legs: STAND
    },
    /** A balloon string held out to the side (sheet: third row, first). */
    balloon: {
      visible: true,
      arms: {
        left: arm({ x: -62, y: -4 }, 0.4, "grip", 0),
        right: arm({ x: 58, y: 24 }, -0.5, "open", -40)
      },
      legs: {
        left: leg({ x: -26, y: 80 }, -0.25, -10),
        right: leg({ x: 24, y: 82 }, 0.15, 6)
      }
    },
    /** Reclining: hands behind the head, legs crossed (sheet: the deckchair). */
    recline: {
      visible: true,
      arms: {
        // The hands are hidden behind the head; only the elbows show, as wings.
        left: { ...arm({ x: -18, y: -30 }, -1.3, "fist", 160), behind: true },
        right: { ...arm({ x: 18, y: -30 }, 1.3, "fist", -160), behind: true }
      },
      legs: {
        left: leg({ x: -46, y: 50 }, 0.3, -6),
        right: leg({ x: -30, y: 58 }, -0.2, -4)
      }
    },
    /** Walking: one stride (sheet: top row, second). Sequences swing it. */
    walk: {
      visible: true,
      arms: {
        left: arm({ x: -60, y: 28 }, -0.4, "fist", 0),
        right: arm({ x: 58, y: 8 }, -0.5, "fist", -30)
      },
      legs: {
        left: leg({ x: -34, y: 80 }, -0.3, -18),
        right: leg({ x: 26, y: 76 }, 0.45, 20)
      }
    }
  };
  function cloneLimbs(l) {
    const a = (x) => ({ ...x, hand: { ...x.hand } });
    const g = (x) => ({ ...x, hip: { ...x.hip }, foot: { ...x.foot } });
    return {
      visible: l.visible,
      arms: { left: a(l.arms.left), right: a(l.arms.right) },
      legs: { left: g(l.legs.left), right: g(l.legs.right) }
    };
  }
  function limbPose(name) {
    return cloneLimbs(LIMB_POSES[name]);
  }
  var mix = (a, b, t) => a + (b - a) * t;
  var mixV = (a, b, t) => ({ x: mix(a.x, b.x, t), y: mix(a.y, b.y, t) });
  var morphOf = (m) => m === void 0 ? 1 : m;
  function blendLimbs(a, b, t) {
    const k = Math.min(1, Math.max(0, t));
    if (k <= 0) return cloneLimbs(a);
    if (k >= 1) return cloneLimbs(b);
    const blendArm = (p, q) => {
      const pm = morphOf(p.morph);
      const qm = morphOf(q.morph);
      const shapeFrom = pm < 0.01 ? q : qm < 0.01 ? p : k < 0.5 ? p : q;
      const changing = pm >= 0.01 && qm >= 0.01 && p.shape !== q.shape;
      const smear = changing && k > 0.3 && k < 0.7;
      return {
        shoulderDeg: mix(p.shoulderDeg, q.shoulderDeg, k),
        // A limb growing from its ray keeps aiming at its target; it does not
        // sweep across from the ray's own resting tip.
        hand: pm < 0.01 ? { ...q.hand } : qm < 0.01 ? { ...p.hand } : mixV(p.hand, q.hand, k),
        bend: pm < 0.01 ? q.bend : qm < 0.01 ? p.bend : mix(p.bend, q.bend, k),
        shape: shapeFrom.shape,
        ...smear ? { smear: true } : {},
        handRotation: pm < 0.01 ? q.handRotation : qm < 0.01 ? p.handRotation : mix(p.handRotation, q.handRotation, k),
        handScale: mix(p.handScale, q.handScale, k) * (changing ? 1 - 0.14 * Math.sin(Math.PI * k) : 1),
        front: shapeFrom.front,
        tubeFront: shapeFrom.tubeFront,
        ...shapeFrom.behind !== void 0 ? { behind: shapeFrom.behind } : {},
        morph: mix(pm, qm, k)
      };
    };
    const blendLeg = (p, q) => {
      const pm = morphOf(p.morph);
      const qm = morphOf(q.morph);
      return {
        hip: mixV(p.hip, q.hip, k),
        foot: pm < 0.01 ? { ...q.foot } : qm < 0.01 ? { ...p.foot } : mixV(p.foot, q.foot, k),
        bend: pm < 0.01 ? q.bend : qm < 0.01 ? p.bend : mix(p.bend, q.bend, k),
        footRotation: mix(p.footRotation, q.footRotation, k),
        morph: mix(pm, qm, k)
      };
    };
    return {
      visible: k < 1 ? a.visible : b.visible,
      arms: {
        left: blendArm(a.arms.left, b.arms.left),
        right: blendArm(a.arms.right, b.arms.right)
      },
      legs: { left: blendLeg(a.legs.left, b.legs.left), right: blendLeg(a.legs.right, b.legs.right) }
    };
  }
  function n(v) {
    if (!Number.isFinite(v)) return "0";
    const r = Math.round(v * 100) / 100;
    return Object.is(r, -0) ? "0" : String(r);
  }
  var smooth = (t) => {
    const c = Math.min(1, Math.max(0, t));
    return c * c * (3 - 2 * c);
  };
  function rayDirection(angleDeg) {
    const a = angleDeg * Math.PI / 180;
    return { x: Math.sin(a), y: -Math.cos(a) };
  }
  function tubePath(t) {
    const m = Math.min(1, Math.max(0, t.morph));
    const restTip = { x: t.base.x + t.dir.x * t.rayLength, y: t.base.y + t.dir.y * t.rayLength };
    const reach = smooth(m * 1.15);
    const end = mixV(restTip, t.target, reach);
    const dx = end.x - t.base.x;
    const dy = end.y - t.base.y;
    const len = Math.hypot(dx, dy) || 1;
    const perp = { x: -dy / len, y: dx / len };
    const straight = { x: t.base.x + t.dir.x * len * 0.5, y: t.base.y + t.dir.y * len * 0.5 };
    const bowed = {
      // The bow is measured against at least a forearm's length, so a short
      // arm (a fist on the hip) can still throw its elbow well out.
      x: (t.base.x + end.x) / 2 + perp.x * t.bend * Math.max(len, 24) * 0.5,
      y: (t.base.y + end.y) / 2 + perp.y * t.bend * Math.max(len, 24) * 0.5
    };
    const c = mixV(straight, bowed, m);
    const endHalf = mix(0.35, t.endHalf, smooth(m * 1.4));
    const power = t.power ?? mix(1, 3.2, m);
    const N = 16;
    const left = [];
    const right = [];
    let endDir = { x: dx / len, y: dy / len };
    for (let i = 0; i <= N; i++) {
      const s = i / N;
      const u = 1 - s;
      const p = {
        x: u * u * t.base.x + 2 * u * s * c.x + s * s * end.x,
        y: u * u * t.base.y + 2 * u * s * c.y + s * s * end.y
      };
      const tan = {
        x: 2 * u * (c.x - t.base.x) + 2 * s * (end.x - c.x),
        y: 2 * u * (c.y - t.base.y) + 2 * s * (end.y - c.y)
      };
      const tl = Math.hypot(tan.x, tan.y) || 1;
      const nx = -tan.y / tl;
      const ny = tan.x / tl;
      if (i === N) endDir = { x: tan.x / tl, y: tan.y / tl };
      const wobble = t.boil === void 0 ? 0 : noise(i, t.boil) * 0.22;
      const flare = t.flareHalf !== void 0 && t.flareHalf > endHalf ? (t.flareHalf - endHalf) * smooth((s - 0.72) / 0.28) * smooth(m * 1.2) : 0;
      const half = endHalf + (t.baseHalf - endHalf) * Math.pow(1 - s, power) + flare + wobble;
      left.push({ x: p.x + nx * half, y: p.y + ny * half });
      right.push({ x: p.x - nx * half, y: p.y - ny * half });
    }
    const cap = [];
    for (let k = 1; k < 6; k++) {
      const a = k / 6 * Math.PI;
      const ex = Math.cos(a);
      const ey = Math.sin(a);
      const nx = -endDir.y;
      const ny = endDir.x;
      cap.push({
        x: end.x + nx * endHalf * ex + endDir.x * endHalf * ey,
        y: end.y + ny * endHalf * ex + endDir.y * endHalf * ey
      });
    }
    const outline = [...left, ...cap, ...right.reverse()];
    return { d: smoothClosed(outline), end, endDir };
  }
  function smoothClosed(pts) {
    const count = pts.length;
    const at = (i) => pts[(i + count) % count];
    const parts = [`M${n(at(0).x)} ${n(at(0).y)}`];
    for (let i = 0; i < count; i++) {
      const p0 = at(i - 1);
      const p1 = at(i);
      const p2 = at(i + 1);
      const p3 = at(i + 2);
      if (i === count - 1) {
        parts.push(`L${n(p2.x)} ${n(p2.y)}`);
        continue;
      }
      const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
      const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
      parts.push(`C${n(c1.x)} ${n(c1.y)} ${n(c2.x)} ${n(c2.y)} ${n(p2.x)} ${n(p2.y)}`);
    }
    parts.push("Z");
    return parts.join("");
  }
  function tubeInk(d, paint) {
    return `<path d="${d}" fill="${paint.ink}" stroke="${paint.ink}" stroke-width="${n(LIMB.outline * 2)}" stroke-linejoin="round"/>`;
  }
  function tubeFill(d, paint) {
    return `<path d="${d}" fill="${paint.limb}"/>`;
  }
  var HAND_ART = {
    relaxed: HANDS.relaxed,
    open: HANDS.open,
    fist: HANDS.fist,
    grip: HANDS.grip,
    point: HANDS.point,
    index: HANDS.index,
    thumb: HANDS.thumb,
    peace: HANDS.peace
  };
  function artInk(art, paint, boil) {
    return `<path d="${boilPath(art.ink, boil, 0.18)}" fill="${paint.ink}"/>`;
  }
  function artFill(art, paint, boil) {
    const fill = `<path d="${boilPath(art.fill, boil, 0.18)}" fill="${paint.limb}"/>`;
    if (!art.lines) return fill;
    return fill + `<path d="${boilPath(art.lines, boil, 0.12)}" fill="${paint.ink}"/>`;
  }
  function joined(tubeD, endArt, endArtFill, paint) {
    return tubeInk(tubeD, paint) + endArt + endArtFill + tubeFill(tubeD, paint);
  }
  function socket(deg) {
    const dir = rayDirection(deg);
    return { base: { x: dir.x * LIMB.socketRadius, y: dir.y * LIMB.socketRadius }, dir };
  }
  function armParts(armRig, side, _rays, paint, boil) {
    return armMarkupSplit(armRig, side, paint, boil);
  }
  function armMarkupSplit(armRig, side, paint, boil) {
    const m = morphOf(armRig.morph);
    if (m < 0.02) return { tube: "", hand: "" };
    const { base, dir } = socket(LIMB_SOCKETS.arms[side]);
    const art = armRig.smear ? SMEAR : HAND_ART[armRig.shape];
    const tube = tubePath({
      base,
      dir,
      baseHalf: LIMB.armHalf,
      rayLength: 0,
      target: armRig.hand,
      endHalf: LIMB.wristHalf,
      // Flare to just inside the hand's own wrist, so the hand stays a touch wider.
      flareHalf: Math.min(art.joint * armRig.handScale * 0.5, LIMB.wristHalf * 1.4),
      bend: armRig.bend,
      morph: m,
      boil,
      power: 1
    });
    const growth = smooth((m - 0.3) / 0.7);
    if (growth > 0.01) {
      const follow = Math.atan2(tube.endDir.x, -tube.endDir.y) * 180 / Math.PI;
      const mirror = side === "left";
      const rotation = follow + (mirror ? -armRig.handRotation : armRig.handRotation);
      const s = armRig.handScale * growth;
      const back = LIMB.wristHalf * 0.6;
      const wrist2 = { x: tube.end.x - tube.endDir.x * back, y: tube.end.y - tube.endDir.y * back };
      const place = `<g transform="translate(${n(wrist2.x)} ${n(wrist2.y)}) rotate(${n(rotation)}) scale(${n(mirror ? -s : s)} ${n(s)})">`;
      const ink = place + artInk(art, paint, boil) + "</g>";
      const fill = place + artFill(art, paint, boil) + "</g>";
      const inFront = armRig.front && m >= 0.85;
      if (inFront && armRig.tubeFront) {
        return { tube: "", hand: joined(tube.d, ink, fill, paint) };
      }
      if (inFront) {
        return { tube: tubeInk(tube.d, paint) + tubeFill(tube.d, paint), hand: ink + fill };
      }
      return { tube: joined(tube.d, ink, fill, paint), hand: "" };
    }
    return { tube: tubeInk(tube.d, paint) + tubeFill(tube.d, paint), hand: "" };
  }
  function legMarkup(legRig, side, _rays, toViewBox2, scale, paint, boil) {
    const m = morphOf(legRig.morph);
    if (m < 0.02) return "";
    const local = socket(LIMB_SOCKETS.legs[side]);
    const base = toViewBox2(local.base);
    const ahead = toViewBox2({ x: local.base.x + local.dir.x, y: local.base.y + local.dir.y });
    const dl = Math.hypot(ahead.x - base.x, ahead.y - base.y) || 1;
    const dir = { x: (ahead.x - base.x) / dl, y: (ahead.y - base.y) / dl };
    const foot = {
      x: LIMB.restCentre.x + legRig.foot.x,
      y: LIMB.restCentre.y + legRig.foot.y
    };
    const tube = tubePath({
      base,
      dir,
      baseHalf: LIMB.legHalf * scale,
      rayLength: 0,
      target: foot,
      endHalf: LIMB.ankleHalf,
      flareHalf: HANDS.shoe.joint * LIMB.shoeScale * 0.5,
      bend: legRig.bend,
      morph: m,
      boil,
      power: 1
    });
    const growth = smooth((m - 0.3) / 0.7);
    if (growth > 0.01) {
      const mirror = side === "left";
      const s = LIMB.shoeScale * growth;
      const place = `<g transform="translate(${n(tube.end.x)} ${n(tube.end.y)}) scale(${n(mirror ? -s : s)} ${n(s)}) rotate(${n(legRig.footRotation)})">`;
      return joined(
        tube.d,
        place + artInk(HANDS.shoe, paint, boil) + "</g>",
        place + artFill(HANDS.shoe, paint, boil) + "</g>",
        paint
      );
    }
    return tubeInk(tube.d, paint) + tubeFill(tube.d, paint);
  }
  function limbRayIndices(_limbs) {
    return [];
  }

  // packages/character/src/rig.ts
  function createRays() {
    return RAY.anglesDeg.map((angleDeg) => ({
      angleDeg,
      lengthScale: 1,
      widthScale: 1,
      rotation: 0,
      offset: { x: 0, y: 0 },
      visible: true
    }));
  }
  var eye = (x, y, rotation, width, height) => ({
    x,
    y,
    rotation,
    width,
    height,
    scaleX: 1,
    scaleY: 1,
    closed: 0,
    gaze: { x: 0, y: 0 }
  });
  var brow = (x, y, rotation, length, arch) => ({
    x,
    y,
    rotation,
    length,
    arch,
    scale: 1
  });
  function defaultRig() {
    return {
      x: 100,
      y: 100,
      rotation: 0,
      scale: 1,
      squash: 0,
      stretch: 0,
      faceTilt: 0,
      eyes: {
        // Reference long axes are +89.6 and +76.6 degrees, and the renderer maps
        // `rotation` to an axis of 90 + rotation, so the tilts are -0.4 and -13.4.
        // Sizes are the measured extents: the reported major/minor lengths run
        // ~2.65 units larger than the opening itself (that is the outline stroke
        // and the black crescent, which are part of the ink mask), and the offset
        // was confirmed against all four of the reference's eye measurements.
        left: eye(-14, -1.9, -0.4, 21.8, 36.6),
        right: eye(17.6, -8.3, -13.4, 18.6, 30.5)
      },
      brows: {
        left: brow(-20.8, -23, -36.7, 12.5, 4.3),
        right: brow(12.3, -30.5, -5.9, 9.1, 2.5)
      },
      smile: {
        x: 5.1,
        y: 15.2,
        rotation: -14.6,
        span: 46.6,
        depth: 7.531,
        strokeWidth: 4
      },
      rays: createRays(),
      props: [],
      // At rest every limb is still its ray: the pose IS the logo (sunny.png).
      limbs: limbPose("rest"),
      theme: { ...SUNNY_THEME }
    };
  }
  function cloneRig(rig) {
    return {
      ...rig,
      eyes: {
        left: { ...rig.eyes.left, gaze: { ...rig.eyes.left.gaze } },
        right: { ...rig.eyes.right, gaze: { ...rig.eyes.right.gaze } }
      },
      brows: { left: { ...rig.brows.left }, right: { ...rig.brows.right } },
      smile: { ...rig.smile },
      rays: rig.rays.map((r) => ({ ...r, offset: { ...r.offset } })),
      props: rig.props.map((p) => ({ ...p })),
      limbs: cloneLimbs(rig.limbs),
      theme: { ...rig.theme }
    };
  }
  function rootScale(rig) {
    return { sx: rig.scale * (1 + rig.stretch), sy: rig.scale * (1 - rig.squash) };
  }
  function toViewBox(rig, point2) {
    const { sx, sy } = rootScale(rig);
    const a = rig.rotation * Math.PI / 180;
    const x = point2.x * sx;
    const y = point2.y * sy;
    return {
      x: rig.x + x * Math.cos(a) - y * Math.sin(a),
      y: rig.y + x * Math.sin(a) + y * Math.cos(a)
    };
  }
  function toBodyFrame(rig, point2) {
    const { sx, sy } = rootScale(rig);
    const a = -rig.rotation * Math.PI / 180;
    const dx = point2.x - rig.x;
    const dy = point2.y - rig.y;
    return {
      x: (dx * Math.cos(a) - dy * Math.sin(a)) / sx,
      y: (dx * Math.sin(a) + dy * Math.cos(a)) / sy
    };
  }
  var ARM_MAX_LENGTH_SCALE = 3.5;
  function armTo(ray, target) {
    const distance = Math.hypot(target.x, target.y);
    const angleDeg = Math.atan2(target.x, -target.y) * 180 / Math.PI;
    const reach = RAY.tipRadius + RAY.apexCompensation - RAY.baseRadius;
    return {
      ...ray,
      rotation: angleDeg - ray.angleDeg,
      lengthScale: Math.min(ARM_MAX_LENGTH_SCALE, Math.max(0, (distance - RAY.baseRadius) / reach)),
      offset: { x: 0, y: 0 },
      visible: true
    };
  }
  function rayTip(ray) {
    const a = (ray.angleDeg + ray.rotation) * Math.PI / 180;
    const reach = RAY.baseRadius + (RAY.tipRadius + RAY.apexCompensation - RAY.baseRadius) * Math.max(0, ray.lengthScale);
    return {
      x: Math.sin(a) * reach + ray.offset.x,
      y: -Math.cos(a) * reach + ray.offset.y
    };
  }
  var lerp = (a, b, t) => a + (b - a) * t;
  var clamp01 = (t) => t < 0 ? 0 : t > 1 ? 1 : t;
  function lerpRig(a, b, t) {
    const k = clamp01(t);
    const n4 = (p, q) => lerp(p, q, k);
    const eyeBlend = (p, q) => ({
      x: n4(p.x, q.x),
      y: n4(p.y, q.y),
      rotation: n4(p.rotation, q.rotation),
      width: n4(p.width, q.width),
      height: n4(p.height, q.height),
      scaleX: n4(p.scaleX, q.scaleX),
      scaleY: n4(p.scaleY, q.scaleY),
      closed: n4(p.closed, q.closed),
      gaze: { x: n4(p.gaze.x, q.gaze.x), y: n4(p.gaze.y, q.gaze.y) }
    });
    const browBlend = (p, q) => ({
      x: n4(p.x, q.x),
      y: n4(p.y, q.y),
      rotation: n4(p.rotation, q.rotation),
      length: n4(p.length, q.length),
      arch: n4(p.arch, q.arch),
      scale: n4(p.scale, q.scale)
    });
    return {
      x: n4(a.x, b.x),
      y: n4(a.y, b.y),
      rotation: n4(a.rotation, b.rotation),
      scale: n4(a.scale, b.scale),
      squash: n4(a.squash, b.squash),
      stretch: n4(a.stretch, b.stretch),
      faceTilt: n4(a.faceTilt, b.faceTilt),
      eyes: { left: eyeBlend(a.eyes.left, b.eyes.left), right: eyeBlend(a.eyes.right, b.eyes.right) },
      brows: {
        left: browBlend(a.brows.left, b.brows.left),
        right: browBlend(a.brows.right, b.brows.right)
      },
      smile: {
        x: n4(a.smile.x, b.smile.x),
        y: n4(a.smile.y, b.smile.y),
        rotation: n4(a.smile.rotation, b.smile.rotation),
        span: n4(a.smile.span, b.smile.span),
        depth: n4(a.smile.depth, b.smile.depth),
        strokeWidth: n4(a.smile.strokeWidth, b.smile.strokeWidth)
      },
      rays: a.rays.map((ra, i) => {
        const rb = b.rays[i] ?? ra;
        return {
          angleDeg: n4(ra.angleDeg, rb.angleDeg),
          lengthScale: n4(ra.lengthScale, rb.lengthScale),
          widthScale: n4(ra.widthScale, rb.widthScale),
          rotation: n4(ra.rotation, rb.rotation),
          offset: { x: n4(ra.offset.x, rb.offset.x), y: n4(ra.offset.y, rb.offset.y) },
          visible: k < 1 ? ra.visible : rb.visible
        };
      }),
      // Props blend by position. A prop present in only one of the two rigs is
      // treated as fully transparent at the other end, so it fades instead of
      // appearing or vanishing mid-blend.
      props: blendProps(a.props, b.props, k, n4),
      limbs: blendLimbs(a.limbs, b.limbs, k),
      theme: k < 1 ? { ...a.theme } : { ...b.theme }
    };
  }
  function blendProps(a, b, k, n4) {
    const count = Math.max(a.length, b.length);
    const out = [];
    for (let i = 0; i < count; i++) {
      const p = a[i];
      const q = b[i];
      if (p && q) {
        out.push({
          id: k < 0.5 ? p.id : q.id,
          x: n4(p.x, q.x),
          y: n4(p.y, q.y),
          rotation: n4(p.rotation, q.rotation),
          scale: n4(p.scale, q.scale),
          opacity: n4(p.opacity, q.opacity)
        });
      } else if (p) {
        out.push({ ...p, opacity: p.opacity * (1 - k) });
      } else if (q) {
        out.push({ ...q, opacity: q.opacity * k });
      }
    }
    return out;
  }

  // packages/character/src/traced-art.ts
  var TRACED_ART = {
    body: {
      ink: "M1.3 48.1C-0.9 48.1 -5 48 -7.1 47.8C-9.3 47.7 -10 47.5 -11.7 47.2C-13.3 46.9 -15.6 46.3 -17.2 45.8C-18.8 45.3 -19.9 44.9 -21.3 44.3C-22.7 43.7 -24.2 43 -25.7 42.2C-27.2 41.3 -29.1 40.1 -30.4 39.2C-31.6 38.3 -32.3 37.8 -33.4 36.7C-34.6 35.7 -36.3 34.1 -37.3 33C-38.3 31.9 -38.6 31.7 -39.6 30.3C-40.7 28.9 -42.7 26.1 -43.7 24.6C-44.7 23 -45.1 22.2 -45.7 20.9C-46.3 19.7 -46.9 18.4 -47.4 16.9C-48 15.4 -48.6 13.6 -49 12C-49.4 10.5 -49.6 8.8 -49.9 7.5C-50.1 6.2 -50.2 5.8 -50.2 4.1C-50.3 2.5 -50.3 -1 -50.2 -2.5C-50.2 -4 -50.2 -3.6 -50 -4.9C-49.8 -6.2 -49.4 -8.6 -49 -10.3C-48.6 -12 -48 -13.6 -47.6 -14.9C-47.1 -16.3 -46.9 -16.9 -46.2 -18.4C-45.5 -20 -44.2 -22.4 -43.2 -24.1C-42.1 -25.8 -40.9 -27.5 -39.9 -28.8C-38.9 -30.1 -38.3 -30.7 -37.3 -31.7C-36.3 -32.8 -35 -34.1 -33.7 -35.2C-32.3 -36.4 -30.4 -37.8 -29.1 -38.8C-27.8 -39.7 -27.1 -40.2 -25.8 -40.9C-24.5 -41.7 -22.8 -42.6 -21.3 -43.3C-19.9 -44 -18.5 -44.6 -17.2 -45.1C-15.8 -45.6 -14.9 -45.9 -13.3 -46.3C-11.7 -46.7 -9.2 -47.3 -7.4 -47.6C-5.6 -47.9 -4.3 -48 -2.6 -48.1C-0.9 -48.2 1.1 -48.2 2.8 -48.1C4.4 -48 5.6 -47.9 7.3 -47.6C8.9 -47.3 11.1 -46.9 12.8 -46.4C14.5 -46 16.2 -45.4 17.4 -44.9C18.6 -44.5 18.7 -44.5 20.1 -43.8C21.4 -43.1 24 -41.8 25.7 -40.8C27.4 -39.8 28.9 -38.6 30.2 -37.6C31.4 -36.7 32.1 -36 33.1 -35.1C34.1 -34.1 35.3 -32.9 36.4 -31.7C37.4 -30.5 38.5 -29.2 39.4 -27.8C40.4 -26.5 41.4 -25.1 42.2 -23.7C43 -22.3 43.6 -21.1 44.3 -19.7C45 -18.3 45.7 -16.7 46.2 -15.2C46.7 -13.7 47.2 -12.1 47.6 -10.7C48 -9.2 48.2 -8.1 48.5 -6.4C48.7 -4.7 49 -2.4 49.1 -0.6C49.2 1.2 49.2 2.8 49.1 4.4C49 6 48.8 7.7 48.6 9.2C48.4 10.6 48.2 11.5 47.8 12.9C47.4 14.3 46.9 16.1 46.3 17.7C45.7 19.3 44.7 21.2 44.1 22.4C43.4 23.7 43 24.3 42.4 25.2C41.8 26.2 41.4 26.9 40.4 28.1C39.4 29.4 37.5 31.6 36.4 32.7C35.3 33.9 34.9 34.3 33.8 35.2C32.7 36.2 31.6 37.2 29.8 38.4C28.1 39.6 25.3 41.3 23.6 42.3C21.9 43.3 21.2 43.5 19.6 44.2C17.9 44.8 15.4 45.7 13.8 46.2C12.2 46.7 11.3 46.8 10 47.1C8.7 47.3 7.5 47.6 6 47.7C4.6 47.9 3.4 48.1 1.3 48.1Z",
      fill: "M1.6 46.1C-0 46.1 -2.7 46.1 -4.4 46.1C-6.1 46 -7.2 45.9 -8.4 45.7C-9.6 45.6 -10.2 45.5 -11.5 45.2C-12.9 44.9 -15 44.4 -16.4 43.9C-17.8 43.5 -18.7 43.2 -19.9 42.7C-21.2 42.2 -22.5 41.6 -24 40.8C-25.4 40 -27.2 38.9 -28.6 37.9C-30 36.9 -31 36.1 -32.3 35C-33.6 33.9 -35.1 32.3 -36.2 31.1C-37.3 29.9 -38 29 -39 27.6C-40 26.2 -41.3 24.3 -42.2 22.8C-43.1 21.3 -43.7 20 -44.3 18.7C-44.9 17.4 -45.4 16.3 -45.8 14.9C-46.3 13.6 -46.7 12.5 -47.1 10.5C-47.5 8.6 -47.9 5.3 -48.1 3.3C-48.3 1.2 -48.2 -0.2 -48.1 -1.6C-48 -3.1 -47.9 -3.9 -47.7 -5.3C-47.5 -6.6 -47.2 -8.4 -46.8 -9.9C-46.5 -11.4 -46 -12.7 -45.6 -14C-45.1 -15.4 -44.7 -16.4 -44.1 -17.8C-43.4 -19.2 -42.3 -21.2 -41.6 -22.6C-40.8 -23.9 -40.3 -24.7 -39.3 -26C-38.3 -27.2 -37 -29 -35.8 -30.2C-34.6 -31.5 -33.6 -32.5 -32.3 -33.6C-31 -34.7 -29.3 -36 -28.1 -36.9C-26.9 -37.8 -26.3 -38.2 -24.8 -39C-23.4 -39.9 -21.3 -41 -19.6 -41.8C-17.8 -42.6 -15.9 -43.3 -14.3 -43.8C-12.7 -44.3 -11.6 -44.6 -10.2 -44.9C-8.7 -45.3 -7.3 -45.5 -5.8 -45.7C-4.2 -45.9 -2.3 -46 -0.8 -46.1C0.8 -46.1 1.8 -46.1 3.3 -46C4.8 -45.8 6.7 -45.6 8.3 -45.3C9.8 -45 11.2 -44.7 12.7 -44.3C14.1 -43.9 15.6 -43.4 16.8 -42.9C18 -42.5 18.7 -42.2 19.9 -41.6C21.2 -40.9 22.6 -40.2 24.1 -39.3C25.5 -38.4 27.5 -37 28.7 -36C29.9 -35.1 30.3 -34.8 31.4 -33.8C32.4 -32.8 33.9 -31.3 34.9 -30.2C35.9 -29 36.5 -28.2 37.4 -27C38.3 -25.7 39.4 -24.1 40.3 -22.6C41.2 -21.1 41.9 -19.6 42.7 -17.9C43.4 -16.2 44.3 -13.9 44.8 -12.3C45.3 -10.7 45.5 -9.9 45.8 -8.5C46.1 -7.1 46.4 -5.5 46.6 -4C46.8 -2.5 46.9 -1.2 47 0.4C47 2 46.9 4.2 46.8 5.6C46.8 7 46.7 7.5 46.4 8.8C46.2 10.1 45.8 11.9 45.4 13.3C45.1 14.7 44.7 15.7 44.2 17.1C43.6 18.4 42.8 20.2 42.2 21.3C41.6 22.5 41.3 23 40.6 24.1C39.8 25.2 38.7 26.8 37.8 28C36.8 29.2 35.9 30.3 34.8 31.4C33.7 32.5 32.5 33.6 31.3 34.6C30.1 35.6 29 36.5 27.6 37.4C26.2 38.4 24.2 39.5 22.8 40.3C21.5 41.1 20.7 41.4 19.4 41.9C18.2 42.5 16.7 43.1 15.2 43.6C13.6 44.1 11.7 44.6 10.2 44.9C8.6 45.3 7.1 45.5 5.6 45.7C4.2 45.9 3.3 46 1.6 46.1Z"
    },
    rays: [
      {
        ink: "M13.8 -48C13.3 -47.9 13.1 -47.8 12.2 -48C11.2 -48.2 9.4 -48.9 8 -49.2C6.7 -49.5 5.8 -49.7 4 -49.9C2.2 -50 -0.8 -50.1 -2.6 -50C-4.5 -49.9 -5.7 -49.7 -7.3 -49.3C-8.8 -49 -11 -48.2 -12 -48C-13.1 -47.8 -13 -47.9 -13.4 -48C-13.9 -48.1 -14.4 -48.4 -14.8 -48.6C-15.2 -48.9 -15.4 -49.3 -15.6 -49.5C-15.8 -49.8 -15.8 -50 -15.9 -50.3C-15.9 -50.6 -16 -51.1 -15.9 -51.5C-15.8 -52 -17.3 -49.5 -15.2 -53.1C-13.1 -56.6 -5.5 -69.5 -3.4 -73C-1.4 -76.5 -3.1 -73.7 -2.8 -74.1C-2.4 -74.4 -1.8 -75 -1.4 -75.3C-1 -75.5 -0.9 -75.5 -0.5 -75.6C-0.1 -75.6 0.4 -75.7 0.9 -75.5C1.3 -75.4 1.8 -75.1 2.1 -74.9C2.5 -74.7 0.5 -78 2.8 -74.2C5.1 -70.5 13.5 -56.2 15.7 -52.4C17.9 -48.6 16.1 -51.7 16.1 -51.3C16.2 -50.9 16.1 -50.4 16 -49.9C15.8 -49.5 15.5 -49 15.1 -48.7C14.7 -48.3 14.3 -48.1 13.8 -48Z",
        fill: "M12.9 -50.1C11.8 -50.3 9 -51.2 6.9 -51.6C4.8 -51.9 2.4 -52.2 0.4 -52.2C-1.7 -52.3 -3.8 -52 -5.4 -51.8C-7 -51.6 -8.1 -51.4 -9.3 -51.1C-10.5 -50.8 -11.9 -50.2 -12.5 -50.1C-13.2 -50 -13.2 -50.4 -13.3 -50.5C-13.5 -50.7 -13.5 -50.8 -13.5 -51C-13.4 -51.3 -14.9 -48.8 -12.8 -52.3C-10.8 -55.8 -3.1 -68.8 -1 -72.2C1.1 -75.7 -0.5 -73 -0.3 -73.2C0 -73.3 0.2 -73.4 0.5 -73.2C0.8 -73 -0.7 -75.5 1.4 -72C3.6 -68.4 11.3 -55.4 13.3 -51.8C15.4 -48.2 13.7 -50.8 13.6 -50.5C13.5 -50.3 14 -50 12.9 -50.1Z"
      },
      {
        ink: "M48.7 -24.8C48.3 -24.7 47.8 -24.7 47.4 -24.8C47 -24.9 46.7 -25.1 46.4 -25.3C46.1 -25.5 46.4 -25 45.6 -26.1C44.9 -27.2 43 -30.2 41.9 -31.7C40.8 -33.1 40 -33.9 39 -34.9C38 -35.9 37.2 -36.7 35.9 -37.8C34.7 -38.8 32.3 -40.4 31.4 -41.1C30.5 -41.9 30.8 -41.9 30.7 -42.4C30.6 -42.9 30.7 -43.7 30.8 -44.1C31 -44.6 31.3 -44.9 31.6 -45.2C31.9 -45.5 28.4 -44.4 32.6 -45.8C36.8 -47.3 52.4 -52.5 56.8 -53.8C61.2 -55.2 58.6 -53.9 59.2 -53.8C59.8 -53.8 59.9 -53.6 60.3 -53.3C60.6 -53 60.9 -52.5 61.1 -52.2C61.3 -51.8 61.4 -51.5 61.4 -51C61.4 -50.6 62.9 -53.5 61.1 -49.3C59.3 -45.1 52.4 -30 50.5 -26C48.5 -21.9 49.8 -25.4 49.5 -25.2C49.2 -25 49 -24.9 48.7 -24.8Z",
        fill: "M48.3 -27C48 -26.8 47.9 -27 47.8 -27C47.6 -27.1 47.9 -26.7 47.4 -27.4C46.9 -28.2 45.6 -30.3 44.7 -31.6C43.7 -32.9 42.9 -34 41.7 -35.2C40.5 -36.5 39 -38 37.6 -39.3C36.1 -40.5 34 -41.8 33.2 -42.5C32.5 -43.1 32.9 -42.9 32.9 -43.1C33 -43.4 32 -43.2 33.5 -43.8C35 -44.4 38.1 -45.4 42 -46.7C45.9 -48 54.3 -50.8 57.1 -51.6C59.8 -52.4 58.1 -51.8 58.4 -51.7C58.8 -51.6 58.9 -51.4 59 -51.2C59.1 -50.9 60.6 -54 59 -50.2C57.4 -46.4 51 -32.3 49.2 -28.5C47.4 -24.6 48.5 -27.3 48.3 -27Z"
      },
      {
        ink: "M53.8 15.6C53.2 15.8 52.8 15.7 52.4 15.6C52 15.6 51.7 15.4 51.4 15.2C51.1 15 50.8 14.7 50.6 14.4C50.4 14.1 50.1 14.9 50.2 13.4C50.4 11.9 51.3 7.9 51.5 5.5C51.7 3.2 51.7 1 51.6 -0.6C51.6 -2.3 51.5 -2.7 51.2 -4.4C51 -6.1 50.1 -9.6 50 -11C49.9 -12.4 50.4 -12.3 50.8 -12.7C51.2 -13.1 52 -13.4 52.4 -13.5C52.9 -13.6 53.1 -13.5 53.6 -13.3C54 -13.2 51.8 -14.4 55.3 -12.6C58.8 -10.7 71 -4.1 74.5 -2.2C77.9 -0.2 75.7 -1.3 76 -0.9C76.3 -0.5 76.4 -0.3 76.4 0.1C76.5 0.6 76.5 1.2 76.3 1.6C76.1 2.1 78.6 0.8 75.3 2.9C71.9 5.1 59.6 12.4 56.1 14.5C52.5 16.6 54.4 15.4 53.8 15.6Z",
        fill: "M53.3 13.5C49.8 15.4 52.8 13.4 52.6 13.3C52.5 13.2 52.2 13.5 52.4 12.7C52.5 11.8 53.1 9.5 53.3 8.2C53.6 6.8 53.7 6.2 53.7 4.4C53.8 2.6 53.7 -0.9 53.6 -2.8C53.5 -4.6 53.3 -5.4 53.1 -6.6C52.9 -7.9 52.4 -9.8 52.2 -10.5C52.1 -11.3 52.3 -10.9 52.4 -11C52.5 -11.2 52.5 -11.3 52.8 -11.2C53.1 -11.1 51 -12.4 54.4 -10.6C57.9 -8.8 70.2 -2.1 73.5 -0.3C76.8 1.6 74.1 0.2 74.2 0.5C74.2 0.8 77.2 -0.7 73.7 1.4C70.3 3.6 56.8 11.5 53.3 13.5Z"
      },
      {
        ink: "M58.2 53.7C57.6 53.8 60.3 54.9 56.1 53.6C51.8 52.3 36.8 47.3 32.7 45.9C28.6 44.6 31.8 45.5 31.5 45.3C31.3 45 31.1 44.8 30.9 44.5C30.8 44.3 30.7 44.1 30.7 43.8C30.6 43.4 30.7 42.7 30.8 42.3C30.9 41.9 30.3 42.3 31.4 41.4C32.5 40.5 35.9 38.1 37.4 36.7C39 35.4 39.3 35.1 40.7 33.5C42.1 31.8 44.9 28 46 26.8C47.1 25.6 46.8 26.3 47.3 26.3C47.7 26.2 48.2 26.2 48.7 26.4C49.1 26.7 48.3 24 50.2 27.8C52.1 31.7 58.5 45.6 60.2 49.4C62 53.3 60.5 50.5 60.5 50.9C60.5 51.4 60.4 51.7 60.2 52C60.1 52.4 59.9 52.7 59.6 53C59.2 53.2 58.8 53.6 58.2 53.7Z",
        fill: "M57.7 51.6C57.5 51.7 57.4 51.7 56.8 51.6C56.3 51.5 58.3 52.1 54.4 50.8C50.5 49.6 37.1 45.2 33.5 43.9C29.9 42.7 33 43.7 32.9 43.5C32.9 43.4 32 43.9 32.9 43C33.9 42.2 37 40 38.9 38.3C40.7 36.6 42.8 34.4 44.1 32.8C45.5 31.2 46.5 29.4 47.1 28.7C47.7 28 47.5 28.3 47.8 28.4C48 28.6 46.9 25.9 48.6 29.5C50.3 33.1 56.5 46.4 58.1 50C59.7 53.6 58.3 50.8 58.2 51C58.2 51.3 57.9 51.5 57.7 51.6Z"
      },
      {
        ink: "M0.1 75.5C-0.3 75.6 -0.9 75.6 -1.4 75.3C-1.9 75 -2.3 74.7 -2.9 73.7C-3.5 72.8 -3 73.2 -5 69.9C-6.9 66.5 -12.9 56.5 -14.6 53.6C-16.3 50.6 -15.2 52.5 -15.2 51.9C-15.3 51.4 -15 50.6 -14.8 50.2C-14.7 49.8 -14.6 49.7 -14.3 49.5C-14 49.3 -13.4 49 -12.9 48.9C-12.5 48.7 -12.5 48.7 -11.5 48.9C-10.6 49.1 -8.7 49.7 -7.3 50C-5.9 50.2 -4.9 50.4 -3 50.5C-1.1 50.5 2.5 50.5 4.3 50.4C6.1 50.2 6.4 50.1 7.8 49.8C9.2 49.5 11.5 48.8 12.5 48.6C13.6 48.4 13.8 48.7 14.3 48.9C14.8 49.1 15.1 49.5 15.3 49.7C15.5 50 15.6 50.3 15.7 50.5C15.8 50.8 15.9 50.9 15.9 51.3C15.8 51.7 16.6 51 15.5 52.8C14.4 54.6 11.6 58.5 9.4 62.1C7.1 65.7 3.4 72.1 2 74.2C0.7 76.4 1.4 75 1.1 75.2C0.8 75.4 0.5 75.5 0.1 75.5Z",
        fill: "M-0.1 73.3C-0.3 73.4 -0.3 73.4 -0.4 73.2C-0.6 73.1 -0.4 73.8 -1.2 72.4C-2 71 -3.4 68.2 -5.4 64.8C-7.3 61.5 -11.6 54.5 -12.8 52.3C-14.1 50.1 -13 51.6 -13 51.4C-12.9 51.2 -12.7 51.1 -12.5 51C-12.3 50.9 -13 50.8 -11.8 51C-10.6 51.2 -7.5 52.1 -5.1 52.4C-2.8 52.6 0.1 52.7 2.3 52.6C4.4 52.5 5.8 52.3 7.7 52C9.5 51.7 12.2 50.9 13.2 50.8C14.2 50.6 13.5 51.1 13.6 51.3C13.6 51.5 14.8 49.8 13.5 51.9C12.2 54 7.9 60.4 5.7 63.8C3.6 67.3 1.5 71 0.5 72.6C-0.4 74.2 0 73.2 -0.1 73.3Z"
      },
      {
        ink: "M-57.4 53.6C-61.7 54.8 -58.6 53.5 -59.1 53.3C-59.5 53.2 -59.7 53 -60 52.7C-60.3 52.3 -60.6 51.9 -60.6 51.3C-60.7 50.7 -62.1 53.2 -60.4 49.3C-58.6 45.4 -51.9 31.4 -50.1 27.7C-48.3 24 -49.9 27.3 -49.6 27.1C-49.3 26.9 -49 26.5 -48.5 26.4C-48 26.3 -47.2 26.3 -46.7 26.4C-46.2 26.6 -46.1 26.6 -45.5 27.3C-45 28 -44.4 29.3 -43.4 30.6C-42.5 31.9 -41.2 33.6 -39.9 35C-38.7 36.4 -37.1 37.9 -35.8 39C-34.5 40.1 -32.8 41.2 -32.1 41.8C-31.4 42.5 -31.6 42.5 -31.6 42.9C-31.5 43.3 -31.6 43.9 -31.7 44.3C-31.8 44.6 -32 44.9 -32.3 45.2C-32.6 45.4 -29 44.4 -33.2 45.8C-37.4 47.2 -53.1 52.3 -57.4 53.6Z",
        fill: "M-57.1 51.3C-59.5 52.1 -58 51.4 -58.2 51.2C-58.4 51 -60 53.9 -58.4 50.2C-56.7 46.5 -50.1 32.7 -48.3 29.1C-46.5 25.5 -47.8 28.5 -47.5 28.4C-47.3 28.4 -47.5 28.2 -47 28.8C-46.5 29.5 -45.6 31.3 -44.7 32.5C-43.8 33.7 -42.7 35 -41.8 36C-40.9 37 -40.1 37.9 -39.3 38.7C-38.4 39.5 -37.7 40.2 -36.8 40.9C-35.9 41.6 -34.6 42.5 -34.1 42.9C-33.6 43.3 -33.8 43.2 -33.8 43.4C-33.9 43.6 -32.7 43.4 -34.4 43.9C-36 44.5 -39.7 45.5 -43.5 46.7C-47.3 48 -54.6 50.6 -57.1 51.3Z"
      },
      {
        ink: "M-53.6 15.7C-54.2 15.7 -51.9 17.2 -55.4 15.1C-59 13 -71.4 5.3 -74.9 3.1C-78.3 0.8 -75.8 2 -76 1.5C-76.3 1.1 -76.3 0.8 -76.2 0.4C-76.1 -0.1 -76 -0.6 -75.6 -1.1C-75.3 -1.5 -77.7 -0.3 -74.2 -2.2C-70.8 -4.1 -58.5 -10.7 -55.1 -12.6C-51.6 -14.4 -53.9 -13.2 -53.4 -13.3C-53 -13.5 -52.7 -13.6 -52.3 -13.5C-51.9 -13.4 -51.1 -13.1 -50.7 -12.8C-50.4 -12.5 -50.2 -12.1 -50.1 -11.5C-50 -11 -50 -10.9 -50.3 -9.7C-50.5 -8.4 -51.3 -6 -51.6 -4.3C-51.9 -2.5 -52 -0.8 -52.1 0.8C-52.2 2.3 -52.2 3.3 -52 5.1C-51.8 7 -50.9 10.7 -50.7 12C-50.5 13.4 -50.7 13.1 -50.7 13.4C-50.8 13.8 -50.8 13.9 -51 14.2C-51.2 14.4 -51.3 14.8 -51.7 15.1C-52.2 15.3 -52.9 15.7 -53.6 15.7Z",
        fill: "M-53.3 13.5C-53.5 13.6 -50.9 15.3 -54.2 13.3C-57.4 11.4 -69.6 3.8 -72.9 1.8C-76.1 -0.2 -73.7 1.3 -73.9 1.1C-74 0.8 -74 0.7 -73.9 0.5C-73.8 0.3 -76.6 1.6 -73.2 -0.3C-69.8 -2.2 -57 -9.1 -53.6 -11C-50.1 -12.8 -52.9 -11.3 -52.7 -11.2C-52.5 -11.2 -52.1 -11.8 -52.2 -10.7C-52.4 -9.5 -53.4 -6.3 -53.7 -4.5C-54.1 -2.7 -54.2 -1.6 -54.2 0.3C-54.3 2.1 -54.2 4.5 -54 6.5C-53.8 8.6 -53 11.4 -52.9 12.5C-52.7 13.7 -53.1 13.3 -53.3 13.5Z"
      },
      {
        ink: "M-47.8 -24.8C-48.2 -24.8 -48.7 -24.7 -49.2 -24.9C-49.6 -25.1 -48.7 -22 -50.6 -26.1C-52.5 -30.1 -59 -45.3 -60.7 -49.3C-62.5 -53.3 -61 -49.9 -61 -50.3C-61 -50.7 -61 -51.5 -60.9 -51.9C-60.7 -52.4 -60.5 -52.6 -60.3 -52.9C-60 -53.2 -59.5 -53.5 -59.2 -53.7C-58.9 -53.9 -58.7 -53.9 -58.3 -54C-57.9 -54 -58.5 -54.4 -56.9 -54C-55.3 -53.5 -52.8 -52.7 -48.7 -51.3C-44.6 -50 -35.2 -46.8 -32.4 -45.8C-29.5 -44.8 -31.7 -45.5 -31.4 -45.2C-31.1 -44.9 -30.7 -44.6 -30.6 -44.1C-30.4 -43.7 -30.4 -43.1 -30.4 -42.6C-30.5 -42.2 -29.7 -42.7 -30.9 -41.6C-32.1 -40.5 -35.8 -37.8 -37.6 -36.2C-39.5 -34.5 -40.5 -33.4 -41.9 -31.7C-43.3 -29.9 -45.1 -27 -45.9 -25.9C-46.7 -24.8 -46.6 -25.2 -46.9 -25C-47.2 -24.9 -47.4 -24.8 -47.8 -24.8Z",
        fill: "M-48 -27C-48.3 -27 -48.5 -27.1 -48.7 -27.3C-48.8 -27.5 -47.5 -24.4 -49.1 -28.1C-50.7 -31.8 -56.6 -45.5 -58.2 -49.3C-59.8 -53.1 -58.7 -50.6 -58.6 -51C-58.6 -51.4 -58.3 -51.6 -58.1 -51.7C-57.8 -51.8 -57.4 -51.8 -57.1 -51.7C-56.7 -51.7 -58.3 -52.1 -55.8 -51.3C-53.4 -50.5 -46.2 -48.2 -42.4 -46.9C-38.6 -45.7 -34.9 -44.4 -33.2 -43.8C-31.6 -43.2 -32.7 -43.4 -32.7 -43.1C-32.7 -42.9 -32.3 -43.1 -33.3 -42.3C-34.3 -41.4 -37.2 -39.4 -38.8 -38.1C-40.3 -36.7 -41.5 -35.4 -42.6 -34.2C-43.7 -33 -44.5 -32 -45.3 -30.9C-46.1 -29.7 -46.9 -28.2 -47.4 -27.6C-47.8 -27 -47.8 -27.1 -48 -27Z"
      }
    ],
    eyes: {
      left: {
        outer: "M-26.8 20.3C-27 20.7 -27.1 20.2 -27.3 19.9C-27.4 19.6 -27.7 19.1 -27.8 18.6C-27.9 18 -27.9 17.5 -27.8 16.8C-27.6 16.2 -27.3 15.3 -27 14.7C-26.7 14.1 -26.4 13.7 -26 13.3C-25.6 12.9 -25.2 12.5 -24.6 12.1C-24 11.8 -23.2 11.4 -22.6 11.2C-21.9 11 -20.5 11.7 -20.6 10.9C-20.6 10.1 -22.2 7.6 -22.7 6.3C-23.3 5 -23.4 4.3 -23.7 3.1C-24.1 1.9 -24.4 0.7 -24.6 -1C-24.9 -2.7 -25 -5.5 -25 -7C-25 -8.5 -24.8 -9.3 -24.6 -10.2C-24.5 -11.1 -24.2 -11.7 -24 -12.4C-23.8 -13.1 -23.6 -13.6 -23.2 -14.2C-22.9 -14.8 -22.5 -15.5 -22.1 -16C-21.7 -16.5 -21.4 -16.9 -20.9 -17.3C-20.4 -17.7 -19.8 -18.2 -19.2 -18.5C-18.5 -18.8 -17.6 -19.1 -16.9 -19.3C-16.2 -19.4 -15.7 -19.3 -15.1 -19.3C-14.4 -19.2 -13.9 -19.1 -13.2 -18.7C-12.4 -18.4 -11.4 -17.7 -10.7 -17C-9.9 -16.3 -9.2 -15.3 -8.6 -14.3C-8 -13.3 -7.4 -12.3 -6.9 -11C-6.3 -9.7 -5.6 -8.2 -5.1 -6.5C-4.6 -4.8 -4 -2.8 -3.6 -1C-3.2 0.8 -2.9 2.9 -2.8 4.4C-2.7 5.9 -2.8 6.8 -2.9 7.9C-3.1 9 -3.4 10.1 -3.7 10.9C-4 11.7 -4.4 12.2 -4.8 12.6C-5.1 13 -5.5 13.3 -5.9 13.6C-6.3 13.9 -6.6 14 -7.3 14.2C-7.9 14.4 -8.9 14.5 -9.7 14.6C-10.4 14.7 -11 14.7 -11.8 14.6C-12.5 14.5 -13.7 14.1 -14.2 14C-14.7 13.9 -14.4 14.2 -14.8 14.1C-15.2 14 -15.8 13.5 -16.6 13.3C-17.3 13 -18.4 12.7 -19.1 12.6C-19.7 12.5 -20 12.5 -20.6 12.6C-21.2 12.7 -21.9 12.8 -22.6 13.1C-23.2 13.4 -23.9 13.9 -24.5 14.4C-25 14.8 -25.4 15.5 -25.8 16.1C-26.1 16.6 -26.2 16.8 -26.4 17.6C-26.6 18.3 -26.7 19.9 -26.8 20.3Z",
        inner: "M-9.5 13.2C-10.3 13.3 -11 13.3 -11.8 13.2C-12.6 13.1 -13.7 12.7 -14.2 12.6C-14.7 12.5 -14.4 12.8 -14.8 12.7C-15.2 12.6 -15.8 12.1 -16.6 11.9C-17.3 11.6 -18.9 11.4 -19.3 11.2C-19.8 11 -19 11.3 -19.3 10.7C-19.5 10.1 -20.3 8.8 -20.9 7.5C-21.4 6.3 -22 4.5 -22.4 3.1C-22.8 1.7 -23 0.4 -23.2 -0.9C-23.5 -2.2 -23.6 -3.6 -23.6 -4.6C-23.7 -5.7 -23.7 -6.1 -23.6 -7C-23.6 -7.9 -23.5 -9.1 -23.2 -10.2C-23 -11.3 -22.5 -12.8 -22.1 -13.7C-21.8 -14.5 -21.4 -15 -21.1 -15.4C-20.8 -15.9 -20.7 -16.1 -20.2 -16.5C-19.7 -16.8 -18.6 -17.4 -18.1 -17.6C-17.5 -17.8 -17.6 -17.9 -16.9 -17.9C-16.3 -17.9 -15.1 -17.9 -14.3 -17.7C-13.5 -17.6 -12.9 -17.3 -12.4 -17C-11.9 -16.7 -11.9 -17 -11.2 -16C-10.5 -15 -9.2 -13.1 -8.2 -11C-7.3 -9 -6.3 -6 -5.6 -3.6C-5 -1.3 -4.6 1.1 -4.3 2.9C-4.1 4.6 -4.2 5.8 -4.2 6.8C-4.2 7.8 -4.3 8.1 -4.5 8.8C-4.6 9.5 -4.9 10.3 -5.1 10.9C-5.3 11.5 -5.5 11.8 -5.8 12.2C-6.2 12.5 -6.7 12.7 -7.3 12.8C-7.9 13 -8.8 13.1 -9.5 13.2Z",
        pupil: "M-7.3 12.8C-7.6 12.9 -7.8 12.9 -8 12.8C-8.3 12.7 -8.4 12.8 -8.9 12.3C-9.4 11.9 -10.3 11.1 -10.8 10.3C-11.4 9.5 -11.9 8.5 -12.3 7.5C-12.8 6.5 -13.2 5 -13.5 4.3C-13.7 3.5 -14.4 3.8 -13.7 2.9C-13 1.9 -9.9 -0.6 -9.3 -1.4C-8.6 -2.1 -9 -1.5 -9.9 -1.7C-10.8 -1.9 -13.7 -2.4 -14.5 -2.6C-15.4 -2.8 -14.9 -2.5 -15 -2.9C-15.1 -3.3 -15.2 -4.3 -15.2 -5C-15.3 -5.7 -15.3 -6.4 -15.2 -7.3C-15.2 -8.2 -15.1 -9.3 -14.8 -10.3C-14.6 -11.3 -14.2 -12.6 -13.8 -13.4C-13.5 -14.2 -13.1 -14.7 -12.8 -15.2C-12.5 -15.6 -12.1 -15.9 -12 -16.1C-11.9 -16.3 -12 -16.2 -12.2 -16.4C-12.4 -16.5 -12.8 -16.9 -13.2 -17.1C-13.6 -17.3 -14.7 -17.7 -14.7 -17.7C-14.7 -17.7 -13.7 -17.6 -13.2 -17.3C-12.7 -17.1 -12.2 -17 -11.7 -16.5C-11.1 -16 -10.6 -15.2 -10 -14.3C-9.4 -13.4 -8.7 -12 -8.2 -11C-7.8 -10.1 -7.7 -10.1 -7.2 -8.7C-6.7 -7.2 -5.7 -4.1 -5.2 -2.1C-4.7 -0.2 -4.5 1.8 -4.3 2.9C-4.2 4 -4.2 3.8 -4.2 4.6C-4.2 5.5 -4.2 7 -4.3 7.9C-4.4 8.8 -4.5 9.2 -4.7 9.8C-4.9 10.4 -5.3 11.3 -5.5 11.7C-5.7 12.1 -5.6 12 -5.9 12.2C-6.2 12.4 -6.9 12.7 -7.3 12.8Z",
        centre: [-14.44141531015248, -1.1179095700768993]
      },
      right: {
        outer: "M19.2 8.3C18.5 8.4 17.8 8.3 17.2 8.2C16.6 8 16 7.8 15.4 7.4C14.9 7.1 14.5 6.9 14 6.3C13.4 5.7 12.7 4.7 12.1 3.8C11.5 2.8 10.9 1.5 10.5 0.5C10.1 -0.5 9.9 -0.6 9.5 -2.3C9 -4 8.1 -7.6 7.8 -9.7C7.5 -11.7 7.7 -13.5 7.7 -14.8C7.8 -16.1 7.9 -16.4 8.1 -17.2C8.3 -18 8.6 -18.9 8.9 -19.6C9.2 -20.3 9.4 -20.8 9.9 -21.4C10.3 -22.1 11.2 -23 11.7 -23.5C12.2 -23.9 12.3 -23.9 12.8 -24.1C13.3 -24.3 14.2 -24.7 14.9 -24.8C15.6 -24.9 16.4 -24.8 17.1 -24.6C17.7 -24.5 18.2 -24.3 18.8 -23.9C19.4 -23.5 20.3 -22.6 20.8 -22.1C21.3 -21.6 21.3 -21.7 21.9 -20.8C22.4 -19.9 23.4 -18.2 24.1 -16.6C24.8 -14.9 25.6 -12.8 26.1 -10.8C26.7 -8.8 27.1 -6.6 27.4 -4.8C27.7 -3 27.5 -0.8 27.8 0C28.1 0.8 28.7 -0.1 29.2 -0.1C29.8 -0 30.4 0.1 31 0.3C31.5 0.6 32.3 1.4 32.5 1.6C32.8 1.9 32.5 1.8 32.2 1.8C32 1.8 31.5 1.5 31 1.4C30.5 1.4 29.8 1.3 29.1 1.4C28.3 1.6 27.1 2 26.5 2.3C25.8 2.6 25.4 2.9 25 3.3C24.6 3.6 24.5 3.5 24 4.3C23.4 5.1 22.2 7.5 21.8 8.2C21.3 8.8 21.5 8.1 21.4 8C21.3 7.9 21.7 7.5 21.3 7.5C21 7.6 19.9 8.2 19.2 8.3Z",
        inner: "M19.2 6.9C18.6 7.1 18.4 7 17.9 7C17.5 6.9 16.8 6.8 16.3 6.6C15.8 6.3 15.3 6.1 14.9 5.6C14.4 5.2 14 4.6 13.5 3.8C13 2.9 12.3 1.5 11.9 0.5C11.4 -0.5 11.3 -0.6 10.9 -2.3C10.4 -4 9.5 -7.6 9.2 -9.7C8.9 -11.7 9 -13.5 9.1 -14.8C9.1 -16.1 9.3 -16.4 9.5 -17.2C9.7 -18 9.9 -18.7 10.2 -19.6C10.6 -20.4 11.3 -21.5 11.7 -22.1C12.2 -22.6 12.3 -22.5 12.8 -22.7C13.3 -23 14.2 -23.3 14.9 -23.4C15.6 -23.5 16.3 -23.5 17.1 -23.2C17.8 -23 18.7 -22.8 19.6 -22C20.4 -21.1 21.3 -19.4 22 -18.2C22.6 -17 23 -15.9 23.5 -14.7C24 -13.4 24.3 -12.4 24.7 -10.8C25.2 -9.1 25.7 -6.6 26 -4.8C26.3 -3 26.3 -0.9 26.4 0C26.6 0.9 27.2 0.3 27 0.6C26.7 1 25.7 1.3 25 1.9C24.2 2.6 23.2 3.6 22.6 4.3C22 5 22 5.6 21.4 6.1C20.9 6.5 19.8 6.8 19.2 6.9Z",
        pupil: "M19.2 6.9C18.8 7 17.8 6.9 17.9 6.9C17.9 6.9 19.1 6.8 19.6 6.7C20 6.6 20.3 6.4 20.6 6.2C20.9 6 21.4 5.9 21.3 5.5C21.3 5.1 20.5 4.4 20.2 3.9C19.8 3.4 19.7 3.2 19.4 2.5C19.1 1.8 18.6 0.5 18.3 -0.5C18 -1.5 16.9 -2.3 17.5 -3.5C18.1 -4.7 21.9 -6.8 21.7 -7.8C21.5 -8.7 17.5 -8.8 16.6 -9.1C15.7 -9.4 16.3 -9.3 16.3 -9.5C16.2 -9.8 16.1 -9.8 16.1 -10.7C16.1 -11.5 16.1 -13.7 16.1 -14.7C16.2 -15.6 16.2 -15.6 16.4 -16.4C16.6 -17.2 17.1 -18.7 17.4 -19.4C17.7 -20.2 18 -20.5 18.3 -20.9C18.5 -21.3 19.2 -21.5 19.1 -21.8C18.9 -22.2 17.4 -23 17.3 -23.1C17.3 -23.2 18.4 -22.7 18.8 -22.5C19.2 -22.3 19.3 -22.3 19.7 -21.9C20.1 -21.4 20.6 -20.7 21.1 -19.8C21.6 -18.9 22.2 -17.9 22.7 -16.6C23.3 -15.2 24.1 -13 24.5 -11.7C24.9 -10.3 25.1 -9.7 25.4 -8.3C25.7 -6.8 26.1 -4.3 26.3 -2.9C26.4 -1.5 26.3 -0.6 26.4 0C26.5 0.6 27.2 0.3 27 0.6C26.7 1 25.7 1.3 25 1.9C24.2 2.6 23.2 3.6 22.6 4.3C22 5 21.8 5.7 21.4 6.1C21 6.4 20.6 6.5 20.2 6.7C19.8 6.8 19.6 6.9 19.2 6.9Z",
        centre: [17.537975167688323, -8.057939215305865]
      }
    },
    brows: {
      left: {
        ink: "M-26.3 -17.5C-26.5 -17.4 -26.7 -17.5 -26.8 -17.5C-27 -17.5 -26.9 -17.5 -27 -17.7C-27.1 -17.9 -27.3 -18.3 -27.3 -18.8C-27.3 -19.3 -27.2 -20.1 -27.2 -20.7C-27.1 -21.3 -27.1 -21.7 -26.8 -22.4C-26.5 -23.2 -26 -24.5 -25.4 -25.3C-24.8 -26.2 -23.8 -27.1 -23.1 -27.6C-22.4 -28.2 -21.9 -28.3 -21.2 -28.5C-20.5 -28.7 -19.6 -28.8 -18.9 -28.8C-18.2 -28.7 -17.5 -28.5 -16.9 -28.3C-16.4 -28 -15.9 -27.7 -15.5 -27.3C-15.1 -27 -14.7 -26.6 -14.5 -26.3C-14.3 -26.1 -14.2 -25.9 -14.3 -25.7C-14.3 -25.5 -14.3 -25.2 -14.8 -25.3C-15.3 -25.4 -16.4 -26 -17.1 -26.1C-17.7 -26.3 -18.4 -26.3 -18.9 -26.3C-19.5 -26.2 -19.9 -26.1 -20.4 -25.9C-20.9 -25.7 -21.5 -25.4 -21.9 -25C-22.4 -24.6 -22.9 -24.1 -23.3 -23.6C-23.7 -23.2 -23.9 -22.9 -24.2 -22.3C-24.6 -21.8 -25 -21 -25.3 -20.3C-25.5 -19.6 -25.7 -18.7 -25.9 -18.2C-26.1 -17.7 -26.2 -17.6 -26.3 -17.5Z",
        centre: [-22.173668353746674, -24.846352806009893]
      },
      right: {
        ink: "M7.3 -28.4C6.8 -28.1 6.9 -28.3 6.7 -28.5C6.6 -28.6 6.5 -28.8 6.6 -29.2C6.7 -29.6 7 -30.4 7.2 -30.9C7.4 -31.3 7.5 -31.4 7.9 -31.8C8.3 -32.2 9.1 -32.9 9.7 -33.3C10.2 -33.6 10.6 -33.8 11 -33.9C11.5 -34.1 11.9 -34.2 12.4 -34.2C13 -34.2 13.6 -34.1 14.3 -33.9C14.9 -33.7 15.7 -33.3 16.3 -32.9C16.9 -32.5 17.4 -32 17.7 -31.5C18.1 -31 18.4 -30.2 18.5 -29.8C18.6 -29.5 18.3 -29.5 18.2 -29.4C18.1 -29.4 18.5 -29.1 17.9 -29.4C17.4 -29.7 15.8 -30.8 15.1 -31.1C14.3 -31.5 14 -31.5 13.5 -31.5C13 -31.6 12.6 -31.6 12 -31.5C11.5 -31.5 10.8 -31.2 10.4 -31C10 -30.8 10.1 -31 9.5 -30.5C9 -30.1 7.7 -28.8 7.3 -28.4Z",
        centre: [12.321139068965524, -31.79770584017515]
      }
    },
    mouth: {
      ink: "M-1.9 26.3C-3.3 26.3 -4.4 26.3 -5.8 26.1C-7.1 26 -8.8 25.7 -9.9 25.4C-11 25.1 -11.7 24.9 -12.5 24.5C-13.4 24.1 -14.3 23.7 -15.1 23.2C-15.8 22.8 -16.5 22.2 -16.8 22C-17.1 21.8 -16.9 21.8 -17 22.1C-17.1 22.3 -17.3 23.2 -17.4 23.5C-17.6 23.8 -17.8 23.8 -17.9 23.8C-18.1 23.9 -18.2 23.8 -18.3 23.7C-18.5 23.7 -18.7 23.6 -18.8 23.4C-19 23.2 -19.1 22.9 -19.2 22.6C-19.3 22.3 -19.4 22 -19.4 21.7C-19.4 21.4 -19.4 21.1 -19.2 20.7C-19.1 20.3 -18.9 19.8 -18.6 19.4C-18.3 19 -17.8 18.6 -17.5 18.3C-17.2 18.1 -17 18 -16.7 17.9C-16.4 17.8 -15.8 17.7 -15.6 17.6C-15.3 17.6 -15.3 17.6 -15.1 17.6C-14.8 17.7 -14.4 17.9 -14.2 18C-14 18.2 -13.9 18.4 -13.9 18.6C-13.8 18.7 -13.8 18.7 -13.9 18.8C-14 18.9 -14.1 19.1 -14.4 19.3C-14.6 19.5 -15.2 19.7 -15.3 19.8C-15.4 19.9 -15.7 19.8 -15.2 20C-14.7 20.2 -13.5 20.8 -12.3 21.1C-11.1 21.4 -9.1 21.7 -8.2 21.9C-7.2 22 -7.5 22 -6.4 22C-5.2 22 -2.8 22 -1.3 21.9C0.3 21.8 1.5 21.6 2.8 21.4C4 21.1 5.1 20.9 6.1 20.6C7.2 20.3 8.2 20 9.3 19.6C10.4 19.2 11.8 18.6 12.9 18.1C14 17.6 14.9 17.1 16.1 16.5C17.2 15.8 18.6 15 19.8 14.1C21.1 13.2 22.5 12.1 23.6 11.1C24.7 10.1 25.8 8.8 26.3 8.3C26.7 7.7 26.6 8 26.5 7.9C26.3 7.8 25.6 7.6 25.3 7.4C25.1 7.3 25.1 7.2 25 7C25 6.9 25.1 6.7 25.2 6.5C25.3 6.4 25.3 6.2 25.6 6.1C25.8 6 26.2 5.7 26.6 5.7C27 5.7 27.5 5.8 27.8 5.9C28.2 5.9 28.3 6 28.7 6.3C29 6.5 29.5 7.2 29.8 7.5C30 7.9 30 8.1 30 8.4C30.1 8.7 30.1 8.9 30 9.3C29.9 9.6 29.7 10.2 29.5 10.4C29.3 10.6 29 10.7 28.8 10.7C28.7 10.7 28.6 10.6 28.5 10.5C28.3 10.3 28.6 9.3 28.1 9.8C27.6 10.3 26.6 12.1 25.6 13.3C24.6 14.6 23 16.2 21.9 17.1C20.9 18.1 20.3 18.5 19.4 19.1C18.5 19.7 17.6 20.4 16.6 21C15.5 21.6 14.3 22.3 12.9 22.9C11.5 23.5 9.8 24.1 8.2 24.6C6.5 25.1 4.7 25.5 3 25.8C1.3 26 -0.4 26.2 -1.9 26.3Z",
      centre: [6.07885171248832, 19.680667556402334]
    }
  };

  // packages/character/src/traced-render.ts
  var REST = defaultRig();
  function n2(v) {
    if (!Number.isFinite(v)) return "0";
    const r = Math.round(v * 1e3) / 1e3;
    return Object.is(r, -0) ? "0" : String(r);
  }
  function safeRatio(value, rest) {
    return rest === 0 ? 1 : value / rest;
  }
  function rayTransform(ray, index2) {
    const restAngle = RAY.anglesDeg[index2] ?? ray.angleDeg;
    const angle = ray.angleDeg + ray.rotation;
    const rad = restAngle * Math.PI / 180;
    const bx = Math.sin(rad) * RAY.baseRadius;
    const by = -Math.cos(rad) * RAY.baseRadius;
    const length = Math.max(0, ray.lengthScale);
    const width = Math.max(0, ray.widthScale);
    return [
      `translate(${n2(ray.offset.x)} ${n2(ray.offset.y)})`,
      `rotate(${n2(angle - restAngle)})`,
      `translate(${n2(bx)} ${n2(by)})`,
      `rotate(${n2(restAngle)})`,
      `scale(${n2(width)} ${n2(length)})`,
      `rotate(${n2(-restAngle)})`,
      `translate(${n2(-bx)} ${n2(-by)})`
    ].join(" ");
  }
  function featureTransform(now, rest, sx, sy) {
    return [
      `translate(${n2(now.x)} ${n2(now.y)})`,
      `rotate(${n2(now.rotation)})`,
      `scale(${n2(sx)} ${n2(sy)})`,
      `rotate(${n2(-rest.rotation)})`,
      `translate(${n2(-rest.x)} ${n2(-rest.y)})`
    ].join(" ");
  }
  function eyeScale(eye2, rest) {
    const closed = Math.max(0, Math.min(1, eye2.closed));
    return {
      sx: safeRatio(eye2.scaleX * eye2.width, rest.scaleX * rest.width),
      // A blink squeezes the eye to a sliver about its own centre.
      sy: safeRatio(eye2.scaleY * eye2.height, rest.scaleY * rest.height) * (1 - closed * 0.92)
    };
  }
  function tracedRayPart(rig, index2, paint, boil) {
    const ray = rig.rays[index2];
    const art = TRACED_ART.rays[index2];
    if (!ray || !art || !ray.visible || ray.lengthScale <= 0.01) return { transform: "", inner: "" };
    return {
      transform: rayTransform(ray, index2),
      inner: `<path d="${boilPath(art.ink, boil)}" fill="${paint.ink}"/><path d="${boilPath(art.fill, boil)}" fill="${paint.ray}"/>`
    };
  }
  function tracedBody(paint, boil) {
    return `<path d="${boilPath(TRACED_ART.body.ink, boil)}" fill="${paint.ink}"/><path d="${boilPath(TRACED_ART.body.fill, boil)}" fill="${paint.body}"/>`;
  }
  function tracedEyePart(side, eye2, paint, uid, boil) {
    const rest = REST.eyes[side];
    const art = TRACED_ART.eyes[side];
    const { sx, sy } = eyeScale(eye2, rest);
    const clipId = `sunny-traced-eye-${uid}${side}${boil ?? ""}`;
    const gx = eye2.gaze.x * rest.width * 0.16;
    const gy = eye2.gaze.y * rest.height * 0.1;
    const inner = boilPath(art.inner, boil, 0.2);
    return {
      transform: featureTransform(eye2, rest, sx, sy),
      inner: [
        `<clipPath id="${clipId}"><path d="${inner}"/></clipPath>`,
        `<path d="${boilPath(art.outer, boil, 0.2)}" fill="${paint.ink}" fill-rule="evenodd"/>`,
        `<path d="${inner}" fill="${paint.highlight}"/>`,
        `<g clip-path="url(#${clipId})">`,
        `<path d="${art.pupil}" fill="${paint.ink}" fill-rule="evenodd" transform="translate(${n2(gx)} ${n2(gy)})"/>`,
        `</g>`
      ].join("")
    };
  }
  function tracedBrowPart(side, brow2, paint, boil) {
    const rest = REST.brows[side];
    const sx = brow2.scale * safeRatio(brow2.length, rest.length);
    const arch = safeRatio(brow2.arch, rest.arch);
    const sy = brow2.scale * Math.max(-2, Math.min(2.5, arch));
    return {
      transform: featureTransform(brow2, rest, sx, sy),
      inner: `<path d="${boilPath(TRACED_ART.brows[side].ink, boil, 0.2)}" fill="${paint.ink}" fill-rule="evenodd"/>`
    };
  }
  function tracedMouthPart(rig, paint, boil) {
    const rest = REST.smile;
    const smile = rig.smile;
    const sx = safeRatio(smile.span, rest.span);
    const sy = Math.max(-2, Math.min(2.5, safeRatio(smile.depth, rest.depth)));
    return {
      transform: featureTransform(smile, rest, sx, sy),
      inner: `<path d="${boilPath(TRACED_ART.mouth.ink, boil, 0.2)}" fill="${paint.ink}" fill-rule="evenodd"/>`
    };
  }

  // packages/character/src/render.ts
  function n3(v) {
    const r = Math.round(v * 1e3) / 1e3;
    return Object.is(r, -0) ? "0" : String(r);
  }
  var PROP_PATHS = {
    // A bold question mark: the bowl, the stem, and a dot.
    "question-mark": {
      d: "M-3.1-4.4a3.3 3.3 0 1 1 5.1 2.8q-2 1.3-2 3.1M0 5.6v0.1",
      filled: false
    },
    // The eureka lightbulb from the pose sheet: a round glass bulb, a waisted
    // neck and a ribbed screw base. Surface-painted so it reads as an object.
    lightbulb: {
      d: "M0-11C5.6-11 9-7 9-2.6 9 1 7 3 5.4 4.8 4.4 6 4 7.2 4 8.4H-4C-4 7.2-4.4 6-5.4 4.8-7 3-9 1-9-2.6-9-7-5.6-11 0-11ZM-4 9.4H4V11H-4ZM-3.4 12H3.4L2.4 14.4H-2.4Z",
      filled: true,
      surface: true,
      // Yellow, as on the sheet: a pale bulb read as a white blob at launcher size.
      colour: "#FFD54A"
    },
    // A four-pointed sparkle.
    sparkle: {
      d: "M0-6 1.5-1.5 6 0 1.5 1.5 0 6-1.5 1.5-6 0-1.5-1.5Z",
      filled: true
    },
    "sweat-drop": {
      d: "M0-5.2C3.1-0.9 3.6 1 3.6 2.1a3.6 3.6 0 0 1-7.2 0C-3.6 1-3.1-0.9 0-5.2Z",
      filled: true
    },
    // An outline battery: body plus terminal.
    battery: {
      d: "M-5.4-2.8h9.2v5.6h-9.2zM3.8-1.1h1.6v2.2h-1.6z",
      filled: false
    },
    // Sunglasses: two rounded lenses, a bridge and hinged temples. This is the one
    // prop authored wide rather than tall, because it has to span both eyes; the
    // sequence that wears it sets the scale, and `cool` is the only group that
    // does. It is drawn in the body frame like the other props, so the sequence
    // that wears it holds `faceTilt` at zero -- a tilted face would slide the eyes
    // out from behind the lenses.
    sunglasses: {
      d: "M-16.5-5.6h15a2.6 2.6 0 0 1 2.6 2.6v6.4a2.6 2.6 0 0 1-2.6 2.6h-15a2.6 2.6 0 0 1-2.6-2.6v-6.4a2.6 2.6 0 0 1 2.6-2.6ZM1.5-5.6h15a2.6 2.6 0 0 1 2.6 2.6v6.4a2.6 2.6 0 0 1-2.6 2.6h-15a2.6 2.6 0 0 1-2.6-2.6v-6.4a2.6 2.6 0 0 1 2.6-2.6ZM-1.6-3.6h3.2v2.4h-3.2ZM-19.1-3.9h-2.3a1.2 1.2 0 0 0-1.2 1.2v1.9a1.2 1.2 0 0 0 1.2 1.2h2.3ZM19.1-3.9h2.3a1.2 1.2 0 0 1 1.2 1.2v1.9a1.2 1.2 0 0 1-1.2 1.2h-2.3Z",
      filled: true
    },
    // A folding deckchair, drawn open and reclined: a fabric sling running out to
    // the foot end, a back leaning away to the upper left, a bar across the top of
    // it, and a leg frame underneath.
    //
    // Authored in the *body* frame rather than its own, which is the only prop that
    // does so, and for a reason that is really a constraint: this one is furniture
    // a 47-unit-radius body has to sit *in*, so its geometry is not about a chair's
    // proportions, it is about where a seat's front edge and a back's inner edge
    // land relative to the sun's silhouette. Authoring it in place means the
    // sequence that deploys it places it at the origin and the numbers here are the
    // composition.
    //
    // The back is not placed by eye. A straight back that leans up and to the left
    // and is anchored under the body *must* cross the silhouette, because the
    // circle bulges further out at shoulder height than any chord can: a line from
    // under her bottom to above her head is either vertical, or it passes through
    // her. The back below is the line that clears the circle all the way along --
    // it runs at a distance of ~50 from the centre against a radius of 47.26, so it
    // is a tangent with about 2.7 units of clearance -- and the lean that falls out
    // of that constraint (~30 degrees off vertical) is a deckchair's recline, not a
    // compromise. Attempts to draw it steeper put the panel across her eye.
    //
    // The sling's front edge sits just below her bottom edge rather than through
    // it, so the whole chair reads as supporting her from underneath and nothing is
    // drawn against her face. It is filled rather than stroked because at launcher
    // size a line drawing of a chair is a tangle of hairlines: see D-20.
    //
    // The unfold is the prop's own transform, not articulation: the chair scales up
    // from a third and rotates into place, so it whips open rather than hinging. A
    // real fold would need props made of parts, which the model does not have.
    deckchair: {
      d: (
        // The back panel, tangent to the silhouette, leaning up-left.
        "M-38.5 35-66.5-19-89.5-7-61.5 47ZM-60 47 27.4 56 28.6 68-59 59ZM24.7 57 60.7 33 67.3 43 31.3 67ZM-29.9 53.9-35.9 79.9-39.7 78.7-33.7 52.7ZM25.9 65.9 30.9 87.9 27.1 89.1 22.1 67.1ZM-40 72h74v3h-74Z"
      ),
      filled: true,
      surface: true
    },
    // A balloon, drawn at the size it is used at (the second prop authored in the
    // body frame, and for the same kind of reason the deckchair is): a balloon is
    // *held against the character* -- it rises past her rays and its knot hangs
    // over her shoulder -- so its scale is a fact about the composition rather
    // than about the prop. The origin is the balloon's own centre rather than the
    // bottom of a string, because that is the point a tap hits and the point the
    // pop bursts from.
    //
    // A balloon is the clearest case for the `surface` painting: it is an object
    // with an inside, so it takes the tenant's surface colour rather than being
    // inked, and a hollow outline of a balloon at launcher size reads as a ring.
    //
    // There is no string, and that is a decision rather than an omission. A string
    // drawn in this path would carry the character's own ink weight -- 2.2 units,
    // the same as the balloon's outline, because a path here has exactly one
    // stroke -- and at the sizes this is actually seen a 2-unit line twelve units
    // long is a black smear beside the balloon rather than a string. The measured
    // versions of both are in the commit that added this. A round envelope, a
    // taper and a knot read as a balloon on their own.
    balloon: {
      d: (
        // The envelope: round at the top, tapering to the neck.
        "M0-15.4C7.9-15.4 13.6-9.4 13.6-2.2 13.6 6.4 7.2 13.6 3.4 16.6L-3.4 16.6C-7.2 13.6-13.6 6.4-13.6-2.2-13.6-9.4-7.9-15.4 0-15.4ZM-3.4 15.4H3.4L1.6 19.6H-1.6Z"
      ),
      filled: true,
      surface: true
    },
    // Held props from the sheet, drawn by their own art functions below (fixed
    // colours: a book is blue whatever the theme). The paths are unused.
    book: { d: "", filled: true },
    "book-page": { d: "", filled: true },
    laptop: { d: "", filled: true },
    magnifier: { d: "", filled: true },
    // A ping-pong bat, held upright: the blade, then a short handle. Authored tall
    // rather than wide -- the second prop that is, after the deckchair's scenery --
    // because the ball has to meet the blade's *face*, and A09's rules decide
    // whether it did by comparing y against the bat's half-length. The bat is
    // `surface`-painted for the reason the balloon is: it is an object with an
    // inside, and a black silhouette at the end of a ray would read as another ray.
    // Its half-length is the number the rules are told (see `@sunny/games`), so
    // lengthening the blade here without changing `PADDLE_HALF` there would put the
    // bounce either inside the bat or short of it.
    paddle: {
      d: "M-7-17H7A1.6 1.6 0 0 1 8.6-15.4V7.4A1.6 1.6 0 0 1 7 9H-7A1.6 1.6 0 0 1-8.6 7.4V-15.4A1.6 1.6 0 0 1-7-17ZM-3.4 9H3.4V14A3.4 3.4 0 0 1-3.4 14Z",
      filled: true,
      surface: true
    },
    // ── A11, the plant ─────────────────────────────────────────────────────────
    //
    // Three props rather than one, because the row names four stages -- "seed,
    // shine, sprout, flower" -- and the model cannot morph a prop: a prop is one
    // path with one transform, so a plant that grows has to be a plant that is
    // *replaced* by the next one. The staging is therefore a cross-fade: each
    // stage is its own prop, faded in as the one before it fades out, which is
    // also why the three share an origin.
    //
    // **The seed and the seedling are solid ink marks**, the way the sparkle and
    // the sweat-drop are: both are small, and a 2.2-unit outline around a 9-unit
    // object is a smudge rather than an inside. The flower is the first thing in
    // this moment big enough to have one.
    //
    // A seed is a teardrop standing on its point -- round above, pointed below --
    // so the point is the end that goes into the ground.
    seed: {
      d: "M0 4.4C2.8 1.6 3.6-0.2 3.6-1.6A3.6 3.6 0 0 0-3.6-1.6C-3.6-0.2-2.8 1.6 0 4.4Z",
      filled: true
    },
    // The sprout and the flower are authored **with their origin at the base**,
    // unlike every other prop here, which is centred on itself. A plant grows from
    // where it is planted: with the origin at the base the `scale` a sequence
    // animates is the plant growing rather than the plant inflating, and the two
    // stages share a planting point as a consequence of their geometry instead of
    // by a constant someone has to keep in step. Both are `surface`-painted,
    // because they are objects with an inside: a stem drawn as a bare ink line is
    // a mark, and a flower made of marks is a doodle rather than a plant.
    //
    // Both are drawn *upright*, and it is the sequence that leans one outward.
    // That is the opposite of the deckchair, which is authored in the body frame
    // because the body has to sit in it; a plant has no such relationship with the
    // character and is a plain object standing beside her.
    //
    // The stem is 4 units wide rather than a hairline for the same reason: the
    // outline is 2.2 units, and a 2-unit stem would be all outline.
    //
    // The seedling is smaller than the flowering plant on purpose -- a shoot and a
    // flower are the same plant, and a seedling drawn at the size of the thing it
    // becomes is not a seed that grew.
    //
    // The leaves are short next to the stem, which is a decision about the scene
    // rather than about the plant: a leaf reaching 12 units to the side is a leaf
    // that lands across one of the character's rays, and a stem with wings is
    // worse in this composition than a stem with leaves. Both stages keep them
    // short for the same reason, and the flower's are the seedling's scaled up so
    // the cross-fade from one to the other is a plant getting bigger.
    //
    // The bloom is six petals of radius 6 on a ring of radius 8 about (0, -30):
    // big enough at launcher size that the cream inside each petal reads, and
    // small enough that the six outlines crossing in the middle read as petals
    // rather than as a scribble. The centre they leave uncovered is the flower's
    // middle, which is why there is no disc drawn there, and the ring is centred
    // on the stem rather than offset to one side so that the flower leans away
    // from the character as one object instead of the head drooping off its own
    // stalk.
    sprout: {
      d: (
        // The stem, from the planting point up.
        "M-1.6 0H1.6V-8H-1.6ZM-0.9-4.7C-2.8-6.1-5.8-5.9-6.6-4.4-5.5-2.9-2.7-3.1-0.8-4.4ZM0.9-7.8C2.8-9.2 5.8-9 6.6-7.6 5.5-6 2.7-6.2 0.8-7.6Z"
      ),
      filled: true
    },
    flower: {
      d: (
        // The stem, with its two leaves where the seedling had them.
        "M-2 0H2V-22H-2ZM-1.3-6.8C-4-8.6-8.3-8.4-9.4-6.3-7.8-4.2-3.8-4.4-1.1-6.3ZM1.3-11.2C4-13.1 8.3-12.9 9.4-10.8 7.8-8.6 3.8-8.8 1.1-10.8ZM2-30a6 6 0 1 0 12 0 6 6 0 1 0-12 0ZM-2-23.1a6 6 0 1 0 12 0 6 6 0 1 0-12 0ZM-10-23.1a6 6 0 1 0 12 0 6 6 0 1 0-12 0ZM-14-30a6 6 0 1 0 12 0 6 6 0 1 0-12 0ZM-10-36.9a6 6 0 1 0 12 0 6 6 0 1 0-12 0ZM-2-36.9a6 6 0 1 0 12 0 6 6 0 1 0-12 0Z"
      ),
      filled: true,
      surface: true
    }
  };
  function renderProp(prop2, paint) {
    if (prop2.opacity <= 1e-3) return "";
    const path = PROP_PATHS[prop2.id];
    const transform = [
      `translate(${n3(prop2.x)} ${n3(prop2.y)})`,
      `rotate(${n3(prop2.rotation)})`,
      `scale(${n3(prop2.scale)})`
    ].join(" ");
    const draw = path.surface ? `fill="${path.colour ?? paint.highlight}" stroke="${paint.ink}" stroke-width="2.2" stroke-linejoin="round"` : path.filled ? `fill="${paint.ink}"` : `fill="none" stroke="${paint.ink}" stroke-width="2.2" stroke-linecap="round"`;
    const custom = PROP_ART[prop2.id];
    const art = custom ? custom(paint) : `<path d="${path.d}" ${draw}/>`;
    return `<g data-prop="${prop2.id}" transform="${transform}" opacity="${n3(Math.min(1, prop2.opacity))}">` + art + `</g>`;
  }
  var BEHIND_PROPS = ["deckchair"];
  var HELD_PROPS = ["book", "book-page", "laptop", "magnifier"];
  var FACE_PROPS = ["sunglasses"];
  var SUNGLASSES_ART = (paint) => {
    const lens = (cx) => `M${cx - 13.5} -8.5C${cx - 4} -10 ${cx + 4} -10 ${cx + 13} -8.5C${cx + 13.5} -2 ${cx + 12} 6 ${cx + 7.5} 9C${cx + 3} 11 ${cx - 5} 11 ${cx - 9} 8.5C${cx - 12.5} 6 ${cx - 14} -2 ${cx - 13.5} -8.5Z`;
    const glint = (cx) => `M${cx - 8} -4.5L${cx - 4} -7M${cx - 8.5} 0L${cx - 7} -1.4`;
    return `<path d="${lens(-15.5)}${lens(15.5)}" fill="#1B1B1F" stroke="${paint.ink}" stroke-width="3" stroke-linejoin="round"/><path d="M-2.4 -6.5C-1 -8.6 1 -8.6 2.4 -6.5" fill="none" stroke="${paint.ink}" stroke-width="3.2" stroke-linecap="round"/><path d="M-28.6 -8L-34 -7M28.6 -8L34 -7" fill="none" stroke="${paint.ink}" stroke-width="3" stroke-linecap="round"/><path d="${glint(-15.5)}${glint(15.5)}" fill="none" stroke="#FFFFFF" stroke-width="1.6" stroke-linecap="round" opacity="0.85"/>`;
  };
  var DECKCHAIR_ART = (paint) => {
    const wood = "#C98B4A";
    const rail = (d, w) => `<path d="${d}" fill="none" stroke="${paint.ink}" stroke-width="${w + 4.6}" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${wood}" stroke-width="${w}" stroke-linecap="round"/>`;
    const sling = "M44 -62C52 -20 52 30 24 50C2 64 -30 52 -50 34";
    return (
      // Back leg / rail and the front leg, behind the canvas.
      rail("M46 -64L78 76", 5) + rail("M-50 34L-70 78", 5) + rail("M-40 36L32 78", 4.2) + // The canvas: an inked band, white, then blue stripes as dashes along it.
      `<path d="${sling}" fill="none" stroke="${paint.ink}" stroke-width="24" stroke-linecap="butt"/><path d="${sling}" fill="none" stroke="#FFFFFF" stroke-width="19.4" stroke-linecap="butt"/><path d="${sling}" fill="none" stroke="#2F6FD6" stroke-width="19.4" stroke-dasharray="9 9" stroke-linecap="butt"/>` + // The crossbars at each end of the canvas.
      rail("M38 -64L52 -60", 3.6) + rail("M-54 30L-44 40", 3.6)
    );
  };
  var BOOK_ART = (paint) => {
    const ink = paint.ink;
    const cover = "M-31 -17L0 -13L31 -17L31 18L0 22L-31 18Z";
    const pages = "M-27.5 -14.5L0 -10.5L27.5 -14.5L27.5 15L0 19L-27.5 15Z";
    const lines = [-7, -2, 3, 8].map((y) => `M-23 ${y - 2.6}L-5 ${y}M5 ${y}L23 ${y - 2.6}`).join("");
    return `<path d="${cover}" fill="#2F6FD6" stroke="${ink}" stroke-width="2.6" stroke-linejoin="round"/><path d="${pages}" fill="#FFFFFF" stroke="${ink}" stroke-width="1.8" stroke-linejoin="round"/><path d="M0 -10.5L0 19" stroke="${ink}" stroke-width="1.8"/><path d="${lines}" stroke="#9AA3AF" stroke-width="1.4" stroke-linecap="round"/>`;
  };
  var BOOK_PAGE_ART = (paint) => `<path d="M0 -10.5C8 -20 18 -22 22 -20L22 10C16 8 8 10 0 19Z" fill="#FFFFFF" stroke="${paint.ink}" stroke-width="1.8" stroke-linejoin="round"/>`;
  var LAPTOP_ART = (paint) => {
    const ink = paint.ink;
    return `<path d="M-6 -24L32 -20L28 12L-10 12Z" fill="#B7BCC4" stroke="${ink}" stroke-width="2.6" stroke-linejoin="round"/><circle cx="11" cy="-5" r="3.2" fill="#E6E9ED"/><path d="M-34 12L30 12L34 19L-30 19Z" fill="#9AA0A8" stroke="${ink}" stroke-width="2.6" stroke-linejoin="round"/>`;
  };
  var MAGNIFIER_ART = (paint) => {
    const ink = paint.ink;
    return `<path d="M-9 9L-22 22" stroke="${ink}" stroke-width="9.4" stroke-linecap="round"/><path d="M-9 9L-22 22" stroke="#9A6334" stroke-width="5.2" stroke-linecap="round"/><circle r="14" fill="#DDEFFF" fill-opacity="0.55" stroke="${ink}" stroke-width="7.6"/><circle r="14" fill="none" stroke="#A9AFB7" stroke-width="3.6"/><path d="M-7 -5C-5 -8.5 -1.5 -10 2 -9.6" fill="none" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round"/>`;
  };
  var PROP_ART = {
    sunglasses: (paint) => SUNGLASSES_ART(paint),
    deckchair: (paint) => DECKCHAIR_ART(paint),
    book: BOOK_ART,
    "book-page": BOOK_PAGE_ART,
    laptop: LAPTOP_ART,
    magnifier: MAGNIFIER_ART
  };
  var SAFE_PAINT = /^(?:#[0-9a-fA-F]{3,8}|[a-zA-Z][a-zA-Z0-9-]{0,31}|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\([#a-zA-Z0-9%\s.,/+-]*\)|var\(--[a-zA-Z0-9-]{1,32}\))$/;
  function safePaint(value, fallback) {
    return SAFE_PAINT.test(value) ? value : fallback;
  }
  function painters(rig, cssVariables) {
    if (cssVariables) {
      return {
        body: "var(--sunny-body)",
        ray: "var(--sunny-ray)",
        ink: "var(--sunny-ink)",
        highlight: "var(--sunny-highlight)"
      };
    }
    return {
      body: safePaint(rig.theme.body, SUNNY_THEME.body),
      ray: safePaint(rig.theme.ray, SUNNY_THEME.ray),
      ink: safePaint(rig.theme.ink, SUNNY_THEME.ink),
      highlight: safePaint(rig.theme.highlight, SUNNY_THEME.highlight)
    };
  }
  var instanceCounter = 0;
  function renderSunnyParts(rig, options = {}) {
    const viewBox = options.crop ? `${n3(options.crop.x)} ${n3(options.crop.y)} ${n3(options.crop.width)} ${n3(options.crop.height)}` : `0 0 ${VIEWBOX} ${VIEWBOX}`;
    const size = options.size ?? VIEWBOX;
    const paint = painters(rig, options.cssVariables ?? false);
    const uid = options.idPrefix !== void 0 ? options.idPrefix : options.uniqueIds ? `u${instanceCounter++}-` : "";
    const boil = options.boil;
    const squash = 1 - rig.squash;
    const stretch = 1 + rig.stretch;
    const root = [
      `translate(${n3(rig.x)} ${n3(rig.y)})`,
      `rotate(${n3(rig.rotation)})`,
      `scale(${n3(rig.scale * stretch)} ${n3(rig.scale * squash)})`
    ].join(" ");
    const showLimbs = (options.limbs ?? true) && rig.limbs.visible;
    const hidden = showLimbs ? limbRayIndices(rig.limbs) : [];
    const limbPaint = { limb: paint.ray, ink: paint.ink };
    const toVB = (p) => toViewBox(rig, p);
    const leg2 = (side) => showLimbs ? legMarkup(rig.limbs.legs[side], side, rig.rays, toVB, rig.scale, limbPaint, boil) : "";
    const arms = {
      left: showLimbs ? armParts(rig.limbs.arms.left, "left", rig.rays, limbPaint, boil) : null,
      right: showLimbs ? armParts(rig.limbs.arms.right, "right", rig.rays, limbPaint, boil) : null
    };
    const armIn = (side, front) => {
      const parts = arms[side];
      if (!parts) return "";
      if (front) return parts.hand;
      return parts.tube;
    };
    const named = options.title !== void 0 && options.title !== "";
    const decorative = options.decorative ?? !named;
    const label = named && !decorative ? `<title>${escapeXml(options.title ?? "")}</title>` : "";
    const aria = decorative ? 'aria-hidden="true" focusable="false"' : `role="img" aria-label="${escapeXml(options.title ?? "Sunny")}"`;
    const behindProps = rig.props.filter((prop2) => BEHIND_PROPS.includes(prop2.id)).map((prop2) => renderProp(prop2, paint)).join("");
    return {
      svgAttributes: `xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${n3(size)}" height="${n3(size)}" ${aria}${options.className ? ` class="${escapeXml(options.className)}"` : ""}`,
      label,
      root,
      faceTransform: `rotate(${n3(rig.faceTilt)})`,
      under: [
        // Furniture goes under everything, legs included: Sunny's legs stretch
        // out *over* the front of the deckchair, as on the sheet. The chair is
        // authored in the body frame, so it carries the root transform here.
        [
          "props-behind",
          plain(behindProps === "" ? "" : `<g transform="${root}">${behindProps}</g>`)
        ],
        ["leg-left", plain(leg2("left"))],
        ["leg-right", plain(leg2("right"))]
      ],
      behind: [
        ...rig.rays.map((_, index2) => [
          `ray-${index2}`,
          hidden.includes(index2) ? EMPTY : tracedRayPart(rig, index2, paint, boil)
        ]),
        ["arm-left", plain(armIn("left", false))],
        ["arm-right", plain(armIn("right", false))],
        ["body", plain(tracedBody(paint, boil))]
      ],
      face: [
        ["eye-left", tracedEyePart("left", rig.eyes.left, paint, uid, boil)],
        ["eye-right", tracedEyePart("right", rig.eyes.right, paint, uid, boil)],
        ["brow-left", tracedBrowPart("left", rig.brows.left, paint, boil)],
        ["brow-right", tracedBrowPart("right", rig.brows.right, paint, boil)],
        ["mouth", tracedMouthPart(rig, paint, boil)],
        [
          "face-props",
          plain(
            rig.props.filter((prop2) => FACE_PROPS.includes(prop2.id)).map((prop2) => renderProp(prop2, paint)).join("")
          )
        ]
      ],
      over: [
        [
          "props-held",
          plain(
            rig.props.filter((prop2) => HELD_PROPS.includes(prop2.id)).map((prop2) => renderProp(prop2, paint)).join("")
          )
        ],
        ["arm-front-left", plain(armIn("left", true))],
        ["arm-front-right", plain(armIn("right", true))],
        // Props sit in the body frame rather than the face frame: a question mark
        // or a held prop should not tilt with the head.
        [
          "props",
          plain(
            rig.props.filter(
              (prop2) => !BEHIND_PROPS.includes(prop2.id) && !FACE_PROPS.includes(prop2.id) && !HELD_PROPS.includes(prop2.id)
            ).map((prop2) => renderProp(prop2, paint)).join("")
          )
        ]
      ]
    };
  }
  var EMPTY = { transform: "", inner: "" };
  var plain = (inner) => ({ transform: "", inner });
  var wrap = (parts) => parts.map(
    ([key, p]) => `<g data-part="${key}"${p.transform ? ` transform="${p.transform}"` : ""}>${p.inner}</g>`
  ).join("");
  function joinSunnyParts(p) {
    return [
      `<svg ${p.svgAttributes}>`,
      p.label,
      `<g data-layer="under">${wrap(p.under)}</g>`,
      `<g data-layer="root" transform="${p.root}">`,
      wrap(p.behind),
      `<g data-layer="face" transform="${p.faceTransform}">${wrap(p.face)}</g>`,
      wrap(p.over),
      `</g>`,
      `</svg>`
    ].join("");
  }
  function renderSunny(rig, options = {}) {
    return joinSunnyParts(renderSunnyParts(rig, options));
  }
  function escapeXml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  }

  // packages/animation-engine/src/compositor.ts
  var BLEND_MS = 180;
  var STATE_BLEND_MS = 260;
  var easeOutCubic = (t) => 1 - (1 - t) ** 3;
  var Compositor = class {
    #last = null;
    #from = null;
    #blendStart = 0;
    #blendMs = BLEND_MS;
    #key = null;
    #lastNow = null;
    #follow = new FollowThrough();
    /** Forget history: the next frame is drawn as-is, with nothing to blend from. */
    reset() {
      this.#last = null;
      this.#from = null;
      this.#key = null;
      this.#lastNow = null;
      this.#follow.reset();
    }
    compose(target, now, options) {
      if (this.#lastNow !== null && now < this.#lastNow) this.reset();
      const previous = this.#lastNow;
      this.#lastNow = now;
      if (options.key !== this.#key) {
        this.#from = this.#last;
        this.#blendStart = previous ?? now;
        this.#blendMs = options.blendMs ?? BLEND_MS;
        this.#key = options.key;
      }
      let rig = target;
      if (this.#from) {
        const k = (now - this.#blendStart) / this.#blendMs;
        if (k >= 1) this.#from = null;
        else rig = lerpRig(nearestTurn(this.#from, target), target, easeOutCubic(Math.max(0, k)));
      }
      rig = options.reducedMotion ? rig : this.#follow.apply(rig, now);
      this.#last = rig;
      return rig;
    }
  };
  function nearestTurn(from, target) {
    const d = from.rotation - target.rotation;
    const wrapped = d - 360 * Math.round(d / 360);
    if (wrapped === d) return from;
    return { ...from, rotation: target.rotation + wrapped };
  }
  var STEP_MS = 1e3 / 120;
  var MAX_GAP_MS = 250;
  var OMEGA = 14.5;
  var ZETA = 0.42;
  var DEADZONE = 0.04;
  var MAX_LAG = 7;
  var MAX_ROT_LAG = 14;
  var springStep = (s, target, dt) => {
    const a = OMEGA * OMEGA * (target - s.p) - 2 * ZETA * OMEGA * s.v;
    s.v += a * dt;
    s.p += s.v * dt;
  };
  var clamp = (v, m) => v > m ? m : v < -m ? -m : v;
  var FollowThrough = class {
    #x = null;
    #y = { p: 0, v: 0 };
    #r = { p: 0, v: 0 };
    #t = 0;
    reset() {
      this.#x = null;
    }
    apply(rig, now) {
      if (this.#x === null || now - this.#t > MAX_GAP_MS || now < this.#t) {
        this.#x = { p: rig.x, v: 0 };
        this.#y = { p: rig.y, v: 0 };
        this.#r = { p: rig.rotation, v: 0 };
        this.#t = now;
        return rig;
      }
      while (now - this.#t >= STEP_MS) {
        const dt = STEP_MS / 1e3;
        springStep(this.#x, rig.x, dt);
        springStep(this.#y, rig.y, dt);
        const dr = this.#r.p - rig.rotation;
        this.#r.p = rig.rotation + dr - 360 * Math.round(dr / 360);
        springStep(this.#r, rig.rotation, dt);
        this.#t += STEP_MS;
      }
      const lagX = clamp(this.#x.p - rig.x, MAX_LAG);
      const lagY = clamp(this.#y.p - rig.y, MAX_LAG);
      const rawR = this.#r.p - rig.rotation;
      const lagR = clamp(rawR - 360 * Math.round(rawR / 360), MAX_ROT_LAG);
      if (Math.abs(lagX) < DEADZONE && Math.abs(lagY) < DEADZONE && Math.abs(lagR) < DEADZONE) {
        return rig;
      }
      const a = -rig.rotation * Math.PI / 180;
      const s = rig.scale || 1;
      const lx = (lagX * Math.cos(a) - lagY * Math.sin(a)) / s;
      const ly = (lagX * Math.sin(a) + lagY * Math.cos(a)) / s;
      const out = cloneRig(rig);
      for (const ray of out.rays) {
        ray.offset.x += lx * 0.45;
        ray.offset.y += ly * 0.45;
        ray.rotation += lagR * 0.55;
      }
      for (const arm2 of [out.limbs.arms.left, out.limbs.arms.right]) {
        arm2.hand.x += lx * 0.7;
        arm2.hand.y += ly * 0.7;
        arm2.handRotation += lagR * 0.8;
      }
      const vy = this.#y.v / s;
      out.stretch -= clamp(Math.abs(vy) * 6e-4, 0.03);
      out.squash -= clamp(Math.abs(vy) * 5e-4, 0.025);
      return out;
    }
  };

  // packages/animation-engine/src/acting.ts
  var TAU = Math.PI * 2;
  var clamp012 = (t) => Math.min(1, Math.max(0, t));
  var ease = (t) => {
    const c = clamp012(t);
    return c * c * (3 - 2 * c);
  };
  var wave = (p, phase = 0) => Math.sin((p + phase) * TAU);
  var envelope = (t, a, b) => t <= 0 || t >= 1 ? 0 : Math.min(ease(t / a), ease((1 - t) / b));
  var overshoot = (t, s = 1.9) => {
    const c = clamp012(t) - 1;
    return 1 + c * c * ((s + 1) * c + s);
  };
  function act(r, base, name, w) {
    r.limbs = blendLimbs(base.limbs, limbPose(name), w);
  }
  function breathe(r, base, p, amount = 1) {
    r.y += -Math.sin(p * TAU) * 1.2 * amount;
    for (const [i, ray] of r.rays.entries()) {
      ray.lengthScale = base.rays[i].lengthScale * (1 + wave(p, -i / 8) * 0.03 * amount);
    }
  }
  var held = (id, x, y, rotation = 0, scale = 1) => ({
    id,
    x,
    y,
    rotation,
    scale,
    opacity: 1
  });
  function readPose(base, t, still) {
    const r = cloneRig(base);
    r.y = base.y + SIT_DROP;
    r.squash = 0.04;
    r.stretch = 0.03;
    act(r, base, "read", 1);
    const line = still ? 0.3 : t * 4 % 1 * 1.2 - 0.6;
    r.eyes.left.gaze = { x: line, y: 0.75 };
    r.eyes.right.gaze = { x: line, y: 0.75 };
    r.eyes.left.scaleY = 0.86;
    r.eyes.right.scaleY = 0.86;
    r.brows.left.y = base.brows.left.y + 1.5;
    r.brows.right.y = base.brows.right.y + 1.5;
    r.faceTilt = still ? -3 : -3 + wave(t) * 2;
    if (!still) breathe(r, base, t, 0.6);
    const turn = still ? 0 : Math.max(0, Math.sin(clamp012((t - 0.55) / 0.2) * Math.PI));
    r.props = [held("book", 0, 30, 0, 1)];
    if (turn > 0.01) r.props.push({ ...held("book", 0, 30, 0, 1), id: "book-page", opacity: turn });
    return r;
  }
  function typePose(base, t, still) {
    const r = cloneRig(base);
    r.y = base.y + SIT_DROP;
    r.squash = 0.04;
    r.stretch = 0.03;
    act(r, base, "type", 1);
    if (!still) {
      r.limbs.arms.left.hand.y += Math.abs(Math.sin(t * 9 * Math.PI)) * -1.8;
      r.limbs.arms.right.hand.y += Math.abs(Math.sin(t * 9 * Math.PI + 1.3)) * -1.8;
      breathe(r, base, t, 0.5);
    }
    const up = still ? 0 : ease((t - 0.6) / 0.08) * (1 - ease((t - 0.82) / 0.08));
    const gaze = { x: 0.15, y: 0.7 - up * 0.9 };
    r.eyes.left.gaze = gaze;
    r.eyes.right.gaze = { ...gaze };
    r.smile.depth = base.smile.depth * (1 + up * 0.2);
    r.props = [held("laptop", 4, 34, 0, 1)];
    return r;
  }
  function magnifyPose(base, t, still) {
    const r = cloneRig(base);
    act(r, base, "magnify", 1);
    const scan = still ? 0 : wave(t);
    const x = -15 + scan * 6;
    const y = -9 + Math.abs(scan) * 2;
    r.faceTilt = scan * 4;
    r.rotation = scan * 2;
    r.eyes.left.scaleX = 1.35;
    r.eyes.left.scaleY = 1.35;
    r.eyes.left.gaze = { x: scan * 0.5, y: 0 };
    r.eyes.right.scaleY = 0.8;
    r.eyes.right.gaze = { x: scan * 0.5, y: 0 };
    r.brows.left.y = base.brows.left.y - 4;
    r.limbs.arms.left.hand = { x: x - 22, y: y + 22 };
    if (!still) breathe(r, base, t, 0.5);
    r.props = [held("magnifier", x, y, 0, 1)];
    return r;
  }
  var lookup = (id, group, pose2, asset) => {
    const moving = {
      id,
      group,
      priority: PRIORITY.chat + 10,
      duration: 3200,
      canInterrupt: true,
      loop: true,
      intensity: "minimal",
      assets: asset,
      reducedMotionFallback: `${id}-still`,
      // Idle too: a host page can stage a prop outside a conversation (the
      // website's guide reads up on the knowledge-base section).
      states: ["thinking", "idle"],
      blendInMs: 420,
      pose: (base, t) => pose2(base, t, false)
    };
    const still = {
      ...moving,
      id: `${id}-still`,
      intensity: "off",
      assets: asset.filter((a) => a !== "book-page"),
      reducedMotionFallback: null,
      pose: (base) => pose2(base, 0, true)
    };
    return [moving, still];
  };
  var [lookupBook, lookupBookStill] = lookup("lookup-book", "lookup-book", readPose, [
    "book",
    "book-page"
  ]);
  var [lookupLaptop, lookupLaptopStill] = lookup("lookup-laptop", "lookup-laptop", typePose, [
    "laptop"
  ]);
  var [lookupMagnify, lookupMagnifyStill] = lookup(
    "lookup-magnify",
    "lookup-magnify",
    magnifyPose,
    ["magnifier"]
  );
  var gesture = (id, intensity, duration, pose2) => ({
    id,
    group: "gesture",
    priority: PRIORITY.chat + 5,
    duration,
    canInterrupt: true,
    loop: false,
    intensity,
    assets: [],
    reducedMotionFallback: null,
    // Idle as well, so a host page can ask for one by name.
    states: ["speaking", "idle"],
    pose: (base, t) => {
      const r = cloneRig(base);
      pose2(r, base, t);
      return r;
    }
  });
  var gestureNod = gesture("gesture-nod", "minimal", 900, (r, base, t) => {
    const w = envelope(t, 0.2, 0.3);
    r.faceTilt = base.faceTilt + Math.sin(t * TAU * 2) * 3 * w;
    r.y = base.y + Math.max(0, Math.sin(t * TAU * 2)) * 2 * w;
    r.eyes.left.closed = 0.25 * w;
    r.eyes.right.closed = 0.25 * w;
    r.smile.depth = base.smile.depth * (1 + 0.2 * w);
  });
  var gesturePalm = gesture("gesture-palm", "balanced", 1500, (r, base, t) => {
    const w = envelope(t, 0.18, 0.25);
    const limbs = limbPose("hips");
    limbs.arms.left = {
      ...limbs.arms.left,
      hand: { x: -60, y: 8 - Math.sin(t * Math.PI) * 6 },
      bend: 0.5,
      shape: "open",
      handRotation: -70 + wave(t * 1.5) * 8,
      front: false
    };
    r.limbs = blendLimbs(base.limbs, limbs, w);
    r.rotation = base.rotation - 3 * w;
    r.faceTilt = base.faceTilt - 4 * w;
    r.brows.left.y = base.brows.left.y - 2.5 * w;
    r.brows.right.y = base.brows.right.y - 2.5 * w;
  });
  var gesturePoint = gesture("gesture-point", "balanced", 1300, (r, base, t) => {
    const w = envelope(t, 0.15, 0.28);
    const shot = overshoot(clamp012((t - 0.05) / 0.25));
    const limbs = limbPose("hips");
    limbs.arms.right = {
      ...limbPose("point").arms.right,
      hand: { x: 58 + shot * 8, y: 4 - shot * 4 }
    };
    r.limbs = blendLimbs(base.limbs, limbs, w);
    const wink = t > 0.3 && t < 0.55 ? Math.sin((t - 0.3) / 0.25 * Math.PI) : 0;
    r.eyes.right.closed = wink;
    r.smile.depth = base.smile.depth * (1 + 0.3 * w);
    r.smile.rotation = base.smile.rotation - 4 * w;
    r.rotation = base.rotation + 3 * w;
  });
  var gestureIndex = gesture("gesture-index", "balanced", 1400, (r, base, t) => {
    const w = envelope(t, 0.18, 0.25);
    r.limbs = blendLimbs(base.limbs, limbPose("idea"), w);
    r.limbs.arms.left.hand.y -= Math.abs(Math.sin(t * TAU * 1.5)) * 3 * w;
    r.brows.left.y = base.brows.left.y - 3 * w;
    r.faceTilt = base.faceTilt + 3 * w;
  });
  var leanIn = {
    id: "lean-in",
    group: "lean",
    priority: PRIORITY.interaction - 10,
    duration: 1600,
    canInterrupt: true,
    loop: false,
    intensity: "minimal",
    assets: [],
    reducedMotionFallback: null,
    states: ["listening"],
    pose: (base, t) => {
      const r = cloneRig(base);
      const w = envelope(t, 0.2, 0.3);
      r.rotation = base.rotation + 4 * w;
      r.y = base.y + 2 * w;
      r.faceTilt = base.faceTilt + 5 * w + Math.max(0, Math.sin(t * TAU * 2)) * 2 * w;
      r.eyes.left.gaze = { x: 0.35 * w, y: 0.6 * w };
      r.eyes.right.gaze = { x: 0.35 * w, y: 0.6 * w };
      r.brows.left.y = base.brows.left.y - 2 * w;
      r.brows.right.y = base.brows.right.y - 2 * w;
      r.limbs = blendLimbs(base.limbs, limbPose("chin"), w * 0.8);
      return r;
    }
  };
  var settleNod = {
    id: "settle-nod",
    group: "nod",
    priority: PRIORITY.chat - 10,
    duration: 1100,
    canInterrupt: true,
    loop: false,
    intensity: "minimal",
    assets: [],
    reducedMotionFallback: null,
    states: ["idle"],
    pose: (base, t) => {
      const r = cloneRig(base);
      const w = envelope(t, 0.15, 0.35);
      r.faceTilt = base.faceTilt + Math.sin(t * TAU * 1.5) * 3 * w;
      r.eyes.left.closed = 0.35 * w;
      r.eyes.right.closed = 0.35 * w;
      r.smile.depth = base.smile.depth * (1 + 0.3 * w);
      r.limbs = blendLimbs(base.limbs, limbPose("hips"), w);
      return r;
    }
  };
  var fidget = (id, intensity, duration, pose2) => ({
    id,
    group: "fidget",
    priority: PRIORITY.idle + 30,
    duration,
    canInterrupt: true,
    loop: false,
    intensity,
    assets: [],
    reducedMotionFallback: null,
    states: ["idle"],
    pose: (base, t) => {
      const r = cloneRig(base);
      pose2(r, base, t);
      return r;
    }
  });
  var fidgetLook = fidget("fidget-look", "minimal", 2600, (r, base, t) => {
    const w = envelope(t, 0.1, 0.15);
    const k = ease(t < 0.5 ? (t - 0.1) / 0.15 : (t - 0.5) / 0.15);
    const x = (t < 0.5 ? -k : -1 + 2 * k) * w;
    r.eyes.left.gaze = { x: x * 0.9, y: 0 };
    r.eyes.right.gaze = { x: x * 0.9, y: 0 };
    r.faceTilt = base.faceTilt + x * 6;
    r.rotation = base.rotation + x * 2;
    r.limbs = blendLimbs(base.limbs, limbPose("hips"), w);
  });
  var fidgetStretch = fidget("fidget-stretch", "balanced", 2400, (r, base, t) => {
    const w = envelope(t, 0.3, 0.3);
    r.limbs = blendLimbs(base.limbs, limbPose("cheer"), w);
    r.limbs.arms.left.shape = "open";
    r.limbs.arms.right.shape = "open";
    r.y = base.y - 4 * w;
    r.squash = -0.06 * w;
    r.stretch = -0.04 * w;
    r.eyes.left.closed = 0.8 * w;
    r.eyes.right.closed = 0.8 * w;
    r.smile.depth = base.smile.depth * (1 - 0.6 * w);
    r.smile.span = base.smile.span * (1 - 0.35 * w);
    for (const [i, ray] of r.rays.entries()) {
      ray.lengthScale = base.rays[i].lengthScale * (1 + 0.12 * w);
    }
  });
  var fidgetPeace = fidget("fidget-peace", "balanced", 1800, (r, base, t) => {
    const w = envelope(t, 0.18, 0.25);
    r.limbs = blendLimbs(base.limbs, limbPose("peace"), w);
    r.limbs.arms.left.handRotation += wave(t * 2) * 10 * w;
    r.faceTilt = base.faceTilt - 5 * w;
    r.smile.depth = base.smile.depth * (1 + 0.35 * w);
    r.eyes.right.closed = Math.max(0, Math.sin((t - 0.4) / 0.25 * Math.PI)) * (t > 0.4 && t < 0.65 ? 1 : 0);
  });
  var fidgetHop = fidget("fidget-hop", "playful", 1200, (r, base, t) => {
    const air = t > 0.2 && t < 0.7 ? Math.sin((t - 0.2) / 0.5 * Math.PI) : 0;
    const crouch = Math.max(
      t < 0.2 ? Math.sin(t / 0.2 * Math.PI) : 0,
      t > 0.7 && t < 0.9 ? Math.sin((t - 0.7) / 0.2 * Math.PI) : 0
    );
    r.y = base.y - air * 9 + crouch * 3;
    r.squash = crouch * 0.1 - air * 0.05;
    r.stretch = -crouch * 0.06 + air * 0.03;
    const limbs = blendLimbs(limbPose("hips"), limbPose("jump"), air);
    for (const side of ["left", "right"]) limbs.legs[side].foot.y -= air * 9;
    r.limbs = blendLimbs(base.limbs, limbs, envelope(t, 0.1, 0.12));
  });
  var LOUNGE_MS = 6e5;
  function loungePose(base, t, still) {
    const r = cloneRig(base);
    const ms = t * LOUNGE_MS;
    const seated = still ? 1 : ease(ms / 900);
    const breath = still ? 0 : wave(ms / 4200) * seated;
    r.rotation = base.rotation + seated * 16;
    r.x = base.x + seated * 8;
    r.y = base.y + seated * 6 - breath * 0.8;
    r.faceTilt = base.faceTilt - seated * 4;
    r.smile.depth = base.smile.depth * (1 + seated * 0.35);
    for (const ray of r.rays) ray.lengthScale = 1 - seated * 0.04 + breath * 0.04;
    const limbs = limbPose("recline");
    limbs.legs.left = { ...limbs.legs.left, foot: { x: -50, y: 78 }, bend: -0.25, footRotation: -32 };
    limbs.legs.right = { ...limbs.legs.right, foot: { x: -74, y: 62 }, bend: 0.3, footRotation: -10 };
    const tap = still ? 0 : Math.max(0, Math.sin(ms / 700 * Math.PI)) * (Math.floor(ms / 5600) % 2);
    limbs.legs.right.footRotation -= tap * 12;
    r.limbs = blendLimbs(base.limbs, limbs, seated);
    const back = -r.rotation * Math.PI / 180;
    const dx = base.x - r.x;
    const dy = base.y - r.y;
    const shades = still ? 1 : ease((ms - 600) / 500);
    const peek = still ? 0 : Math.max(0, Math.sin((ms % 21e3 - 18e3) / 1200 * Math.PI));
    r.props = [
      {
        id: "deckchair",
        x: dx * Math.cos(back) - dy * Math.sin(back),
        y: dx * Math.sin(back) + dy * Math.cos(back),
        rotation: -r.rotation + (1 - seated) * 18,
        scale: 0.55 + 0.45 * seated,
        opacity: seated
      },
      {
        id: "sunglasses",
        x: 1.8,
        y: -5.4 - 40 * (1 - shades) + peek * 6,
        rotation: -11.4,
        scale: 1,
        opacity: shades
      }
    ];
    r.eyes.left.closed = 0.35 * shades * (1 - peek);
    r.eyes.right.closed = 0.35 * shades * (1 - peek);
    r.brows.left.y = base.brows.left.y - peek * 3;
    return r;
  }
  var lounge = {
    id: "lounge-deckchair",
    group: "lounge",
    priority: PRIORITY.idle + 40,
    duration: LOUNGE_MS,
    canInterrupt: true,
    loop: false,
    intensity: "minimal",
    assets: ["deckchair", "sunglasses"],
    reducedMotionFallback: "lounge-still",
    states: ["relaxing"],
    blendInMs: 500,
    pose: (base, t) => loungePose(base, t, false)
  };
  var loungeStill = {
    ...lounge,
    id: "lounge-still",
    // A held pose: it loops on one frame until the state it belongs to ends.
    loop: true,
    duration: 1,
    intensity: "off",
    reducedMotionFallback: null,
    pose: (base) => loungePose(base, 0, true)
  };
  var ACTING = [
    lookupBookStill,
    lookupBook,
    lookupLaptopStill,
    lookupLaptop,
    lookupMagnifyStill,
    lookupMagnify,
    gestureNod,
    gesturePalm,
    gesturePoint,
    gestureIndex,
    leanIn,
    settleNod,
    fidgetLook,
    fidgetStretch,
    fidgetPeace,
    fidgetHop,
    loungeStill,
    lounge
  ];
  var GESTURES = ["gesture-nod", "gesture-palm", "gesture-point", "gesture-index"];
  var FIDGETS = [
    "fidget-look",
    "fidget-stretch",
    "fidget-peace",
    "fidget-hop",
    "balloon"
  ];
  var LOOKUP_GROUP = {
    book: "lookup-book",
    laptop: "lookup-laptop",
    magnifier: "lookup-magnify"
  };

  // packages/animation-engine/src/limb-acting.ts
  var TAU2 = Math.PI * 2;
  var clamp013 = (t) => Math.min(1, Math.max(0, t));
  var ease2 = (t) => {
    const c = clamp013(t);
    return c * c * (3 - 2 * c);
  };
  var wave2 = (p, phase = 0) => Math.sin((p + phase) * TAU2);
  var envelope2 = (t, a, b) => t <= 0 || t >= 1 ? 0 : Math.min(ease2(t / a), ease2((1 - t) / b));
  var overshoot2 = (t, s = 1.9) => {
    const c = clamp013(t) - 1;
    return 1 + c * c * ((s + 1) * c + s);
  };
  var pose = (name) => limbPose(name);
  function act2(r, base, limbs, w) {
    r.limbs = blendLimbs(base.limbs, limbs, w);
  }
  function findProp(r, id) {
    return r.props.find((p) => p.id === id && p.opacity > 0.05);
  }
  function tuckWhileSpinning(r, base, limit = 20) {
    const turn = ((r.rotation - base.rotation) % 360 + 540) % 360 - 180;
    if (Math.abs(turn) > limit) r.limbs.visible = false;
  }
  var wavingHello = (r, t, base) => {
    const w = envelope2(t, 0.2, 0.25);
    const limbs = pose("wave");
    limbs.arms.left.handRotation += wave2(t * 3) * 28;
    limbs.arms.left.hand.x += wave2(t * 3) * 3;
    act2(r, base, limbs, w);
  };
  var DIRECTORS = {
    "idle-breathe": (r, t) => {
      r.limbs.arms.left.bend += wave2(t * 6) * 0.18;
      r.limbs.arms.right.bend -= wave2(t * 6) * 0.18;
    },
    "listening-perk": wavingHello,
    "bubble-open": (r, t, base) => {
      const w = t < 0.3 ? 0 : Math.sin((t - 0.3) / 0.7 * Math.PI);
      const limbs = pose("wave");
      limbs.arms.left.handRotation += wave2(t * 2) * 30;
      act2(r, base, limbs, w);
    },
    "thinking-whirr": (r, t, base) => {
      const limbs = pose("chin");
      limbs.arms.left.hand.y += Math.abs(Math.sin(t * 4 * Math.PI)) * 1.6;
      act2(r, base, limbs, 1);
    },
    "thinking-still": (r, _t, base) => act2(r, base, pose("chin"), 1),
    "thinking-eureka": (r, t, base) => {
      const lit = t < 0.45 ? 0 : overshoot2((t - 0.45) / 0.18);
      const limbs = blendLimbs(pose("chin"), pose("idea"), lit);
      act2(r, base, limbs, Math.min(1, ease2((1 - t) / 0.15)));
    },
    "eureka-still": (r, t, base) => act2(r, base, pose("idea"), envelope2(t, 0.2, 0.2)),
    "speaking-pulse": (r, t, base) => {
      const beat = Math.sin(t * 2 % 1 * Math.PI);
      const limbs = blendLimbs(pose("hips"), pose("shrug"), 0.45 + beat * 0.3);
      limbs.arms.right = pose("hips").arms.right;
      act2(r, base, limbs, 1);
    },
    "guiding-point": (r, t, base) => {
      const limbs = pose("point");
      limbs.arms.left = pose("hips").arms.left;
      limbs.arms.right.hand.x += wave2(t * 2) * 2.5;
      act2(r, base, limbs, 1);
      const wink = t > 0.1 && t < 0.3 ? Math.sin((t - 0.1) / 0.2 * Math.PI) : 0;
      r.eyes.right.closed = Math.max(r.eyes.right.closed, wink);
      r.smile.depth *= 1 + wink * 0.25;
    },
    "guiding-still": (r, _t, base) => {
      const limbs = pose("point");
      limbs.arms.left = pose("hips").arms.left;
      act2(r, base, limbs, 1);
    },
    "celebrate-bounce": (r, t, base) => {
      const air = Math.max(0, base.y - r.y);
      const flying = clamp013(air / 6);
      const limbs = blendLimbs(pose("cheer"), pose("jump"), flying);
      for (const side of ["left", "right"]) limbs.legs[side].foot.y -= air;
      limbs.arms.left.handRotation += wave2(t * 3) * 12;
      limbs.arms.right.handRotation -= wave2(t * 3) * 12;
      act2(r, base, limbs, envelope2(t, 0.1, 0.12));
    },
    "celebrate-still": (r, t, base) => act2(r, base, pose("thumbsUp"), envelope2(t, 0.2, 0.2)),
    "celebrate-spin": (r, t, base) => {
      act2(r, base, pose("cheer"), envelope2(t, 0.1, 0.1));
      tuckWhileSpinning(r, base);
    },
    "confused-tilt": (r, t, base) => {
      const limbs = pose("shrug");
      limbs.arms.left.hand.y -= Math.abs(Math.sin(t * Math.PI * 3)) * 3;
      limbs.arms.right.hand.y -= Math.abs(Math.sin(t * Math.PI * 3)) * 3;
      act2(r, base, limbs, envelope2(t, 0.25, 0.25));
    },
    "confused-still": (r, t, base) => act2(r, base, pose("shrug"), envelope2(t, 0.3, 0.3) * 0.6),
    "error-deflate": (r, t, base) => act2(r, base, pose("droop"), envelope2(t, 0.3, 0.3)),
    "error-still": (r, t, base) => act2(r, base, pose("droop"), envelope2(t, 0.3, 0.3) * 0.6),
    "celebrate-glow": (r, t, base) => {
      const limbs = blendLimbs(pose("hips"), pose("cheer"), 0.55 + Math.sin(t * 4 * Math.PI) * 0.2);
      act2(r, base, limbs, 1);
    },
    "celebrate-glow-still": (r, _t, base) => act2(r, base, pose("thumbsUp"), 1),
    ponder: (r, t, base) => {
      const limbs = pose("chin");
      limbs.arms.left.hand.x += Math.sin(t * 6 * TAU2) * 1.2;
      limbs.arms.left.handRotation += Math.sin(t * 6 * TAU2) * 6;
      act2(r, base, limbs, 1);
    },
    "ponder-still": (r, _t, base) => act2(r, base, pose("chin"), 1),
    droop: (r, _t, base) => act2(r, base, pose("droop"), 0.85),
    "droop-still": (r, _t, base) => act2(r, base, pose("droop"), 0.85),
    "cool-still": (r, t, base) => act2(r, base, pose("thumbsUp"), envelope2(t, 0.2, 0.2)),
    "charging-panel": (r, t, base) => {
      const battery = findProp(r, "battery");
      const limbs = pose("hips");
      if (battery) {
        limbs.arms.right.hand = { x: battery.x - 2, y: battery.y + 12 };
        limbs.arms.right.shape = "open";
        limbs.arms.right.bend = 0.4;
        limbs.arms.right.handRotation = -20;
      }
      act2(r, base, limbs, envelope2(t, 0.12, 0.12));
    },
    "play-shuffle": (r, t, base) => walk(r, t, base, 3, 0.6),
    "play-run": (r, t, base) => walk(r, t, base, 4, 1),
    "play-dance": (r, t, base) => {
      walk(r, t, base, 4, 0.8);
      const w = envelope2(t, 0.1, 0.12);
      const limbs = blendLimbs(r.limbs, pose("cheer"), 0.6 * w);
      limbs.legs = r.limbs.legs;
      r.limbs = limbs;
    },
    "balloon-rise": (r, t, base) => holdBalloon(r, t, base),
    "balloon-sway": (r, t, base) => holdBalloon(r, t, base),
    "balloon-wander": (r, t, base) => holdBalloon(r, t, base),
    "pop-burst": (r, t, base) => act2(r, base, pose("jump"), envelope2(t, 0.08, 0.4)),
    "pop-flinch": (r, t, base) => act2(r, base, pose("jump"), envelope2(t, 0.08, 0.4)),
    "pop-shower": (r, t, base) => act2(r, base, pose("cheer"), envelope2(t, 0.1, 0.3)),
    "arcade-tuck": (r, _t, base) => tuckWhileSpinning(r, base),
    "arcade-roll": (r, _t, base) => tuckWhileSpinning(r, base),
    "arcade-spin": (r, _t, base) => tuckWhileSpinning(r, base),
    "bloom-seed": (r, t, base) => act2(r, base, pose("point"), envelope2(t, 0.15, 0.15) * 0.5),
    "bloom-grow": (r, t, base) => act2(r, base, pose("cheer"), Math.max(0, envelope2(t, 0.6, 0.12))),
    "bloom-showcase": (r, t, base) => act2(r, base, pose("cheer"), Math.max(0, envelope2(t, 0.6, 0.12)))
  };
  function walk(r, t, base, steps, size) {
    const limbs = pose("stand");
    const p = t * steps * 0.5;
    const stride = wave2(p) * 12 * size;
    limbs.legs.left.foot = { x: -22 + stride, y: 86 - Math.max(0, wave2(p)) * 10 * size };
    limbs.legs.right.foot = { x: 22 - stride, y: 86 - Math.max(0, -wave2(p)) * 10 * size };
    limbs.legs.left.bend = -0.25 - Math.max(0, wave2(p)) * 0.4;
    limbs.legs.right.bend = 0.25 + Math.max(0, -wave2(p)) * 0.4;
    limbs.arms.left = {
      ...limbs.arms.left,
      hand: { x: -62 - stride * 0.9, y: 36 - Math.max(0, -wave2(p)) * 14 * size },
      bend: -0.35,
      shape: "fist",
      morph: 1
    };
    limbs.arms.right = {
      ...limbs.arms.right,
      hand: { x: 62 - stride * 0.9, y: 36 - Math.max(0, wave2(p)) * 14 * size },
      bend: 0.35,
      shape: "fist",
      morph: 1
    };
    act2(r, base, limbs, envelope2(t, 0.1, 0.12));
  }
  function holdBalloon(r, t, base) {
    const balloon = findProp(r, "balloon");
    const limbs = pose("hips");
    if (balloon) {
      const side = balloon.x < 0 ? "left" : "right";
      const sign = side === "left" ? -1 : 1;
      limbs.arms[side] = {
        ...limbs.arms[side],
        shoulderDeg: side === "left" ? 255 : 105,
        hand: {
          x: sign * Math.max(56, Math.abs(balloon.x) + 6),
          y: Math.min(14, Math.max(-24, balloon.y + 34))
        },
        bend: sign * -0.35,
        shape: "fist",
        handRotation: 0
      };
    }
    act2(r, base, limbs, envelope2(t, 0.1, 0.1));
  }
  function withLimbActing(sequence) {
    const director = DIRECTORS[sequence.id];
    if (!director) return sequence;
    return {
      ...sequence,
      pose: (base, t, anchor) => {
        const r = sequence.pose(base, t, anchor);
        director(r, t, base);
        return r;
      }
    };
  }

  // packages/animation-engine/src/sequences.ts
  var TAU3 = Math.PI * 2;
  var wave3 = (p, phase = 0) => Math.sin((p + phase) * TAU3);
  var bump = (t) => Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
  var land = (t) => t <= 0 || t >= 1 ? 0 : Math.sin(Math.PI * t);
  var turns = (t, whole) => whole * 360 * t % 360;
  var swell = (t, from, to) => t <= from || t >= to ? 0 : Math.sin(Math.PI * ((t - from) / (to - from)));
  var ease3 = (t) => {
    const c = Math.min(1, Math.max(0, t));
    return c * c * (3 - 2 * c);
  };
  var clamp014 = (t) => Math.min(1, Math.max(0, t));
  var overshoot3 = (t, s = 1.9) => {
    const c = clamp014(t) - 1;
    return 1 + c * c * ((s + 1) * c + s);
  };
  var settle = (t, cycles = 2.5, decay = 4.5) => t <= 0 || t >= 1 ? 0 : Math.sin(t * cycles * TAU3) * Math.exp(-decay * t) * (1 - t);
  function hoseBounce(p) {
    const ph = (p % 1 + 1) % 1;
    const lift = Math.sin(ph * Math.PI);
    const edge2 = Math.min(ph, 1 - ph);
    const squash = Math.max(0, 1 - edge2 / 0.14) ** 2;
    const stretch = Math.abs(Math.cos(ph * Math.PI)) * (1 - squash);
    return { lift, squash, stretch };
  }
  function rubberRays(r, p, amount) {
    for (const [i, ray] of r.rays.entries()) {
      const phase = i / r.rays.length;
      ray.rotation += wave3(p, -phase) * 7 * amount;
      ray.lengthScale *= 1 + wave3(p, 0.25 - phase) * 0.09 * amount;
      ray.widthScale *= 1 - wave3(p, 0.25 - phase) * 0.05 * amount;
    }
  }
  function eyes(r, f) {
    f(r.eyes.left);
    f(r.eyes.right);
  }
  function prop(id, x, y, scale, rotation = 0) {
    return { id, x, y, rotation, scale, opacity: 1 };
  }
  var idle = {
    id: "idle-breathe",
    group: "idle",
    priority: PRIORITY.idle,
    duration: 6e3,
    canInterrupt: true,
    loop: true,
    intensity: "minimal",
    assets: [],
    reducedMotionFallback: "idle-still",
    states: ["idle", "relaxing"],
    pose: (base, t) => {
      const r = cloneRig(base);
      const b = hoseBounce(t * 6);
      r.y = base.y - b.lift * 3.2;
      r.squash = b.squash * 0.07 - b.stretch * 0.025;
      r.stretch = b.stretch * 0.035 - b.squash * 0.04;
      r.faceTilt = wave3(t * 3, -0.12) * 2.6;
      rubberRays(r, t * 6 - 0.15, 0.7);
      const phase = t * 4 % 1;
      const hold = ease3(Math.min(1, phase * 3));
      const targets = [
        [0, 0],
        [0.55, 0.15],
        [-0.4, 0.3],
        [-0.15, -0.2]
      ];
      const from = targets[Math.floor(t * 4) % targets.length];
      const to = targets[(Math.floor(t * 4) + 1) % targets.length];
      r.eyes.left.gaze = {
        x: from[0] + (to[0] - from[0]) * hold,
        y: from[1] + (to[1] - from[1]) * hold
      };
      r.eyes.right.gaze = { ...r.eyes.left.gaze };
      r.brows.left.y = base.brows.left.y - b.lift * 0.9;
      r.brows.right.y = base.brows.right.y - b.lift * 0.9;
      return r;
    }
  };
  var idleStill = {
    id: "idle-still",
    group: "idle",
    priority: PRIORITY.idle,
    duration: 1,
    canInterrupt: true,
    loop: true,
    intensity: "off",
    assets: [],
    reducedMotionFallback: null,
    states: ["idle", "relaxing"],
    pose: (base) => cloneRig(base)
  };
  var blink = {
    id: "blink",
    group: "blink",
    priority: PRIORITY.idle + 20,
    duration: 160,
    canInterrupt: true,
    loop: false,
    intensity: "minimal",
    assets: [],
    reducedMotionFallback: null,
    states: [
      "idle",
      "listening",
      "thinking",
      "speaking",
      "guiding",
      "celebrating",
      "confused",
      "relaxing",
      "playing",
      "error"
    ],
    layer: "eyelids",
    pose: (base, t) => {
      const r = cloneRig(base);
      const close = t < 0.35 ? ease3(t / 0.35) : 1 - ease3((t - 0.35) / 0.65);
      r.eyes.left.closed = close;
      r.eyes.right.closed = close;
      return r;
    }
  };
  var listening = {
    id: "listening-perk",
    group: "listen",
    priority: PRIORITY.interaction,
    // Long enough to read as a wave hello (three flaps), not a twitch.
    duration: 1400,
    canInterrupt: true,
    loop: false,
    intensity: "balanced",
    assets: [],
    reducedMotionFallback: null,
    states: ["listening"],
    pose: (base, t) => {
      const r = cloneRig(base);
      const dip = t < 0.18 ? Math.sin(t / 0.18 * Math.PI * 0.5) * (1 - t / 0.18) * 1.6 : 0;
      const pop = t < 0.18 ? 0 : overshoot3((t - 0.18) / 0.35) * (1 - ease3((t - 0.5) / 0.5));
      const wob = settle(t, 2, 3);
      r.y = base.y + dip * 3 - pop * 5;
      r.squash = dip * 0.12 - pop * 0.06 + wob * 0.04;
      r.stretch = pop * 0.08 - dip * 0.06;
      eyes(r, (eye2) => {
        eye2.scaleY = 1 + pop * 0.32 - dip * 0.25;
        eye2.scaleX = 1 + pop * 0.1;
      });
      r.brows.left.y = base.brows.left.y - pop * 4;
      r.brows.right.y = base.brows.right.y - pop * 4;
      for (const [i, ray] of r.rays.entries()) {
        ray.lengthScale = 1 + pop * 0.14 - dip * 0.12 + settle(clamp014(t - i * 0.02), 2, 3) * 0.08;
      }
      r.smile.depth = base.smile.depth * (1 + pop * 0.3);
      return r;
    }
  };
  var listeningStill = {
    id: "listening-still",
    group: "listen",
    priority: PRIORITY.interaction,
    duration: 700,
    canInterrupt: true,
    loop: false,
    intensity: "minimal",
    assets: [],
    reducedMotionFallback: null,
    states: ["listening"],
    pose: (base, t) => {
      const r = cloneRig(base);
      const a = bump(t);
      r.eyes.left.scaleY = 1 + a * 0.12;
      r.eyes.right.scaleY = 1 + a * 0.12;
      return r;
    }
  };
  var thinking = {
    id: "thinking-whirr",
    group: "think",
    priority: PRIORITY.chat,
    duration: 2400,
    canInterrupt: true,
    loop: true,
    intensity: "balanced",
    assets: [],
    reducedMotionFallback: "thinking-still",
    states: ["thinking"],
    pose: (base, t) => {
      const r = cloneRig(base);
      const beat = t * 4;
      const k = Math.floor(beat);
      const f = beat - k;
      const dir = k % 2 === 0 ? 1 : -1;
      const tick = dir * (overshoot3(f / 0.45) * 2 - 1);
      for (const [i, ray] of r.rays.entries()) {
        ray.rotation = tick * 9;
        ray.lengthScale = 1 + wave3(t * 2, -i / r.rays.length) * 0.07;
      }
      r.rotation = tick * 2.2;
      r.faceTilt = -tick * 3 + wave3(t) * 2;
      r.y = base.y - Math.abs(Math.sin(beat * Math.PI)) * 1.4;
      const up = 0.68 + wave3(t * 0.5) * 0.12;
      eyes(r, (eye2) => {
        eye2.gaze = { x: -up * 0.6, y: -up };
        eye2.scaleY = 0.86;
      });
      r.brows.left.y = base.brows.left.y - 3;
      r.brows.left.rotation = base.brows.left.rotation - 6;
      r.brows.right.y = base.brows.right.y + 1.2;
      r.smile.span = base.smile.span * 0.6;
      r.smile.depth = base.smile.depth * 0.45;
      r.smile.rotation = base.smile.rotation + 6;
      return r;
    }
  };
  var thinkingStill = {
    id: "thinking-still",
    group: "think",
    priority: PRIORITY.chat,
    duration: 2400,
    canInterrupt: true,
    loop: true,
    intensity: "minimal",
    assets: [],
    reducedMotionFallback: null,
    states: ["thinking"],
    pose: (base) => {
      const r = cloneRig(base);
      r.eyes.left.gaze = { x: -0.35, y: -0.55 };
      r.eyes.right.gaze = { x: -0.35, y: -0.55 };
      r.smile.span = base.smile.span * 0.7;
      r.smile.depth = base.smile.depth * 0.6;
      return r;
    }
  };
  var eureka = {
    id: "thinking-eureka",
    group: "eureka",
    priority: PRIORITY.chat + 20,
    duration: 1500,
    canInterrupt: true,
    loop: false,
    intensity: "balanced",
    assets: ["question-mark", "sparkle", "lightbulb"],
    // The eureka has a still of its own. Pointing at the celebration's was a
    // copy-paste that would have shown a reduced-motion visitor a different
    // moment from the one they asked for.
    reducedMotionFallback: "eureka-still",
    // `celebrating` is deliberately absent. It was there, and it meant a eureka
    // still in flight outranked the celebration that arrived while it played --
    // a real success being buried, which is the failure the celebration tests
    // exist to prevent. An idea landing and a job well done are different beats.
    states: ["thinking", "speaking"],
    pose: (base, t) => {
      const r = cloneRig(base);
      const flare = t < 0.45 ? 0 : ease3((t - 0.45) / 0.55);
      const hold = t < 0.45 ? bump(t / 0.45) : 1;
      r.props = [
        {
          id: "question-mark",
          x: -34,
          y: -30 - wave3(t * 1.5) * 2,
          rotation: -12 + wave3(t) * 4,
          scale: 0.5 + hold * 0.5,
          // Fades out as the flare takes over.
          opacity: Math.max(0, 1 - flare * 1.6)
        },
        {
          // The idea arrives as a lightbulb over her head, as in the pose sheet,
          // popping in on an overshoot.
          id: "lightbulb",
          x: 30,
          y: -62 - flare * 4,
          rotation: 12 - flare * 12,
          scale: flare > 0 ? 0.8 + (1 - Math.cos(Math.min(1, flare * 1.4) * Math.PI)) * 0.55 : 0,
          opacity: flare > 0 ? Math.min(1, flare * 2) * (t > 0.9 ? (1 - t) / 0.1 : 1) : 0
        },
        {
          id: "sparkle",
          x: 46,
          y: -64,
          rotation: flare * 90,
          scale: 0.3 + flare * 0.6,
          opacity: flare > 0 ? Math.min(1, flare * 1.4) * (t > 0.9 ? (1 - t) / 0.1 : 1) : 0
        }
      ];
      for (const ray of r.rays) {
        ray.lengthScale = 1 + flare * 0.16;
        ray.widthScale = 1 - flare * 0.1;
      }
      r.y = base.y - bump(Math.min(1, Math.max(0, (t - 0.45) / 0.55))) * 3;
      r.squash = -flare * 0.05;
      r.stretch = flare * 0.05;
      r.eyes.left.scaleY = 1 + flare * 0.2;
      r.eyes.right.scaleY = 1 + flare * 0.2;
      r.smile.span = base.smile.span * (0.7 + flare * 0.45);
      r.smile.depth = base.smile.depth * (0.6 + flare * 0.6);
      r.brows.left.y = base.brows.left.y - flare * 3;
      r.brows.right.y = base.brows.right.y - flare * 3;
      return r;
    }
  };
  var eurekaStill = {
    id: "eureka-still",
    group: "eureka",
    // Matches the full eureka: a floor is about how much motion a tenant allows,
    // and both variants are the same moment. Left below it, a tenant who turned
    // the dial down would lose the eureka to the ambient layer instead of seeing
    // a still one.
    priority: PRIORITY.chat + 20,
    duration: 1100,
    canInterrupt: true,
    loop: false,
    intensity: "minimal",
    assets: ["sparkle"],
    reducedMotionFallback: null,
    states: ["thinking", "speaking"],
    pose: (base, t) => {
      const r = cloneRig(base);
      const a = bump(t);
      r.smile.depth = base.smile.depth * (1 + a * 0.35);
      r.props = [
        { id: "sparkle", x: 34, y: -34, rotation: a * 30, scale: 0.4 + a * 0.3, opacity: a }
      ];
      return r;
    }
  };
  var speaking = {
    id: "speaking-pulse",
    group: "speak",
    priority: PRIORITY.chat,
    duration: 900,
    canInterrupt: true,
    loop: true,
    intensity: "minimal",
    assets: [],
    reducedMotionFallback: "speaking-still",
    states: ["speaking"],
    pose: (base, t) => {
      const r = cloneRig(base);
      const syl = hoseBounce(t * 2);
      const open2 = Math.sin(t * 2 % 1 * Math.PI);
      r.smile.depth = base.smile.depth * (1 + open2 * 0.55);
      r.smile.span = base.smile.span * (1 - open2 * 0.08);
      r.smile.y = base.smile.y + open2 * 0.9;
      r.brows.left.y = base.brows.left.y - open2 * 2.2;
      r.brows.right.y = base.brows.right.y - open2 * 2.2;
      r.y = base.y - syl.lift * 1.8;
      r.squash = syl.squash * 0.05;
      r.stretch = syl.stretch * 0.02;
      r.faceTilt = wave3(t, 0.1) * 2;
      rubberRays(r, t * 2 - 0.2, 0.45);
      return r;
    }
  };
  var speakingStill = {
    id: "speaking-still",
    group: "speak",
    priority: PRIORITY.chat,
    duration: 900,
    canInterrupt: true,
    loop: true,
    intensity: "off",
    assets: [],
    reducedMotionFallback: null,
    states: ["speaking"],
    pose: (base) => cloneRig(base)
  };
  var guiding = {
    id: "guiding-point",
    group: "guide",
    priority: PRIORITY.chat,
    duration: 1200,
    canInterrupt: true,
    loop: true,
    intensity: "balanced",
    assets: [],
    reducedMotionFallback: "guiding-still",
    states: ["guiding"],
    pose: (base, t) => {
      const r = cloneRig(base);
      const lean = 9;
      r.faceTilt = lean + wave3(t) * 1.4;
      r.rotation = lean * 0.4;
      const arm2 = r.rays[2];
      if (arm2) {
        arm2.lengthScale = 1.35;
        arm2.widthScale = 1.5;
        arm2.rotation = 8;
        arm2.offset = { x: 6, y: 0 };
      }
      r.eyes.left.gaze = { x: 0.75, y: 0.25 };
      r.eyes.right.gaze = { x: 0.75, y: 0.25 };
      r.brows.left.rotation = -30;
      return r;
    }
  };
  var guidingStill = {
    id: "guiding-still",
    group: "guide",
    priority: PRIORITY.chat,
    duration: 1200,
    canInterrupt: true,
    loop: true,
    intensity: "off",
    assets: [],
    reducedMotionFallback: null,
    states: ["guiding"],
    pose: (base) => {
      const r = cloneRig(base);
      r.faceTilt = 8;
      r.eyes.left.gaze = { x: 0.6, y: 0.2 };
      r.eyes.right.gaze = { x: 0.6, y: 0.2 };
      return r;
    }
  };
  var celebrate = {
    id: "celebrate-spin",
    group: "celebrate",
    priority: PRIORITY.success,
    duration: 1600,
    canInterrupt: true,
    loop: false,
    intensity: "playful",
    assets: ["sparkle"],
    reducedMotionFallback: "celebrate-still",
    states: ["celebrating", "speaking", "idle"],
    pose: (base, t) => {
      const r = cloneRig(base);
      const a = bump(t);
      r.rotation = ease3(Math.min(1, t / 0.8)) * 720;
      r.y = base.y - a * 7;
      r.squash = -a * 0.06;
      r.stretch = a * 0.06;
      r.smile.span = base.smile.span * (1 + a * 0.25);
      r.smile.depth = base.smile.depth * (1 + a * 0.35);
      r.eyes.left.scaleY = 1 - a * 0.3;
      r.eyes.right.scaleY = 1 - a * 0.3;
      r.props = [
        prop("sparkle", -40, -32, 0.5 + a * 0.8, a * 140),
        prop("sparkle", 42, -18, 0.5 + a * 0.8, -a * 140)
      ];
      for (const [i, ray] of r.rays.entries()) {
        ray.lengthScale = 1 + a * 0.2 * (i % 2 === 0 ? 1 : -0.5);
        ray.rotation = a * 40;
      }
      return r;
    }
  };
  var celebrateBounce = {
    id: "celebrate-bounce",
    group: "celebrate",
    priority: PRIORITY.success,
    duration: 1400,
    canInterrupt: true,
    loop: false,
    intensity: "balanced",
    assets: ["sparkle"],
    reducedMotionFallback: "celebrate-still",
    states: ["celebrating", "speaking", "idle"],
    pose: (base, t) => {
      const r = cloneRig(base);
      const hop = (from, to, height) => t <= from || t >= to ? 0 : Math.sin((t - from) / (to - from) * Math.PI) * height;
      const speed = (from, to) => t <= from || t >= to ? 0 : Math.abs(Math.cos((t - from) / (to - from) * Math.PI));
      const crouch = swell(t, 0, 0.14) + swell(t, 0.5, 0.6) * 0.8 + swell(t, 0.86, 0.96) * 0.6;
      const air = hop(0.12, 0.52, 9.5) + hop(0.58, 0.88, 6);
      const rising = speed(0.12, 0.52) + speed(0.58, 0.88);
      r.y = base.y - air + crouch * 4;
      r.squash = crouch * 0.18 - rising * 0.06;
      r.stretch = rising * 0.12 - crouch * 0.1;
      r.rotation = wave3(clamp014((t - 0.12) / 0.76)) * 8 * (1 - t);
      const joy = Math.min(1, air / 6);
      for (const [i, ray] of r.rays.entries()) {
        ray.lengthScale = 1 + joy * 0.22 - crouch * 0.15 + settle(clamp014(t - i * 0.015), 3, 4) * 0.06;
        ray.rotation = wave3(t * 2, -i / 8) * 8 * joy;
      }
      const a = bump(t);
      r.smile.span = base.smile.span * (1 + a * 0.22);
      r.smile.depth = base.smile.depth * (1 + a * 0.6);
      eyes(r, (eye2) => {
        eye2.scaleY = 1 - joy * 0.45 + crouch * 0.1;
      });
      r.brows.left.y = base.brows.left.y - a * 5;
      r.brows.right.y = base.brows.right.y - a * 5;
      r.props = [
        {
          id: "sparkle",
          x: -40,
          y: -34 - joy * 6,
          rotation: a * 180,
          scale: 0.3 + a * 0.8,
          opacity: a
        },
        {
          id: "sparkle",
          x: 42,
          y: -24 - joy * 6,
          rotation: -a * 180,
          scale: 0.3 + a * 0.7,
          opacity: a
        }
      ];
      return r;
    }
  };
  var celebrateStill = {
    id: "celebrate-still",
    group: "celebrate",
    priority: PRIORITY.success,
    duration: 900,
    canInterrupt: true,
    loop: false,
    intensity: "minimal",
    assets: [],
    reducedMotionFallback: null,
    states: ["celebrating", "speaking", "idle"],
    pose: (base, t) => {
      const r = cloneRig(base);
      const a = bump(t);
      r.smile.span = base.smile.span * (1 + a * 0.25);
      r.smile.depth = base.smile.depth * (1 + a * 0.3);
      r.eyes.left.scaleY = 1 - a * 0.25;
      r.eyes.right.scaleY = 1 - a * 0.25;
      return r;
    }
  };
  var confused = {
    id: "confused-tilt",
    group: "confused",
    priority: PRIORITY.accessibility,
    duration: 1400,
    canInterrupt: true,
    loop: false,
    intensity: "balanced",
    assets: ["question-mark"],
    reducedMotionFallback: "confused-still",
    states: ["confused"],
    pose: (base, t) => {
      const r = cloneRig(base);
      const shake = t < 0.22 ? Math.sin(t / 0.22 * TAU3 * 2) * (1 - t / 0.22) : 0;
      const tilt = t < 0.2 ? 0 : overshoot3((t - 0.2) / 0.3) * (1 - ease3((t - 0.75) / 0.25));
      const shrug = swell(t, 0.3, 0.75);
      r.faceTilt = -16 * tilt + shake * 8 + settle(t, 2, 3) * 4;
      r.rotation = -5 * tilt;
      r.y = base.y - shrug * 3;
      r.squash = -shrug * 0.03;
      r.stretch = shrug * 0.04;
      r.eyes.left.scaleY = 1 - tilt * 0.2;
      r.eyes.right.scaleY = 1 + tilt * 0.3;
      r.brows.left.y = base.brows.left.y - tilt * 6;
      r.brows.left.rotation = base.brows.left.rotation + tilt * 12;
      r.brows.right.y = base.brows.right.y + tilt * 3;
      r.smile.depth = base.smile.depth * (1 - tilt * 1.4);
      r.smile.rotation = base.smile.rotation + tilt * 10;
      for (const [i, ray] of r.rays.entries()) {
        const side = i === 2 || i === 6 ? 1 : i % 2 === 1 ? 0.5 : 0;
        ray.rotation = (i < 4 ? -1 : 1) * side * shrug * 14;
        ray.lengthScale = 1 + side * shrug * 0.1;
      }
      const a = bump(t);
      r.props = [
        {
          id: "question-mark",
          x: 36,
          y: -36 - Math.abs(Math.sin(t * TAU3 * 1.5)) * 3,
          rotation: 14 + wave3(t * 1.5) * 8,
          scale: 0.5 + overshoot3(clamp014(t / 0.35)) * 0.45 * a,
          opacity: Math.min(1, a * 1.4)
        }
      ];
      return r;
    }
  };
  var confusedStill = {
    id: "confused-still",
    group: "confused",
    priority: PRIORITY.accessibility,
    duration: 1e3,
    canInterrupt: true,
    loop: false,
    intensity: "minimal",
    assets: [],
    reducedMotionFallback: null,
    states: ["confused"],
    pose: (base, t) => {
      const r = cloneRig(base);
      const a = bump(t);
      r.faceTilt = -10 * a;
      r.rotation = -2 * a;
      r.brows.left.y = base.brows.left.y - 4 * a;
      r.brows.right.y = base.brows.right.y + 2 * a;
      r.smile.depth = base.smile.depth * (1 - a * 0.5);
      return r;
    }
  };
  var error = {
    id: "error-deflate",
    group: "error",
    priority: PRIORITY.accessibility,
    duration: 1200,
    canInterrupt: true,
    loop: false,
    intensity: "balanced",
    assets: ["sweat-drop"],
    reducedMotionFallback: "error-still",
    states: ["error"],
    pose: (base, t) => {
      const r = cloneRig(base);
      const sag = t < 0.55 ? ease3(t / 0.4) : (1 - overshoot3((t - 0.55) / 0.45)) * (1 - t);
      for (const [i, ray] of r.rays.entries()) {
        const angle = (ray.angleDeg + 360) % 360;
        const towardDown = angle < 180 ? 1 : -1;
        ray.rotation = towardDown * sag * 22 * Math.sin(angle * Math.PI / 180) ** 2;
        ray.lengthScale = 1 - sag * 0.28 + settle(clamp014((t - 0.55) / 0.45 - i * 0.01), 2, 4) * 0.1;
        ray.widthScale = 1 - sag * 0.15;
      }
      r.squash = sag * 0.16;
      r.stretch = -sag * 0.1;
      r.y = base.y + sag * 5;
      r.smile.depth = base.smile.depth * (1 - sag * 1.5);
      eyes(r, (eye2) => {
        eye2.scaleY = 1 - sag * 0.4;
        eye2.gaze = { x: 0, y: sag * 0.6 };
      });
      r.brows.left.y = base.brows.left.y + sag * 4;
      r.brows.right.y = base.brows.right.y + sag * 4;
      r.brows.left.rotation = base.brows.left.rotation + sag * 14;
      r.brows.right.rotation = base.brows.right.rotation - sag * 14;
      const a = bump(t);
      r.props = [{ id: "sweat-drop", x: 28, y: -32 + t * 14, rotation: 0, scale: 0.6, opacity: a }];
      return r;
    }
  };
  var errorStill = {
    id: "error-still",
    group: "error",
    priority: PRIORITY.accessibility,
    duration: 800,
    canInterrupt: true,
    loop: false,
    // `minimal`, not `off`, and the distinction is the whole rule: `off` is for a
    // variant that holds one pose, and this one animates. It also serves as
    // `error-deflate`'s reduced-motion fallback, which is what makes the fade the
    // right choice -- an opacity change is motion a reduced-motion viewer can
    // accept, and it is the only way the deflation can arrive without a jump.
    intensity: "minimal",
    assets: [],
    reducedMotionFallback: null,
    states: ["error"],
    pose: (base, t) => {
      const a = bump(t);
      const r = cloneRig(base);
      for (const ray of r.rays) ray.lengthScale = 1 - a * 0.1;
      r.smile.depth = base.smile.depth * (1 - a * 0.7);
      return r;
    }
  };
  var coolShades = {
    id: "cool-shades",
    group: "cool",
    priority: PRIORITY.success,
    duration: 2400,
    canInterrupt: true,
    loop: false,
    intensity: "balanced",
    assets: ["sunglasses"],
    reducedMotionFallback: "cool-still",
    states: ["celebrating", "idle", "speaking"],
    pose: (base, t) => {
      return shadesPose(base, t, false);
    }
  };
  var coolShadesPlay = {
    id: "cool-shades-play",
    group: "cool",
    priority: PRIORITY.success,
    duration: 2600,
    canInterrupt: true,
    loop: false,
    intensity: "playful",
    assets: ["sunglasses", "sparkle"],
    reducedMotionFallback: "cool-still",
    states: ["celebrating", "idle", "speaking"],
    pose: (base, t) => {
      return shadesPose(base, t, true);
    }
  };
  var coolShadesStill = {
    id: "cool-still",
    group: "cool",
    priority: PRIORITY.success,
    duration: 1600,
    canInterrupt: true,
    loop: false,
    // Deliberately `minimal` and not `off`. The lenses fade, and a fade is motion;
    // `off` is reserved for the variants that hold one pose, so that a visitor who
    // has asked for no animation gets a character that genuinely does not move.
    intensity: "minimal",
    assets: ["sunglasses"],
    reducedMotionFallback: null,
    states: ["celebrating", "idle", "speaking"],
    pose: (base, t) => {
      const r = cloneRig(base);
      const a = bump(t);
      r.faceTilt = 0;
      r.props = [{ id: "sunglasses", x: -1.4, y: -5.1, rotation: -3, scale: 1, opacity: a }];
      return r;
    }
  };
  var charging = {
    id: "charging-panel",
    group: "charge",
    priority: PRIORITY.chat,
    duration: 2600,
    canInterrupt: true,
    loop: false,
    intensity: "balanced",
    assets: ["battery", "sparkle"],
    reducedMotionFallback: "charging-still",
    states: ["guiding", "speaking", "idle"],
    pose: (base, t) => {
      const r = cloneRig(base);
      const charge = ease3(Math.min(1, t / 0.85));
      for (const [i, ray] of r.rays.entries()) {
        const pulse = Math.max(0, wave3(t * 2.5, -i / r.rays.length));
        ray.lengthScale = 1 + pulse * 0.22;
        ray.widthScale = 1 - pulse * 0.12;
      }
      r.y = base.y - charge * 1.5;
      r.eyes.left.gaze = { x: 0.4, y: 0.35 };
      r.eyes.right.gaze = { x: 0.4, y: 0.35 };
      r.smile.depth = base.smile.depth * (1 + charge * 0.2);
      r.props = [
        { id: "battery", x: 38, y: 22, rotation: 0, scale: 1.1, opacity: 1 },
        {
          id: "sparkle",
          x: 30,
          y: 22,
          rotation: charge * 120,
          scale: 0.35 * (1 - charge),
          opacity: Math.max(0, 1 - charge * 1.5)
        }
      ];
      return r;
    }
  };
  var chargingStill = {
    id: "charging-still",
    group: "charge",
    priority: PRIORITY.chat,
    duration: 1400,
    canInterrupt: true,
    loop: false,
    intensity: "minimal",
    assets: ["battery"],
    reducedMotionFallback: null,
    states: ["guiding", "speaking", "idle"],
    pose: (base, t) => {
      const r = cloneRig(base);
      const a = bump(t);
      r.props = [{ id: "battery", x: 38, y: 22, rotation: 0, scale: 1.1, opacity: a }];
      return r;
    }
  };
  var bubbleOpen = {
    id: "bubble-open",
    group: "open",
    priority: PRIORITY.interaction,
    duration: 420,
    canInterrupt: false,
    loop: false,
    intensity: "balanced",
    assets: [],
    reducedMotionFallback: null,
    states: ["idle", "listening"],
    pose: (base, t) => {
      const r = cloneRig(base);
      const crouch = t < 0.3 ? Math.sin(t / 0.3 * Math.PI * 0.5) : Math.max(0, 1 - ease3((t - 0.3) / 0.12));
      const launch = swell(t, 0.3, 0.75);
      const wob = t < 0.6 ? 0 : settle((t - 0.6) / 0.4, 1.5, 3);
      r.squash = crouch * 0.22 - launch * 0.08 + wob * 0.06;
      r.stretch = launch * 0.16 - crouch * 0.12 - wob * 0.04;
      r.y = base.y + crouch * 6 - launch * 7;
      for (const [i, ray] of r.rays.entries()) {
        ray.lengthScale = 1 - crouch * 0.3 + launch * 0.25 + settle(clamp014((t - 0.55) / 0.45 - i * 0.02), 2, 4) * 0.08;
      }
      eyes(r, (eye2) => {
        eye2.scaleY = 1 - crouch * 0.5 + launch * 0.25;
      });
      r.smile.depth = base.smile.depth * (1 + launch * 0.5);
      return r;
    }
  };
  var bubbleOpenStill = {
    id: "open-still",
    group: "open",
    priority: PRIORITY.interaction,
    duration: 260,
    canInterrupt: false,
    loop: false,
    intensity: "minimal",
    assets: [],
    reducedMotionFallback: null,
    states: ["idle", "listening"],
    pose: (base, t) => {
      const r = cloneRig(base);
      const a = bump(t);
      r.squash = a * 0.06;
      r.stretch = a * 0.04;
      return r;
    }
  };
  var playStill = {
    id: "play-still",
    group: "play",
    priority: PRIORITY.play,
    duration: 1,
    canInterrupt: true,
    loop: true,
    intensity: "off",
    assets: [],
    reducedMotionFallback: null,
    states: ["playing"],
    pose: (base) => cloneRig(base)
  };
  var playShuffle = {
    id: "play-shuffle",
    group: "play",
    priority: PRIORITY.play,
    duration: 900,
    canInterrupt: true,
    loop: false,
    intensity: "minimal",
    assets: [],
    reducedMotionFallback: "play-still",
    states: ["playing"],
    pose: (base, t) => {
      const r = cloneRig(base);
      const env = bump(t);
      const step2 = Math.floor(t * 2) % 2 === 0 ? 1 : -1;
      const hop = bump(t * 2 % 1) * env;
      r.x = base.x + step2 * hop * 5;
      r.y = base.y - hop * 3.5;
      r.squash = -hop * 0.05;
      r.stretch = hop * 0.04;
      r.faceTilt = step2 * hop * 5;
      r.smile.depth = base.smile.depth * (1 + hop * 0.18);
      r.eyes.left.gaze = { x: step2 * hop * 0.45, y: 0.1 };
      r.eyes.right.gaze = { ...r.eyes.left.gaze };
      for (const ray of r.rays) ray.rotation = step2 * hop * 5;
      return r;
    }
  };
  var playRun = {
    id: "play-run",
    group: "play",
    priority: PRIORITY.play,
    duration: 1100,
    canInterrupt: true,
    loop: false,
    intensity: "balanced",
    assets: [],
    reducedMotionFallback: "play-still",
    states: ["playing"],
    pose: (base, t) => {
      const r = cloneRig(base);
      const env = bump(t);
      const stride = Math.abs(wave3(t * 2)) * env;
      const sway = wave3(t, 0.25) * env;
      r.rotation = env * 7 + stride * 2;
      r.x = base.x + sway * 2;
      r.y = base.y - stride * 4.5;
      r.squash = (0.09 - stride * 0.14) * env;
      r.stretch = (stride * 0.08 - 0.06) * env;
      r.faceTilt = env * 1.5;
      for (const side of ["left", "right"]) {
        r.brows[side].y = base.brows[side].y + env * 1.4;
        r.brows[side].arch = base.brows[side].arch * (1 - env * 0.5);
        r.eyes[side].scaleY = 1 - env * 0.3;
        r.eyes[side].gaze = { x: env * 0.45, y: -env * 0.05 };
      }
      r.smile.span = base.smile.span * (1 + env * 0.12);
      r.smile.depth = base.smile.depth * (1 + env * 0.25);
      for (const ray of r.rays) {
        ray.offset = { x: -(2 + stride * 1.5) * env, y: 0 };
        ray.lengthScale = 1 - env * 0.1;
        ray.rotation = -env * 5;
      }
      return r;
    }
  };
  var playDance = {
    id: "play-dance",
    group: "play",
    priority: PRIORITY.play,
    duration: 1300,
    canInterrupt: true,
    loop: false,
    intensity: "playful",
    assets: ["sparkle"],
    reducedMotionFallback: "play-still",
    states: ["playing"],
    pose: (base, t) => {
      const r = cloneRig(base);
      const env = bump(t);
      const rock = wave3(t * 1.5) * env;
      const swing = Math.abs(rock);
      r.rotation = rock * 11;
      r.x = base.x + rock * 4.5;
      r.y = base.y - Math.abs(wave3(t * 1.5, 0.25)) * 4 * env;
      r.squash = -swing * 0.04;
      r.stretch = swing * 0.05;
      r.faceTilt = -rock * 6;
      r.smile.span = base.smile.span * (1 + env * 0.3);
      r.smile.depth = base.smile.depth * (1 + env * 0.45);
      for (const side of ["left", "right"]) {
        r.eyes[side].scaleY = 1 - swing * 0.35;
        r.eyes[side].gaze = { x: rock * 0.3, y: 0 };
      }
      for (const [i, ray] of r.rays.entries()) {
        ray.lengthScale = 1 + swing * 0.22 * (i % 2 === 0 ? 1 : -0.4);
        ray.rotation = rock * 9;
      }
      r.props = [
        {
          ...prop("sparkle", rock * 30 - 6, -30, 0.35 + swing * 0.5, rock * 80),
          // Faded by the size of the swing, so it is invisible at both ends of the
          // move and cannot be left on screen by a frame that lands mid-gesture.
          opacity: swing
        }
      ];
      return r;
    }
  };
  function gather(t, inBy, outFrom) {
    return Math.min(ease3(t / inBy), ease3((1 - t) / outFrom));
  }
  var arcadeTuck = {
    id: "arcade-tuck",
    group: "arcade",
    priority: PRIORITY.play,
    duration: 800,
    canInterrupt: true,
    loop: false,
    intensity: "minimal",
    assets: [],
    reducedMotionFallback: null,
    states: ["celebrating", "playing", "idle"],
    pose: (base, t) => {
      const r = cloneRig(base);
      const a = land(t);
      r.squash = base.squash + a * 0.07;
      r.stretch = base.stretch - a * 0.03;
      r.y = base.y - a * 1.5;
      r.smile.span = base.smile.span * (1 + a * 0.18);
      r.smile.depth = base.smile.depth * (1 + a * 0.28);
      r.eyes.left.scaleY = base.eyes.left.scaleY - a * 0.22;
      r.eyes.right.scaleY = base.eyes.right.scaleY - a * 0.22;
      r.rays.forEach((ray, i) => {
        ray.lengthScale = base.rays[i].lengthScale - a * 0.16;
      });
      return r;
    }
  };
  var arcadeRoll = {
    id: "arcade-roll",
    group: "arcade",
    priority: PRIORITY.play,
    duration: 1e3,
    canInterrupt: true,
    loop: false,
    intensity: "balanced",
    assets: [],
    reducedMotionFallback: "arcade-tuck",
    states: ["celebrating", "playing", "idle"],
    pose: (base, t) => {
      const r = cloneRig(base);
      const fold = gather(t, 0.2, 0.26);
      const a = land(t);
      r.rotation = base.rotation + turns(ease3((t - 0.14) / 0.62), 1);
      r.x = base.x + a * 2.5;
      r.y = base.y - a * 2;
      r.squash = base.squash + fold * 0.11;
      r.stretch = base.stretch - fold * 0.05;
      r.smile.span = base.smile.span * (1 + a * 0.22);
      r.smile.depth = base.smile.depth * (1 + a * 0.35);
      r.eyes.left.scaleY = base.eyes.left.scaleY - fold * 0.4;
      r.eyes.right.scaleY = base.eyes.right.scaleY - fold * 0.4;
      r.rays.forEach((ray, i) => {
        ray.lengthScale = base.rays[i].lengthScale - fold * 0.4;
        ray.rotation = base.rays[i].rotation + fold * 90;
      });
      return r;
    }
  };
  var arcadeSpin = {
    id: "arcade-spin",
    group: "arcade",
    priority: PRIORITY.play,
    duration: 1300,
    canInterrupt: true,
    loop: false,
    intensity: "playful",
    assets: [],
    reducedMotionFallback: "arcade-tuck",
    states: ["celebrating", "playing", "idle"],
    pose: (base, t) => {
      const r = cloneRig(base);
      const fold = gather(t, 0.16, 0.24);
      const a = land(t);
      const hop = a * Math.sin(Math.PI * Math.min(1, Math.max(0, (t - 0.15) / 0.7)));
      r.rotation = base.rotation + turns(ease3((t - 0.12) / 0.68), 2);
      r.y = base.y - hop * 4;
      r.squash = base.squash + (fold * 0.14 - hop * 0.05);
      r.stretch = base.stretch + (hop * 0.04 - fold * 0.06);
      r.faceTilt = base.faceTilt - fold * 3;
      r.smile.span = base.smile.span * (1 + a * 0.3);
      r.smile.depth = base.smile.depth * (1 + a * 0.45);
      r.eyes.left.scaleY = base.eyes.left.scaleY - fold * 0.45;
      r.eyes.right.scaleY = base.eyes.right.scaleY - fold * 0.45;
      const bloom = swell(t, 0.72, 1);
      r.rays.forEach((ray, i) => {
        ray.lengthScale = base.rays[i].lengthScale + (bloom * 0.18 - fold * 0.42);
        ray.rotation = base.rays[i].rotation + fold * 120;
      });
      return r;
    }
  };
  function relaxPose(base, t, extra) {
    const r = cloneRig(base);
    const seated = Math.min(ease3(t / 0.2), ease3((1 - t) / 0.12));
    const deployed = Math.min(ease3(t / 0.16), ease3((1 - t) / 0.08));
    const breath = wave3(t * 1.25) * seated;
    const stretch = bump((t - 0.7) / 0.18);
    const lean = seated * 16;
    r.rotation = base.rotation + lean;
    r.x = base.x + seated * 8;
    r.y = base.y + seated * 6 - breath * 0.8 - stretch * 1.4;
    r.faceTilt = base.faceTilt - seated * 4;
    r.smile.depth = base.smile.depth * (1 + seated * 0.35);
    r.smile.span = base.smile.span * (1 + seated * 0.08);
    for (const ray of r.rays) {
      ray.lengthScale = 1 - seated * 0.04 + breath * 0.04 + stretch * 0.12;
    }
    const relaxed2 = limbPose("recline");
    relaxed2.legs.left = {
      ...relaxed2.legs.left,
      foot: { x: -50, y: 78 },
      bend: -0.25,
      footRotation: -32
    };
    relaxed2.legs.right = {
      ...relaxed2.legs.right,
      foot: { x: -74, y: 62 },
      bend: 0.3,
      footRotation: -10
    };
    r.limbs = blendLimbs(base.limbs, relaxed2, seated * (1 - stretch * 0.5));
    const back = -r.rotation * Math.PI / 180;
    const dx = base.x - r.x;
    const dy = base.y - r.y;
    const props = [
      {
        id: "deckchair",
        x: dx * Math.cos(back) - dy * Math.sin(back),
        y: dx * Math.sin(back) + dy * Math.cos(back),
        rotation: -r.rotation + (1 - deployed) * 18,
        scale: 0.55 + 0.45 * deployed,
        opacity: deployed
      }
    ];
    if (extra.shades) {
      const on = Math.min(ease3((t - 0.18) / 0.1), ease3((0.84 - t) / 0.1));
      props.push({ ...SHADES_REST, y: SHADES_REST.y - 40 * (1 - on), opacity: on });
      const squint = on * 0.35;
      r.eyes.left.closed = squint;
      r.eyes.right.closed = squint;
    } else {
      const squint = seated * (1 - stretch) * 0.6;
      r.eyes.left.closed = squint;
      r.eyes.right.closed = squint;
    }
    if (extra.doze) {
      for (const [i, phase] of [0, 0.35].entries()) {
        const p = (t - 0.26 - phase) / 0.42;
        if (p <= 0 || p >= 1) continue;
        props.push({
          id: "sparkle",
          x: 14 + i * 10 + p * 8,
          y: -52 - p * 24,
          rotation: p * 140,
          scale: 0.42 + bump(p) * 0.22,
          opacity: bump(p) * 0.85 * seated
        });
      }
    }
    r.props = props;
    return r;
  }
  var SHADES_REST = {
    id: "sunglasses",
    x: 1.8,
    y: -5.4,
    rotation: -11.4,
    scale: 1,
    opacity: 1
  };
  function toFaceFrame(rig, p) {
    const a = -rig.faceTilt * Math.PI / 180;
    return { x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) };
  }
  function shadesPose(base, t, playful) {
    const r = cloneRig(base);
    const clamp3 = (v) => Math.min(1, Math.max(0, v));
    const reach = ease3(clamp3(t / 0.12));
    const bring = ease3(clamp3((t - 0.12) / 0.24));
    const landed = t >= 0.36;
    const land2 = landed ? Math.sin(clamp3((t - 0.36) / 0.18) * Math.PI * 2.5) * Math.exp(-clamp3((t - 0.36) / 0.18) * 4) * (1 - clamp3((t - 0.36) / 0.18)) : 0;
    const nudge = swell(t, 0.44, 0.54);
    const retract = ease3(clamp3((t - 0.56) / 0.14));
    const off = ease3(clamp3((t - 0.86) / 0.14));
    const pop = swell(t, 0, 0.12);
    const wearing = landed ? Math.min(1, (t - 0.36) / 0.1) * (1 - off) : 0;
    r.squash = pop * 0.06;
    r.stretch = -pop * 0.03;
    r.rotation = base.rotation - wearing * 3;
    r.y = base.y - wearing * 1.5 - (playful ? Math.abs(wave3(t * 4)) * 2 * wearing : 0);
    r.faceTilt = base.faceTilt + wearing * wave3(t * 2) * 2.5;
    const start2 = { x: 70, y: -96 };
    const temple = { x: 50, y: -14 };
    const hand = {
      x: start2.x + (temple.x - start2.x) * bring + Math.sin(bring * Math.PI) * 10,
      y: start2.y + (temple.y - start2.y) * bring
    };
    hand.y -= nudge * 3;
    const armPose = limbPose("rest");
    armPose.arms.right = {
      ...armPose.arms.right,
      hand,
      bend: -0.55,
      shape: "fist",
      handRotation: -100,
      front: true,
      morph: 1
    };
    r.limbs = blendLimbs(base.limbs, armPose, reach * (1 - retract));
    const carried = toFaceFrame(r, { x: hand.x - 48, y: hand.y + 8.6 });
    const worn = { x: SHADES_REST.x, y: SHADES_REST.y + land2 * 1.8 - nudge * 2.4 };
    const at = landed ? worn : carried;
    r.props = [
      {
        ...SHADES_REST,
        x: at.x,
        y: at.y - off * 46,
        rotation: (landed ? SHADES_REST.rotation : -38 + (SHADES_REST.rotation + 38) * bring) - off * 28,
        opacity: Math.min(clamp3(t / 0.06), 1 - off)
      }
    ];
    if (playful && landed) {
      const glint = swell(t, 0.36, 0.56);
      r.props.push({
        id: "sparkle",
        x: -20,
        y: -18,
        rotation: glint * 120,
        scale: 0.4 + glint * 0.6,
        opacity: glint
      });
    }
    const squint = wearing * 0.45;
    r.eyes.left.closed = squint;
    r.eyes.right.closed = squint;
    r.brows.left.y = base.brows.left.y - (nudge + wearing * 0.6) * 4;
    r.brows.left.rotation = base.brows.left.rotation - wearing * 8;
    r.smile.depth = base.smile.depth * (1 + wearing * 0.35);
    r.smile.rotation = base.smile.rotation - wearing * 4;
    return r;
  }
  var relaxStill = {
    id: "relax-still",
    group: "relax",
    priority: PRIORITY.idle + 40,
    duration: 1,
    canInterrupt: true,
    loop: true,
    intensity: "off",
    assets: [],
    reducedMotionFallback: null,
    states: ["relaxing"],
    pose: (base) => cloneRig(base)
  };
  var relaxSettle = {
    id: "relax-settle",
    group: "relax",
    priority: PRIORITY.idle + 40,
    duration: 6800,
    canInterrupt: true,
    loop: false,
    intensity: "minimal",
    assets: ["deckchair"],
    reducedMotionFallback: "relax-still",
    states: ["relaxing"],
    pose: (base, t) => relaxPose(base, t, { shades: false, doze: false })
  };
  var relaxSunbathe = {
    id: "relax-sunbathe",
    group: "relax",
    priority: PRIORITY.idle + 40,
    duration: 9200,
    canInterrupt: true,
    loop: false,
    intensity: "balanced",
    assets: ["deckchair", "sunglasses"],
    reducedMotionFallback: "relax-still",
    states: ["relaxing"],
    pose: (base, t) => relaxPose(base, t, { shades: true, doze: false })
  };
  var relaxDoze = {
    id: "relax-doze",
    group: "relax",
    priority: PRIORITY.idle + 40,
    duration: 11400,
    canInterrupt: true,
    loop: false,
    intensity: "playful",
    assets: ["deckchair", "sunglasses", "sparkle"],
    reducedMotionFallback: "relax-still",
    states: ["relaxing"],
    pose: (base, t) => relaxPose(base, t, { shades: true, doze: true })
  };
  var BALLOON_START = { x: 30, y: -10 };
  var BALLOON_HOVER = { x: 34, y: -62 };
  var BALLOON_RELEASE = { x: 12, y: 18 };
  function balloonPose(base, t, extra) {
    const r = cloneRig(base);
    const arrive = ease3(t / 0.2);
    const leave = ease3((t - 0.8) / 0.2);
    const visible = arrive * (1 - leave);
    const held2 = ease3(Math.min(arrive, (0.8 - t) / 0.12));
    const sway = wave3(t * 1.5) * extra.sway * held2;
    const wander = wave3(t * 2.3, 0.15) * extra.wander * held2;
    const bob = wave3(t * 1.5, 0.25) * (2.2 + extra.sway * 0.25) * held2;
    const drift = wave3(t * 3.1, 0.6) * extra.wander * held2;
    const x = BALLOON_START.x + (BALLOON_HOVER.x - BALLOON_START.x) * arrive + sway + wander + leave * BALLOON_RELEASE.x;
    const y = BALLOON_START.y + (BALLOON_HOVER.y - BALLOON_START.y) * arrive - bob - leave * BALLOON_RELEASE.y;
    const toward = extra.lean * held2;
    r.rotation = base.rotation + toward;
    r.faceTilt = base.faceTilt - toward * 0.6;
    r.x = base.x + toward * 0.35;
    r.y = base.y - held2 * 0.5 - bob * 0.1;
    r.smile.depth = base.smile.depth * (1 + held2 * 0.12);
    r.smile.span = base.smile.span * (1 + held2 * 0.05);
    const mag = Math.max(1, Math.hypot(x, y));
    const gaze = {
      x: Math.max(-1, Math.min(1, x / mag)),
      y: Math.max(-1, Math.min(1, y / mag))
    };
    r.eyes.left.gaze = gaze;
    r.eyes.right.gaze = { ...gaze };
    for (const ray of r.rays) {
      ray.lengthScale = 1 + held2 * 0.04 + drift * 0.02;
      ray.widthScale = 1 + held2 * 0.02;
      ray.rotation = drift * 2;
    }
    r.props = [
      {
        id: "balloon",
        x,
        y,
        // Tumbling slightly as it swings, and held back at an angle in the instant
        // it is released -- which reads as the string going slack rather than as
        // the balloon rotating on its own.
        rotation: sway * 1.5 + drift * 2 + (1 - arrive) * -6,
        scale: 0.72 + 0.28 * arrive - leave * 0.16,
        opacity: visible
      }
    ];
    return r;
  }
  var balloonStill = {
    id: "balloon-still",
    group: "balloon",
    priority: PRIORITY.play,
    duration: 1,
    canInterrupt: true,
    loop: true,
    intensity: "off",
    assets: ["balloon"],
    reducedMotionFallback: null,
    states: ["idle", "playing"],
    pose: (base) => {
      const r = cloneRig(base);
      r.props = [
        { id: "balloon", x: BALLOON_HOVER.x, y: BALLOON_HOVER.y, rotation: 0, scale: 1, opacity: 1 }
      ];
      return r;
    }
  };
  var balloonRise = {
    id: "balloon-rise",
    group: "balloon",
    priority: PRIORITY.play,
    duration: 4600,
    canInterrupt: true,
    loop: false,
    intensity: "minimal",
    assets: ["balloon"],
    reducedMotionFallback: "balloon-still",
    states: ["idle", "playing"],
    pose: (base, t) => balloonPose(base, t, { sway: 0.6, wander: 0, lean: 1.6 })
  };
  var balloonSway = {
    id: "balloon-sway",
    group: "balloon",
    priority: PRIORITY.play,
    duration: 5600,
    canInterrupt: true,
    loop: false,
    intensity: "balanced",
    assets: ["balloon"],
    reducedMotionFallback: "balloon-still",
    states: ["idle", "playing"],
    pose: (base, t) => balloonPose(base, t, { sway: 1.6, wander: 0.8, lean: 2.6 })
  };
  var balloonWander = {
    id: "balloon-wander",
    group: "balloon",
    priority: PRIORITY.play,
    duration: 6800,
    canInterrupt: true,
    loop: false,
    intensity: "playful",
    assets: ["balloon"],
    reducedMotionFallback: "balloon-still",
    states: ["idle", "playing"],
    pose: (base, t) => balloonPose(base, t, { sway: 2.4, wander: 2, lean: 3.4 })
  };
  function popPose(base, t, anchor, extra) {
    const r = cloneRig(base);
    const centre2 = anchor ? anchor.point : toViewBox(base, BALLOON_HOVER);
    const jolt = bump(t / 0.35) * extra.jolt;
    r.y = base.y - jolt * 2.4;
    r.squash = jolt * 0.07;
    r.stretch = jolt * 0.03;
    r.rotation = base.rotation - jolt * 2.2;
    r.faceTilt = base.faceTilt - jolt * 1.6;
    for (const side of ["left", "right"]) {
      r.eyes[side].scaleY = base.eyes[side].scaleY + jolt * 0.22;
      r.brows[side].y = base.brows[side].y - jolt * 1.4;
      r.brows[side].arch = base.brows[side].arch * (1 + jolt * 0.3);
    }
    r.smile.depth = base.smile.depth * (1 + jolt * 0.2);
    for (const ray of r.rays) {
      ray.lengthScale = 1 + jolt * 0.12;
      ray.widthScale = 1 + jolt * 0.08;
    }
    const props = [];
    for (let i = 0; i < extra.shards; i++) {
      const p = (t - 0.06 - i % 3 * 0.04) / 0.68;
      if (p <= 0 || p >= 1) continue;
      const out = 1 - (1 - p) * (1 - p);
      const angle = i / extra.shards * 360 + i % 2 * 24;
      const dist = out * extra.reach * (0.72 + 0.28 * (i % 3 / 2));
      const radians = angle * Math.PI / 180;
      const local = toBodyFrame(r, {
        x: centre2.x + Math.sin(radians) * dist,
        y: centre2.y - Math.cos(radians) * dist
      });
      props.push({
        id: "sparkle",
        x: local.x,
        y: local.y,
        rotation: angle + p * 180,
        scale: 0.95 * (1 - out * 0.55),
        opacity: bump(p) * 0.95
      });
    }
    r.props = props;
    return r;
  }
  var popStill = {
    id: "pop-still",
    group: "pop",
    priority: PRIORITY.interaction,
    duration: 1,
    canInterrupt: true,
    loop: true,
    intensity: "off",
    assets: [],
    reducedMotionFallback: null,
    states: ["idle", "playing"],
    pose: (base) => cloneRig(base)
  };
  var popBurst = {
    id: "pop-burst",
    group: "pop",
    priority: PRIORITY.interaction,
    duration: 520,
    canInterrupt: true,
    loop: false,
    intensity: "minimal",
    assets: ["sparkle"],
    reducedMotionFallback: null,
    states: ["idle", "playing"],
    pose: (base, t, anchor) => popPose(base, t, anchor, { shards: 5, reach: 20, jolt: 0.35 })
  };
  var popFlinch = {
    id: "pop-flinch",
    group: "pop",
    priority: PRIORITY.interaction,
    duration: 620,
    canInterrupt: true,
    loop: false,
    intensity: "balanced",
    assets: ["sparkle"],
    reducedMotionFallback: null,
    states: ["idle", "playing"],
    pose: (base, t, anchor) => popPose(base, t, anchor, { shards: 7, reach: 26, jolt: 0.8 })
  };
  var popShower = {
    id: "pop-shower",
    group: "pop",
    priority: PRIORITY.interaction,
    duration: 760,
    canInterrupt: true,
    loop: false,
    intensity: "playful",
    assets: ["sparkle"],
    reducedMotionFallback: null,
    states: ["idle", "playing"],
    pose: (base, t, anchor) => popPose(base, t, anchor, { shards: 10, reach: 34, jolt: 1 })
  };
  var PLANT = { x: 64, y: 52, lean: 14 };
  var BLOOM_UP = 30;
  function bloomCentre() {
    const a = PLANT.lean * Math.PI / 180;
    return { x: PLANT.x + BLOOM_UP * Math.sin(a), y: PLANT.y - BLOOM_UP * Math.cos(a) };
  }
  var SEED_HELD = { x: 56, y: 18 };
  var SEED_APPEARS_BY = 0.06;
  var SEED_DROPS_AT = 0.02;
  var SEED_LANDS_BY = 0.16;
  var SEED_FADES_FROM = 0.17;
  var SEED_GONE = 0.22;
  var SPROUT_AT = 0.26;
  var SPROUT_DONE = 0.5;
  var FLOWER_AT = 0.58;
  var FLOWER_DONE = 0.86;
  var TAKEN_IN = 0.88;
  function bloomPose(base, t, extra) {
    const r = cloneRig(base);
    const props = [];
    const shine = swell(t, 0.1, 0.46) * extra.shine;
    r.rays.forEach((ray, i) => {
      ray.lengthScale = base.rays[i].lengthScale + shine;
    });
    const fallen = ease3((t - SEED_DROPS_AT) / (SEED_LANDS_BY - SEED_DROPS_AT));
    const seedOpacity = ease3(t / SEED_APPEARS_BY) * (1 - ease3((t - SEED_FADES_FROM) / (SEED_GONE - SEED_FADES_FROM)));
    if (seedOpacity > 0) {
      props.push({
        id: "seed",
        x: SEED_HELD.x + (PLANT.x - SEED_HELD.x) * fallen,
        y: SEED_HELD.y + (PLANT.y - SEED_HELD.y) * fallen,
        rotation: -22 * (1 - fallen),
        scale: 1,
        opacity: seedOpacity
      });
    }
    const sprout = ease3((t - SPROUT_AT) / (SPROUT_DONE - SPROUT_AT));
    const sproutOpacity = Math.min(1, sprout * 4) * (1 - ease3((t - FLOWER_AT) / 0.14));
    if (sproutOpacity > 0) {
      props.push({
        id: "sprout",
        x: PLANT.x,
        y: PLANT.y,
        rotation: PLANT.lean + 14 * (1 - sprout),
        scale: 0.25 + 0.75 * sprout,
        opacity: sproutOpacity
      });
    }
    const bloom = ease3((t - FLOWER_AT) / (FLOWER_DONE - FLOWER_AT));
    const flowerOpacity = Math.min(1, bloom * 4) * (1 - ease3((t - TAKEN_IN) / (1 - TAKEN_IN)));
    if (flowerOpacity > 0) {
      props.push({
        id: "flower",
        x: PLANT.x,
        y: PLANT.y,
        rotation: PLANT.lean - 11 * (1 - bloom) + swell(t, 0.6, 0.92) * 3,
        scale: (0.25 + 0.75 * bloom) * extra.bloom * (1 + swell(t, 0.62, 0.86) * 0.06),
        opacity: flowerOpacity
      });
    }
    const held2 = land(t / 0.9);
    const lean = extra.lean * held2;
    r.rotation = base.rotation + lean;
    r.x = base.x + lean * 0.35;
    r.faceTilt = base.faceTilt - lean * 0.5;
    r.smile.depth = base.smile.depth * (1 + held2 * 0.16);
    r.smile.span = base.smile.span * (1 + held2 * 0.06);
    if (extra.hop) r.y = base.y - swell(t, 0.58, 0.88) * 2.4;
    const focus = sprout > 0 || bloom > 0 ? bloomCentre() : {
      x: SEED_HELD.x + (PLANT.x - SEED_HELD.x) * fallen,
      y: SEED_HELD.y + (PLANT.y - SEED_HELD.y) * fallen
    };
    const mag = Math.max(1, Math.hypot(focus.x, focus.y));
    const gaze = {
      x: base.eyes.left.gaze.x + (focus.x / mag - base.eyes.left.gaze.x) * held2,
      y: base.eyes.left.gaze.y + (focus.y / mag - base.eyes.left.gaze.y) * held2
    };
    r.eyes.left.gaze = gaze;
    r.eyes.right.gaze = { ...gaze };
    const axis = {
      x: Math.sin(PLANT.lean * Math.PI / 180),
      y: -Math.cos(PLANT.lean * Math.PI / 180)
    };
    for (let i = 0; i < extra.gleam; i++) {
      const p = (t - 0.34 - i * 0.14) / 0.3;
      if (p <= 0 || p >= 1) continue;
      const rise = 8 + p * 32;
      props.push({
        id: "sparkle",
        x: PLANT.x + axis.x * rise,
        y: PLANT.y + axis.y * rise,
        rotation: p * 160,
        scale: 0.34 + bump(p) * 0.42,
        opacity: bump(p) * 0.9
      });
    }
    r.props = props;
    return r;
  }
  var bloomStill = {
    id: "bloom-still",
    group: "bloom",
    priority: PRIORITY.play,
    duration: 1,
    canInterrupt: true,
    loop: true,
    intensity: "off",
    assets: ["flower"],
    reducedMotionFallback: null,
    states: ["idle", "playing"],
    pose: (base) => {
      const r = cloneRig(base);
      r.props = [
        { id: "flower", x: PLANT.x, y: PLANT.y, rotation: PLANT.lean, scale: 1, opacity: 1 }
      ];
      return r;
    }
  };
  var bloomSeed = {
    id: "bloom-seed",
    group: "bloom",
    priority: PRIORITY.play,
    duration: 4200,
    canInterrupt: true,
    loop: false,
    intensity: "minimal",
    assets: ["seed", "sprout", "flower"],
    reducedMotionFallback: "bloom-still",
    states: ["idle", "playing"],
    pose: (base, t) => bloomPose(base, t, { shine: 0.05, gleam: 0, bloom: 1, hop: false, lean: 1.4 })
  };
  var bloomGrow = {
    id: "bloom-grow",
    group: "bloom",
    priority: PRIORITY.play,
    duration: 5200,
    canInterrupt: true,
    loop: false,
    intensity: "balanced",
    assets: ["seed", "sprout", "flower", "sparkle"],
    reducedMotionFallback: "bloom-still",
    states: ["idle", "playing"],
    pose: (base, t) => bloomPose(base, t, { shine: 0.11, gleam: 1, bloom: 1, hop: false, lean: 2.2 })
  };
  var bloomShowcase = {
    id: "bloom-showcase",
    group: "bloom",
    priority: PRIORITY.play,
    duration: 6200,
    canInterrupt: true,
    loop: false,
    intensity: "playful",
    assets: ["seed", "sprout", "flower", "sparkle"],
    reducedMotionFallback: "bloom-still",
    states: ["idle", "playing"],
    pose: (base, t) => bloomPose(base, t, { shine: 0.16, gleam: 2, bloom: 1.12, hop: true, lean: 3 })
  };
  var celebrateGlow = {
    id: "celebrate-glow",
    group: "celebrate-glow",
    priority: PRIORITY.idle + 10,
    duration: 1600,
    canInterrupt: true,
    loop: true,
    intensity: "minimal",
    assets: [],
    reducedMotionFallback: "celebrate-glow-still",
    states: ["celebrating"],
    pose: (base, t) => {
      const r = cloneRig(base);
      const b = hoseBounce(t * 2);
      r.y = base.y - b.lift * 4;
      r.squash = b.squash * 0.09 - b.stretch * 0.03;
      r.stretch = b.stretch * 0.04 - b.squash * 0.05;
      r.faceTilt = wave3(t, -0.1) * 4;
      rubberRays(r, t * 2 - 0.12, 1);
      r.smile.depth = base.smile.depth * 1.3;
      r.smile.span = base.smile.span * 1.08;
      eyes(r, (eye2) => {
        eye2.scaleY = 0.86;
        eye2.gaze = { x: 0, y: -0.2 };
      });
      r.brows.left.y = base.brows.left.y - 3 - b.lift;
      r.brows.right.y = base.brows.right.y - 3 - b.lift;
      return r;
    }
  };
  var celebrateGlowStill = {
    ...celebrateGlow,
    id: "celebrate-glow-still",
    intensity: "off",
    reducedMotionFallback: null,
    pose: (base) => {
      const r = cloneRig(base);
      r.smile.depth = base.smile.depth * 1.3;
      eyes(r, (eye2) => eye2.scaleY = 0.86);
      return r;
    }
  };
  var ponder = {
    id: "ponder",
    group: "ponder",
    priority: PRIORITY.idle + 10,
    duration: 2400,
    canInterrupt: true,
    loop: true,
    intensity: "minimal",
    assets: [],
    reducedMotionFallback: "ponder-still",
    states: ["confused"],
    pose: (base, t) => {
      const r = cloneRig(base);
      const sway = wave3(t);
      r.faceTilt = -9 + sway * 4;
      r.rotation = -2 + sway * 1.5;
      r.y = base.y - Math.abs(wave3(t * 2)) * 1.2;
      rubberRays(r, t, 0.4);
      r.brows.left.y = base.brows.left.y - 5 - Math.max(0, sway) * 2;
      r.brows.left.rotation = base.brows.left.rotation + 10;
      r.brows.right.y = base.brows.right.y + 2;
      r.eyes.left.scaleY = 0.85;
      r.eyes.right.scaleY = 1.2;
      eyes(r, (eye2) => eye2.gaze = { x: -0.4 + sway * 0.2, y: -0.45 });
      r.smile.depth = base.smile.depth * 0.35;
      r.smile.span = base.smile.span * 0.75;
      r.smile.rotation = base.smile.rotation + 8;
      return r;
    }
  };
  var ponderStill = {
    ...ponder,
    id: "ponder-still",
    intensity: "off",
    reducedMotionFallback: null,
    pose: (base) => {
      const r = cloneRig(base);
      r.faceTilt = -9;
      r.brows.left.y = base.brows.left.y - 5;
      r.smile.depth = base.smile.depth * 0.35;
      return r;
    }
  };
  var droop = {
    id: "droop",
    group: "droop",
    priority: PRIORITY.idle + 10,
    duration: 3200,
    canInterrupt: true,
    loop: true,
    intensity: "minimal",
    assets: [],
    reducedMotionFallback: "droop-still",
    states: ["error"],
    pose: (base, t) => {
      const r = cloneRig(base);
      const breath = (1 - Math.cos(t * TAU3)) / 2;
      r.y = base.y + 3 - breath * 1.5;
      r.squash = 0.05 - breath * 0.03;
      r.stretch = -0.03 + breath * 0.02;
      for (const ray of r.rays) {
        const angle = (ray.angleDeg + 360) % 360;
        const towardDown = angle < 180 ? 1 : -1;
        ray.rotation = towardDown * (10 - breath * 3) * Math.sin(angle * Math.PI / 180) ** 2;
        ray.lengthScale = 0.88 + breath * 0.03;
      }
      eyes(r, (eye2) => {
        eye2.scaleY = 0.8;
        eye2.gaze = { x: 0, y: 0.5 };
      });
      r.brows.left.rotation = base.brows.left.rotation + 10;
      r.brows.right.rotation = base.brows.right.rotation - 10;
      r.brows.left.y = base.brows.left.y + 2;
      r.brows.right.y = base.brows.right.y + 2;
      r.smile.depth = base.smile.depth * -0.25;
      r.smile.span = base.smile.span * 0.7;
      return r;
    }
  };
  var droopStill = {
    ...droop,
    id: "droop-still",
    intensity: "off",
    reducedMotionFallback: null,
    pose: (base) => {
      const r = cloneRig(base);
      for (const ray of r.rays) ray.lengthScale = 0.9;
      r.smile.depth = base.smile.depth * -0.2;
      return r;
    }
  };
  var AUTHORED = [
    idleStill,
    idle,
    blink,
    listeningStill,
    listening,
    thinkingStill,
    thinking,
    eurekaStill,
    eureka,
    speakingStill,
    speaking,
    guidingStill,
    guiding,
    celebrateStill,
    celebrateBounce,
    celebrate,
    confusedStill,
    confused,
    errorStill,
    error,
    celebrateGlowStill,
    celebrateGlow,
    ponderStill,
    ponder,
    droopStill,
    droop,
    chargingStill,
    charging,
    coolShadesStill,
    coolShades,
    coolShadesPlay,
    bubbleOpenStill,
    bubbleOpen,
    playStill,
    playShuffle,
    playRun,
    playDance,
    relaxStill,
    relaxSettle,
    relaxSunbathe,
    relaxDoze,
    balloonStill,
    balloonRise,
    balloonSway,
    balloonWander,
    popStill,
    popBurst,
    popFlinch,
    popShower,
    arcadeTuck,
    arcadeRoll,
    arcadeSpin,
    bloomStill,
    bloomSeed,
    bloomGrow,
    bloomShowcase,
    ...ACTING
  ];
  var SEQUENCES = AUTHORED.map(withLimbActing);
  var SEQUENCE_BY_ID = new Map(
    SEQUENCES.map((s) => [s.id, s])
  );
  var RANK = { off: 0, minimal: 1, balanced: 2, playful: 3 };
  function isEligible(sequence, intensity) {
    return RANK[intensity] >= RANK[sequence.intensity];
  }
  function sequencesInGroup(group) {
    return SEQUENCES.filter((s) => s.group === group).sort(
      (a, b) => RANK[a.intensity] - RANK[b.intensity] || a.id.localeCompare(b.id)
    );
  }
  var GROUPS = [...new Set(SEQUENCES.map((s) => s.group))].sort();
  function bestInGroup(group, intensity) {
    const eligible = sequencesInGroup(group).filter((s) => isEligible(s, intensity));
    return eligible[eligible.length - 1] ?? null;
  }

  // packages/animation-engine/src/scheduler.ts
  var AMBIENT_GROUP = {
    idle: "idle",
    relaxing: "idle",
    // A game borrows the resting layer for the same reason the relaxing state
    // does: the play moves are short bursts at the start of the session, and what
    // the visitor is looking at for the rest of it is a character breathing
    // quietly beside a board. See A07 in `sequences.ts`.
    playing: "idle",
    listening: "idle",
    thinking: "think",
    speaking: "speak",
    guiding: "guide",
    // The reactive states used to have no floor, so once their short moment was
    // over Sunny stood as a bare, unbreathing base pose for seconds (error: until
    // the next event). Each now has a quiet loop of its own underneath.
    celebrating: "celebrate-glow",
    confused: "ponder",
    error: "droop"
  };
  var Scheduler = class {
    #active = [];
    #intensity;
    #reducedMotion;
    #floor = null;
    #floorGroup = null;
    #compositor = new Compositor();
    constructor(intensity = "balanced", reducedMotion = false) {
      this.#intensity = intensity;
      this.#reducedMotion = reducedMotion;
    }
    get intensity() {
      return this.#intensity;
    }
    setIntensity(intensity) {
      this.#intensity = intensity;
    }
    setReducedMotion(reduced) {
      this.#reducedMotion = reduced;
    }
    get active() {
      return this.#active;
    }
    /**
     * Ask for a behavioural moment, by group name (`celebrate`, `think`) or by a
     * specific sequence id.
     *
     * Callers should normally name the group. Naming a group means the tenant's
     * intensity setting selects the variant, so lowering intensity makes a
     * celebration quieter instead of removing it -- the failure mode where a
     * setting silently deletes a whole behaviour in production but not in tests.
     *
     * Returns false when nothing could be chosen. That is a silent no-op rather
     * than an error: asking for a moment that cannot play is not a fault.
     */
    request(groupOrId, state2, now, anchor) {
      const sequence = SEQUENCE_BY_ID.get(groupOrId) ?? bestInGroup(groupOrId, this.#intensity);
      if (!sequence) return false;
      if (!sequence.states.includes(state2)) return false;
      if (!isEligible(sequence, this.#intensity)) return false;
      if (this.#active.some((a) => a.sequence.group === sequence.group)) return false;
      this.#active.push({ sequence, startedAt: now, ...anchor ? { anchor } : {} });
      return true;
    }
    /**
     * Drop everything currently playing for a group or a sequence id.
     *
     * Named the same way `request` is, and for the same reason: a caller that
     * asked for `balloon` did not choose between `balloon-sway` and
     * `balloon-wander`, so it cannot name the one it wants back. More to the
     * point, the sequence a group request installed is *not* the sequence that
     * renders: `request('balloon', …)` stores whichever variant the intensity
     * picked, and under reduced motion it renders a third sequence again. An
     * id-only cancel silently matches none of those and the moment the caller
     * meant to stop keeps running underneath -- which is exactly the bug it was
     * written to prevent.
     */
    cancel(groupOrId) {
      this.#active = this.#active.filter(
        (a) => a.sequence.id !== groupOrId && a.sequence.group !== groupOrId
      );
    }
    /**
     * Forget everything that is playing, including the ambient floor.
     *
     * A requested sequence expires on its own clock, which starts when it is
     * *asked for* rather than when it is first drawn. So a moment can be queued
     * behind a longer, higher-priority one for its whole life and never be seen:
     * the celebration asked for while a 2.6 s charging panel plays is drawn on no
     * frame at all. That is the priority system working -- the alternative is a
     * moment landing late, detached from its cause -- but it means a caller that
     * wants an independent, isolated encounter with a moment has to clear the
     * stage first rather than hope the last one has finished. The animation lab's
     * gallery is exactly that caller: every `Play` is a fresh question, so a
     * previous demo must not be the answer.
     */
    clear() {
      this.#active = [];
      this.#floor = null;
      this.#floorGroup = null;
      this.#compositor.reset();
    }
    /** Resume the sequence a state change interrupted, if it qualifies. */
    settled(instance, now) {
      const { sequence, startedAt } = instance;
      if (sequence.loop) return false;
      return now - startedAt >= sequence.duration;
    }
    resolve(sequence) {
      if (!this.#reducedMotion) return sequence;
      const fallbackId = sequence.reducedMotionFallback;
      if (fallbackId === null) return null;
      return SEQUENCE_BY_ID.get(fallbackId) ?? null;
    }
    /**
     * Advance to `now` and pick the frame. Pure with respect to the clock: calling
     * it twice with the same `now` returns the same rig, which is what lets tests
     * and screenshot harnesses drive it deterministically.
     */
    update(base, state2, ctx, now) {
      this.#reducedMotion = ctx.reducedMotion || ctx.lowPower;
      this.#intensity = ctx.paused ? "off" : ctx.intensity;
      if (ctx.paused || ctx.hidden) {
        this.clear();
        return { rig: base, sequenceId: null, yields: [], overlays: [] };
      }
      this.#active = this.#active.filter(
        (a) => !this.settled(a, now) && a.sequence.states.includes(state2)
      );
      const ambientGroup = AMBIENT_GROUP[state2];
      const ambient = ambientGroup ? bestInGroup(ambientGroup, this.#intensity) : null;
      if (!ambient || ambient.group !== this.#floorGroup) {
        this.#floor = ambient ? { sequence: ambient, startedAt: now } : null;
        this.#floorGroup = ambient?.group ?? null;
      } else if (this.#floor && this.#floor.sequence.id !== ambient.id) {
        this.#floor = { sequence: ambient, startedAt: now };
      }
      const floor = this.#floor;
      const pool = floor ? [...this.#active, floor] : [...this.#active];
      const eligible = pool.map((instance) => ({ instance, sequence: this.resolve(instance.sequence) })).filter((e) => e.sequence !== null).filter((e) => isEligible(e.sequence, this.#intensity));
      const overlays = eligible.filter((e) => e.sequence.layer === "eyelids");
      const resolved = eligible.filter((e) => e.sequence.layer === void 0).sort((a, b) => b.sequence.priority - a.sequence.priority);
      const progress = (e) => {
        const elapsed = now - e.instance.startedAt;
        return e.sequence.loop ? elapsed % e.sequence.duration / e.sequence.duration : Math.min(1, elapsed / e.sequence.duration);
      };
      const winner = resolved[0];
      let target = winner ? winner.sequence.pose(base, progress(winner), winner.instance.anchor) : base;
      if (overlays.length > 0) {
        target = cloneRig(target);
        for (const o of overlays) {
          const lid = o.sequence.pose(base, progress(o), o.instance.anchor);
          target.eyes.left.closed = Math.max(target.eyes.left.closed, lid.eyes.left.closed);
          target.eyes.right.closed = Math.max(target.eyes.right.closed, lid.eyes.right.closed);
        }
      }
      const key = winner ? `${winner.sequence.id}@${winner.instance.startedAt}` : null;
      const rig = this.#compositor.compose(target, now, {
        key,
        blendMs: winner?.sequence.blendInMs ?? (winner && winner.instance === floor ? STATE_BLEND_MS : BLEND_MS),
        reducedMotion: this.#reducedMotion
      });
      return {
        rig,
        sequenceId: winner?.sequence.id ?? null,
        yields: resolved.slice(1).map((e) => e.sequence.id),
        overlays: overlays.map((e) => e.sequence.id)
      };
    }
    /** Everything the scheduler could play right now, for a debug overlay. */
    options(state2) {
      return [...SEQUENCE_BY_ID.values()].filter((s) => s.states.includes(state2)).filter((s) => isEligible(s, this.#intensity)).sort((a, b) => b.priority - a.priority);
    }
    /** The priority band a state's ambient behaviour sits in. Exposed for tests. */
    static ambientPriority(state2) {
      const group = AMBIENT_GROUP[state2];
      if (!group) return PRIORITY.idle;
      return bestInGroup(group, "playful")?.priority ?? PRIORITY.idle;
    }
  };

  // packages/animation-engine/src/catalogue.ts
  var CATALOGUE = [
    {
      group: "blink",
      name: "Blink",
      description: "A reflex: the eyes close for a moment and open again, on a seeded cadence.",
      category: "reflex",
      asked: "engine",
      askedBy: "the animator\u2019s own blink timer"
    },
    {
      group: "idle",
      name: "Resting",
      description: "Breathing and glancing around at nothing in particular. Deliberately sparse.",
      category: "ambient",
      asked: "engine",
      askedBy: "the ambient layer of the idle and relaxing states"
    },
    {
      group: "listen",
      name: "Listening",
      description: "A small perk of attention when the visitor arrives or starts typing.",
      category: "conversation",
      asked: "engine",
      askedBy: "`attention`, alongside `open`"
    },
    {
      group: "think",
      name: "Thinking",
      description: "The rays turn while the answer is being worked out.",
      category: "conversation",
      asked: "engine",
      askedBy: "the ambient layer of the thinking state"
    },
    {
      group: "eureka",
      name: "Eureka",
      description: "The answer arrives: a question mark turns into a spark.",
      category: "conversation",
      asked: "engine",
      askedBy: "`speaking_started` when it follows thinking"
    },
    {
      group: "speak",
      name: "Speaking",
      description: "A gentle pulse while the answer streams in, so the character is never still while it is the one talking.",
      category: "conversation",
      asked: "engine",
      askedBy: "the ambient layer of the speaking state"
    },
    {
      group: "guide",
      name: "Pointing",
      description: "Sunny points at the part of the host page the answer refers to.",
      category: "conversation",
      asked: "engine",
      askedBy: "`guiding_started`"
    },
    {
      group: "charge",
      name: "Charging a panel",
      description: "A solar panel unfolds, a beam of sunlight lands on it and the battery fills.",
      category: "conversation",
      asked: "nobody",
      note: "A12, and one of the plan\u2019s five flagship sequences. Nothing requests the group: it belongs to the solar-education moment, and no tool or stream event has been wired to it yet."
    },
    {
      group: "open",
      name: "The bubble opens",
      description: "The launcher bubbles open into the panel, and Sunny settles into the header.",
      category: "conversation",
      asked: "engine",
      askedBy: "`attention`"
    },
    {
      group: "celebrate",
      name: "Celebration",
      description: "Something went well for the visitor, and Sunny enjoys it.",
      category: "reaction",
      asked: "engine",
      askedBy: "`celebrate`"
    },
    {
      group: "cool",
      name: "Sunglasses",
      description: "Sunny has done something well and knows it. The shades come out.",
      category: "reaction",
      asked: "engine",
      askedBy: "`impress`"
    },
    {
      group: "confused",
      name: "Confusion",
      description: "A question landed badly, or the answer is genuinely uncertain.",
      category: "reaction",
      asked: "engine",
      askedBy: "`confused`"
    },
    {
      group: "error",
      name: "Something went wrong",
      description: "The turn failed. A sweat drop, a deflate, and a recovery back to rest.",
      category: "reaction",
      asked: "engine",
      askedBy: "`turn_failed`"
    },
    {
      group: "celebrate-glow",
      name: "Glowing",
      description: "After a celebration: a happy little bounce with fists pumping, eyes squinting.",
      category: "ambient",
      asked: "engine",
      askedBy: "the ambient layer of the celebrating state"
    },
    {
      group: "ponder",
      name: "Pondering",
      description: "After a double take: a slow puzzled sway, one brow up, scratching the chin.",
      category: "ambient",
      asked: "engine",
      askedBy: "the ambient layer of the confused state"
    },
    {
      group: "droop",
      name: "Drooping",
      description: "After an error: slumped with the rays hanging, breathing slowly until the next turn.",
      category: "ambient",
      asked: "engine",
      askedBy: "the ambient layer of the error state"
    },
    {
      group: "lookup-book",
      name: "Reading up",
      description: "Sits down with a book while a knowledge-base tool runs, eyes running along the lines.",
      category: "conversation",
      asked: "engine",
      askedBy: "`lookup` with kind `book` (a knowledge or questionnaire tool started)"
    },
    {
      group: "lookup-laptop",
      name: "On the laptop",
      description: "Sits down and types on a laptop while a pricing or estimate tool runs, glancing up now and then.",
      category: "conversation",
      asked: "engine",
      askedBy: "`lookup` with kind `laptop` (an estimate, quote or form tool started)"
    },
    {
      group: "lookup-magnify",
      name: "Searching",
      description: "Holds a magnifying glass up to one eye and scans while a search tool runs.",
      category: "conversation",
      asked: "engine",
      askedBy: "`lookup` with kind `magnifier` (a search or check tool started)"
    },
    {
      group: "gesture",
      name: "Talking with the hands",
      description: "While the answer streams: a nod, an open palm, a finger-gun or a raised finger, never the same twice running.",
      category: "conversation",
      asked: "engine",
      askedBy: "the director, every few seconds in the speaking state"
    },
    {
      group: "lean",
      name: "Leaning in",
      description: "The visitor is typing: Sunny leans in, eyes on the message box, and nods.",
      category: "conversation",
      asked: "engine",
      askedBy: "`user_typing`, at most every few seconds"
    },
    {
      group: "nod",
      name: "Satisfied nod",
      description: "An answer delivered: a small nod and a smile as Sunny settles.",
      category: "conversation",
      asked: "engine",
      askedBy: "`turn_finished`"
    },
    {
      group: "fidget",
      name: "Fidgeting",
      description: "Nothing has happened for a while: a look round, a stretch, a peace sign or a hop.",
      category: "reflex",
      asked: "engine",
      askedBy: "the director, after twenty quiet seconds in idle"
    },
    {
      group: "lounge",
      name: "Waiting in the deckchair",
      description: "After a long quiet spell the deckchair comes out and Sunny waits in it, shades on, until someone types.",
      category: "reflex",
      asked: "engine",
      askedBy: "`idle_timeout`, which the director sends after forty-five quiet seconds"
    },
    {
      group: "play",
      name: "Playing along",
      description: "A short burst of showing off when a game starts: a shuffle, a run or a dance, depending on the tenant\u2019s motion setting.",
      category: "play",
      asked: "engine",
      askedBy: "`play_started`"
    },
    {
      group: "arcade",
      name: "Arcade spin",
      description: "Her rays fold flat and she rolls: a whole turn at a walking pace, or two fast revolutions with a hop, depending on the tenant\u2019s motion setting.",
      category: "play",
      asked: "engine",
      askedBy: "`spin` \u2014 a wave cleared in an arcade game"
    },
    {
      group: "relax",
      name: "Taking a break",
      description: "The visitor closes the chat and Sunny gets a deckchair out: it unfolds, she lies back, and at the stronger settings the shades come down or she dozes off.",
      category: "ambient",
      asked: "engine",
      askedBy: "`dismissed`"
    },
    {
      group: "balloon",
      name: "The balloon",
      description: "A balloon comes up out of her hands and floats there while she watches it, then is let go.",
      category: "play",
      asked: "gesture",
      note: "The engine asks for this when `SunnyAnimator.tap()` is called with a point on the body, so the host has to forward a pointer gesture. Nothing in the widget does yet, and until one does a tap on the character does nothing at all."
    },
    {
      group: "pop",
      name: "Popping it",
      description: "The balloon bursts where the visitor touched it, and she flinches.",
      category: "play",
      asked: "gesture",
      note: "Reached by tapping the balloon rather than the body, so it needs the same forwarded gesture the float does. The burst is drawn at the point the visitor touched instead of at a position the moment chose for itself, which is the reason the scheduler carries an anchor."
    },
    {
      group: "bloom",
      name: "Planting a flower",
      description: "A seed drops into the ground beside her, her rays stretch over it, a shoot comes up out of the soil and opens into a flower.",
      category: "play",
      asked: "app",
      note: 'The solar showcase (A11), and nothing in the engine asks for it. It has no event because it is not a response to anything: an application calls `SunnyAnimator.play("bloom")` when it wants to show a visitor what sunlight does, which is a decision no machine event could make.'
    }
  ];
  var UNWIRED_GROUPS = CATALOGUE.filter(
    (entry) => entry.asked !== "engine"
  ).map((entry) => entry.group);
  var UNREACHABLE_GROUPS = CATALOGUE.filter(
    (entry) => entry.asked === "nobody"
  ).map((entry) => entry.group);

  // packages/animation-engine/src/engine.ts
  var BLINK_MIN_MS = 2600;
  var BLINK_MAX_MS = 6400;
  var GESTURE_FIRST_MS = 1700;
  var GESTURE_MIN_MS = 2200;
  var GESTURE_MAX_MS = 4200;
  var FIDGET_AFTER_MS = 2e4;
  var FIDGET_MIN_MS = 7e3;
  var FIDGET_MAX_MS = 12e3;
  var LOUNGE_AFTER_MS = 45e3;
  var LEAN_EVERY_MS = 2800;
  var TAP_RADIUS = { balloon: 24 };
  function xorshift(seed) {
    let s = seed >>> 0 || 2654435769;
    return () => {
      s ^= s << 13;
      s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5;
      s >>>= 0;
      return s / 4294967296;
    };
  }
  var SunnyAnimator = class {
    machine;
    scheduler;
    #base;
    #random;
    #nextBlinkAt = 0;
    #last = null;
    #directing;
    #directedState = null;
    #quietSince = 0;
    #nextGestureAt = 0;
    #nextFidgetAt = 0;
    #lastLeanAt = -Infinity;
    /** The last few gestures and fidgets, so the director does not repeat itself. */
    #recent = [];
    constructor(base = defaultRig(), options = {}) {
      this.#base = base;
      this.machine = new SunnyMachine("idle", 0);
      this.scheduler = new Scheduler(options.intensity ?? "balanced", options.reducedMotion ?? false);
      this.#random = xorshift(options.seed ?? 1592594996);
      this.#directing = options.director ?? true;
    }
    get state() {
      return this.machine.state;
    }
    /** Replace the base pose, e.g. when a tenant changes its theme. */
    setBase(base) {
      this.#base = base;
    }
    /**
     * Apply an application event. This is the only way behaviour changes: there is
     * deliberately no API that takes an animation id from a model response, so a
     * compromised or over-eager model cannot drive the character past the
     * vocabulary the application compiled in.
     */
    dispatch(event, now) {
      if (event.type === "spin") {
        this.scheduler.request("arcade", this.machine.state, now);
        return;
      }
      if (event.type !== "idle") this.#quietSince = now;
      const previous = this.machine.state;
      const result = this.machine.send(event, now);
      switch (event.type) {
        case "lookup":
          for (const group of Object.values(LOOKUP_GROUP)) this.scheduler.cancel(group);
          this.scheduler.request(LOOKUP_GROUP[event.kind], this.machine.state, now);
          return;
        case "lookup_finished":
          for (const group of Object.values(LOOKUP_GROUP)) this.scheduler.cancel(group);
          return;
        case "user_typing":
          if (this.machine.state === "listening" && now - this.#lastLeanAt >= LEAN_EVERY_MS) {
            this.#lastLeanAt = now;
            this.scheduler.request("lean", "listening", now);
          }
          return;
        default:
          break;
      }
      if (!result.changed) return;
      switch (event.type) {
        case "celebrate":
          this.scheduler.request("celebrate", result.state, now);
          break;
        case "impress":
          this.scheduler.request("cool", result.state, now);
          break;
        case "confused":
          this.scheduler.request("confused", result.state, now);
          break;
        case "turn_failed":
          this.scheduler.request("error", result.state, now);
          break;
        case "guiding_started":
          this.scheduler.request("guide", result.state, now);
          break;
        case "attention":
          this.scheduler.request("open", result.state, now);
          this.scheduler.request("listen", result.state, now);
          break;
        case "play_started":
          this.scheduler.request("play", result.state, now);
          break;
        case "dismissed":
          this.scheduler.request("relax", result.state, now);
          break;
        case "turn_finished":
          if (result.state === "idle") this.scheduler.request("nod", result.state, now);
          break;
        case "idle_timeout":
          this.scheduler.request("lounge", result.state, now);
          break;
        case "speaking_started":
          if (previous === "thinking") this.scheduler.request("eureka", result.state, now);
          break;
        default:
          break;
      }
    }
    /**
     * Note that the visitor did something the engine was not told about as an
     * event -- scrolled, moved the pointer -- so the idle director holds off its
     * fidgets and the deckchair.
     */
    noteActivity(now) {
      this.#quietSince = now;
    }
    /** Play a named moment now, e.g. the charging sequence a tool call triggers. */
    play(group, now) {
      return this.scheduler.request(group, this.machine.state, now);
    }
    /**
     * Stop everything that is playing and let the next frame start clean.
     *
     * For a surface that asks for moments out of any context -- the lab's gallery,
     * where each button is a separate demonstration -- rather than one that is
     * following a conversation, where the previous moment is part of the story.
     */
    reset() {
      this.scheduler.clear();
    }
    /**
     * A pointer gesture on the character, given in viewBox coordinates. Returns
     * whether Sunny had anything to say about it.
     *
     * **Hit-tested against what was drawn.** The test is made against the last rig
     * the animator rendered rather than against anything current, for the same
     * reason a button responds where it is rather than where it will be: the
     * visitor pointed at a picture, and the picture they saw is the one that was on
     * screen when their finger went down. Both the balloon's position and its size
     * come from that frame, so a tap where the balloon is at the moment it is seen
     * lands, and a tap where it was half a second ago does not.
     *
     * **Two gestures, one entry point.** A tap on the balloon pops it; a tap on her
     * puts a balloon in her hands. Anything else the pointer lands on -- a ray tip,
     * the empty canvas -- is not a hit and changes nothing, because a character
     * that reacts to being touched anywhere is a character that cannot be *not*
     * touched.
     */
    tap(point2, now) {
      this.#quietSince = now;
      const rig = this.#last?.rig ?? this.#base;
      const local = toBodyFrame(rig, point2);
      const balloon = rig.props.find((prop2) => prop2.id === "balloon" && prop2.opacity > 0.05);
      if (balloon) {
        const radius = (TAP_RADIUS.balloon ?? 0) * balloon.scale;
        if (Math.hypot(local.x - balloon.x, local.y - balloon.y) <= radius) {
          this.scheduler.cancel("balloon");
          return this.scheduler.request("pop", this.machine.state, now, { point: point2 });
        }
      }
      if (Math.hypot(local.x, local.y) <= BODY.radius) {
        return this.scheduler.request("balloon", this.machine.state, now);
      }
      return false;
    }
    /** Run one frame. `now` is monotonic milliseconds. */
    frame(now, ctx = {}) {
      const context = {
        state: this.machine.state,
        intensity: this.scheduler.intensity,
        reducedMotion: ctx.reducedMotion ?? false,
        hidden: ctx.hidden ?? false,
        paused: ctx.paused ?? false,
        lowPower: ctx.lowPower ?? false
      };
      this.machine.tick(now);
      if (!context.paused && !context.hidden && context.intensity !== "off") {
        this.maybeBlink(now);
        if (this.#directing) this.direct(now);
      }
      const result = this.scheduler.update(this.#base, this.machine.state, context, now);
      this.#last = result;
      return result;
    }
    get lastFrame() {
      return this.#last;
    }
    /**
     * The director: what Sunny does on its own between the application's events,
     * so a conversation never looks like the same loop playing over and over.
     *
     * - **Speaking:** a gesture every few seconds (a nod, an open palm, a
     *   finger-gun, a raised finger), never the same one twice running.
     * - **Idle:** after twenty quiet seconds, a fidget now and then (a look
     *   round, a stretch, a peace sign, a hop, the balloon); after forty-five,
     *   the deckchair comes out and Sunny waits in it until someone types.
     *
     * All of it is seeded, so a replay draws the same frames.
     */
    direct(now) {
      const state2 = this.machine.state;
      if (state2 !== this.#directedState) {
        this.#directedState = state2;
        if (state2 === "idle") this.#quietSince = now;
        if (state2 === "speaking") this.#nextGestureAt = now + GESTURE_FIRST_MS;
        this.#nextFidgetAt = now + FIDGET_AFTER_MS;
      }
      if (state2 === "speaking" && now >= this.#nextGestureAt) {
        this.perform(GESTURES, now);
        this.#nextGestureAt = now + this.between(GESTURE_MIN_MS, GESTURE_MAX_MS);
        return;
      }
      if (state2 !== "idle") return;
      const quiet = now - this.#quietSince;
      if (quiet >= LOUNGE_AFTER_MS) {
        this.dispatch({ type: "idle_timeout" }, now);
        return;
      }
      if (quiet >= FIDGET_AFTER_MS && now >= this.#nextFidgetAt) {
        this.perform(FIDGETS, now);
        this.#nextFidgetAt = now + this.between(FIDGET_MIN_MS, FIDGET_MAX_MS);
      }
    }
    /** Play one of `choices` that has not played recently and can play now. */
    perform(choices, now) {
      const fresh = choices.filter((id) => !this.#recent.includes(id));
      const pool = fresh.length > 0 ? fresh : [...choices];
      const start2 = Math.floor(this.#random() * pool.length);
      for (let i = 0; i < pool.length; i++) {
        const id = pool[(start2 + i) % pool.length];
        if (this.scheduler.request(id, this.machine.state, now)) {
          this.#recent = [id, ...this.#recent].slice(0, 2);
          return;
        }
      }
    }
    between(min, max) {
      return min + this.#random() * (max - min);
    }
    /**
     * Blinking is scheduled rather than baked into the idle sequence, because a
     * blink must be able to land *on top of* whatever else is playing: a visitor
     * being talked at should still see Sunny blink.
     */
    maybeBlink(now) {
      const blinkable = [
        "idle",
        "listening",
        "thinking",
        "speaking",
        "guiding",
        "celebrating",
        "confused",
        "relaxing",
        "playing",
        "error"
      ];
      if (!blinkable.includes(this.machine.state)) {
        this.#nextBlinkAt = now + BLINK_MIN_MS;
        return;
      }
      if (this.#nextBlinkAt === 0) {
        this.#nextBlinkAt = now + BLINK_MIN_MS;
        return;
      }
      if (now < this.#nextBlinkAt) return;
      this.scheduler.request("blink", this.machine.state, now);
      this.#nextBlinkAt = now + BLINK_MIN_MS + this.#random() * (BLINK_MAX_MS - BLINK_MIN_MS);
    }
  };

  // packages/animation-engine/src/index.ts
  function machineEventForStreamEvent(event) {
    switch (event.type) {
      // The first words of the answer: from thinking this is the eureka. Every
      // later delta maps the same way and is a no-op once Sunny is speaking.
      case "text_delta":
        return { type: "speaking_started" };
      case "tool_started":
        return event.tool === POINTING_TOOL ? { type: "guiding_started" } : { type: "lookup", kind: lookupKindForTool(event.tool ?? "") };
      case "tool_finished":
        return event.tool === POINTING_TOOL ? { type: "guiding_finished" } : { type: "lookup_finished" };
      // A finished recommendation is Sunny's own good work: the sunglasses.
      case "recommendation_ready":
        return { type: "impress" };
      // A saved lead is for the visitor's benefit, and gets the full celebration.
      case "lead_saved":
        return { type: "celebrate" };
      case "error":
        return { type: "turn_failed" };
      case "message_finished":
        return { type: "turn_finished" };
      default:
        return null;
    }
  }
  var POINTING_TOOL = "suggest_page_action";
  function lookupKindForTool(tool) {
    if (/knowledge|questionnaire|faq|retrieve/.test(tool)) return "book";
    if (/search|validate|sunscan|find|lookup/.test(tool)) return "magnifier";
    return "laptop";
  }

  // apps/character-lab/src/dom.ts
  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === void 0 || value === false) continue;
      if (key === "class") node.className = String(value);
      else if (key === "text") node.textContent = String(value);
      else node.setAttribute(key, value === true ? "" : String(value));
    }
    node.append(...children);
    return node;
  }

  // packages/games/src/tic-tac-toe.ts
  var tic_tac_toe_exports = {};
  __export(tic_tac_toe_exports, {
    CELLS: () => CELLS,
    LINES: () => LINES,
    freeCells: () => freeCells,
    isLegal: () => isLegal,
    move: () => move,
    newGame: () => newGame,
    other: () => other,
    replay: () => replay,
    sunnyMove: () => sunnyMove
  });
  var CELLS = 9;
  var LINES = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6]
  ];
  var CENTRE = 4;
  var CORNERS = [0, 2, 6, 8];
  function freeCells(squares) {
    const out = [];
    for (let cell = 0; cell < CELLS; cell++) {
      if (squares[cell] === null) out.push(cell);
    }
    return out;
  }
  var other = (mark) => mark === "X" ? "O" : "X";
  function judge(squares) {
    for (const line of LINES) {
      const [a, b, c] = line;
      const mark = squares[a];
      if (!mark) continue;
      if (mark === squares[b] && mark === squares[c]) {
        return { status: "won", winner: mark, line };
      }
    }
    return freeCells(squares).length > 0 ? { status: "playing", winner: null, line: null } : { status: "drawn", winner: null, line: null };
  }
  function newGame(first = "X") {
    return {
      squares: Array.from({ length: CELLS }, () => null),
      turn: first,
      moves: [],
      status: "playing",
      winner: null,
      line: null
    };
  }
  function isLegal(game, cell) {
    return Number.isInteger(cell) && cell >= 0 && cell < CELLS && game.status === "playing" && game.squares[cell] === null;
  }
  function move(game, cell) {
    if (!Number.isInteger(cell) || cell < 0 || cell >= CELLS) {
      throw new RangeError(`${cell} is not a cell`);
    }
    if (game.status !== "playing") {
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
      ...verdict
    };
  }
  function replay(moves, first = "X") {
    return moves.reduce((game, cell) => move(game, cell), newGame(first));
  }
  function winningCell(squares, mark) {
    for (const line of LINES) {
      let owned = 0;
      let empty = -1;
      for (const cell of line) {
        const square = squares[cell];
        if (square === mark) owned++;
        else if (square === null) empty = cell;
        else {
          owned = -1;
          break;
        }
      }
      if (owned === 2 && empty !== -1) return empty;
    }
    return null;
  }
  function pick(cells, random) {
    const index2 = Math.min(cells.length - 1, Math.floor(random() * cells.length));
    return cells[index2];
  }
  function sunnyMove(game, random = Math.random) {
    if (game.status !== "playing") {
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

  // packages/games/src/invaders.ts
  var FIELD_ROWS = 12;
  var SHIP_ROW = FIELD_ROWS - 1;

  // packages/games/src/ping-pong.ts
  var ping_pong_exports = {};
  __export(ping_pong_exports, {
    BALL_RADIUS: () => BALL_RADIUS,
    BALL_STEP: () => BALL_STEP,
    COURT_HEIGHT: () => COURT_HEIGHT,
    COURT_WIDTH: () => COURT_WIDTH,
    MAX_BALL_STEP: () => MAX_BALL_STEP,
    PADDLE_HALF: () => PADDLE_HALF,
    PADDLE_HALF_WIDTH: () => PADDLE_HALF_WIDTH,
    PADDLE_KICK: () => PADDLE_KICK,
    PADDLE_LEFT_X: () => PADDLE_LEFT_X,
    PADDLE_RIGHT_X: () => PADDLE_RIGHT_X,
    PADDLE_SPEED: () => PADDLE_SPEED,
    STEP_GAIN: () => STEP_GAIN,
    WALL_BOTTOM: () => WALL_BOTTOM,
    WALL_TOP: () => WALL_TOP,
    WIN_SCORE: () => WIN_SCORE,
    ballSpeed: () => ballSpeed,
    facePlane: () => facePlane,
    leader: () => leader,
    movePaddle: () => movePaddle,
    moveVisitor: () => moveVisitor,
    newGame: () => newGame2,
    step: () => step,
    sunnyBatY: () => sunnyBatY,
    sunnyTarget: () => sunnyTarget,
    takeOver: () => takeOver
  });
  var COURT_WIDTH = 200;
  var COURT_HEIGHT = 200;
  var WALL_TOP = 26;
  var WALL_BOTTOM = 174;
  var PADDLE_LEFT_X = 40;
  var PADDLE_RIGHT_X = 160;
  var PADDLE_HALF_WIDTH = 9;
  var PADDLE_HALF = 17;
  var BALL_RADIUS = 5;
  var BALL_STEP = 2.2;
  var MAX_BALL_STEP = 4.6;
  var STEP_GAIN = 1.05;
  var PADDLE_SPEED = 2.9;
  var PADDLE_KICK = 5;
  var MAX_BOUNCE_DEG = 62;
  var MAX_BOUNCE_RAD = MAX_BOUNCE_DEG * Math.PI / 180;
  var PADDLE_LOW = WALL_TOP + PADDLE_HALF;
  var PADDLE_HIGH = WALL_BOTTOM - PADDLE_HALF;
  var WIN_SCORE = 5;
  var other2 = (side) => side === "left" ? "right" : "left";
  function facePlane(side) {
    return side === "left" ? PADDLE_LEFT_X + PADDLE_HALF_WIDTH + BALL_RADIUS : PADDLE_RIGHT_X - PADDLE_HALF_WIDTH - BALL_RADIUS;
  }
  function backWall(side) {
    return side === "left" ? 4 : COURT_WIDTH - 4;
  }
  var clamp2 = (v, low, high) => v < low ? low : v > high ? high : v;
  function serve(toward, random) {
    const angle = (random() - 0.5) * 0.7;
    const step2 = BALL_STEP;
    const sign = toward === "right" ? 1 : -1;
    return {
      x: COURT_WIDTH / 2,
      y: COURT_HEIGHT / 2,
      vx: Math.cos(angle) * step2 * sign,
      vy: Math.sin(angle) * step2
    };
  }
  function newGame2(random = Math.random) {
    return {
      ball: serve("left", random),
      paddles: { left: centre(), right: centre() },
      score: { left: 0, right: 0 },
      hits: 0,
      controlled: null,
      status: "playing",
      steps: 0,
      lastPoint: null
    };
  }
  var centre = () => ({ y: COURT_HEIGHT / 2 });
  function movePaddle(paddle, dy) {
    return { y: clamp2(paddle.y + dy, PADDLE_LOW, PADDLE_HIGH) };
  }
  function takeOver(game, side) {
    return game.controlled === side ? game : { ...game, controlled: side };
  }
  function moveVisitor(game, dy) {
    if (game.status !== "playing") return game;
    const side = "right";
    return {
      ...game,
      controlled: side,
      paddles: { ...game.paddles, [side]: movePaddle(game.paddles[side], dy) }
    };
  }
  function sunnyTarget(game, side) {
    const incoming = side === "left" ? game.ball.vx < 0 : game.ball.vx > 0;
    if (!incoming) return COURT_HEIGHT / 2;
    const ticksToArrive = Math.abs((facePlane(side) - game.ball.x) / game.ball.vx);
    const predicted = game.ball.y + game.ball.vy * ticksToArrive;
    const span = PADDLE_HIGH - PADDLE_LOW;
    const period = span * 2;
    let reflected = ((predicted - PADDLE_LOW) % period + period) % period;
    if (reflected > span) reflected = period - reflected;
    return PADDLE_LOW + reflected;
  }
  function sunnyBatY(game, side) {
    const crossing = sunnyTarget(game, side);
    const incoming = side === "left" ? game.ball.vx < 0 : game.ball.vx > 0;
    if (!incoming) return crossing;
    const opponentY = game.paddles[other2(side)].y;
    const middle = (PADDLE_LOW + PADDLE_HIGH) / 2;
    const aim = opponentY < middle ? PADDLE_HIGH : PADDLE_LOW;
    const span = Math.abs(facePlane(other2(side)) - facePlane(side));
    const angle = clamp2(Math.atan2(aim - crossing, span), -MAX_BOUNCE_RAD, MAX_BOUNCE_RAD);
    const offset = angle / MAX_BOUNCE_RAD;
    return clamp2(crossing - offset * (PADDLE_HALF + BALL_RADIUS), PADDLE_LOW, PADDLE_HIGH);
  }
  function track(paddle, target) {
    const delta = target - paddle.y;
    if (Math.abs(delta) <= PADDLE_SPEED) return { y: target };
    return movePaddle(paddle, Math.sign(delta) * PADDLE_SPEED);
  }
  function bounce(ball, paddle, side) {
    const offset = clamp2((ball.y - paddle.y) / (PADDLE_HALF + BALL_RADIUS), -1, 1);
    const step2 = Math.min(MAX_BALL_STEP, Math.hypot(ball.vx, ball.vy) * STEP_GAIN);
    const angle = offset * MAX_BOUNCE_DEG * Math.PI / 180;
    const outward = side === "left" ? 1 : -1;
    return {
      x: facePlane(side),
      y: ball.y,
      vx: Math.cos(angle) * step2 * outward,
      vy: Math.sin(angle) * step2
    };
  }
  function step(game, random = Math.random) {
    if (game.status !== "playing") return game;
    const steps = game.steps + 1;
    let paddles = game.paddles;
    for (const side of ["left", "right"]) {
      if (side === "right" && game.controlled === "right") continue;
      paddles = { ...paddles, [side]: track(paddles[side], sunnyBatY(game, side)) };
    }
    const before = game.ball;
    const ball = {
      x: before.x + before.vx,
      y: before.y + before.vy,
      vx: before.vx,
      vy: before.vy
    };
    let vy = ball.vy;
    let y = ball.y;
    if (y - BALL_RADIUS < WALL_TOP && vy < 0) {
      y = WALL_TOP + BALL_RADIUS;
      vy = -vy;
    } else if (y + BALL_RADIUS > WALL_BOTTOM && vy > 0) {
      y = WALL_BOTTOM - BALL_RADIUS;
      vy = -vy;
    }
    let next = { x: ball.x, y, vx: ball.vx, vy };
    let hits = game.hits;
    for (const side of ["left", "right"]) {
      const plane = facePlane(side);
      const crossed = side === "left" ? before.x >= plane && ball.x < plane : before.x <= plane && ball.x > plane;
      if (!crossed) continue;
      const paddle = paddles[side];
      if (Math.abs(next.y - paddle.y) > PADDLE_HALF + BALL_RADIUS) continue;
      next = bounce(next, paddle, side);
      hits += 1;
    }
    for (const side of ["left", "right"]) {
      const scored = side === "left" ? next.x < backWall("left") : next.x > backWall("right");
      if (!scored) continue;
      const conceded = side;
      const winner = other2(conceded);
      const score = { ...game.score, [winner]: game.score[winner] + 1 };
      const over = score[winner] >= WIN_SCORE;
      if (over) {
        return {
          ...game,
          ball: next,
          paddles,
          score,
          hits,
          status: "over",
          steps,
          lastPoint: winner
        };
      }
      return {
        ...game,
        ball: serve(conceded, random),
        paddles,
        score,
        hits: 0,
        steps,
        lastPoint: winner
      };
    }
    return { ...game, ball: next, paddles, hits, steps };
  }
  function leader(game) {
    if (game.score.left === game.score.right) return null;
    return game.score.left > game.score.right ? "left" : "right";
  }
  function ballSpeed(game) {
    return Math.hypot(game.ball.vx, game.ball.vy);
  }

  // apps/character-lab/src/game.ts
  var { CELLS: CELLS2, isLegal: isLegal2, move: move2, newGame: newGame3, sunnyMove: sunnyMove2 } = tic_tac_toe_exports;
  var HUMAN = "X";
  var SUNNY = "O";
  var THINK_MS = 700;
  function gamePanel(host2) {
    let game = newGame3(HUMAN);
    let dueAt = null;
    let lastSeen = 0;
    const status = el("p", { class: "game-status" });
    const log = el("div", { class: "mono game-log" });
    const board2 = el("div", { class: "board", role: "grid", "aria-label": "Tic-tac-toe board" });
    const cells = [];
    for (let cell = 0; cell < CELLS2; cell++) {
      const button = el("button", {
        class: "cell",
        type: "button",
        "data-cell": String(cell),
        "aria-label": `Square ${cell}`
      });
      button.addEventListener("click", () => play(cell));
      cells.push(button);
      board2.append(button);
    }
    const fresh = el("button", { class: "btn", type: "button", text: "New game" });
    fresh.addEventListener("click", () => start2());
    const element = el("div", { class: "game" }, [
      board2,
      el("div", { class: "game-side" }, [
        status,
        fresh,
        log,
        el("p", {
          class: "note",
          text: "You are X and move first. Sunny plays a heuristic \u2014 she takes a win, blocks yours, prefers the centre, then a corner \u2014 so she punishes a slip but cannot see a fork. The log below is the move history the rules can replay from."
        })
      ])
    ]);
    function visitorToPlay() {
      return game.status === "playing" && game.turn === HUMAN && dueAt === null;
    }
    function statusText() {
      if (game.status === "drawn") return "A draw. Neither of us got three.";
      if (game.status === "won") return game.winner === SUNNY ? "Sunny wins." : "You win!";
      if (dueAt !== null) return "Sunny is thinking\u2026";
      return game.turn === HUMAN ? "Your turn \u2014 you are X" : "Sunny\u2019s turn";
    }
    function render() {
      for (let cell = 0; cell < CELLS2; cell++) {
        const button = cells[cell];
        const mark = game.squares[cell];
        button.textContent = mark ?? "";
        button.dataset.square = mark ?? "empty";
        button.disabled = !visitorToPlay() || mark !== null;
        if (game.line?.includes(cell)) button.dataset.win = "1";
        else delete button.dataset.win;
      }
      status.textContent = statusText();
      status.dataset.outcome = game.status === "playing" ? "playing" : game.status === "drawn" ? "drawn" : game.winner;
      log.textContent = game.moves.length === 0 ? "no moves yet" : game.moves.map((cell, i) => `${i % 2 === 0 ? HUMAN : SUNNY}${cell}`).join("  ");
      log.dataset.moves = game.moves.join(",");
    }
    function settle2() {
      if (game.status === "won") {
        host2.animator().dispatch({ type: game.winner === SUNNY ? "impress" : "celebrate" }, host2.now());
      }
      host2.redraw();
    }
    function play(cell) {
      if (!visitorToPlay() || !isLegal2(game, cell)) return;
      const now = host2.now();
      game = move2(game, cell);
      if (game.status === "playing") {
        dueAt = now + THINK_MS;
        host2.animator().dispatch({ type: "turn_started" }, now);
      }
      render();
      if (game.status === "playing") host2.redraw();
      else settle2();
    }
    function start2() {
      game = newGame3(HUMAN);
      dueAt = null;
      host2.animator().dispatch({ type: "play_started" }, host2.now());
      render();
      host2.redraw();
    }
    start2();
    return {
      element,
      tick(now) {
        if (now < lastSeen && dueAt !== null) dueAt = now + THINK_MS;
        lastSeen = now;
        if (dueAt === null || now < dueAt) return false;
        dueAt = null;
        game = move2(game, sunnyMove2(game));
        host2.animator().dispatch({ type: "turn_finished" }, now);
        render();
        if (game.status === "playing") host2.redraw();
        else settle2();
        return true;
      }
    };
  }

  // apps/character-lab/src/pong.ts
  var STEP_MS2 = 16;
  var MAX_CATCHUP = STEP_MS2 * 6;
  var SVG_WIDTH = 308;
  var SVG_HEIGHT = 200;
  var COURT_X = 106;
  var CHAR_X = 62;
  var CHAR_Y = 100;
  var CHAR_SCALE = 0.8;
  var ARM_RAY = 2;
  function pongPanel(host2) {
    let game = ping_pong_exports.newGame();
    let rallies = 1;
    let owed = 0;
    let last = null;
    const held2 = /* @__PURE__ */ new Set();
    const scene = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    scene.setAttribute("viewBox", `0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`);
    scene.setAttribute("role", "img");
    scene.setAttribute("aria-label", "Sunny at a ping pong table, mid-rally");
    const surface = el("div", { class: "pong-surface", tabindex: "0", role: "application" });
    surface.setAttribute("aria-label", "Ping pong: the up and down arrows move your bat");
    surface.append(scene);
    const message = el("p", { class: "game-status", "data-readout": "status" });
    const leftScore = el("span", { class: "mono", "data-readout": "sunny" });
    const rightScore = el("span", { class: "mono", "data-readout": "you" });
    const rally = el("span", { class: "mono", "data-readout": "rally" });
    const up = el("button", { class: "btn small", type: "button", text: "\u25B2", "data-key": "up" });
    const down = el("button", { class: "btn small", type: "button", text: "\u25BC", "data-key": "down" });
    const take = el("button", { class: "btn small", type: "button", text: "Hand back to Sunny" });
    const again = el("button", { class: "btn small", type: "button", text: "New rally" });
    up.addEventListener("click", () => move3(-ping_pong_exports.PADDLE_KICK));
    down.addEventListener("click", () => move3(ping_pong_exports.PADDLE_KICK));
    take.addEventListener("click", () => {
      game = ping_pong_exports.takeOver(game, null);
      draw();
    });
    again.addEventListener("click", () => restart());
    const keys = (event, down2) => {
      if (event.key === "ArrowUp" || event.key === "w" || event.key === "W") {
        if (down2) held2.add("up");
        else held2.delete("up");
      } else if (event.key === "ArrowDown" || event.key === "s" || event.key === "S") {
        if (down2) held2.add("down");
        else held2.delete("down");
      } else {
        return;
      }
      event.preventDefault();
    };
    surface.addEventListener("keydown", (event) => keys(event, true));
    surface.addEventListener("keyup", (event) => keys(event, false));
    surface.addEventListener("blur", () => held2.clear());
    const element = el("div", { class: "pong" }, [
      surface,
      el("div", { class: "pong-side" }, [
        message,
        el("div", { class: "arcade-readout" }, [
          labelled("Sunny", leftScore),
          labelled("You", rightScore),
          labelled("Rally", rally)
        ]),
        el("div", { class: "btn-row" }, [up, down, take, again]),
        el("p", {
          class: "note",
          text: 'Arrow keys or W and S move the bat, and the first press is what takes it over \u2014 until then Sunny plays both ends, which is the whole of "optional". She aims her returns at the side of the court your bat is not on; her one weakness is that she predicts in a straight line, so a ball that bounces off a wall on its way in arrives where she is not.'
        })
      ])
    ]);
    function move3(dy) {
      game = ping_pong_exports.moveVisitor(game, dy);
      draw();
    }
    function restart() {
      game = ping_pong_exports.newGame();
      rallies += 1;
      owed = 0;
      held2.clear();
      host2.animator().dispatch({ type: "play_started" }, host2.now());
      draw();
      host2.redraw();
    }
    function poseRig() {
      const rig = defaultRig();
      rig.x = CHAR_X;
      rig.y = CHAR_Y;
      rig.scale = CHAR_SCALE;
      const target = {
        x: (COURT_X + ping_pong_exports.PADDLE_LEFT_X - CHAR_X) / CHAR_SCALE,
        y: (game.paddles.left.y - CHAR_Y) / CHAR_SCALE
      };
      const arm2 = armTo(rig.rays[ARM_RAY], target);
      rig.rays[ARM_RAY] = arm2;
      const tip = rayTip(arm2);
      rig.props = [
        { id: "paddle", x: tip.x, y: tip.y, rotation: 0, scale: 1 / CHAR_SCALE, opacity: 1 }
      ];
      return rig;
    }
    function draw() {
      const at = (x) => COURT_X + x;
      const bat = game.paddles.right;
      const over = game.score.left >= ping_pong_exports.WIN_SCORE || game.score.right >= ping_pong_exports.WIN_SCORE;
      scene.innerHTML = [
        // The table, and then the part of it the ball can actually be in. The walls
        // are the edges of the second rect rather than lines drawn near them,
        // because the ball's edge meets the wall and a wall that is not where the
        // bounce happens is a lie about the rules.
        `<rect class="pong-court" x="${COURT_X}" y="1" width="${ping_pong_exports.COURT_WIDTH}" height="${ping_pong_exports.COURT_HEIGHT - 2}" rx="16"/>`,
        `<rect class="pong-field" x="${at(0)}" y="${ping_pong_exports.WALL_TOP}" width="${ping_pong_exports.COURT_WIDTH}" height="${ping_pong_exports.WALL_BOTTOM - ping_pong_exports.WALL_TOP}"/>`,
        renderSunny(poseRig(), { title: "Sunny at the table", uniqueIds: true }),
        `<line class="pong-wall" x1="${at(0)}" y1="${ping_pong_exports.WALL_TOP}" x2="${at(ping_pong_exports.COURT_WIDTH)}" y2="${ping_pong_exports.WALL_TOP}"/>`,
        `<line class="pong-wall" x1="${at(0)}" y1="${ping_pong_exports.WALL_BOTTOM}" x2="${at(ping_pong_exports.COURT_WIDTH)}" y2="${ping_pong_exports.WALL_BOTTOM}"/>`,
        `<line class="pong-centre" x1="${at(ping_pong_exports.COURT_WIDTH / 2)}" y1="${ping_pong_exports.WALL_TOP}" x2="${at(ping_pong_exports.COURT_WIDTH / 2)}" y2="${ping_pong_exports.WALL_BOTTOM}"/>`,
        // Only the right bat is drawn: Sunny's is the paddle on the end of her arm.
        `<rect class="pong-bat" x="${at(ping_pong_exports.PADDLE_RIGHT_X - ping_pong_exports.PADDLE_HALF_WIDTH)}" y="${bat.y - ping_pong_exports.PADDLE_HALF}" width="${ping_pong_exports.PADDLE_HALF_WIDTH * 2}" height="${ping_pong_exports.PADDLE_HALF * 2}" rx="3"/>`,
        `<circle class="pong-ball" cx="${at(game.ball.x)}" cy="${game.ball.y}" r="${ping_pong_exports.BALL_RADIUS}"/>`
      ].join("");
      leftScore.textContent = String(game.score.left);
      rightScore.textContent = String(game.score.right);
      rally.textContent = String(game.hits);
      message.textContent = over ? game.score.left >= ping_pong_exports.WIN_SCORE ? "Sunny took the game. New rally?" : "You took the game. New rally?" : game.controlled === "right" ? "Your bat. Arrow keys or W and S." : "Sunny is playing both ends \u2014 press a key to take the right bat.";
      take.disabled = game.controlled !== "right";
      element.dataset.status = game.status;
      element.dataset.score = `${game.score.left}-${game.score.right}`;
      element.dataset.hits = String(game.hits);
      element.dataset.rallies = String(rallies);
      element.dataset.controlled = game.controlled ?? "sunny";
      element.dataset.steps = String(game.steps);
      element.dataset.ball = `${game.ball.x.toFixed(1)},${game.ball.y.toFixed(1)}`;
      element.dataset.speed = ping_pong_exports.ballSpeed(game).toFixed(2);
    }
    host2.animator().dispatch({ type: "play_started" }, host2.now());
    draw();
    host2.redraw();
    return {
      element,
      tick(now) {
        if (last === null || now < last) {
          last = now;
          owed = 0;
        }
        owed += now - last;
        last = now;
        if (game.status !== "playing") {
          owed = 0;
          return false;
        }
        owed = Math.min(owed, MAX_CATCHUP);
        let moved = false;
        while (owed >= STEP_MS2) {
          owed -= STEP_MS2;
          moved = true;
          const direction = (held2.has("down") ? 1 : 0) - (held2.has("up") ? 1 : 0);
          if (direction !== 0) game = ping_pong_exports.moveVisitor(game, direction * ping_pong_exports.PADDLE_SPEED);
          const before = game.score.left + game.score.right;
          game = ping_pong_exports.step(game);
          if (game.score.left + game.score.right > before) {
            host2.animator().dispatch({ type: game.lastPoint === "left" ? "impress" : "celebrate" }, now);
            host2.redraw();
          }
        }
        if (moved) draw();
        return moved;
      }
    };
  }
  function labelled(label, control) {
    return el("label", { class: "field" }, [
      el("span", { class: "field-label", text: label }),
      control
    ]);
  }

  // apps/character-lab/src/lab.ts
  var FLAGSHIPS = ["idle", "think", "eureka", "cool", "charge", "open"];
  var RANK2 = { off: 0, minimal: 1, balanced: 2, playful: 3 };
  var state = {
    t: 0,
    playing: true,
    speed: 1,
    intensity: "balanced",
    reducedMotion: false,
    scrubSource: "idle",
    scrubLength: 6e3,
    zoom: 1
  };
  function poseAt(sequence, base, t) {
    const progress = sequence.loop ? t / sequence.duration % 1 : Math.min(1, t / sequence.duration);
    return sequence.pose(base, progress);
  }
  var cards = [];
  var host;
  function buildGrid() {
    cards = SEQUENCES.map((sequence) => {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 200 200");
      svg.setAttribute("width", "128");
      svg.setAttribute("height", "128");
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", `${sequence.id} at the current scrub position`);
      const note = el("div", { class: "card-note" });
      const card = el("button", { class: "card", type: "button", "data-group": sequence.group }, [
        el("div", { class: "card-art" }, [svg]),
        el("div", { class: "card-id", text: sequence.id }),
        note
      ]);
      card.addEventListener("click", () => {
        state.scrubSource = sequence.id;
        state.scrubLength = sequence.duration;
        renderScrubber();
      });
      host.append(card);
      return { id: sequence.id, group: sequence.group, rank: RANK2[sequence.intensity], svg, note };
    });
  }
  function frame() {
    const base = defaultRig();
    for (const card of cards) {
      const sequence = SEQUENCES.find((s) => s.id === card.id);
      const rig = poseAt(sequence, base, state.t);
      card.svg.innerHTML = renderSunny(rig, { title: sequence.id, uniqueIds: true });
      const eligible = card.rank <= RANK2[state.intensity];
      card.note.textContent = [
        sequence.group,
        `${sequence.duration}ms`,
        sequence.loop ? "loops" : "once",
        sequence.intensity,
        eligible ? "" : `\xB7 hidden below ${sequence.intensity}`
      ].filter(Boolean).join(" \xB7 ");
      card.svg.parentElement?.classList.toggle("ineligible", !eligible);
      card.svg.parentElement?.classList.toggle(
        "has-props",
        rig.props.some((p) => p.opacity > 0.01)
      );
    }
    renderBigStage();
    const frame2 = animator.lastFrame;
    const liveGroups = new Set(
      [frame2?.sequenceId ?? null, ...frame2?.overlays ?? []].map((id) => id ? groupOfSequence.get(id) : void 0).filter((group) => group !== void 0)
    );
    for (const moment of moments) {
      const live = liveGroups.has(moment.group);
      moment.node.classList.toggle("live", live);
      if (live) moment.node.dataset.drawn = "1";
    }
  }
  var moments = [];
  var groupOfSequence = new Map(SEQUENCES.map((s) => [s.id, s.group]));
  var ROUTE = {
    listen: ["attention"],
    think: ["turn_started"],
    // Looking things up happens while a turn is being worked out.
    "lookup-book": ["turn_started"],
    "lookup-laptop": ["turn_started"],
    "lookup-magnify": ["turn_started"],
    gesture: ["speaking_started"],
    lean: ["attention"],
    // The lounge is what the director asks for after a long quiet spell.
    lounge: ["idle_timeout"],
    // The glow, ponder and droop are the floors of their states.
    "celebrate-glow": ["celebrate"],
    ponder: ["confused"],
    droop: ["turn_started", "turn_failed"],
    // The answer arriving: `speaking_started` out of thinking is what the engine
    // itself reads as the eureka, so the gallery only has to set the scene.
    eureka: ["turn_started", "speaking_started"],
    speak: ["speaking_started"],
    guide: ["guiding_started"],
    // A game starting is what makes Sunny show off; the move itself is the
    // engine's, asked for by `play_started` the same way the eureka is asked for
    // by `speaking_started` out of thinking.
    play: ["play_started"],
    // A wave cleared in the arcade cabinet (A10). The route is the cue itself
    // rather than a state to move into, because the spin happens *inside* a game:
    // it is the one moment in the catalogue that plays on top of the state instead
    // of replacing it, so the gallery demonstrates it the way the cabinet asks for
    // it -- `spin`, from rest -- rather than by moving the machine somewhere first.
    arcade: ["spin"],
    // The break Sunny takes when the visitor closes the chat. The panel has to be
    // open for there to be anything to close, so the route opens it first: a
    // dismissal from rest is legal, but it is not the moment A04 is about, and the
    // bubble arriving first is the half-second of context that makes the chair
    // read as a break rather than as furniture appearing from nowhere.
    relax: ["attention", "dismissed"],
    confused: ["confused"],
    // `turn_failed` is not accepted from rest, so the error has to be reached the
    // way it really happens: a turn that started and then failed.
    error: ["turn_started", "turn_failed"]
    // `bloom` (A11) has no route, and is the first card that does not. Nothing in
    // the engine asks for the planting -- it is not a response to anything, which
    // is why it has no event at all -- so there is no sequence of events that
    // would produce it. The click plays it by name, which is how an application
    // asks for it, and the tooltip says what the empty route means.
  };
  function buildCatalogue() {
    const host2 = document.getElementById("catalogue-card");
    moments = CATALOGUE.map((entry) => {
      const route = ROUTE[entry.group] ?? [];
      const button = el("button", {
        class: "btn small",
        type: "button",
        text: "Play",
        title: route.length === 0 ? "Plays from the resting state" : `Goes idle \u2192 ${route.join(" \u2192 ")}`
      });
      button.addEventListener("click", () => {
        for (const moment of moments) delete moment.node.dataset.drawn;
        animator.reset();
        animator.dispatch({ type: "idle" }, state.t);
        for (const type of route) animator.dispatch({ type }, state.t);
        animator.play(entry.group, state.t);
        const best = bestInGroup(entry.group, state.intensity);
        if (best) {
          state.scrubSource = best.id;
          state.scrubLength = best.duration;
        }
        renderScrubber();
        renderBigStage();
      });
      const node = el(
        "div",
        { class: entry.asked === "engine" ? "moment" : "moment unwired", "data-group": entry.group },
        [
          el("div", { class: "moment-head" }, [
            el("span", { class: "moment-name", text: entry.name }),
            el("span", { class: "moment-cat", text: entry.category })
          ]),
          el("div", { class: "moment-desc", text: entry.description }),
          el("div", { class: "moment-foot" }, [
            el("span", {
              class: "moment-asked",
              // The backticks read well in the source and badly on a page.
              text: entry.askedBy ? `asked by ${entry.askedBy.replace(/`/g, "")}` : "no caller yet"
            }),
            button
          ]),
          ...entry.note ? [el("div", { class: "moment-why", text: entry.note })] : []
        ]
      );
      host2.append(node);
      return { group: entry.group, node, button };
    });
    refreshCatalogue();
  }
  function refreshCatalogue() {
    for (const moment of moments) {
      const best = bestInGroup(moment.group, state.intensity);
      moment.button.disabled = best === null;
      moment.button.textContent = best ? `Play \xB7 ${best.id}` : `hidden at ${state.intensity}`;
    }
  }
  function reactions() {
    return {
      dispatch: (type) => {
        animator.dispatch({ type }, state.t);
        renderBigStage();
      }
    };
  }
  function loadArcade() {
    return new Promise((resolve, reject) => {
      if (window.SunnyArcade) {
        resolve(window.SunnyArcade);
        return;
      }
      const script = document.createElement("script");
      script.src = "/arcade.js";
      script.addEventListener(
        "load",
        () => {
          const loaded = window.SunnyArcade;
          if (loaded) resolve(loaded);
          else reject(new Error("arcade.js loaded but registered nothing"));
        },
        { once: true }
      );
      script.addEventListener("error", () => reject(new Error("the arcade bundle did not load")), {
        once: true
      });
      document.head.append(script);
    });
  }
  function buildArcade() {
    const host2 = document.getElementById("arcade");
    const slot = el("div", { class: "arcade-slot" });
    const note = el("p", {
      class: "note",
      text: "Nothing here is fetched until the button is pressed."
    });
    const button = el("button", { class: "btn", type: "button", text: "Load the arcade" });
    button.addEventListener("click", () => {
      button.disabled = true;
      button.textContent = "Loading\u2026";
      loadArcade().then((loaded) => {
        loaded.mount(slot, reactions());
        button.remove();
        note.textContent = "Loaded: /arcade.js arrived on the press and not before.";
      }).catch((error2) => {
        button.disabled = false;
        button.textContent = "Load the arcade";
        note.textContent = error2 instanceof Error ? error2.message : "the arcade did not load";
      });
    });
    host2.append(button, note, slot);
  }
  var stageSvg = null;
  var stageLabel = null;
  var animator = new SunnyAnimator(defaultRig(), { intensity: "balanced" });
  var board = null;
  var table = null;
  function renderBigStage() {
    if (!stageSvg) return;
    const rig = animator.frame(state.t, {
      reducedMotion: state.reducedMotion,
      intensity: state.intensity
    }).rig;
    stageSvg.innerHTML = renderSunny(rig, { title: "Sunny", uniqueIds: true });
    if (stageLabel) {
      const result = animator.lastFrame;
      const props = rig.props.filter((prop2) => prop2.opacity > 1e-3).map((prop2) => prop2.id);
      stageLabel.textContent = [
        `state: ${animator.state}`,
        `sequence: ${result?.sequenceId ?? "none"}`,
        props.length > 0 ? `props: ${props.join(", ")}` : "",
        `${state.t.toFixed(0)}ms`
      ].filter(Boolean).join("   \xB7   ");
    }
  }
  function controls() {
    const playButton = el("button", { class: "btn", type: "button", text: "Pause" });
    playButton.addEventListener("click", () => {
      state.playing = !state.playing;
      playButton.textContent = state.playing ? "Pause" : "Play";
    });
    const speed = el("input", {
      type: "range",
      min: "0.1",
      max: "2",
      step: "0.1",
      value: "1",
      "aria-label": "Playback speed"
    });
    const speedLabel = el("span", { class: "mono", text: "1.0\xD7" });
    speed.addEventListener("input", () => {
      state.speed = Number(speed.value);
      speedLabel.textContent = `${state.speed.toFixed(1)}\xD7`;
    });
    const intensity = el("select", { "aria-label": "Intensity" });
    for (const value of INTENSITIES) {
      intensity.append(el("option", { value, text: value, selected: value === state.intensity }));
    }
    intensity.addEventListener("change", () => {
      state.intensity = intensity.value;
      animator = new SunnyAnimator(defaultRig(), {
        intensity: state.intensity,
        reducedMotion: state.reducedMotion
      });
      renderScrubber();
    });
    const reduced = el("input", { type: "checkbox", id: "reduced" });
    reduced.addEventListener("change", () => {
      state.reducedMotion = reduced.checked;
      animator = new SunnyAnimator(defaultRig(), {
        intensity: state.intensity,
        reducedMotion: state.reducedMotion
      });
      renderScrubber();
    });
    const zoom = el("input", {
      type: "range",
      min: "0.5",
      max: "3",
      step: "0.25",
      value: "1",
      "aria-label": "Zoom"
    });
    zoom.addEventListener("input", () => {
      state.zoom = Number(zoom.value);
      document.documentElement.style.setProperty("--zoom", String(state.zoom));
    });
    return el("div", { class: "controls" }, [
      playButton,
      labelled2("Speed", speed, speedLabel),
      labelled2("Intensity", intensity),
      labelled2("Zoom", zoom),
      el("label", { class: "check" }, [reduced, el("span", { text: "prefers-reduced-motion" })])
    ]);
  }
  function labelled2(label, control, suffix) {
    return el("label", { class: "field" }, [
      el("span", { class: "field-label", text: label }),
      control,
      ...suffix ? [suffix] : []
    ]);
  }
  var scrubInput = null;
  var scrubLabel = null;
  var eventLog = null;
  function scrubber() {
    scrubInput = el("input", {
      type: "range",
      min: "0",
      max: String(state.scrubLength),
      step: "1",
      value: "0",
      "aria-label": "Scrub the selected sequence"
    });
    scrubInput.addEventListener("input", () => {
      state.t = Number(scrubInput.value);
      state.playing = false;
      renderScrubber();
      frame();
    });
    const picker = el("select", { "aria-label": "Sequence to scrub" });
    for (const group of GROUPS) {
      const optgroup = el("optgroup", { label: group });
      for (const sequence of sequencesInGroup(group)) {
        optgroup.append(
          el("option", {
            value: sequence.id,
            text: `${sequence.id} (${sequence.duration}ms)`,
            selected: sequence.id === state.scrubSource
          })
        );
      }
      picker.append(optgroup);
    }
    picker.addEventListener("change", () => {
      state.scrubSource = picker.value;
      state.scrubLength = SEQUENCES.find((s) => s.id === picker.value)?.duration ?? 1e3;
      renderScrubber();
    });
    eventLog = el("div", { class: "event-log" });
    const events = [
      ["attention", "attention"],
      ["turn_started", "turn_started"],
      ["turn_finished", "turn_finished"],
      ["turn_failed", "turn_failed"],
      ["celebrate", "celebrate"],
      ["impress", "impress"],
      ["confused", "confused"],
      ["guiding_started", "guiding_started"],
      ["play_started", "play_started"],
      ["dismissed", "dismissed"]
    ];
    const eventButtons = events.map(([label, type]) => {
      const button = el("button", { class: "btn small", type: "button", text: label });
      button.addEventListener("click", () => {
        animator.dispatch({ type }, state.t);
        if (eventLog) {
          eventLog.textContent = `${state.t.toFixed(0)}ms  ${label} \u2192 ${animator.state}`;
        }
        renderBigStage();
      });
      return button;
    });
    const streamButtons = [
      "tool_started",
      "tool_finished",
      "recommendation_ready",
      "lead_saved",
      "error",
      "message_finished"
    ].map((type) => {
      const button = el("button", { class: "btn small ghost", type: "button", text: type });
      button.addEventListener("click", () => {
        const mapped = machineEventForStreamEvent({ type });
        if (mapped) animator.dispatch(mapped, state.t);
        if (eventLog) {
          eventLog.textContent = `${type} \u2192 ${mapped ? mapped.type : "no behavioural meaning"} \u2192 ${animator.state}`;
        }
        renderBigStage();
      });
      return button;
    });
    return el("div", { class: "scrubber" }, [
      labelled2("Sequence", picker),
      el("div", { class: "scrub-row" }, [scrubInput, scrubLabel = el("span", { class: "mono" })]),
      el("div", { class: "btn-row" }, [
        el("span", { class: "field-label", text: "machine events" }),
        ...eventButtons
      ]),
      el("div", { class: "btn-row" }, [
        el("span", { class: "field-label", text: "stream events" }),
        ...streamButtons
      ]),
      eventLog
    ]);
  }
  function renderScrubber() {
    if (scrubInput) {
      scrubInput.max = String(state.scrubLength);
      if (Number(scrubInput.value) > state.scrubLength) scrubInput.value = String(state.scrubLength);
    }
    if (scrubLabel) scrubLabel.textContent = `${state.t.toFixed(0)} / ${state.scrubLength} ms`;
    refreshCatalogue();
  }
  function start() {
    host = document.getElementById("grid");
    buildGrid();
    buildCatalogue();
    const stage = document.getElementById("stage");
    stageSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    stageSvg.setAttribute("viewBox", "0 0 200 200");
    stageSvg.setAttribute("role", "img");
    stageSvg.setAttribute("aria-label", "The character, driven by the state machine");
    stageLabel = el("div", { class: "mono stage-label" });
    stage.append(
      stageSvg,
      el("div", {
        class: "stage-hint",
        text: "Tap her to give her a balloon, then tap the balloon to pop it."
      }),
      stageLabel
    );
    stage.addEventListener("pointerup", (event) => {
      if (!stageSvg) return;
      const ctm = stageSvg.getScreenCTM();
      if (!ctm) return;
      const point2 = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
      const hit = animator.tap({ x: point2.x, y: point2.y }, state.t);
      renderBigStage();
      if (eventLog) {
        const at = `${point2.x.toFixed(0)},${point2.y.toFixed(0)}`;
        eventLog.textContent = hit ? `${state.t.toFixed(0)}ms  tap ${at} \u2192 ${animator.lastFrame?.sequenceId ?? "requested"}` : `${state.t.toFixed(0)}ms  tap ${at} \u2192 nothing there`;
      }
    });
    board = gamePanel({
      animator: () => animator,
      now: () => state.t,
      redraw: () => renderBigStage()
    });
    document.getElementById("game").append(board.element);
    table = pongPanel({
      animator: () => animator,
      now: () => state.t,
      redraw: () => renderBigStage()
    });
    document.getElementById("pong").append(table.element);
    buildArcade();
    document.getElementById("controls").append(controls());
    document.getElementById("scrubber").append(scrubber());
    const flagshipRow = el("div", { class: "btn-row" });
    for (const group of FLAGSHIPS) {
      const best = bestInGroup(group, state.intensity);
      const button = el("button", {
        class: "btn small",
        type: "button",
        text: `${group} \u2192 ${best?.id ?? "none"}`
      });
      button.addEventListener("click", () => {
        animator.play(group, state.t);
        renderBigStage();
      });
      flagshipRow.append(button);
    }
    document.getElementById("flagships").append(flagshipRow);
    const swatch = document.getElementById("theme-swatch");
    for (const [name, value] of Object.entries(SUNNY_THEME)) {
      if (typeof value !== "string") continue;
      swatch.append(
        el("div", { class: "swatch" }, [
          el("span", { class: "swatch-chip", style: `background:${value}` }),
          el("span", { class: "mono", text: name })
        ])
      );
    }
    let last = performance.now();
    const tick = (now) => {
      requestAnimationFrame(tick);
      const dt = Math.min(64, now - last);
      last = now;
      if (state.playing) {
        state.t += dt * state.speed;
        if (state.t > state.scrubLength && animator.scheduler.active.length === 0) state.t = 0;
        if (scrubInput) scrubInput.value = String(Math.min(state.t, state.scrubLength));
        renderScrubber();
      }
      board?.tick(state.t);
      table?.tick(state.t);
      frame();
    };
    requestAnimationFrame(tick);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => start(), { once: true });
  } else {
    start();
  }
})();
//# sourceMappingURL=lab.js.map
