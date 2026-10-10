"use strict";
(() => {
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
    const draw = path.filled ? `fill="${paint.ink}"` : `fill="none" stroke="${paint.ink}" stroke-width="2.2" stroke-linecap="round"`;
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
      body: rig.theme.body,
      ray: rig.theme.ray,
      ink: rig.theme.ink,
      highlight: rig.theme.highlight
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
    states: ["idle", "listening", "speaking", "guiding", "relaxing"],
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
    bubbleOpen
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
    request(groupOrId, state2, now) {
      const sequence = SEQUENCE_BY_ID.get(groupOrId) ?? bestInGroup(groupOrId, this.#intensity);
      if (!sequence) return false;
      if (!sequence.states.includes(state2)) return false;
      if (!isEligible(sequence, this.#intensity)) return false;
      if (this.#active.some((a) => a.sequence.group === sequence.group)) return false;
      this.#active.push({ sequence, startedAt: now });
      return true;
    }
    /** Drop every instance of a sequence, whether or not it has finished. */
    cancel(id) {
      this.#active = this.#active.filter((a) => a.sequence.id !== id);
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
        rig: winner.sequence.pose(base, t),
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
    }
  ];
  var UNREACHABLE_GROUPS = CATALOGUE.filter(
    (entry) => entry.asked === "nobody"
  ).map((entry) => entry.group);

  // packages/animation-engine/src/engine.ts
  var BLINK_MIN_MS = 2600;
  var BLINK_MAX_MS = 6400;
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
      const blinkable = ["idle", "listening", "speaking", "guiding", "relaxing"];
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
    confused: ["confused"],
    // `turn_failed` is not accepted from rest, so the error has to be reached the
    // way it really happens: a turn that started and then failed.
    error: ["turn_started", "turn_failed"]
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
  var stageSvg = null;
  var stageLabel = null;
  var animator = new SunnyAnimator(defaultRig(), { intensity: "balanced" });
  function renderBigStage() {
    if (!stageSvg) return;
    const rig = animator.frame(state.t, {
      reducedMotion: state.reducedMotion,
      intensity: state.intensity
    }).rig;
    stageSvg.innerHTML = renderSunny(rig, { title: "Sunny", uniqueIds: true });
    if (stageLabel) {
      const result = animator.lastFrame;
      stageLabel.textContent = [
        `state: ${animator.state}`,
        `sequence: ${result?.sequenceId ?? "none"}`,
        `${state.t.toFixed(0)}ms`
      ].join("   \xB7   ");
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
      labelled("Speed", speed, speedLabel),
      labelled("Intensity", intensity),
      labelled("Zoom", zoom),
      el("label", { class: "check" }, [reduced, el("span", { text: "prefers-reduced-motion" })])
    ]);
  }
  function labelled(label, control, suffix) {
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
      labelled("Sequence", picker),
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
    stage.append(stageSvg, stageLabel);
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
