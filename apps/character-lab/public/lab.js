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
      dismissed: "relaxing"
    },
    listening: {
      turn_started: "thinking",
      impress: "celebrating",
      idle: "idle",
      dismissed: "relaxing",
      confused: "confused"
    },
    thinking: {
      speaking_started: "speaking",
      impress: "celebrating",
      celebrate: "celebrating",
      turn_failed: "error",
      turn_finished: "idle",
      idle: "idle",
      confused: "confused"
    },
    speaking: {
      turn_finished: "idle",
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
      dismissed: "relaxing"
    },
    relaxing: {
      attention: "listening",
      idle: "idle"
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
      turn_started: "thinking"
    }
  };
  var SETTLE = {
    listening: { afterMs: 6e4, to: "idle" },
    thinking: { afterMs: 45e3, to: "error" },
    speaking: { afterMs: 9e4, to: "idle" },
    guiding: { afterMs: 2e4, to: "idle" },
    celebrating: { afterMs: 4e3, to: "idle" },
    confused: { afterMs: 3500, to: "idle" }
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
      const settle = SETTLE[this.#state];
      if (!settle || now - this.#enteredAt < settle.afterMs) {
        return { state: this.#state, changed: false };
      }
      this.#state = settle.to;
      this.#enteredAt = now;
      return { state: settle.to, changed: true };
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
  var EYE = {
    /** Eye outline stroke width, measured at 11 px. */
    strokeWidth: 1.4,
    /**
     * Where along the eye the opening is widest, as a fraction of the half-height
     * (−1 = top, +1 = bottom). The reference eye is fullest above the middle.
     */
    widest: 0,
    /** The lower half narrows to this fraction of the upper half's width. */
    taper: 0.85
  };
  var EYE_HIGHLIGHT = {
    /**
     * Width of the cream strip, as a fraction of the eye's outer width. The
     * reference's cream is very nearly constant width down the eye rather than
     * filling a fixed fraction of it, so it is drawn as the eye's interior
     * trimmed back from its left edge by this much.
     *
     * Tuned by measurement, not by eye: at 0.55 the two highlights measured 28%
     * and 14% larger in area than the reference's; 0.47 brings them to +10% and
     * -2.5%, and the cream mask IoU over that change went 0.669 -> 0.741. It is a
     * single fraction standing in for two hand-drawn highlights, so both eyes
     * cannot be exact at once -- the reference traces them independently and they
     * do not scale with the eye alike.
     */
    widthFraction: 0.47,
    /** How far down the opening the notch sits: 0 = top, 1 = bottom. */
    notchAt: 0.54,
    /**
     * How far right the notch reaches, as a fraction of the eye's OUTER width,
     * measured from the eye's left inner edge. Deliberately not a multiple of the
     * strip's width: the reference's spike is a fixed bite out of the crescent
     * (about 12.5 units across a ~21 unit eye), not a scaled copy of the cream.
     */
    notchReach: 0.6
  };
  var BROW = {
    /**
     * Brow stroke width. The reference measures 18-21 px across the two brows,
     * but the ink area it inks (39.0 and 27.4 u2) is matched at 2.2 units.
     */
    strokeWidth: 2.2
  };
  var SMILE_PROFILE = [
    [-1, 0],
    [-0.669, 0.552],
    [-0.323, 0.924],
    [0.045, 1],
    [0.441, 0.758],
    [0.721, 0.345],
    [1, 0]
  ];

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
      theme: { ...rig.theme }
    };
  }
  function rootScale(rig) {
    return { sx: rig.scale * (1 + rig.stretch), sy: rig.scale * (1 - rig.squash) };
  }
  function toViewBox(rig, point) {
    const { sx, sy } = rootScale(rig);
    const a = rig.rotation * Math.PI / 180;
    const x = point.x * sx;
    const y = point.y * sy;
    return {
      x: rig.x + x * Math.cos(a) - y * Math.sin(a),
      y: rig.y + x * Math.sin(a) + y * Math.cos(a)
    };
  }
  function toBodyFrame(rig, point) {
    const { sx, sy } = rootScale(rig);
    const a = -rig.rotation * Math.PI / 180;
    const dx = point.x - rig.x;
    const dy = point.y - rig.y;
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

  // packages/character/src/render.ts
  var add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
  var sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
  var mul = (a, s) => ({ x: a.x * s, y: a.y * s });
  var len = (a) => Math.hypot(a.x, a.y);
  var unit = (a) => {
    const l = len(a) || 1;
    return { x: a.x / l, y: a.y / l };
  };
  function n(v) {
    const r = Math.round(v * 1e3) / 1e3;
    return Object.is(r, -0) ? "0" : String(r);
  }
  var pt = (p) => `${n(p.x)} ${n(p.y)}`;
  function roundedPolygonPath(points, radius) {
    const count = points.length;
    if (count < 3) return "";
    let d = "";
    for (let i = 0; i < count; i++) {
      const prev = points[(i - 1 + count) % count];
      const curr = points[i];
      const next = points[(i + 1) % count];
      const want = typeof radius === "number" ? radius : radius[i] ?? 0;
      const r = Math.min(want, len(sub(prev, curr)) / 2, len(sub(next, curr)) / 2);
      const a = add(curr, mul(unit(sub(prev, curr)), r));
      const b = add(curr, mul(unit(sub(next, curr)), r));
      d += i === 0 ? `M${pt(a)}` : `L${pt(a)}`;
      d += `Q${pt(curr)} ${pt(b)}`;
    }
    return `${d}Z`;
  }
  function smoothPath(points, tension = 1, corners = []) {
    if (points.length < 2) return "";
    if (points.length === 2) return `M${pt(points[0])}L${pt(points[1])}`;
    const k = tension / 6;
    let d = `M${pt(points[0])}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i - 1] ?? points[i];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2] ?? p2;
      if (corners.includes(i + 1)) {
        d += `L${pt(p2)}`;
        continue;
      }
      const c1 = add(p1, mul(sub(p2, p0), k));
      const c2 = sub(p2, mul(sub(p3, p1), k));
      d += `C${pt(c1)} ${pt(c2)} ${pt(p2)}`;
    }
    return d;
  }
  function rayPoints(ray) {
    const a = (ray.angleDeg + ray.rotation) * Math.PI / 180;
    const dir = { x: Math.sin(a), y: -Math.cos(a) };
    const perp = { x: Math.cos(a), y: Math.sin(a) };
    const baseR = RAY.baseRadius;
    const scale = Math.max(0, ray.lengthScale);
    const tipR = baseR + (RAY.tipRadius + RAY.apexCompensation - baseR) * scale;
    const halfWidth = RAY.baseHalfWidth * Math.max(0, ray.widthScale);
    const base = mul(dir, baseR);
    return [
      add(add(base, mul(perp, -halfWidth)), ray.offset),
      add(mul(dir, tipR), ray.offset),
      add(add(base, mul(perp, halfWidth)), ray.offset)
    ];
  }
  var K = 0.5523;
  function eyeOutlinePath(eye2) {
    const hw = eye2.width / 2;
    const hh = eye2.height / 2;
    const yw = EYE.widest * hh;
    const upperRise = yw + hh;
    const lowerFall = hh - yw;
    const lowerW = hw * EYE.taper;
    return [
      `M0 ${n(-hh)}`,
      // Top → right widest.
      `C${n(hw * K)} ${n(-hh)} ${n(hw)} ${n(yw - upperRise * K)} ${n(hw)} ${n(yw)}`,
      // Right widest → bottom.
      `C${n(hw)} ${n(yw + lowerFall * K)} ${n(lowerW * K)} ${n(hh)} 0 ${n(hh)}`,
      // Bottom → left widest.
      `C${n(-lowerW * K)} ${n(hh)} ${n(-hw)} ${n(yw + lowerFall * K)} ${n(-hw)} ${n(yw)}`,
      // Left widest → top.
      `C${n(-hw)} ${n(yw - upperRise * K)} ${n(-hw * K)} ${n(-hh)} 0 ${n(-hh)}`,
      "Z"
    ].join("");
  }
  function eyeHighlightPath(eye2) {
    const hw = eye2.width / 2;
    const hh = eye2.height / 2;
    const width = EYE_HIGHLIGHT.widthFraction * eye2.width;
    const stepCount = 24;
    const notchIndex = Math.round(EYE_HIGHLIGHT.notchAt * stepCount);
    const points = [];
    const corners = [];
    for (let i = 0; i <= stepCount; i++) {
      const y = (-1 + 2 * i / stepCount) * hh;
      const left = -eyeHalfWidthAt(eye2, y);
      points.push({ x: left + width, y });
      if (i === notchIndex) {
        corners.push(points.length);
        points.push({ x: left + eye2.width * EYE_HIGHLIGHT.notchReach, y });
      }
    }
    const path = smoothPath(points, 0.6, corners);
    return `${path}L${n(-hw * 3)} ${n(hh)}L${n(-hw * 3)} ${n(-hh)}Z`;
  }
  function eyeHalfWidthAt(eye2, y) {
    const hw = eye2.width / 2;
    const hh = eye2.height / 2;
    const yw = EYE.widest * hh;
    const inside = (span, w) => {
      const t = span > 0 ? (y - yw) / span : 0;
      return w * Math.sqrt(Math.max(0, 1 - t * t));
    };
    return y <= yw ? inside(yw + hh, hw) : inside(hh - yw, hw * EYE.taper);
  }
  var PROP_PATHS = {
    // A bold question mark: the bowl, the stem, and a dot.
    "question-mark": {
      d: "M-3.1-4.4a3.3 3.3 0 1 1 5.1 2.8q-2 1.3-2 3.1M0 5.6v0.1",
      filled: false
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
      `translate(${n(prop2.x)} ${n(prop2.y)})`,
      `rotate(${n(prop2.rotation)})`,
      `scale(${n(prop2.scale)})`
    ].join(" ");
    const draw = path.surface ? `fill="${paint.highlight}" stroke="${paint.ink}" stroke-width="2.2" stroke-linejoin="round"` : path.filled ? `fill="${paint.ink}"` : `fill="none" stroke="${paint.ink}" stroke-width="2.2" stroke-linecap="round"`;
    return `<g data-prop="${prop2.id}" transform="${transform}" opacity="${n(Math.min(1, prop2.opacity))}"><path d="${path.d}" ${draw}/></g>`;
  }
  function browPath(brow2) {
    const half = brow2.length * brow2.scale / 2;
    return `M${n(-half)} 0Q0 ${n(-brow2.arch * brow2.scale * 2)} ${n(half)} 0`;
  }
  function smilePath(smile) {
    const half = smile.span / 2;
    const pts = SMILE_PROFILE.map(([u, v]) => ({
      x: u * half,
      y: v * smile.depth
    }));
    return smoothPath(pts, 0.9);
  }
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
  function renderEye(side, eye2, paint, uid) {
    const closed = Math.max(0, Math.min(1, eye2.closed));
    const outline = eyeOutlinePath(eye2);
    const clipId = `sunny-eye-${uid}-${side}`;
    const scaleY = eye2.scaleY * (1 - closed * 0.94);
    const transform = [
      `translate(${n(eye2.x)} ${n(eye2.y)})`,
      `rotate(${n(eye2.rotation)})`,
      `scale(${n(eye2.scaleX)} ${n(scaleY)})`
    ].join(" ");
    const gazeX = eye2.gaze.x * eye2.width * 0.1;
    const gazeY = eye2.gaze.y * eye2.height * 0.06;
    return [
      `<g transform="${transform}">`,
      `<clipPath id="${clipId}"><path d="${outline}"/></clipPath>`,
      // Base: the whole opening reads dark, so the crescent is simply whatever
      // the highlight does not cover.
      `<path d="${outline}" fill="${paint.ink}"/>`,
      `<g clip-path="url(#${clipId})">`,
      `<path d="${eyeHighlightPath(eye2)}" transform="translate(${n(gazeX)} ${n(gazeY)})" fill="${paint.highlight}"/>`,
      `</g>`,
      // The outline is re-stroked on top, so the highlight can never eat into it.
      `<path d="${outline}" fill="none" stroke="${paint.ink}" stroke-width="${n(EYE.strokeWidth * 2)}"/>`,
      `</g>`
    ].join("");
  }
  function renderBrow(brow2, paint) {
    return [
      `<g transform="translate(${n(brow2.x)} ${n(brow2.y)}) rotate(${n(brow2.rotation)})">`,
      `<path d="${browPath(brow2)}" fill="none" stroke="${paint.ink}" stroke-width="${n(BROW.strokeWidth)}" stroke-linecap="round"/>`,
      `</g>`
    ].join("");
  }
  function renderSmile(smile, paint) {
    return [
      `<g transform="translate(${n(smile.x)} ${n(smile.y)}) rotate(${n(smile.rotation)})">`,
      `<path d="${smilePath(smile)}" fill="none" stroke="${paint.ink}" stroke-width="${n(smile.strokeWidth)}" stroke-linecap="round"/>`,
      `</g>`
    ].join("");
  }
  function renderSunny(rig, options = {}) {
    const viewBox = options.crop ? `${n(options.crop.x)} ${n(options.crop.y)} ${n(options.crop.width)} ${n(options.crop.height)}` : `0 0 ${VIEWBOX} ${VIEWBOX}`;
    const size = options.size ?? VIEWBOX;
    const paint = painters(rig, options.cssVariables ?? false);
    const uid = options.uniqueIds ? `u${instanceCounter++}-` : "";
    const squash = 1 - rig.squash;
    const stretch = 1 + rig.stretch;
    const root = [
      `translate(${n(rig.x)} ${n(rig.y)})`,
      `rotate(${n(rig.rotation)})`,
      `scale(${n(rig.scale * stretch)} ${n(rig.scale * squash)})`
    ].join(" ");
    const rays = rig.rays.filter((r) => r.visible && r.lengthScale > 0.01).map((r) => {
      const d = roundedPolygonPath(rayPoints(r), [
        RAY.apexRadius,
        RAY.cornerRadius,
        RAY.cornerRadius
      ]);
      return `<path d="${d}" fill="none" stroke="${paint.ink}" stroke-width="${n(RAY.strokeWidth)}" stroke-linejoin="round"/><path d="${d}" fill="${paint.ray}"/>`;
    }).join("");
    const face = [
      renderEye("left", rig.eyes.left, paint, uid),
      renderEye("right", rig.eyes.right, paint, uid),
      renderBrow(rig.brows.left, paint),
      renderBrow(rig.brows.right, paint),
      renderSmile(rig.smile, paint)
    ].join("");
    const props = rig.props.map((prop2) => renderProp(prop2, paint)).join("");
    const named = options.title !== void 0 && options.title !== "";
    const decorative = options.decorative ?? !named;
    const label = named && !decorative ? `<title>${escapeXml(options.title ?? "")}</title>` : "";
    const aria = decorative ? 'aria-hidden="true" focusable="false"' : `role="img" aria-label="${escapeXml(options.title ?? "Sunny")}"`;
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${n(size)}" height="${n(size)}" ${aria}${options.className ? ` class="${escapeXml(options.className)}"` : ""}>`,
      label,
      `<g transform="${root}">`,
      `<g>${rays}</g>`,
      `<circle cx="0" cy="0" r="${n(BODY.radius)}" fill="${paint.body}" stroke="${paint.ink}" stroke-width="${n(BODY.strokeWidth)}"/>`,
      `<g transform="rotate(${n(rig.faceTilt)})">${face}</g>`,
      props,
      `</g>`,
      `</svg>`
    ].join("");
  }
  function escapeXml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  }

  // packages/animation-engine/src/sequences.ts
  var TAU = Math.PI * 2;
  var wave = (p, phase = 0) => Math.sin((p + phase) * TAU);
  var bump = (t) => Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
  var land = (t) => t <= 0 || t >= 1 ? 0 : Math.sin(Math.PI * t);
  var turns = (t, whole) => whole * 360 * t % 360;
  var swell = (t, from, to) => t <= from || t >= to ? 0 : Math.sin(Math.PI * ((t - from) / (to - from)));
  var ease = (t) => {
    const c = Math.min(1, Math.max(0, t));
    return c * c * (3 - 2 * c);
  };
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
      const breath = wave(t) * 0.012;
      r.squash = breath;
      r.stretch = -breath * 0.6;
      r.y = base.y - 0.6 + wave(t) * 0.6;
      const phase = t * 4 % 1;
      const hold = ease(Math.min(1, phase * 3));
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
    states: ["idle", "listening", "speaking", "guiding", "relaxing", "playing"],
    pose: (base, t) => {
      const r = cloneRig(base);
      const close = t < 0.35 ? ease(t / 0.35) : 1 - ease((t - 0.35) / 0.65);
      r.eyes.left.closed = close;
      r.eyes.right.closed = close;
      return r;
    }
  };
  var listening = {
    id: "listening-perk",
    group: "listen",
    priority: PRIORITY.interaction,
    duration: 700,
    canInterrupt: true,
    loop: false,
    intensity: "balanced",
    assets: [],
    reducedMotionFallback: null,
    states: ["listening"],
    pose: (base, t) => {
      const r = cloneRig(base);
      const a = bump(t);
      r.eyes.left.scaleY = 1 + a * 0.16;
      r.eyes.right.scaleY = 1 + a * 0.16;
      r.eyes.left.scaleX = 1 + a * 0.05;
      r.eyes.right.scaleX = 1 + a * 0.05;
      r.y = base.y - a * 2.2;
      for (const ray of r.rays) {
        ray.lengthScale = 1 + a * 0.06;
        ray.widthScale = 1 - a * 0.04;
      }
      r.smile.depth = base.smile.depth + a * 1.2;
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
      const spin = t * 22;
      for (const [i, ray] of r.rays.entries()) {
        ray.rotation = spin;
        ray.lengthScale = 1 + wave(t * 2, -i / r.rays.length) * 0.07;
      }
      r.faceTilt = wave(t) * 2.4;
      const up = 0.62 + wave(t * 0.5) * 0.12;
      r.eyes.left.gaze = { x: -up * 0.6, y: -up };
      r.eyes.right.gaze = { x: -up * 0.6, y: -up };
      r.eyes.left.scaleY = 0.9;
      r.eyes.right.scaleY = 0.9;
      r.brows.left.y = base.brows.left.y - 1.6;
      r.brows.right.y = base.brows.right.y - 1.6;
      r.smile.span = base.smile.span * 0.62;
      r.smile.depth = base.smile.depth * 0.5;
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
    assets: ["question-mark", "sparkle"],
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
      const flare = t < 0.45 ? 0 : ease((t - 0.45) / 0.55);
      const hold = t < 0.45 ? bump(t / 0.45) : 1;
      r.props = [
        {
          id: "question-mark",
          x: -34,
          y: -30 - wave(t * 1.5) * 2,
          rotation: -12 + wave(t) * 4,
          scale: 0.5 + hold * 0.5,
          // Fades out as the flare takes over.
          opacity: Math.max(0, 1 - flare * 1.6)
        },
        {
          id: "sparkle",
          x: 36,
          y: -36,
          rotation: flare * 90,
          scale: 0.4 + flare * 0.9,
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
      const beat = wave(t * 2);
      r.smile.depth = base.smile.depth * (1 + beat * 0.26);
      r.smile.span = base.smile.span * (1 + beat * 0.05);
      r.smile.y = base.smile.y + beat * 0.7;
      r.brows.left.y = base.brows.left.y + beat * 1.5;
      r.brows.right.y = base.brows.right.y + beat * 1.5;
      r.y = base.y + wave(t) * 0.8;
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
      r.faceTilt = lean + wave(t) * 1.4;
      r.rotation = lean * 0.4;
      const arm = r.rays[2];
      if (arm) {
        arm.lengthScale = 1.35;
        arm.widthScale = 1.5;
        arm.rotation = 8;
        arm.offset = { x: 6, y: 0 };
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
      r.rotation = ease(Math.min(1, t / 0.8)) * 720;
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
      const a = bump(t);
      const hop = Math.abs(Math.sin(t * Math.PI * 2)) * (1 - t * 0.4);
      r.y = base.y - hop * 6;
      r.squash = (0.06 - hop * 0.09) * (t < 0.5 ? 1 : 0.6);
      r.stretch = -r.squash * 0.7;
      r.rotation = wave(t * 2) * 6;
      r.smile.span = base.smile.span * (1 + a * 0.22);
      r.smile.depth = base.smile.depth * (1 + a * 0.3);
      r.eyes.left.scaleY = 1 - a * 0.26;
      r.eyes.right.scaleY = 1 - a * 0.26;
      r.brows.left.y = base.brows.left.y - a * 4;
      r.brows.right.y = base.brows.right.y - a * 4;
      r.props = [
        { id: "sparkle", x: -38, y: -34, rotation: a * 90, scale: 0.4 + a * 0.6, opacity: a },
        { id: "sparkle", x: 40, y: -22, rotation: -a * 90, scale: 0.4 + a * 0.6, opacity: a }
      ];
      for (const [i, ray] of r.rays.entries()) {
        ray.lengthScale = 1 + a * 0.12 * (i % 2 === 0 ? 1 : -0.4);
      }
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
      const a = bump(t);
      r.faceTilt = -14 * a;
      r.rotation = -4 * a;
      r.eyes.left.scaleY = 1 - a * 0.12;
      r.eyes.right.scaleY = 1 + a * 0.22;
      r.brows.left.y = base.brows.left.y - a * 5;
      r.brows.left.rotation = base.brows.left.rotation + a * 10;
      r.brows.right.y = base.brows.right.y + a * 3;
      r.smile.depth = base.smile.depth * (1 - a * 0.55);
      r.smile.rotation = base.smile.rotation + a * 8;
      r.props = [
        {
          id: "question-mark",
          x: 36,
          y: -34,
          rotation: 14,
          scale: 0.55 + a * 0.35,
          opacity: a * 1.2 > 1 ? 1 : a * 1.2
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
      const a = bump(t);
      for (const ray of r.rays) {
        ray.lengthScale = 1 - a * 0.22;
        ray.widthScale = 1 - a * 0.18;
      }
      r.squash = a * 0.08;
      r.stretch = -a * 0.06;
      r.smile.depth = base.smile.depth * (1 - a * 0.85);
      r.eyes.left.scaleY = 1 - a * 0.35;
      r.eyes.right.scaleY = 1 - a * 0.35;
      r.brows.left.y = base.brows.left.y + a * 4;
      r.brows.right.y = base.brows.right.y + a * 4;
      r.props = [
        {
          id: "sweat-drop",
          x: 26,
          y: -32 + a * 6,
          rotation: 0,
          scale: 0.55,
          opacity: a
        }
      ];
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
      const r = cloneRig(base);
      const descend = ease(Math.min(1, t / 0.3));
      const leave = t > 0.82 ? ease((t - 0.82) / 0.18) : 0;
      const drop = -34 * (1 - descend) - leave * 40;
      const overshoot = t < 0.3 ? 0 : Math.sin(t * Math.PI * 5) * Math.exp(-(t - 0.3) * 9) * 1.6;
      r.faceTilt = 0;
      const lean = bump(Math.min(1, t / 0.6));
      r.rotation = base.rotation - lean * 2.2;
      r.y = base.y - lean * 1.2;
      r.eyes.left.gaze = { x: 0.12, y: -0.1 };
      r.eyes.right.gaze = { x: 0.12, y: -0.1 };
      r.smile.depth = base.smile.depth * (1 + descend * 0.18);
      for (const ray of r.rays) {
        ray.lengthScale = 1 + lean * 0.06;
      }
      r.props = [
        {
          id: "sunglasses",
          x: -1.4,
          y: -5.1 + drop + overshoot,
          rotation: -3,
          scale: 1,
          opacity: Math.min(1, Math.max(0, 1 - leave))
        }
      ];
      return r;
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
      const r = cloneRig(base);
      const descend = ease(Math.min(1, t / 0.26));
      const leave = t > 0.85 ? ease((t - 0.85) / 0.15) : 0;
      const drop = -40 * (1 - descend) - leave * 44;
      const overshoot = t < 0.26 ? 0 : Math.sin(t * Math.PI * 6) * Math.exp(-(t - 0.26) * 8) * 2.2;
      const strut = Math.sin(t * Math.PI * 4) * (t < 0.7 ? bump(t / 0.7) : 0);
      r.faceTilt = 0;
      r.rotation = base.rotation + strut * 4.5;
      r.x = base.x + strut * 2.6;
      r.y = base.y - bump(t) * 2.2;
      r.squash = strut * 0.02;
      for (const ray of r.rays) {
        ray.lengthScale = 1 + Math.max(0, strut) * 0.16;
        ray.rotation = ray.rotation + strut * 6;
      }
      r.smile.depth = base.smile.depth * (1 + descend * 0.3);
      r.props = [
        {
          id: "sunglasses",
          x: -1.4,
          y: -5.1 + drop + overshoot,
          rotation: -6 + strut * 4,
          scale: 1,
          opacity: Math.min(1, Math.max(0, 1 - leave))
        },
        // A sparkle flicks off the right lens as they land, then is gone.
        {
          id: "sparkle",
          x: 15,
          y: -12 + overshoot,
          rotation: 24 + t * 140,
          scale: 0.5 * Math.max(0, 1 - t * 2.6),
          opacity: Math.max(0, 1 - t * 2.2)
        }
      ];
      return r;
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
      const charge = ease(Math.min(1, t / 0.85));
      for (const [i, ray] of r.rays.entries()) {
        const pulse = Math.max(0, wave(t * 2.5, -i / r.rays.length));
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
      const compress = t < 0.35 ? ease(t / 0.35) : 0;
      const spring = t < 0.35 ? 0 : Math.sin((t - 0.35) / 0.65 * Math.PI * 2) * Math.exp(-(t - 0.35) * 6);
      r.squash = compress * 0.16 - spring * 0.05;
      r.stretch = compress * 0.12 + spring * 0.04;
      r.y = base.y + compress * 4;
      for (const ray of r.rays) {
        ray.lengthScale = 1 - compress * 0.25 + spring * 0.05;
      }
      r.eyes.left.scaleY = 1 - compress * 0.3;
      r.eyes.right.scaleY = 1 - compress * 0.3;
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
      const stride = Math.abs(wave(t * 2)) * env;
      const sway = wave(t, 0.25) * env;
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
      const rock = wave(t * 1.5) * env;
      const swing = Math.abs(rock);
      r.rotation = rock * 11;
      r.x = base.x + rock * 4.5;
      r.y = base.y - Math.abs(wave(t * 1.5, 0.25)) * 4 * env;
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
    return Math.min(ease(t / inBy), ease((1 - t) / outFrom));
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
      r.rotation = base.rotation + turns(ease((t - 0.14) / 0.62), 1);
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
      r.rotation = base.rotation + turns(ease((t - 0.12) / 0.68), 2);
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
    const seated = Math.min(ease(t / 0.2), ease((1 - t) / 0.12));
    const deployed = Math.min(ease(t / 0.2), ease((1 - t) / 0.1));
    const breath = wave(t * 1.25) * seated;
    const stretch = bump((t - 0.7) / 0.18);
    const lean = seated * 7;
    const sink = seated * 2.5;
    const dx = seated * 1.2;
    const dy = sink - breath * 0.8 - stretch * 1.6;
    r.rotation = base.rotation - lean;
    r.x = base.x + dx;
    r.y = base.y + dy;
    r.faceTilt = base.faceTilt - seated * 3;
    r.squash = seated * 0.02;
    const squint = seated * (1 - stretch) * 0.62;
    r.eyes.left.closed = squint;
    r.eyes.right.closed = squint;
    r.smile.depth = base.smile.depth * (1 + seated * 0.3);
    r.smile.span = base.smile.span * (1 + seated * 0.08);
    for (const ray of r.rays) {
      ray.lengthScale = 1 - seated * 0.05 + breath * 0.05 + stretch * 0.14;
      ray.widthScale = 1 + breath * 0.03;
    }
    const angle = lean * Math.PI / 180;
    const props = [
      {
        id: "deckchair",
        // See the note above: this is the inverse of the body's rotation and
        // translation, so the chair stays on the ground while she settles into it.
        x: -dx * Math.cos(angle) + dy * Math.sin(angle),
        y: -dx * Math.sin(angle) - dy * Math.cos(angle),
        // Plus the unfold: the chair swings open from a lean as it deploys.
        rotation: lean + (1 - deployed) * -14,
        scale: 0.35 + 0.65 * deployed,
        opacity: deployed
      }
    ];
    if (extra.shades) {
      const on = Math.min(ease((t - 0.16) / 0.1), ease((0.84 - t) / 0.1));
      props.push({
        id: "sunglasses",
        x: -1.4,
        y: -5.1 - 34 * (1 - on),
        rotation: -3,
        scale: 1,
        opacity: on
      });
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
    const arrive = ease(t / 0.2);
    const leave = ease((t - 0.8) / 0.2);
    const visible = arrive * (1 - leave);
    const held = ease(Math.min(arrive, (0.8 - t) / 0.12));
    const sway = wave(t * 1.5) * extra.sway * held;
    const wander = wave(t * 2.3, 0.15) * extra.wander * held;
    const bob = wave(t * 1.5, 0.25) * (2.2 + extra.sway * 0.25) * held;
    const drift = wave(t * 3.1, 0.6) * extra.wander * held;
    const x = BALLOON_START.x + (BALLOON_HOVER.x - BALLOON_START.x) * arrive + sway + wander + leave * BALLOON_RELEASE.x;
    const y = BALLOON_START.y + (BALLOON_HOVER.y - BALLOON_START.y) * arrive - bob - leave * BALLOON_RELEASE.y;
    const toward = extra.lean * held;
    r.rotation = base.rotation + toward;
    r.faceTilt = base.faceTilt - toward * 0.6;
    r.x = base.x + toward * 0.35;
    r.y = base.y - held * 0.5 - bob * 0.1;
    r.smile.depth = base.smile.depth * (1 + held * 0.12);
    r.smile.span = base.smile.span * (1 + held * 0.05);
    const mag = Math.max(1, Math.hypot(x, y));
    const gaze = {
      x: Math.max(-1, Math.min(1, x / mag)),
      y: Math.max(-1, Math.min(1, y / mag))
    };
    r.eyes.left.gaze = gaze;
    r.eyes.right.gaze = { ...gaze };
    for (const ray of r.rays) {
      ray.lengthScale = 1 + held * 0.04 + drift * 0.02;
      ray.widthScale = 1 + held * 0.02;
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
    const fallen = ease((t - SEED_DROPS_AT) / (SEED_LANDS_BY - SEED_DROPS_AT));
    const seedOpacity = ease(t / SEED_APPEARS_BY) * (1 - ease((t - SEED_FADES_FROM) / (SEED_GONE - SEED_FADES_FROM)));
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
    const sprout = ease((t - SPROUT_AT) / (SPROUT_DONE - SPROUT_AT));
    const sproutOpacity = Math.min(1, sprout * 4) * (1 - ease((t - FLOWER_AT) / 0.14));
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
    const bloom = ease((t - FLOWER_AT) / (FLOWER_DONE - FLOWER_AT));
    const flowerOpacity = Math.min(1, bloom * 4) * (1 - ease((t - TAKEN_IN) / (1 - TAKEN_IN)));
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
    const held = land(t / 0.9);
    const lean = extra.lean * held;
    r.rotation = base.rotation + lean;
    r.x = base.x + lean * 0.35;
    r.faceTilt = base.faceTilt - lean * 0.5;
    r.smile.depth = base.smile.depth * (1 + held * 0.16);
    r.smile.span = base.smile.span * (1 + held * 0.06);
    if (extra.hop) r.y = base.y - swell(t, 0.58, 0.88) * 2.4;
    const focus = sprout > 0 || bloom > 0 ? bloomCentre() : {
      x: SEED_HELD.x + (PLANT.x - SEED_HELD.x) * fallen,
      y: SEED_HELD.y + (PLANT.y - SEED_HELD.y) * fallen
    };
    const mag = Math.max(1, Math.hypot(focus.x, focus.y));
    const gaze = {
      x: base.eyes.left.gaze.x + (focus.x / mag - base.eyes.left.gaze.x) * held,
      y: base.eyes.left.gaze.y + (focus.y / mag - base.eyes.left.gaze.y) * held
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
  var SEQUENCES = [
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
    bloomShowcase
  ];
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
    guiding: "guide"
  };
  var Scheduler = class {
    #active = [];
    #intensity;
    #reducedMotion;
    #floor = null;
    #floorGroup = null;
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
        return { rig: base, sequenceId: null, yields: [] };
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
      const resolved = pool.map((instance) => ({ instance, sequence: this.resolve(instance.sequence) })).filter((e) => e.sequence !== null).filter((e) => isEligible(e.sequence, this.#intensity)).sort((a, b) => b.sequence.priority - a.sequence.priority);
      if (resolved.length === 0) {
        return { rig: base, sequenceId: null, yields: [] };
      }
      const winner = resolved[0];
      const elapsed = now - winner.instance.startedAt;
      const t = winner.sequence.loop ? elapsed % winner.sequence.duration / winner.sequence.duration : Math.min(1, elapsed / winner.sequence.duration);
      return {
        rig: winner.sequence.pose(base, t, winner.instance.anchor),
        sequenceId: winner.sequence.id,
        yields: resolved.slice(1).map((e) => e.sequence.id)
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
      asked: "nobody",
      note: "`attention` requests `open`, and the listening state\u2019s ambient layer is the idle group, so nothing ever asks for the perk. Either the listening state\u2019s ambient should be this group, or `attention` should request both."
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
    constructor(base = defaultRig(), options = {}) {
      this.#base = base;
      this.machine = new SunnyMachine("idle", 0);
      this.scheduler = new Scheduler(options.intensity ?? "balanced", options.reducedMotion ?? false);
      this.#random = xorshift(options.seed ?? 1592594996);
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
      const previous = this.machine.state;
      const result = this.machine.send(event, now);
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
          break;
        case "play_started":
          this.scheduler.request("play", result.state, now);
          break;
        case "dismissed":
          this.scheduler.request("relax", result.state, now);
          break;
        case "speaking_started":
          if (previous === "thinking") this.scheduler.request("eureka", result.state, now);
          break;
        default:
          break;
      }
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
    tap(point, now) {
      const rig = this.#last?.rig ?? this.#base;
      const local = toBodyFrame(rig, point);
      const balloon = rig.props.find((prop2) => prop2.id === "balloon" && prop2.opacity > 0.05);
      if (balloon) {
        const radius = (TAP_RADIUS.balloon ?? 0) * balloon.scale;
        if (Math.hypot(local.x - balloon.x, local.y - balloon.y) <= radius) {
          this.scheduler.cancel("balloon");
          return this.scheduler.request("pop", this.machine.state, now, { point });
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
      }
      const result = this.scheduler.update(this.#base, this.machine.state, context, now);
      this.#last = result;
      return result;
    }
    get lastFrame() {
      return this.#last;
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
        "speaking",
        "guiding",
        "relaxing",
        "playing"
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
      case "tool_started":
        return { type: "guiding_started" };
      case "tool_finished":
        return { type: "guiding_finished" };
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
    const index = Math.min(cells.length - 1, Math.floor(random() * cells.length));
    return cells[index];
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
  var clamp = (v, low, high) => v < low ? low : v > high ? high : v;
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
    return { y: clamp(paddle.y + dy, PADDLE_LOW, PADDLE_HIGH) };
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
    const angle = clamp(Math.atan2(aim - crossing, span), -MAX_BOUNCE_RAD, MAX_BOUNCE_RAD);
    const offset = angle / MAX_BOUNCE_RAD;
    return clamp(crossing - offset * (PADDLE_HALF + BALL_RADIUS), PADDLE_LOW, PADDLE_HIGH);
  }
  function track(paddle, target) {
    const delta = target - paddle.y;
    if (Math.abs(delta) <= PADDLE_SPEED) return { y: target };
    return movePaddle(paddle, Math.sign(delta) * PADDLE_SPEED);
  }
  function bounce(ball, paddle, side) {
    const offset = clamp((ball.y - paddle.y) / (PADDLE_HALF + BALL_RADIUS), -1, 1);
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
    function settle() {
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
      else settle();
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
        else settle();
        return true;
      }
    };
  }

  // apps/character-lab/src/pong.ts
  var STEP_MS = 16;
  var MAX_CATCHUP = STEP_MS * 6;
  var SVG_WIDTH = 308;
  var SVG_HEIGHT = 200;
  var COURT_X = 106;
  var CHAR_X = 62;
  var CHAR_Y = 100;
  var CHAR_SCALE = 0.8;
  var ARM_RAY = 2;
  function pongPanel(host2) {
    let game = ping_pong_exports.newGame();
    let owed = 0;
    let last = null;
    const held = /* @__PURE__ */ new Set();
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
        if (down2) held.add("up");
        else held.delete("up");
      } else if (event.key === "ArrowDown" || event.key === "s" || event.key === "S") {
        if (down2) held.add("down");
        else held.delete("down");
      } else {
        return;
      }
      event.preventDefault();
    };
    surface.addEventListener("keydown", (event) => keys(event, true));
    surface.addEventListener("keyup", (event) => keys(event, false));
    surface.addEventListener("blur", () => held.clear());
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
      owed = 0;
      held.clear();
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
      const arm = armTo(rig.rays[ARM_RAY], target);
      rig.rays[ARM_RAY] = arm;
      const tip = rayTip(arm);
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
        while (owed >= STEP_MS) {
          owed -= STEP_MS;
          moved = true;
          const direction = (held.has("down") ? 1 : 0) - (held.has("up") ? 1 : 0);
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
    const drawn = animator.lastFrame?.sequenceId;
    const liveGroup = drawn ? groupOfSequence.get(drawn) : void 0;
    for (const moment of moments) {
      const live = moment.group === liveGroup;
      moment.node.classList.toggle("live", live);
      if (live) moment.node.dataset.drawn = "1";
    }
  }
  var moments = [];
  var groupOfSequence = new Map(SEQUENCES.map((s) => [s.id, s.group]));
  var ROUTE = {
    listen: ["attention"],
    think: ["turn_started"],
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
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
      const hit = animator.tap({ x: point.x, y: point.y }, state.t);
      renderBigStage();
      if (eventLog) {
        const at = `${point.x.toFixed(0)},${point.y.toFixed(0)}`;
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
