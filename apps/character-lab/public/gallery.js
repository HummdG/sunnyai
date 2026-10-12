"use strict";
(() => {
  // packages/animation-engine/src/types.ts
  var PRIORITY = {
    idle: 0,
    play: 200,
    success: 400,
    chat: 600,
    accessibility: 800,
    interaction: 1e3
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
  function noise(index, variant) {
    const s = Math.sin(index * 12.9898 + variant * 78.233 + 0.5) * 43758.5453;
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
      const index = Math.floor(i / 2);
      const axis = i % 2;
      i += 1;
      const shifted = v + noise(index * 2 + axis, variant) * amplitude;
      return String(Math.round(shifted * 100) / 100);
    });
    if (cache.size > CACHE_LIMIT) cache.clear();
    cache.set(key, out);
    return out;
  }

  // packages/character/src/traced-hands.ts
  var TRACED_HANDS = { "open": { "ink": "M-7.7 0.2C-10.7 -0.2 -9.1 -1 -9.7 -2.1C-10.4 -3.3 -11 -4.6 -11.5 -6.9C-11.9 -9.2 -12.3 -14 -12.4 -15.9C-12.5 -17.9 -12.1 -17.9 -11.9 -18.6C-11.7 -19.2 -11.6 -19.5 -11 -20C-10.5 -20.4 -9.7 -21.1 -8.7 -21.3C-7.8 -21.4 -6.2 -20.6 -5.4 -20.8C-4.5 -21.1 -4.6 -22.4 -3.8 -22.9C-3.1 -23.4 -1.7 -23.9 -0.8 -24C0.2 -24.1 1.2 -23.9 1.9 -23.3C2.7 -22.8 3 -20.9 3.9 -20.6C4.7 -20.4 5.9 -21.7 6.9 -21.7C7.8 -21.8 8.9 -21.4 9.7 -21C10.4 -20.5 10.8 -19.8 11.1 -19C11.5 -18.2 11.8 -17.7 11.6 -16.3C11.4 -14.9 9.7 -11.6 10 -10.7C10.2 -9.8 12.4 -11.1 13.1 -11.1C13.8 -11.1 14.1 -11 14.4 -10.9C14.6 -10.7 15.7 -12.2 14.6 -10.4C13.6 -8.6 11.8 -1.8 8.1 0C4.4 1.8 -4.7 0.6 -7.7 0.2Z", "fill": "M-5.6 -0.3C-8.1 -0.8 -7.7 -2.1 -8.3 -3.3C-9 -4.6 -9.4 -5.7 -9.8 -7.8C-10.1 -9.9 -10.6 -14.2 -10.5 -16C-10.5 -17.8 -10 -18.1 -9.6 -18.6C-9.1 -19.2 -8.4 -19.5 -7.8 -19.5C-7.2 -19.5 -6.5 -19.3 -6 -18.8C-5.6 -18.3 -5.3 -17.5 -5.1 -16.5C-4.9 -15.4 -4.9 -13.3 -4.8 -12.6C-4.7 -11.9 -4.5 -12.2 -4.3 -12.3C-4.2 -12.3 -4 -12 -4 -12.9C-3.9 -13.7 -4.1 -16.2 -4 -17.4C-3.9 -18.7 -3.7 -19.6 -3.4 -20.3C-3.1 -21 -2.7 -21.4 -2.1 -21.7C-1.5 -22 -0.3 -22.2 0.3 -22C0.9 -21.9 1.3 -21.4 1.7 -20.9C2 -20.3 2.2 -20.2 2.2 -18.9C2.2 -17.5 1.7 -13.7 1.7 -12.6C1.7 -11.5 1.8 -11.6 2.1 -12.2C2.5 -12.9 3.1 -15.4 3.7 -16.6C4.2 -17.7 4.7 -18.6 5.3 -19.2C6 -19.7 7 -19.8 7.6 -19.8C8.2 -19.8 8.6 -19.5 9 -19.1C9.3 -18.7 9.6 -18 9.8 -17.4C9.9 -16.8 10.2 -17.3 9.7 -15.6C9.2 -13.9 7.2 -8.7 6.9 -7.2C6.5 -5.8 6.8 -6.6 7.5 -6.9C8.2 -7.2 10.1 -8.6 11.1 -9C12 -9.4 13.6 -10.4 13.1 -9.1C12.6 -7.8 9.1 -2.4 8 -1C7 0.5 9.1 -0.3 6.8 -0.2C4.5 -0.1 -3.1 0.2 -5.6 -0.3Z", "joint": 8.2 }, "fist": { "ink": "M10.9 -0.9C8.7 -0.1 4.1 0.1 0.3 0.2C-3.5 0.4 -9.5 0.5 -11.8 0.2C-14 -0.1 -12.7 -0.7 -13.1 -1.5C-13.6 -2.3 -14.2 -3.6 -14.5 -4.6C-14.7 -5.7 -14.9 -6.8 -14.8 -7.9C-14.7 -9.1 -14.9 -9.8 -14 -11.4C-13.2 -13 -10.7 -16.1 -9.5 -17.5C-8.3 -19 -7.8 -19.4 -6.8 -20C-5.9 -20.5 -5 -20.4 -3.9 -21C-2.9 -21.5 -1.8 -22.9 -0.6 -23.4C0.6 -23.8 2.4 -23.8 3.4 -23.8C4.3 -23.8 4.3 -23.7 5.2 -23.3C6 -22.8 7.6 -21.9 8.5 -20.9C9.4 -19.9 9.9 -18.2 10.6 -17.2C11.3 -16.3 12.3 -16 12.9 -15.3C13.5 -14.7 14 -14.1 14.3 -13C14.6 -12 14.7 -10.2 14.7 -9.2C14.7 -8.2 14.6 -7.8 14.3 -7C14.1 -6.2 13.9 -5.5 13.4 -4.5C12.8 -3.5 13.1 -1.7 10.9 -0.9Z", "fill": "M8.3 -1.2C6.6 -0.4 3.2 -0.4 0.3 -0.3C-2.7 -0.2 -7.3 -0.1 -9.1 -0.3C-11 -0.6 -10.3 -1.3 -10.8 -2.1C-11.3 -2.8 -11.9 -4 -12.2 -5C-12.5 -6 -12.6 -7.1 -12.5 -8.2C-12.4 -9.2 -12.3 -10.3 -11.6 -11.4C-11 -12.4 -9.4 -13.4 -8.6 -14.3C-7.9 -15.3 -7.7 -16.2 -7.1 -16.9C-6.5 -17.6 -5.8 -18.3 -5 -18.7C-4.1 -19.1 -2.8 -18.8 -2.2 -19.1C-1.6 -19.5 -1.6 -20.2 -1.1 -20.6C-0.7 -21 0 -21.3 0.7 -21.5C1.3 -21.6 2.1 -21.7 2.8 -21.5C3.5 -21.4 4.2 -21.3 5 -20.8C5.8 -20.4 6.8 -19.5 7.3 -18.9C7.9 -18.4 8.8 -18 8.2 -17.4C7.6 -16.8 4.8 -15.2 3.7 -15.3C2.6 -15.3 2.1 -17.1 1.5 -17.6C0.8 -18 -0.1 -18.4 0.1 -17.9C0.2 -17.4 2.2 -15.5 2.4 -14.4C2.5 -13.3 1.2 -12.3 1 -11.3C0.8 -10.3 1.4 -8.9 1.4 -8.2C1.3 -7.6 1.1 -7.6 0.9 -7.3C0.7 -7.1 0.4 -6.9 0.1 -6.8C-0.1 -6.8 0 -6.3 -0.6 -7.2C-1.2 -8.1 -2.4 -11.2 -3.4 -12.3C-4.3 -13.4 -5.6 -13.6 -6.1 -13.7C-6.6 -13.8 -6.8 -13.7 -6.3 -13.1C-5.7 -12.5 -3.6 -10.8 -2.9 -9.8C-2.2 -8.9 -2.2 -8.2 -2 -7.5C-1.9 -6.8 -1.8 -6.5 -2 -5.9C-2.3 -5.3 -2.9 -4.4 -3.3 -4C-3.8 -3.6 -4.3 -3.5 -4.8 -3.4C-5.2 -3.3 -5.4 -3.2 -6 -3.6C-6.5 -3.9 -7.7 -5.3 -8.1 -5.5C-8.4 -5.8 -8.5 -5.7 -8.3 -5.3C-8.1 -4.8 -7.5 -3.4 -6.8 -2.9C-6.1 -2.4 -5 -2.2 -4.2 -2.2C-3.4 -2.3 -2.7 -2.6 -2 -3.1C-1.4 -3.6 -1 -4.6 -0.2 -5.1C0.5 -5.7 1.7 -6.4 2.4 -6.6C3.2 -6.8 3.5 -6.3 4.2 -6.3C4.9 -6.4 6.2 -6.5 6.8 -6.8C7.5 -7.1 8 -7.8 8.2 -8.1C8.4 -8.5 8.5 -8.8 8.2 -8.8C7.8 -8.8 6.8 -8 6.2 -7.9C5.6 -7.7 5 -7.6 4.5 -7.8C3.9 -8 3 -8.6 2.7 -9.1C2.4 -9.5 2.3 -10 2.4 -10.6C2.5 -11.2 2.9 -12 3.4 -12.6C3.8 -13.2 4.4 -13.8 5 -14.3C5.6 -14.7 6.1 -15 6.8 -15.1C7.5 -15.3 8.3 -15.5 9.1 -15.2C9.8 -14.9 10.9 -14.3 11.5 -13.4C12.1 -12.6 12.7 -11.5 12.6 -10.1C12.5 -8.6 11.6 -6.4 10.9 -4.9C10.2 -3.4 10.1 -1.9 8.3 -1.2Z", "joint": 11.27 }, "thumb": { "ink": "M16.3 -11.8C16.8 -10.2 17 -8.4 17.1 -7.4C17.2 -6.4 17.2 -6.2 17 -5.8C16.9 -5.5 19 -6.3 16.2 -5.3C13.4 -4.3 5.9 -0.7 0.3 0.2C-5.4 1.1 -14.9 0.3 -17.8 0C-20.7 -0.2 -17.6 -0.9 -17.2 -1.5C-16.7 -2 -16.4 -2.6 -15.2 -3.4C-14 -4.1 -10.4 -4.8 -9.8 -5.9C-9.2 -7.1 -11.2 -9.1 -11.5 -10.2C-11.9 -11.2 -11.8 -11.5 -11.7 -12.3C-11.7 -13.1 -11.5 -14.3 -11.2 -15.1C-10.9 -15.9 -10.6 -16.5 -10 -17.1C-9.4 -17.6 -8.7 -18.2 -7.8 -18.6C-6.9 -18.9 -5.5 -18.7 -4.5 -19.2C-3.6 -19.6 -2.9 -20.7 -2 -21.1C-1.2 -21.6 -0.4 -21.8 0.5 -21.8C1.4 -21.8 2.4 -21.2 3.3 -21.3C4.2 -21.5 5.2 -22.4 6 -22.6C6.9 -22.8 7.7 -22.7 8.4 -22.5C9.2 -22.3 9.7 -22 10.5 -21.5C11.2 -21 12.3 -20.1 13 -19.4C13.6 -18.6 13.8 -18.3 14.4 -17.1C14.9 -15.8 15.8 -13.4 16.3 -11.8Z", "fill": "M14.6 -9.4C14.8 -9.1 15 -8.2 15 -7.5C15 -6.8 17 -6.5 14.5 -5.4C12 -4.2 5.1 -1.2 0.2 -0.4C-4.7 0.5 -12.8 -0.1 -15 -0.4C-17.1 -0.7 -13.8 -1.8 -12.6 -2.4C-11.5 -3 -9.4 -3.9 -8.1 -3.9C-6.7 -3.9 -5.6 -2.6 -4.5 -2.4C-3.4 -2.1 -2.4 -2.2 -1.6 -2.4C-0.8 -2.5 -0.1 -3.1 0.4 -3.5C0.9 -3.9 0.7 -4.7 1.5 -4.9C2.3 -5.1 4.3 -4.7 5.2 -4.8C6.1 -5 6.4 -5.3 6.9 -5.8C7.4 -6.2 7.7 -7.2 8.4 -7.5C9.1 -7.8 10.4 -7.2 11.3 -7.5C12.2 -7.9 13.3 -9.3 13.8 -9.6C14.4 -10 14.4 -9.8 14.6 -9.4ZM12.2 -16.3C12.7 -15.4 13 -14.2 13.2 -13.3C13.3 -12.5 13.2 -12 13 -11.4C12.8 -10.7 12.6 -10 12.1 -9.6C11.5 -9.1 10.4 -8.7 9.8 -8.7C9.1 -8.7 8.5 -8.7 8 -9.6C7.4 -10.5 7.1 -12.7 6.6 -13.8C6.2 -14.9 5.5 -15.8 5.2 -16.2C4.9 -16.7 4.4 -17.5 4.6 -16.3C4.9 -15.1 6.6 -10.4 6.8 -8.8C7.1 -7.2 6.5 -7.5 6.1 -7C5.7 -6.5 5.1 -5.9 4.4 -6C3.6 -6 2.5 -5.7 1.3 -7C0.2 -8.4 -2.1 -13.5 -2.6 -14C-3.1 -14.6 -2.2 -11.5 -1.8 -10.2C-1.3 -8.9 0 -7.1 0.3 -6.2C0.5 -5.3 0.1 -5.2 -0.3 -4.8C-0.8 -4.3 -1.7 -3.8 -2.3 -3.6C-2.9 -3.5 -3.5 -3.7 -4.2 -3.9C-4.9 -4.2 -5.5 -4.4 -6.2 -5.1C-6.9 -5.7 -7.8 -6.8 -8.4 -7.8C-8.9 -8.8 -9.4 -10.1 -9.5 -11.1C-9.7 -12.1 -9.6 -13.1 -9.3 -13.9C-9 -14.7 -8.5 -15.4 -7.9 -15.9C-7.4 -16.4 -6.6 -16.6 -5.9 -16.7C-5.2 -16.8 -4.5 -16.2 -3.9 -16.5C-3.2 -16.8 -2.6 -18.1 -2 -18.6C-1.4 -19.1 -0.9 -19.3 -0.3 -19.5C0.2 -19.6 0.8 -19.7 1.4 -19.6C2.1 -19.5 2.8 -18.7 3.6 -18.8C4.4 -18.9 5.4 -20 6.2 -20.2C6.9 -20.5 7.2 -20.5 7.9 -20.3C8.7 -20 9.8 -19.6 10.5 -18.9C11.2 -18.3 11.8 -17.3 12.2 -16.3Z", "joint": 18.07 }, "point": { "ink": "M-17.7 -6.1C-17.6 -7 -17.4 -8.5 -16.8 -9.5C-16.3 -10.5 -15.2 -11.4 -14.5 -11.9C-13.8 -12.5 -13.3 -12.7 -12.5 -12.8C-11.8 -12.9 -11.3 -12.3 -10.2 -12.6C-9.1 -13 -7.4 -14.6 -6.2 -14.9C-4.9 -15.3 -3.3 -13.7 -2.6 -14.5C-1.8 -15.4 -2 -18.6 -1.6 -19.8C-1.3 -21 -1.2 -21 -0.6 -21.6C-0.1 -22.2 1 -23 1.7 -23.4C2.5 -23.7 3 -24 3.9 -23.7C4.8 -23.5 6.4 -22.7 7.2 -22C8 -21.2 8.4 -20.3 8.6 -19C8.9 -17.7 9.1 -16.1 8.9 -14.1C8.7 -12 7 -7.9 7.3 -6.7C7.5 -5.5 9.4 -7 10.4 -6.9C11.4 -6.7 12.5 -6.3 13.4 -5.7C14.3 -5 15.2 -3.8 15.6 -3C16 -2.2 16.1 -1.4 16 -0.8C16 -0.3 18.1 0 15.4 0.2C12.6 0.4 5 0.7 -0.4 0.2C-5.8 -0.3 -14.2 -2.3 -17.1 -2.9C-19.9 -3.6 -17.5 -3.4 -17.7 -4C-17.8 -4.5 -17.9 -5.1 -17.7 -6.1Z", "fill": "M-3.6 -1C-3.7 -1.5 -1.7 -3 -0.9 -3.4C0 -3.7 1.5 -3 1.5 -3.3C1.5 -3.6 -0.2 -4 -0.6 -5.1C-1 -6.2 -1 -7.6 -0.9 -9.7C-0.7 -11.8 -0.2 -15.9 0.2 -17.7C0.6 -19.4 0.9 -19.6 1.4 -20.2C1.8 -20.8 2.4 -21.1 2.9 -21.2C3.4 -21.4 3.8 -21.6 4.4 -21.1C5 -20.6 6.1 -19.6 6.5 -18.4C6.9 -17.3 6.9 -16.2 6.6 -14.1C6.3 -11.9 5.3 -7.3 4.7 -5.5C4.2 -3.7 2.7 -3.5 3.3 -3.4C4 -3.2 7.3 -4.4 8.7 -4.5C10.1 -4.6 10.7 -4.4 11.5 -4C12.3 -3.6 13.1 -2.7 13.4 -2.1C13.8 -1.5 16 -0.9 13.7 -0.6C11.5 -0.3 2.7 -0.3 -0.2 -0.3C-3.1 -0.4 -3.5 -0.5 -3.6 -1ZM-8.6 -9.4C-8.6 -10.5 -8.2 -10.9 -7.8 -11.5C-7.3 -12 -6.5 -12.6 -5.8 -12.8C-5.2 -13 -4.4 -12.8 -3.9 -12.6C-3.4 -12.4 -3 -12.1 -2.7 -11.8C-2.3 -11.4 -2 -11 -1.8 -10.5C-1.6 -10 -1.5 -9.6 -1.5 -8.7C-1.5 -7.9 -1.5 -6.4 -1.7 -5.6C-1.9 -4.7 -2 -4.2 -2.6 -3.6C-3.2 -3.1 -4.4 -2.4 -5 -2.2C-5.7 -2 -6.2 -2.1 -6.6 -2.5C-7.1 -2.9 -7.6 -3.4 -7.9 -4.5C-8.2 -5.6 -8.6 -8.2 -8.6 -9.4ZM-15.3 -6.3C-15.4 -7.1 -15.1 -7.5 -14.9 -8C-14.6 -8.6 -14.1 -9.2 -13.6 -9.6C-13.1 -10 -12.3 -10.4 -11.8 -10.6C-11.3 -10.7 -10.9 -10.7 -10.6 -10.5C-10.3 -10.3 -10.1 -10.8 -9.9 -9.5C-9.7 -8.2 -9.3 -3.7 -9.4 -2.5C-9.4 -1.3 -9.2 -2.1 -10.1 -2.2C-10.9 -2.3 -13.5 -2.4 -14.4 -3C-15.3 -3.7 -15.2 -5.5 -15.3 -6.3Z", "joint": 17.8 }, "peace": { "ink": "M-9.6 0.2C-11.3 0.2 -10 0.2 -10.1 0.1C-10.3 0 -10.2 0.4 -10.4 -0.4C-10.7 -1.1 -11.6 -2.9 -11.6 -4.4C-11.6 -5.9 -11.1 -8.1 -10.5 -9.3C-9.9 -10.5 -8.6 -11.1 -7.9 -11.6C-7.2 -12.1 -6.5 -11 -6.4 -12.3C-6.3 -13.5 -7.3 -17.4 -7.2 -19C-7.1 -20.6 -6.3 -21.2 -5.9 -21.8C-5.5 -22.4 -5.1 -22.5 -4.6 -22.7C-4.1 -22.9 -3.6 -23.2 -2.9 -23.1C-2.1 -23 -1.1 -22.7 -0.4 -22.2C0.3 -21.7 0.8 -20.9 1.2 -20C1.6 -19 1.5 -16.5 2 -16.6C2.5 -16.7 3.4 -19.5 4 -20.4C4.7 -21.3 5.3 -21.7 5.9 -22C6.6 -22.4 7.3 -22.6 8.1 -22.4C8.9 -22.3 10 -21.8 10.6 -21.3C11.2 -20.8 11.6 -20.1 11.8 -19.4C12 -18.8 12 -18 11.9 -17.2C11.8 -16.3 11.8 -15.9 11.1 -14.2C10.4 -12.6 8.1 -9 7.7 -7.3C7.3 -5.5 8.6 -4.7 8.7 -3.9C8.9 -3.1 9.9 -2.9 8.5 -2.2C7 -1.5 3.3 -0.2 0.3 0.2C-2.7 0.6 -7.8 0.2 -9.6 0.2Z", "fill": "M-8.1 -0.2C-9.1 -0.2 -8.4 -0.1 -8.6 -0.4C-8.8 -0.7 -9.1 -1.2 -9.4 -2.1C-9.6 -3 -10 -4.9 -10 -5.9C-10 -6.9 -9.7 -7.4 -9.4 -8C-9 -8.7 -8.3 -9.4 -7.7 -9.8C-7.2 -10.2 -6.7 -10.5 -6.2 -10.6C-5.6 -10.7 -4.4 -9.3 -4.3 -10.4C-4.2 -11.4 -5.3 -15.5 -5.5 -17C-5.7 -18.5 -5.5 -18.9 -5.3 -19.5C-5.2 -20.1 -5 -20.3 -4.7 -20.6C-4.4 -21 -3.9 -21.3 -3.5 -21.4C-3.1 -21.5 -2.7 -21.5 -2.3 -21.5C-2 -21.4 -1.6 -21.2 -1.3 -20.9C-1 -20.6 -0.7 -20.4 -0.5 -19.7C-0.2 -19 0.1 -18.1 0.3 -16.6C0.5 -15.1 0.6 -11.7 0.8 -10.6C1 -9.6 1.1 -10.3 1.3 -10.3C1.6 -10.3 1.7 -9.9 2.1 -10.8C2.5 -11.8 3.1 -14.8 3.7 -16.2C4.2 -17.6 4.6 -18.5 5.2 -19.3C5.8 -20.1 6.7 -20.5 7.2 -20.7C7.7 -21 8 -20.9 8.3 -20.8C8.7 -20.7 9 -20.6 9.4 -20.2C9.7 -19.8 10.2 -19.1 10.3 -18.4C10.4 -17.7 10.7 -17.8 10 -16.1C9.4 -14.4 7.1 -9.6 6.4 -8.2C5.7 -6.9 6.4 -7.8 5.8 -7.9C5.3 -8.1 4 -8.8 3.1 -9C2.2 -9.2 1.1 -9.2 0.3 -9.1C-0.5 -9 -1.2 -8.7 -1.8 -8.3C-2.4 -8 -2.9 -6.9 -3.3 -7C-3.7 -7.1 -3.8 -8.4 -4.1 -8.8C-4.3 -9.1 -4.7 -9.7 -4.7 -9.1C-4.7 -8.4 -4.2 -5.8 -4.1 -4.9C-4.1 -4 -4.3 -3.9 -4.5 -3.5C-4.8 -3.1 -5.3 -2.7 -5.7 -2.6C-6.1 -2.5 -6.4 -2.3 -6.9 -2.7C-7.3 -3.2 -8.3 -5.1 -8.6 -5.2C-8.9 -5.3 -8.7 -3.9 -8.5 -3.4C-8.3 -2.9 -7.8 -2.4 -7.5 -2.1C-7.2 -1.8 -7 -1.7 -6.5 -1.7C-6 -1.6 -5.3 -1.6 -4.7 -1.9C-4.1 -2.2 -3.5 -3.5 -3 -3.5C-2.5 -3.5 -1.7 -2.5 -1.6 -1.9C-1.5 -1.4 -1.3 -0.5 -2.4 -0.2C-3.5 0.1 -7.1 -0.1 -8.1 -0.2ZM-1.3 -0.2C-1.7 -0.2 -1.6 -0.4 -1.6 -0.6C-1.5 -0.8 -1.6 -1 -1 -1.4C-0.4 -1.8 2.2 -2.4 2.2 -2.8C2.1 -3.2 -0.6 -3.3 -1.4 -3.7C-2.1 -4.1 -2.2 -4.7 -2.2 -5.2C-2.3 -5.7 -2.1 -6.3 -1.8 -6.7C-1.5 -7.1 -0.9 -7.5 -0.3 -7.7C0.2 -8 0.8 -8.2 1.6 -8.1C2.4 -8.1 3.9 -7.8 4.6 -7.5C5.3 -7.2 5.4 -7 5.8 -6.5C6.3 -6 6.9 -5 7 -4.3C7.2 -3.6 7.9 -2.7 6.8 -2.1C5.7 -1.4 1.9 -0.6 0.5 -0.3C-0.8 0.1 -1 -0.1 -1.3 -0.2Z", "joint": 8.95 }, "shoe": { "ink": "M4.1 12.5C6.5 12.5 11.6 12.1 13.8 11.9C15.9 11.6 16.1 11.3 17.2 10.9C18.3 10.6 19.6 10 20.3 9.5C21.1 9.1 21.4 8.8 21.7 8.3C22 7.8 22.1 7.3 22.1 6.5C22.1 5.7 22 4.4 21.7 3.5C21.4 2.6 21 1.9 20.3 1C19.6 0.2 18.8 -0.8 17.6 -1.6C16.5 -2.3 15 -3 13.6 -3.4C12.3 -3.8 11 -4 9.5 -3.8C8.1 -3.6 5.8 -2.2 4.8 -2.2C3.8 -2.1 5 -4.6 3.5 -3.6C2.1 -2.7 -2.7 2.1 -3.9 3.5C-5.1 4.9 -3.5 3.8 -3.4 4.6C-3.3 5.4 -3.6 7.1 -3.4 8C-3.2 9 -2.9 9.7 -2.4 10.4C-1.9 11 -1.7 11.5 -0.6 11.8C0.5 12.2 1.7 12.5 4.1 12.5Z", "fill": "M3.9 10.6C5.7 10.6 9.1 10.5 11.4 10.2C13.7 9.9 16.1 9.4 17.5 8.8C19 8.2 19.8 7.7 20.1 6.8C20.4 5.9 20 4.5 19.5 3.5C19.1 2.5 18.4 1.7 17.4 0.9C16.4 0.1 15 -1 13.5 -1.4C12.1 -1.8 10.2 -1.9 8.6 -1.7C7.1 -1.4 5.2 0.4 4.1 0.3C3 0.2 3.2 -2.5 2.1 -2.2C1 -1.9 -2 1.1 -2.6 2.3C-3.2 3.4 -1.7 3.9 -1.5 4.7C-1.4 5.5 -1.8 6.5 -1.7 7.3C-1.7 8 -1.5 8.6 -1.2 9C-0.8 9.5 -0.6 9.8 0.2 10.1C1 10.3 2 10.6 3.9 10.6Z", "joint": 5.3 } };

  // packages/character/src/limbs.ts
  var LIMB_RAYS = {
    arms: { left: 6, right: 2 },
    legs: { left: 5, right: 3 }
  };
  var LIMB = {
    /** The ink outline outside the orange, matching the traced rays. */
    outline: 2.4,
    /** Half-width at the wrist and the ankle when fully morphed. */
    wristHalf: 4.8,
    ankleHalf: 5.6,
    /** Retained for older callers; the tube is now tapered (see `tubePath`). */
    fill: 7,
    ink: 11.4,
    shoulderRadius: 50,
    /** How far a grown limb's root tucks inside the body, hiding the ray's base corners. */
    rootInset: 9,
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
  var ARM_RAY_L = arm({ x: -70, y: 2 }, 0, "open", 0, false, 0);
  var ARM_RAY_R = arm({ x: 70, y: 2 }, 0, "open", 0, false, 0);
  var LEG_RAY_L = leg({ x: -40, y: 60 }, 0, 0, 0);
  var LEG_RAY_R = leg({ x: 40, y: 60 }, 0, 0, 0);
  var STAND = {
    left: leg({ x: -24, y: 86 }, -0.12),
    right: leg({ x: 24, y: 86 }, 0.12)
  };
  var LIMB_POSES = {
    /** The logo: every limb is still its ray. */
    rest: {
      visible: true,
      arms: { left: ARM_RAY_L, right: ARM_RAY_R },
      legs: { left: LEG_RAY_L, right: LEG_RAY_R }
    },
    /** Standing on two legs, arms still rays. */
    stand: {
      visible: true,
      arms: { left: ARM_RAY_L, right: ARM_RAY_R },
      legs: STAND
    },
    /** Hands on hips, elbows out (sheet: bottom right). */
    hips: {
      visible: true,
      arms: {
        left: arm({ x: -54, y: 34 }, 2.2, "fist", 0, true),
        right: arm({ x: 54, y: 34 }, -2.2, "fist", 0, true)
      },
      legs: STAND
    },
    /** Waving hello (sheet: top left). */
    wave: {
      visible: true,
      arms: {
        left: arm({ x: -66, y: -34 }, 0.35, "open", -10),
        right: ARM_RAY_R
      },
      legs: STAND
    },
    /** Thumbs up (sheet: top row, third). */
    thumbsUp: {
      visible: true,
      arms: {
        left: ARM_RAY_L,
        right: arm({ x: 70, y: -14 }, -0.35, "thumb", 30)
      },
      legs: STAND
    },
    /** Pointing off to the side (sheet: top right). */
    point: {
      visible: true,
      arms: {
        left: ARM_RAY_L,
        right: arm({ x: 78, y: -2 }, -0.1, "point", 0)
      },
      legs: STAND
    },
    /** Both fists up, cheering (sheet: second row, first). */
    cheer: {
      visible: true,
      arms: {
        left: arm({ x: -60, y: -46 }, 0.3, "fist", 0),
        right: arm({ x: 60, y: -46 }, -0.3, "fist", 0)
      },
      legs: {
        left: leg({ x: -30, y: 86 }, -0.1),
        right: leg({ x: 30, y: 86 }, 0.1)
      }
    },
    /** Hand on chin, thinking (sheet: second row, second). */
    chin: {
      visible: true,
      arms: {
        left: ARM_RAY_L,
        right: arm({ x: 4, y: 44 }, 1.1, "fist", 70, true)
      },
      legs: STAND
    },
    /** Finger up, "I've got it" (sheet: second row, third). */
    idea: {
      visible: true,
      arms: {
        left: arm({ x: -62, y: -38 }, 0.3, "point", -55),
        right: ARM_RAY_R
      },
      legs: STAND
    },
    /** Peace sign (sheet: bottom left). */
    peace: {
      visible: true,
      arms: {
        left: arm({ x: -64, y: -34 }, 0.3, "peace", -35),
        right: ARM_RAY_R
      },
      legs: STAND
    },
    /** Arms out, palms up: a shrug. */
    shrug: {
      visible: true,
      arms: {
        left: arm({ x: -72, y: 8 }, 0.45, "open", -55),
        right: arm({ x: 72, y: 8 }, -0.45, "open", 55)
      },
      legs: STAND
    },
    /** Mid-jump, arms flung up, legs tucked (sheet: bottom row, second). */
    jump: {
      visible: true,
      arms: {
        left: arm({ x: -74, y: -34 }, 0.25, "open", -15),
        right: arm({ x: 74, y: -34 }, -0.25, "open", 15)
      },
      legs: {
        left: leg({ x: -34, y: 64 }, -0.5, -20),
        right: leg({ x: 34, y: 64 }, 0.5, 20)
      }
    },
    /** Drooping: arms hang limp, knees buckle. */
    droop: {
      visible: true,
      arms: {
        left: arm({ x: -52, y: 54 }, -0.25, "relaxed", 0),
        right: arm({ x: 52, y: 54 }, 0.25, "relaxed", 0)
      },
      legs: {
        left: leg({ x: -26, y: 86 }, 0.4),
        right: leg({ x: 26, y: 86 }, -0.4)
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
      return {
        shoulderDeg: mix(p.shoulderDeg, q.shoulderDeg, k),
        // A limb growing from its ray keeps aiming at its target; it does not
        // sweep across from the ray's own resting tip.
        hand: pm < 0.01 ? { ...q.hand } : qm < 0.01 ? { ...p.hand } : mixV(p.hand, q.hand, k),
        bend: pm < 0.01 ? q.bend : qm < 0.01 ? p.bend : mix(p.bend, q.bend, k),
        shape: shapeFrom.shape,
        handRotation: pm < 0.01 ? q.handRotation : qm < 0.01 ? p.handRotation : mix(p.handRotation, q.handRotation, k),
        handScale: mix(p.handScale, q.handScale, k),
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
      x: (t.base.x + end.x) / 2 + perp.x * t.bend * len * 0.5,
      y: (t.base.y + end.y) / 2 + perp.y * t.bend * len * 0.5
    };
    const c = mixV(straight, bowed, m);
    const endHalf = mix(0.35, t.endHalf, smooth(m * 1.4));
    const power = mix(1, 3.2, m);
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
    relaxed: "open",
    open: "open",
    fist: "fist",
    point: "point",
    thumb: "thumb",
    peace: "peace"
  };
  function artInk(art, paint, boil2) {
    return `<path d="${boilPath(art.ink, boil2, 0.18)}" fill="${paint.ink}"/>`;
  }
  function artFill(art, paint, boil2) {
    return `<path d="${boilPath(art.fill, boil2, 0.18)}" fill="${paint.limb}"/>`;
  }
  function joined(tubeD, endArt, endArtFill, paint) {
    return tubeInk(tubeD, paint) + endArt + endArtFill + tubeFill(tubeD, paint);
  }
  function rayOf(rays, index) {
    return rays[index] ?? {
      angleDeg: RAY.anglesDeg[index] ?? 0,
      rotation: 0,
      lengthScale: 1,
      widthScale: 1,
      offset: { x: 0, y: 0 },
      visible: true
    };
  }
  function armParts(armRig, side, rays, paint, boil2) {
    const whole = armMarkupSplit(armRig, side, rays, paint, boil2);
    return whole;
  }
  function armMarkupSplit(armRig, side, rays, paint, boil2) {
    const m = morphOf(armRig.morph);
    if (m < 0.02) return { tube: "", hand: "" };
    const ray = rayOf(rays, LIMB_RAYS.arms[side]);
    const dir = rayDirection(ray.angleDeg + ray.rotation);
    const inset = LIMB.rootInset * smooth(m * 2);
    const base2 = {
      x: dir.x * (RAY.baseRadius - inset) + ray.offset.x,
      y: dir.y * (RAY.baseRadius - inset) + ray.offset.y
    };
    const tube = tubePath({
      base: base2,
      dir,
      baseHalf: RAY.baseHalfWidth * ray.widthScale,
      rayLength: (RAY.tipRadius - RAY.baseRadius) * ray.lengthScale,
      target: armRig.hand,
      endHalf: LIMB.wristHalf,
      // Flare to just inside the hand's own wrist, so the hand stays a touch wider.
      flareHalf: Math.min(
        TRACED_HANDS[HAND_ART[armRig.shape]].joint * armRig.handScale * 0.78,
        LIMB.wristHalf * 1.9
      ),
      bend: armRig.bend,
      morph: m,
      boil: boil2
    });
    const growth = smooth((m - 0.3) / 0.7);
    if (growth > 0.01) {
      const follow = Math.atan2(tube.endDir.x, -tube.endDir.y) * 180 / Math.PI;
      const mirror = side === "left";
      const rotation = follow + (mirror ? -armRig.handRotation : armRig.handRotation);
      const s = armRig.handScale * growth;
      const back = LIMB.wristHalf * 0.6;
      const wrist = { x: tube.end.x - tube.endDir.x * back, y: tube.end.y - tube.endDir.y * back };
      const place = `<g transform="translate(${n(wrist.x)} ${n(wrist.y)}) rotate(${n(rotation)}) scale(${n(mirror ? -s : s)} ${n(s)})">`;
      const art = TRACED_HANDS[HAND_ART[armRig.shape]];
      const ink = place + artInk(art, paint, boil2) + "</g>";
      const fill = place + artFill(art, paint, boil2) + "</g>";
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
  function legMarkup(legRig, side, rays, toViewBox2, scale, paint, boil2) {
    const m = morphOf(legRig.morph);
    if (m < 0.02) return "";
    const ray = rayOf(rays, LIMB_RAYS.legs[side]);
    const dirLocal = rayDirection(ray.angleDeg + ray.rotation);
    const inset = LIMB.rootInset * smooth(m * 2);
    const baseLocal = {
      x: dirLocal.x * (RAY.baseRadius - inset) + ray.offset.x,
      y: dirLocal.y * (RAY.baseRadius - inset) + ray.offset.y
    };
    const base2 = toViewBox2(baseLocal);
    const ahead = toViewBox2({ x: baseLocal.x + dirLocal.x, y: baseLocal.y + dirLocal.y });
    const dl = Math.hypot(ahead.x - base2.x, ahead.y - base2.y) || 1;
    const dir = { x: (ahead.x - base2.x) / dl, y: (ahead.y - base2.y) / dl };
    const foot = {
      x: LIMB.restCentre.x + legRig.foot.x,
      y: LIMB.restCentre.y + legRig.foot.y
    };
    const tube = tubePath({
      base: base2,
      dir,
      baseHalf: RAY.baseHalfWidth * ray.widthScale * scale,
      rayLength: (RAY.tipRadius - RAY.baseRadius) * ray.lengthScale * scale,
      target: foot,
      endHalf: LIMB.ankleHalf,
      flareHalf: TRACED_HANDS.shoe.joint * 1.65 * 1.05,
      bend: legRig.bend,
      morph: m,
      boil: boil2
    });
    const growth = smooth((m - 0.3) / 0.7);
    if (growth > 0.01) {
      const mirror = side === "left";
      const s = 1.65 * growth;
      const place = `<g transform="translate(${n(tube.end.x)} ${n(tube.end.y)}) scale(${n(mirror ? -s : s)} ${n(s)}) rotate(${n(legRig.footRotation)}) translate(-1.5 -1)">`;
      return joined(
        tube.d,
        place + artInk(TRACED_HANDS.shoe, paint, boil2) + "</g>",
        place + artFill(TRACED_HANDS.shoe, paint, boil2) + "</g>",
        paint
      );
    }
    return tubeInk(tube.d, paint) + tubeFill(tube.d, paint);
  }
  function limbRayIndices(limbs) {
    if (!limbs.visible) return [];
    const out = [];
    if (morphOf(limbs.arms.left.morph) >= 0.02) out.push(LIMB_RAYS.arms.left);
    if (morphOf(limbs.arms.right.morph) >= 0.02) out.push(LIMB_RAYS.arms.right);
    if (morphOf(limbs.legs.left.morph) >= 0.02) out.push(LIMB_RAYS.legs.left);
    if (morphOf(limbs.legs.right.morph) >= 0.02) out.push(LIMB_RAYS.legs.right);
    return out;
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
  function rayTransform(ray, index) {
    const restAngle = RAY.anglesDeg[index] ?? ray.angleDeg;
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
  function tracedRayPart(rig, index, paint, boil2) {
    const ray = rig.rays[index];
    const art = TRACED_ART.rays[index];
    if (!ray || !art || !ray.visible || ray.lengthScale <= 0.01) return { transform: "", inner: "" };
    return {
      transform: rayTransform(ray, index),
      inner: `<path d="${boilPath(art.ink, boil2)}" fill="${paint.ink}"/><path d="${boilPath(art.fill, boil2)}" fill="${paint.ray}"/>`
    };
  }
  function tracedBody(paint, boil2) {
    return `<path d="${boilPath(TRACED_ART.body.ink, boil2)}" fill="${paint.ink}"/><path d="${boilPath(TRACED_ART.body.fill, boil2)}" fill="${paint.body}"/>`;
  }
  function tracedEyePart(side, eye2, paint, uid, boil2) {
    const rest = REST.eyes[side];
    const art = TRACED_ART.eyes[side];
    const { sx, sy } = eyeScale(eye2, rest);
    const clipId = `sunny-traced-eye-${uid}${side}${boil2 ?? ""}`;
    const gx = eye2.gaze.x * rest.width * 0.16;
    const gy = eye2.gaze.y * rest.height * 0.1;
    const inner = boilPath(art.inner, boil2, 0.2);
    return {
      transform: featureTransform(eye2, rest, sx, sy),
      inner: [
        `<clipPath id="${clipId}"><path d="${inner}"/></clipPath>`,
        `<path d="${boilPath(art.outer, boil2, 0.2)}" fill="${paint.ink}" fill-rule="evenodd"/>`,
        `<path d="${inner}" fill="${paint.highlight}"/>`,
        `<g clip-path="url(#${clipId})">`,
        `<path d="${art.pupil}" fill="${paint.ink}" fill-rule="evenodd" transform="translate(${n2(gx)} ${n2(gy)})"/>`,
        `</g>`
      ].join("")
    };
  }
  function tracedBrowPart(side, brow2, paint, boil2) {
    const rest = REST.brows[side];
    const sx = brow2.scale * safeRatio(brow2.length, rest.length);
    const arch = safeRatio(brow2.arch, rest.arch);
    const sy = brow2.scale * Math.max(-2, Math.min(2.5, arch));
    return {
      transform: featureTransform(brow2, rest, sx, sy),
      inner: `<path d="${boilPath(TRACED_ART.brows[side].ink, boil2, 0.2)}" fill="${paint.ink}" fill-rule="evenodd"/>`
    };
  }
  function tracedMouthPart(rig, paint, boil2) {
    const rest = REST.smile;
    const smile = rig.smile;
    const sx = safeRatio(smile.span, rest.span);
    const sy = Math.max(-2, Math.min(2.5, safeRatio(smile.depth, rest.depth)));
    return {
      transform: featureTransform(smile, rest, sx, sy),
      inner: `<path d="${boilPath(TRACED_ART.mouth.ink, boil2, 0.2)}" fill="${paint.ink}" fill-rule="evenodd"/>`
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
      surface: true
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
      `translate(${n3(prop2.x)} ${n3(prop2.y)})`,
      `rotate(${n3(prop2.rotation)})`,
      `scale(${n3(prop2.scale)})`
    ].join(" ");
    const draw = path.surface ? `fill="${paint.highlight}" stroke="${paint.ink}" stroke-width="2.2" stroke-linejoin="round"` : path.filled ? `fill="${paint.ink}"` : `fill="none" stroke="${paint.ink}" stroke-width="2.2" stroke-linecap="round"`;
    const art = prop2.id === "sunglasses" ? SUNGLASSES_ART(paint) : prop2.id === "deckchair" ? DECKCHAIR_ART(paint) : `<path d="${path.d}" ${draw}/>`;
    return `<g data-prop="${prop2.id}" transform="${transform}" opacity="${n3(Math.min(1, prop2.opacity))}">` + art + `</g>`;
  }
  var BEHIND_PROPS = ["deckchair"];
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
    const boil2 = options.boil;
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
    const leg2 = (side) => showLimbs ? legMarkup(rig.limbs.legs[side], side, rig.rays, toVB, rig.scale, limbPaint, boil2) : "";
    const arms = {
      left: showLimbs ? armParts(rig.limbs.arms.left, "left", rig.rays, limbPaint, boil2) : null,
      right: showLimbs ? armParts(rig.limbs.arms.right, "right", rig.rays, limbPaint, boil2) : null
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
    return {
      svgAttributes: `xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${n3(size)}" height="${n3(size)}" ${aria}${options.className ? ` class="${escapeXml(options.className)}"` : ""}`,
      label,
      root,
      faceTransform: `rotate(${n3(rig.faceTilt)})`,
      under: [
        ["leg-left", plain(leg2("left"))],
        ["leg-right", plain(leg2("right"))]
      ],
      behind: [
        [
          "props-behind",
          plain(
            rig.props.filter((prop2) => BEHIND_PROPS.includes(prop2.id)).map((prop2) => renderProp(prop2, paint)).join("")
          )
        ],
        ...rig.rays.map((_, index) => [
          `ray-${index}`,
          hidden.includes(index) ? EMPTY : tracedRayPart(rig, index, paint, boil2)
        ]),
        ["arm-left", plain(armIn("left", false))],
        ["arm-right", plain(armIn("right", false))],
        ["body", plain(tracedBody(paint, boil2))]
      ],
      face: [
        ["eye-left", tracedEyePart("left", rig.eyes.left, paint, uid, boil2)],
        ["eye-right", tracedEyePart("right", rig.eyes.right, paint, uid, boil2)],
        ["brow-left", tracedBrowPart("left", rig.brows.left, paint, boil2)],
        ["brow-right", tracedBrowPart("right", rig.brows.right, paint, boil2)],
        ["mouth", tracedMouthPart(rig, paint, boil2)],
        [
          "face-props",
          plain(
            rig.props.filter((prop2) => FACE_PROPS.includes(prop2.id)).map((prop2) => renderProp(prop2, paint)).join("")
          )
        ]
      ],
      over: [
        ["arm-front-left", plain(armIn("left", true))],
        ["arm-front-right", plain(armIn("right", true))],
        // Props sit in the body frame rather than the face frame: a question mark
        // or a held prop should not tilt with the head.
        [
          "props",
          plain(
            rig.props.filter((prop2) => !BEHIND_PROPS.includes(prop2.id) && !FACE_PROPS.includes(prop2.id)).map((prop2) => renderProp(prop2, paint)).join("")
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
  function escapeXml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  }

  // packages/character/src/view.ts
  var viewCounter = 0;
  function createSunnyView(host, options = {}) {
    const idPrefix = `v${viewCounter++}-`;
    const doc = host.ownerDocument;
    let lastKey = "";
    let svgAttributes = "";
    let label = "";
    let rootNode = null;
    let faceNode = null;
    const parts = /* @__PURE__ */ new Map();
    const rebuild = (drawn) => {
      const template = doc.createElement("template");
      template.innerHTML = joinSunnyParts(drawn);
      const svg = template.content.firstElementChild;
      if (!svg) return;
      host.replaceChildren(svg);
      svgAttributes = drawn.svgAttributes;
      label = drawn.label;
      rootNode = svg.querySelector('[data-layer="root"]');
      faceNode = svg.querySelector('[data-layer="face"]');
      parts.clear();
      for (const [key] of [...drawn.under, ...drawn.behind, ...drawn.face, ...drawn.over]) {
        const node = svg.querySelector(`[data-part="${key}"]`);
        if (!node) continue;
        node.replaceChildren();
        node.removeAttribute("transform");
        parts.set(key, { node, transform: "", slots: [], inner: [], shown: -1 });
      }
    };
    const slotFor = (part, index) => {
      while (part.slots.length <= index) {
        const g = doc.createElementNS("http://www.w3.org/2000/svg", "g");
        g.setAttribute("display", "none");
        part.node.append(g);
        part.slots.push(g);
        part.inner.push("");
      }
      return part.slots[index];
    };
    const update = (key, drawing, boil2) => {
      const part = parts.get(key);
      if (!part) return;
      if (part.transform !== drawing.transform) {
        part.transform = drawing.transform;
        if (drawing.transform) part.node.setAttribute("transform", drawing.transform);
        else part.node.removeAttribute("transform");
      }
      const slot = slotFor(part, boil2);
      if (part.inner[boil2] !== drawing.inner) {
        part.inner[boil2] = drawing.inner;
        slot.innerHTML = drawing.inner;
      }
      if (part.shown !== boil2) {
        if (part.shown >= 0) part.slots[part.shown]?.setAttribute("display", "none");
        slot.removeAttribute("display");
        part.shown = boil2;
      }
    };
    return {
      draw(rig, frame) {
        const boil2 = frame?.boil;
        const key = `${boil2 ?? ""}|${JSON.stringify(rig)}`;
        if (key === lastKey) return;
        lastKey = key;
        const drawn = renderSunnyParts(rig, { ...options, idPrefix, boil: boil2 });
        if (!rootNode || !host.contains(rootNode) || drawn.svgAttributes !== svgAttributes || drawn.label !== label) {
          rebuild(drawn);
        }
        if (rootNode && rootNode.getAttribute("transform") !== drawn.root) {
          rootNode.setAttribute("transform", drawn.root);
        }
        if (faceNode && faceNode.getAttribute("transform") !== drawn.faceTransform) {
          faceNode.setAttribute("transform", drawn.faceTransform);
        }
        const slot = boil2 ?? 0;
        for (const [k, drawing] of [...drawn.under, ...drawn.behind, ...drawn.face, ...drawn.over]) {
          update(k, drawing, slot);
        }
      },
      destroy() {
        lastKey = "";
        rootNode = null;
        faceNode = null;
        parts.clear();
        host.replaceChildren();
      }
    };
  }
  var CARTOON_FPS = 24;
  var BOIL_FPS = 8;
  var BOIL_DRAWINGS = 3;
  function cartoonClock(now) {
    const frame = Math.floor(now * CARTOON_FPS / 1e3);
    return {
      time: frame * 1e3 / CARTOON_FPS,
      boil: Math.floor(now * BOIL_FPS / 1e3) % BOIL_DRAWINGS
    };
  }

  // packages/animation-engine/src/limb-acting.ts
  var TAU = Math.PI * 2;
  var clamp01 = (t) => Math.min(1, Math.max(0, t));
  var ease = (t) => {
    const c = clamp01(t);
    return c * c * (3 - 2 * c);
  };
  var wave = (p, phase = 0) => Math.sin((p + phase) * TAU);
  var envelope = (t, a, b) => t <= 0 || t >= 1 ? 0 : Math.min(ease(t / a), ease((1 - t) / b));
  var overshoot = (t, s = 1.9) => {
    const c = clamp01(t) - 1;
    return 1 + c * c * ((s + 1) * c + s);
  };
  var pose = (name) => limbPose(name);
  function act(r, base2, limbs, w) {
    r.limbs = blendLimbs(base2.limbs, limbs, w);
  }
  function findProp(r, id) {
    return r.props.find((p) => p.id === id && p.opacity > 0.05);
  }
  function tuckWhileSpinning(r, base2, limit = 20) {
    const turn = ((r.rotation - base2.rotation) % 360 + 540) % 360 - 180;
    if (Math.abs(turn) > limit) r.limbs.visible = false;
  }
  var wavingHello = (r, t, base2) => {
    const w = envelope(t, 0.2, 0.25);
    const limbs = pose("wave");
    limbs.arms.left.handRotation += wave(t * 3) * 28;
    limbs.arms.left.hand.x += wave(t * 3) * 3;
    act(r, base2, limbs, w);
  };
  var DIRECTORS = {
    "idle-breathe": (r, t) => {
      r.limbs.arms.left.bend += wave(t * 6) * 0.18;
      r.limbs.arms.right.bend -= wave(t * 6) * 0.18;
    },
    "listening-perk": wavingHello,
    "bubble-open": (r, t, base2) => {
      const w = t < 0.3 ? 0 : Math.sin((t - 0.3) / 0.7 * Math.PI);
      const limbs = pose("wave");
      limbs.arms.left.handRotation += wave(t * 2) * 30;
      act(r, base2, limbs, w);
    },
    "thinking-whirr": (r, t, base2) => {
      const limbs = pose("chin");
      limbs.arms.left.hand.y += Math.abs(Math.sin(t * 4 * Math.PI)) * 1.6;
      act(r, base2, limbs, 1);
    },
    "thinking-still": (r, _t, base2) => act(r, base2, pose("chin"), 1),
    "thinking-eureka": (r, t, base2) => {
      const lit = t < 0.45 ? 0 : overshoot((t - 0.45) / 0.18);
      const limbs = blendLimbs(pose("chin"), pose("idea"), lit);
      act(r, base2, limbs, Math.min(1, ease((1 - t) / 0.15)));
    },
    "eureka-still": (r, t, base2) => act(r, base2, pose("idea"), envelope(t, 0.2, 0.2)),
    "speaking-pulse": (r, t, base2) => {
      const beat = Math.sin(t * 2 % 1 * Math.PI);
      const limbs = blendLimbs(pose("hips"), pose("shrug"), 0.45 + beat * 0.3);
      limbs.arms.right = pose("hips").arms.right;
      act(r, base2, limbs, 1);
    },
    "guiding-point": (r, t, base2) => {
      const limbs = pose("point");
      limbs.arms.left = pose("hips").arms.left;
      limbs.arms.right.hand.x += wave(t * 2) * 2.5;
      act(r, base2, limbs, 1);
      const wink = t > 0.1 && t < 0.3 ? Math.sin((t - 0.1) / 0.2 * Math.PI) : 0;
      r.eyes.right.closed = Math.max(r.eyes.right.closed, wink);
      r.smile.depth *= 1 + wink * 0.25;
    },
    "guiding-still": (r, _t, base2) => {
      const limbs = pose("point");
      limbs.arms.left = pose("hips").arms.left;
      act(r, base2, limbs, 1);
    },
    "celebrate-bounce": (r, t, base2) => {
      const air = Math.max(0, base2.y - r.y);
      const flying = clamp01(air / 6);
      const limbs = blendLimbs(pose("cheer"), pose("jump"), flying);
      for (const side of ["left", "right"]) limbs.legs[side].foot.y -= air;
      limbs.arms.left.handRotation += wave(t * 3) * 12;
      limbs.arms.right.handRotation -= wave(t * 3) * 12;
      act(r, base2, limbs, envelope(t, 0.1, 0.12));
    },
    "celebrate-still": (r, t, base2) => act(r, base2, pose("thumbsUp"), envelope(t, 0.2, 0.2)),
    "celebrate-spin": (r, t, base2) => {
      act(r, base2, pose("cheer"), envelope(t, 0.1, 0.1));
      tuckWhileSpinning(r, base2);
    },
    "confused-tilt": (r, t, base2) => {
      const limbs = pose("shrug");
      limbs.arms.left.hand.y -= Math.abs(Math.sin(t * Math.PI * 3)) * 3;
      limbs.arms.right.hand.y -= Math.abs(Math.sin(t * Math.PI * 3)) * 3;
      act(r, base2, limbs, envelope(t, 0.25, 0.25));
    },
    "confused-still": (r, t, base2) => act(r, base2, pose("shrug"), envelope(t, 0.3, 0.3) * 0.6),
    "error-deflate": (r, t, base2) => act(r, base2, pose("droop"), envelope(t, 0.3, 0.3)),
    "error-still": (r, t, base2) => act(r, base2, pose("droop"), envelope(t, 0.3, 0.3) * 0.6),
    "cool-still": (r, t, base2) => act(r, base2, pose("thumbsUp"), envelope(t, 0.2, 0.2)),
    "charging-panel": (r, t, base2) => {
      const battery = findProp(r, "battery");
      const limbs = pose("hips");
      if (battery) {
        limbs.arms.right.hand = { x: battery.x - 2, y: battery.y + 12 };
        limbs.arms.right.shape = "open";
        limbs.arms.right.bend = 0.4;
        limbs.arms.right.handRotation = -20;
      }
      act(r, base2, limbs, envelope(t, 0.12, 0.12));
    },
    "play-shuffle": (r, t, base2) => walk(r, t, base2, 3, 0.6),
    "play-run": (r, t, base2) => walk(r, t, base2, 4, 1),
    "play-dance": (r, t, base2) => {
      walk(r, t, base2, 4, 0.8);
      const w = envelope(t, 0.1, 0.12);
      const limbs = blendLimbs(r.limbs, pose("cheer"), 0.6 * w);
      limbs.legs = r.limbs.legs;
      r.limbs = limbs;
    },
    "balloon-rise": (r, t, base2) => holdBalloon(r, t, base2),
    "balloon-sway": (r, t, base2) => holdBalloon(r, t, base2),
    "balloon-wander": (r, t, base2) => holdBalloon(r, t, base2),
    "pop-burst": (r, t, base2) => act(r, base2, pose("jump"), envelope(t, 0.08, 0.4)),
    "pop-flinch": (r, t, base2) => act(r, base2, pose("jump"), envelope(t, 0.08, 0.4)),
    "pop-shower": (r, t, base2) => act(r, base2, pose("cheer"), envelope(t, 0.1, 0.3)),
    "arcade-tuck": (r, _t, base2) => tuckWhileSpinning(r, base2),
    "arcade-roll": (r, _t, base2) => tuckWhileSpinning(r, base2),
    "arcade-spin": (r, _t, base2) => tuckWhileSpinning(r, base2),
    "bloom-seed": (r, t, base2) => act(r, base2, pose("point"), envelope(t, 0.15, 0.15) * 0.5),
    "bloom-grow": (r, t, base2) => act(r, base2, pose("cheer"), Math.max(0, envelope(t, 0.6, 0.12))),
    "bloom-showcase": (r, t, base2) => act(r, base2, pose("cheer"), Math.max(0, envelope(t, 0.6, 0.12)))
  };
  function walk(r, t, base2, steps, size) {
    const limbs = pose("stand");
    const p = t * steps * 0.5;
    const stride = wave(p) * 12 * size;
    limbs.legs.left.foot = { x: -22 + stride, y: 86 - Math.max(0, wave(p)) * 10 * size };
    limbs.legs.right.foot = { x: 22 - stride, y: 86 - Math.max(0, -wave(p)) * 10 * size };
    limbs.legs.left.bend = -0.25 - Math.max(0, wave(p)) * 0.4;
    limbs.legs.right.bend = 0.25 + Math.max(0, -wave(p)) * 0.4;
    limbs.arms.left = {
      ...limbs.arms.left,
      hand: { x: -62 - stride * 0.9, y: 36 - Math.max(0, -wave(p)) * 14 * size },
      bend: -0.35,
      shape: "fist",
      morph: 1
    };
    limbs.arms.right = {
      ...limbs.arms.right,
      hand: { x: 62 - stride * 0.9, y: 36 - Math.max(0, wave(p)) * 14 * size },
      bend: 0.35,
      shape: "fist",
      morph: 1
    };
    act(r, base2, limbs, envelope(t, 0.1, 0.12));
  }
  function holdBalloon(r, t, base2) {
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
    act(r, base2, limbs, envelope(t, 0.1, 0.1));
  }
  function withLimbActing(sequence) {
    const director = DIRECTORS[sequence.id];
    if (!director) return sequence;
    return {
      ...sequence,
      pose: (base2, t, anchor) => {
        const r = sequence.pose(base2, t, anchor);
        director(r, t, base2);
        return r;
      }
    };
  }

  // packages/animation-engine/src/sequences.ts
  var TAU2 = Math.PI * 2;
  var wave2 = (p, phase = 0) => Math.sin((p + phase) * TAU2);
  var bump = (t) => Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
  var land = (t) => t <= 0 || t >= 1 ? 0 : Math.sin(Math.PI * t);
  var turns = (t, whole) => whole * 360 * t % 360;
  var swell = (t, from, to) => t <= from || t >= to ? 0 : Math.sin(Math.PI * ((t - from) / (to - from)));
  var ease2 = (t) => {
    const c = Math.min(1, Math.max(0, t));
    return c * c * (3 - 2 * c);
  };
  var clamp012 = (t) => Math.min(1, Math.max(0, t));
  var overshoot2 = (t, s = 1.9) => {
    const c = clamp012(t) - 1;
    return 1 + c * c * ((s + 1) * c + s);
  };
  var settle = (t, cycles = 2.5, decay = 4.5) => t <= 0 || t >= 1 ? 0 : Math.sin(t * cycles * TAU2) * Math.exp(-decay * t) * (1 - t);
  function hoseBounce(p) {
    const ph = (p % 1 + 1) % 1;
    const lift = Math.sin(ph * Math.PI);
    const edge = Math.min(ph, 1 - ph);
    const squash = Math.max(0, 1 - edge / 0.14) ** 2;
    const stretch = Math.abs(Math.cos(ph * Math.PI)) * (1 - squash);
    return { lift, squash, stretch };
  }
  function rubberRays(r, p, amount) {
    for (const [i, ray] of r.rays.entries()) {
      const phase = i / r.rays.length;
      ray.rotation += wave2(p, -phase) * 7 * amount;
      ray.lengthScale *= 1 + wave2(p, 0.25 - phase) * 0.09 * amount;
      ray.widthScale *= 1 - wave2(p, 0.25 - phase) * 0.05 * amount;
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
    pose: (base2, t) => {
      const r = cloneRig(base2);
      const b = hoseBounce(t * 6);
      r.y = base2.y - b.lift * 3.2;
      r.squash = b.squash * 0.07 - b.stretch * 0.025;
      r.stretch = b.stretch * 0.035 - b.squash * 0.04;
      r.faceTilt = wave2(t * 3, -0.12) * 2.6;
      rubberRays(r, t * 6 - 0.15, 0.7);
      const phase = t * 4 % 1;
      const hold = ease2(Math.min(1, phase * 3));
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
      r.brows.left.y = base2.brows.left.y - b.lift * 0.9;
      r.brows.right.y = base2.brows.right.y - b.lift * 0.9;
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
    pose: (base2) => cloneRig(base2)
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
    pose: (base2, t) => {
      const r = cloneRig(base2);
      const close = t < 0.35 ? ease2(t / 0.35) : 1 - ease2((t - 0.35) / 0.65);
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
    pose: (base2, t) => {
      const r = cloneRig(base2);
      const dip = t < 0.18 ? Math.sin(t / 0.18 * Math.PI * 0.5) * (1 - t / 0.18) * 1.6 : 0;
      const pop = t < 0.18 ? 0 : overshoot2((t - 0.18) / 0.35) * (1 - ease2((t - 0.5) / 0.5));
      const wob = settle(t, 2, 3);
      r.y = base2.y + dip * 3 - pop * 5;
      r.squash = dip * 0.12 - pop * 0.06 + wob * 0.04;
      r.stretch = pop * 0.08 - dip * 0.06;
      eyes(r, (eye2) => {
        eye2.scaleY = 1 + pop * 0.32 - dip * 0.25;
        eye2.scaleX = 1 + pop * 0.1;
      });
      r.brows.left.y = base2.brows.left.y - pop * 4;
      r.brows.right.y = base2.brows.right.y - pop * 4;
      for (const [i, ray] of r.rays.entries()) {
        ray.lengthScale = 1 + pop * 0.14 - dip * 0.12 + settle(clamp012(t - i * 0.02), 2, 3) * 0.08;
      }
      r.smile.depth = base2.smile.depth * (1 + pop * 0.3);
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
    pose: (base2, t) => {
      const r = cloneRig(base2);
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
    pose: (base2, t) => {
      const r = cloneRig(base2);
      const beat = t * 4;
      const k = Math.floor(beat);
      const f = beat - k;
      const dir = k % 2 === 0 ? 1 : -1;
      const tick2 = dir * (overshoot2(f / 0.45) * 2 - 1);
      for (const [i, ray] of r.rays.entries()) {
        ray.rotation = tick2 * 9;
        ray.lengthScale = 1 + wave2(t * 2, -i / r.rays.length) * 0.07;
      }
      r.rotation = tick2 * 2.2;
      r.faceTilt = -tick2 * 3 + wave2(t) * 2;
      r.y = base2.y - Math.abs(Math.sin(beat * Math.PI)) * 1.4;
      const up = 0.68 + wave2(t * 0.5) * 0.12;
      eyes(r, (eye2) => {
        eye2.gaze = { x: -up * 0.6, y: -up };
        eye2.scaleY = 0.86;
      });
      r.brows.left.y = base2.brows.left.y - 3;
      r.brows.left.rotation = base2.brows.left.rotation - 6;
      r.brows.right.y = base2.brows.right.y + 1.2;
      r.smile.span = base2.smile.span * 0.6;
      r.smile.depth = base2.smile.depth * 0.45;
      r.smile.rotation = base2.smile.rotation + 6;
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
    pose: (base2) => {
      const r = cloneRig(base2);
      r.eyes.left.gaze = { x: -0.35, y: -0.55 };
      r.eyes.right.gaze = { x: -0.35, y: -0.55 };
      r.smile.span = base2.smile.span * 0.7;
      r.smile.depth = base2.smile.depth * 0.6;
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
    pose: (base2, t) => {
      const r = cloneRig(base2);
      const flare = t < 0.45 ? 0 : ease2((t - 0.45) / 0.55);
      const hold = t < 0.45 ? bump(t / 0.45) : 1;
      r.props = [
        {
          id: "question-mark",
          x: -34,
          y: -30 - wave2(t * 1.5) * 2,
          rotation: -12 + wave2(t) * 4,
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
      r.y = base2.y - bump(Math.min(1, Math.max(0, (t - 0.45) / 0.55))) * 3;
      r.squash = -flare * 0.05;
      r.stretch = flare * 0.05;
      r.eyes.left.scaleY = 1 + flare * 0.2;
      r.eyes.right.scaleY = 1 + flare * 0.2;
      r.smile.span = base2.smile.span * (0.7 + flare * 0.45);
      r.smile.depth = base2.smile.depth * (0.6 + flare * 0.6);
      r.brows.left.y = base2.brows.left.y - flare * 3;
      r.brows.right.y = base2.brows.right.y - flare * 3;
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
    pose: (base2, t) => {
      const r = cloneRig(base2);
      const a = bump(t);
      r.smile.depth = base2.smile.depth * (1 + a * 0.35);
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
    pose: (base2, t) => {
      const r = cloneRig(base2);
      const syl = hoseBounce(t * 2);
      const open = Math.sin(t * 2 % 1 * Math.PI);
      r.smile.depth = base2.smile.depth * (1 + open * 0.55);
      r.smile.span = base2.smile.span * (1 - open * 0.08);
      r.smile.y = base2.smile.y + open * 0.9;
      r.brows.left.y = base2.brows.left.y - open * 2.2;
      r.brows.right.y = base2.brows.right.y - open * 2.2;
      r.y = base2.y - syl.lift * 1.8;
      r.squash = syl.squash * 0.05;
      r.stretch = syl.stretch * 0.02;
      r.faceTilt = wave2(t, 0.1) * 2;
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
    pose: (base2) => cloneRig(base2)
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
    pose: (base2, t) => {
      const r = cloneRig(base2);
      const lean = 9;
      r.faceTilt = lean + wave2(t) * 1.4;
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
    pose: (base2) => {
      const r = cloneRig(base2);
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
    pose: (base2, t) => {
      const r = cloneRig(base2);
      const a = bump(t);
      r.rotation = ease2(Math.min(1, t / 0.8)) * 720;
      r.y = base2.y - a * 7;
      r.squash = -a * 0.06;
      r.stretch = a * 0.06;
      r.smile.span = base2.smile.span * (1 + a * 0.25);
      r.smile.depth = base2.smile.depth * (1 + a * 0.35);
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
    pose: (base2, t) => {
      const r = cloneRig(base2);
      const hop = (from, to, height) => t <= from || t >= to ? 0 : Math.sin((t - from) / (to - from) * Math.PI) * height;
      const speed2 = (from, to) => t <= from || t >= to ? 0 : Math.abs(Math.cos((t - from) / (to - from) * Math.PI));
      const crouch = swell(t, 0, 0.14) + swell(t, 0.5, 0.6) * 0.8 + swell(t, 0.86, 0.96) * 0.6;
      const air = hop(0.12, 0.52, 9.5) + hop(0.58, 0.88, 6);
      const rising = speed2(0.12, 0.52) + speed2(0.58, 0.88);
      r.y = base2.y - air + crouch * 4;
      r.squash = crouch * 0.18 - rising * 0.06;
      r.stretch = rising * 0.12 - crouch * 0.1;
      r.rotation = wave2(clamp012((t - 0.12) / 0.76)) * 8 * (1 - t);
      const joy = Math.min(1, air / 6);
      for (const [i, ray] of r.rays.entries()) {
        ray.lengthScale = 1 + joy * 0.22 - crouch * 0.15 + settle(clamp012(t - i * 0.015), 3, 4) * 0.06;
        ray.rotation = wave2(t * 2, -i / 8) * 8 * joy;
      }
      const a = bump(t);
      r.smile.span = base2.smile.span * (1 + a * 0.22);
      r.smile.depth = base2.smile.depth * (1 + a * 0.6);
      eyes(r, (eye2) => {
        eye2.scaleY = 1 - joy * 0.45 + crouch * 0.1;
      });
      r.brows.left.y = base2.brows.left.y - a * 5;
      r.brows.right.y = base2.brows.right.y - a * 5;
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
    pose: (base2, t) => {
      const r = cloneRig(base2);
      const a = bump(t);
      r.smile.span = base2.smile.span * (1 + a * 0.25);
      r.smile.depth = base2.smile.depth * (1 + a * 0.3);
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
    pose: (base2, t) => {
      const r = cloneRig(base2);
      const shake = t < 0.22 ? Math.sin(t / 0.22 * TAU2 * 2) * (1 - t / 0.22) : 0;
      const tilt = t < 0.2 ? 0 : overshoot2((t - 0.2) / 0.3) * (1 - ease2((t - 0.75) / 0.25));
      const shrug = swell(t, 0.3, 0.75);
      r.faceTilt = -16 * tilt + shake * 8 + settle(t, 2, 3) * 4;
      r.rotation = -5 * tilt;
      r.y = base2.y - shrug * 3;
      r.squash = -shrug * 0.03;
      r.stretch = shrug * 0.04;
      r.eyes.left.scaleY = 1 - tilt * 0.2;
      r.eyes.right.scaleY = 1 + tilt * 0.3;
      r.brows.left.y = base2.brows.left.y - tilt * 6;
      r.brows.left.rotation = base2.brows.left.rotation + tilt * 12;
      r.brows.right.y = base2.brows.right.y + tilt * 3;
      r.smile.depth = base2.smile.depth * (1 - tilt * 1.4);
      r.smile.rotation = base2.smile.rotation + tilt * 10;
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
          y: -36 - Math.abs(Math.sin(t * TAU2 * 1.5)) * 3,
          rotation: 14 + wave2(t * 1.5) * 8,
          scale: 0.5 + overshoot2(clamp012(t / 0.35)) * 0.45 * a,
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
    pose: (base2, t) => {
      const r = cloneRig(base2);
      const a = bump(t);
      r.faceTilt = -10 * a;
      r.rotation = -2 * a;
      r.brows.left.y = base2.brows.left.y - 4 * a;
      r.brows.right.y = base2.brows.right.y + 2 * a;
      r.smile.depth = base2.smile.depth * (1 - a * 0.5);
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
    pose: (base2, t) => {
      const r = cloneRig(base2);
      const sag = t < 0.55 ? ease2(t / 0.4) : (1 - overshoot2((t - 0.55) / 0.45)) * (1 - t);
      for (const [i, ray] of r.rays.entries()) {
        const angle = (ray.angleDeg + 360) % 360;
        const towardDown = angle < 180 ? 1 : -1;
        ray.rotation = towardDown * sag * 22 * Math.sin(angle * Math.PI / 180) ** 2;
        ray.lengthScale = 1 - sag * 0.28 + settle(clamp012((t - 0.55) / 0.45 - i * 0.01), 2, 4) * 0.1;
        ray.widthScale = 1 - sag * 0.15;
      }
      r.squash = sag * 0.16;
      r.stretch = -sag * 0.1;
      r.y = base2.y + sag * 5;
      r.smile.depth = base2.smile.depth * (1 - sag * 1.5);
      eyes(r, (eye2) => {
        eye2.scaleY = 1 - sag * 0.4;
        eye2.gaze = { x: 0, y: sag * 0.6 };
      });
      r.brows.left.y = base2.brows.left.y + sag * 4;
      r.brows.right.y = base2.brows.right.y + sag * 4;
      r.brows.left.rotation = base2.brows.left.rotation + sag * 14;
      r.brows.right.rotation = base2.brows.right.rotation - sag * 14;
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
    pose: (base2, t) => {
      const a = bump(t);
      const r = cloneRig(base2);
      for (const ray of r.rays) ray.lengthScale = 1 - a * 0.1;
      r.smile.depth = base2.smile.depth * (1 - a * 0.7);
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
    pose: (base2, t) => {
      return shadesPose(base2, t, false);
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
    pose: (base2, t) => {
      return shadesPose(base2, t, true);
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
    pose: (base2, t) => {
      const r = cloneRig(base2);
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
    pose: (base2, t) => {
      const r = cloneRig(base2);
      const charge = ease2(Math.min(1, t / 0.85));
      for (const [i, ray] of r.rays.entries()) {
        const pulse = Math.max(0, wave2(t * 2.5, -i / r.rays.length));
        ray.lengthScale = 1 + pulse * 0.22;
        ray.widthScale = 1 - pulse * 0.12;
      }
      r.y = base2.y - charge * 1.5;
      r.eyes.left.gaze = { x: 0.4, y: 0.35 };
      r.eyes.right.gaze = { x: 0.4, y: 0.35 };
      r.smile.depth = base2.smile.depth * (1 + charge * 0.2);
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
    pose: (base2, t) => {
      const r = cloneRig(base2);
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
    pose: (base2, t) => {
      const r = cloneRig(base2);
      const crouch = t < 0.3 ? Math.sin(t / 0.3 * Math.PI * 0.5) : Math.max(0, 1 - ease2((t - 0.3) / 0.12));
      const launch = swell(t, 0.3, 0.75);
      const wob = t < 0.6 ? 0 : settle((t - 0.6) / 0.4, 1.5, 3);
      r.squash = crouch * 0.22 - launch * 0.08 + wob * 0.06;
      r.stretch = launch * 0.16 - crouch * 0.12 - wob * 0.04;
      r.y = base2.y + crouch * 6 - launch * 7;
      for (const [i, ray] of r.rays.entries()) {
        ray.lengthScale = 1 - crouch * 0.3 + launch * 0.25 + settle(clamp012((t - 0.55) / 0.45 - i * 0.02), 2, 4) * 0.08;
      }
      eyes(r, (eye2) => {
        eye2.scaleY = 1 - crouch * 0.5 + launch * 0.25;
      });
      r.smile.depth = base2.smile.depth * (1 + launch * 0.5);
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
    pose: (base2, t) => {
      const r = cloneRig(base2);
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
    pose: (base2) => cloneRig(base2)
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
    pose: (base2, t) => {
      const r = cloneRig(base2);
      const env = bump(t);
      const step = Math.floor(t * 2) % 2 === 0 ? 1 : -1;
      const hop = bump(t * 2 % 1) * env;
      r.x = base2.x + step * hop * 5;
      r.y = base2.y - hop * 3.5;
      r.squash = -hop * 0.05;
      r.stretch = hop * 0.04;
      r.faceTilt = step * hop * 5;
      r.smile.depth = base2.smile.depth * (1 + hop * 0.18);
      r.eyes.left.gaze = { x: step * hop * 0.45, y: 0.1 };
      r.eyes.right.gaze = { ...r.eyes.left.gaze };
      for (const ray of r.rays) ray.rotation = step * hop * 5;
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
    pose: (base2, t) => {
      const r = cloneRig(base2);
      const env = bump(t);
      const stride = Math.abs(wave2(t * 2)) * env;
      const sway = wave2(t, 0.25) * env;
      r.rotation = env * 7 + stride * 2;
      r.x = base2.x + sway * 2;
      r.y = base2.y - stride * 4.5;
      r.squash = (0.09 - stride * 0.14) * env;
      r.stretch = (stride * 0.08 - 0.06) * env;
      r.faceTilt = env * 1.5;
      for (const side of ["left", "right"]) {
        r.brows[side].y = base2.brows[side].y + env * 1.4;
        r.brows[side].arch = base2.brows[side].arch * (1 - env * 0.5);
        r.eyes[side].scaleY = 1 - env * 0.3;
        r.eyes[side].gaze = { x: env * 0.45, y: -env * 0.05 };
      }
      r.smile.span = base2.smile.span * (1 + env * 0.12);
      r.smile.depth = base2.smile.depth * (1 + env * 0.25);
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
    pose: (base2, t) => {
      const r = cloneRig(base2);
      const env = bump(t);
      const rock = wave2(t * 1.5) * env;
      const swing = Math.abs(rock);
      r.rotation = rock * 11;
      r.x = base2.x + rock * 4.5;
      r.y = base2.y - Math.abs(wave2(t * 1.5, 0.25)) * 4 * env;
      r.squash = -swing * 0.04;
      r.stretch = swing * 0.05;
      r.faceTilt = -rock * 6;
      r.smile.span = base2.smile.span * (1 + env * 0.3);
      r.smile.depth = base2.smile.depth * (1 + env * 0.45);
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
    return Math.min(ease2(t / inBy), ease2((1 - t) / outFrom));
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
    pose: (base2, t) => {
      const r = cloneRig(base2);
      const a = land(t);
      r.squash = base2.squash + a * 0.07;
      r.stretch = base2.stretch - a * 0.03;
      r.y = base2.y - a * 1.5;
      r.smile.span = base2.smile.span * (1 + a * 0.18);
      r.smile.depth = base2.smile.depth * (1 + a * 0.28);
      r.eyes.left.scaleY = base2.eyes.left.scaleY - a * 0.22;
      r.eyes.right.scaleY = base2.eyes.right.scaleY - a * 0.22;
      r.rays.forEach((ray, i) => {
        ray.lengthScale = base2.rays[i].lengthScale - a * 0.16;
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
    pose: (base2, t) => {
      const r = cloneRig(base2);
      const fold = gather(t, 0.2, 0.26);
      const a = land(t);
      r.rotation = base2.rotation + turns(ease2((t - 0.14) / 0.62), 1);
      r.x = base2.x + a * 2.5;
      r.y = base2.y - a * 2;
      r.squash = base2.squash + fold * 0.11;
      r.stretch = base2.stretch - fold * 0.05;
      r.smile.span = base2.smile.span * (1 + a * 0.22);
      r.smile.depth = base2.smile.depth * (1 + a * 0.35);
      r.eyes.left.scaleY = base2.eyes.left.scaleY - fold * 0.4;
      r.eyes.right.scaleY = base2.eyes.right.scaleY - fold * 0.4;
      r.rays.forEach((ray, i) => {
        ray.lengthScale = base2.rays[i].lengthScale - fold * 0.4;
        ray.rotation = base2.rays[i].rotation + fold * 90;
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
    pose: (base2, t) => {
      const r = cloneRig(base2);
      const fold = gather(t, 0.16, 0.24);
      const a = land(t);
      const hop = a * Math.sin(Math.PI * Math.min(1, Math.max(0, (t - 0.15) / 0.7)));
      r.rotation = base2.rotation + turns(ease2((t - 0.12) / 0.68), 2);
      r.y = base2.y - hop * 4;
      r.squash = base2.squash + (fold * 0.14 - hop * 0.05);
      r.stretch = base2.stretch + (hop * 0.04 - fold * 0.06);
      r.faceTilt = base2.faceTilt - fold * 3;
      r.smile.span = base2.smile.span * (1 + a * 0.3);
      r.smile.depth = base2.smile.depth * (1 + a * 0.45);
      r.eyes.left.scaleY = base2.eyes.left.scaleY - fold * 0.45;
      r.eyes.right.scaleY = base2.eyes.right.scaleY - fold * 0.45;
      const bloom = swell(t, 0.72, 1);
      r.rays.forEach((ray, i) => {
        ray.lengthScale = base2.rays[i].lengthScale + (bloom * 0.18 - fold * 0.42);
        ray.rotation = base2.rays[i].rotation + fold * 120;
      });
      return r;
    }
  };
  function relaxPose(base2, t, extra) {
    const r = cloneRig(base2);
    const seated = Math.min(ease2(t / 0.2), ease2((1 - t) / 0.12));
    const deployed = Math.min(ease2(t / 0.16), ease2((1 - t) / 0.08));
    const breath = wave2(t * 1.25) * seated;
    const stretch = bump((t - 0.7) / 0.18);
    const lean = seated * 16;
    r.rotation = base2.rotation + lean;
    r.x = base2.x - seated * 4;
    r.y = base2.y + seated * 6 - breath * 0.8 - stretch * 1.4;
    r.faceTilt = base2.faceTilt - seated * 4;
    r.smile.depth = base2.smile.depth * (1 + seated * 0.35);
    r.smile.span = base2.smile.span * (1 + seated * 0.08);
    for (const ray of r.rays) {
      ray.lengthScale = 1 - seated * 0.04 + breath * 0.04 + stretch * 0.12;
    }
    const relaxed = limbPose("rest");
    relaxed.legs.left = {
      ...relaxed.legs.left,
      foot: { x: -66, y: 54 },
      bend: 0.25,
      footRotation: -12,
      morph: 1
    };
    relaxed.legs.right = {
      ...relaxed.legs.right,
      foot: { x: -78, y: 47 },
      bend: 0.35,
      footRotation: -6,
      morph: 1
    };
    relaxed.arms.left = {
      ...relaxed.arms.left,
      hand: { x: -16, y: -26 },
      bend: 1.35,
      shape: "fist",
      handRotation: 0,
      behind: true,
      morph: 1
    };
    relaxed.arms.right = {
      ...relaxed.arms.right,
      hand: { x: 18, y: -28 },
      bend: -1.35,
      shape: "fist",
      handRotation: 0,
      behind: true,
      morph: 1
    };
    r.limbs = blendLimbs(base2.limbs, relaxed, seated * (1 - stretch * 0.5));
    const back = -r.rotation * Math.PI / 180;
    const dx = base2.x - r.x;
    const dy = base2.y - r.y;
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
      const on = Math.min(ease2((t - 0.18) / 0.1), ease2((0.84 - t) / 0.1));
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
  function shadesPose(base2, t, playful) {
    const r = cloneRig(base2);
    const clamp = (v) => Math.min(1, Math.max(0, v));
    const reach = ease2(clamp(t / 0.12));
    const bring = ease2(clamp((t - 0.12) / 0.24));
    const landed = t >= 0.36;
    const land2 = landed ? Math.sin(clamp((t - 0.36) / 0.18) * Math.PI * 2.5) * Math.exp(-clamp((t - 0.36) / 0.18) * 4) * (1 - clamp((t - 0.36) / 0.18)) : 0;
    const nudge = swell(t, 0.44, 0.54);
    const retract = ease2(clamp((t - 0.56) / 0.14));
    const off = ease2(clamp((t - 0.86) / 0.14));
    const pop = swell(t, 0, 0.12);
    const wearing = landed ? Math.min(1, (t - 0.36) / 0.1) * (1 - off) : 0;
    r.squash = pop * 0.06;
    r.stretch = -pop * 0.03;
    r.rotation = base2.rotation - wearing * 3;
    r.y = base2.y - wearing * 1.5 - (playful ? Math.abs(wave2(t * 4)) * 2 * wearing : 0);
    r.faceTilt = base2.faceTilt + wearing * wave2(t * 2) * 2.5;
    const start = { x: 70, y: -96 };
    const temple = { x: 50, y: -14 };
    const hand = {
      x: start.x + (temple.x - start.x) * bring + Math.sin(bring * Math.PI) * 10,
      y: start.y + (temple.y - start.y) * bring
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
    r.limbs = blendLimbs(base2.limbs, armPose, reach * (1 - retract));
    const carried = toFaceFrame(r, { x: hand.x - 48, y: hand.y + 8.6 });
    const worn = { x: SHADES_REST.x, y: SHADES_REST.y + land2 * 1.8 - nudge * 2.4 };
    const at = landed ? worn : carried;
    r.props = [
      {
        ...SHADES_REST,
        x: at.x,
        y: at.y - off * 46,
        rotation: (landed ? SHADES_REST.rotation : -38 + (SHADES_REST.rotation + 38) * bring) - off * 28,
        opacity: Math.min(clamp(t / 0.06), 1 - off)
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
    r.brows.left.y = base2.brows.left.y - (nudge + wearing * 0.6) * 4;
    r.brows.left.rotation = base2.brows.left.rotation - wearing * 8;
    r.smile.depth = base2.smile.depth * (1 + wearing * 0.35);
    r.smile.rotation = base2.smile.rotation - wearing * 4;
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
    pose: (base2) => cloneRig(base2)
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
    pose: (base2, t) => relaxPose(base2, t, { shades: false, doze: false })
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
    pose: (base2, t) => relaxPose(base2, t, { shades: true, doze: false })
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
    pose: (base2, t) => relaxPose(base2, t, { shades: true, doze: true })
  };
  var BALLOON_START = { x: 30, y: -10 };
  var BALLOON_HOVER = { x: 34, y: -62 };
  var BALLOON_RELEASE = { x: 12, y: 18 };
  function balloonPose(base2, t, extra) {
    const r = cloneRig(base2);
    const arrive = ease2(t / 0.2);
    const leave = ease2((t - 0.8) / 0.2);
    const visible = arrive * (1 - leave);
    const held = ease2(Math.min(arrive, (0.8 - t) / 0.12));
    const sway = wave2(t * 1.5) * extra.sway * held;
    const wander = wave2(t * 2.3, 0.15) * extra.wander * held;
    const bob = wave2(t * 1.5, 0.25) * (2.2 + extra.sway * 0.25) * held;
    const drift = wave2(t * 3.1, 0.6) * extra.wander * held;
    const x = BALLOON_START.x + (BALLOON_HOVER.x - BALLOON_START.x) * arrive + sway + wander + leave * BALLOON_RELEASE.x;
    const y = BALLOON_START.y + (BALLOON_HOVER.y - BALLOON_START.y) * arrive - bob - leave * BALLOON_RELEASE.y;
    const toward = extra.lean * held;
    r.rotation = base2.rotation + toward;
    r.faceTilt = base2.faceTilt - toward * 0.6;
    r.x = base2.x + toward * 0.35;
    r.y = base2.y - held * 0.5 - bob * 0.1;
    r.smile.depth = base2.smile.depth * (1 + held * 0.12);
    r.smile.span = base2.smile.span * (1 + held * 0.05);
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
    pose: (base2) => {
      const r = cloneRig(base2);
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
    pose: (base2, t) => balloonPose(base2, t, { sway: 0.6, wander: 0, lean: 1.6 })
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
    pose: (base2, t) => balloonPose(base2, t, { sway: 1.6, wander: 0.8, lean: 2.6 })
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
    pose: (base2, t) => balloonPose(base2, t, { sway: 2.4, wander: 2, lean: 3.4 })
  };
  function popPose(base2, t, anchor, extra) {
    const r = cloneRig(base2);
    const centre = anchor ? anchor.point : toViewBox(base2, BALLOON_HOVER);
    const jolt = bump(t / 0.35) * extra.jolt;
    r.y = base2.y - jolt * 2.4;
    r.squash = jolt * 0.07;
    r.stretch = jolt * 0.03;
    r.rotation = base2.rotation - jolt * 2.2;
    r.faceTilt = base2.faceTilt - jolt * 1.6;
    for (const side of ["left", "right"]) {
      r.eyes[side].scaleY = base2.eyes[side].scaleY + jolt * 0.22;
      r.brows[side].y = base2.brows[side].y - jolt * 1.4;
      r.brows[side].arch = base2.brows[side].arch * (1 + jolt * 0.3);
    }
    r.smile.depth = base2.smile.depth * (1 + jolt * 0.2);
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
        x: centre.x + Math.sin(radians) * dist,
        y: centre.y - Math.cos(radians) * dist
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
    pose: (base2) => cloneRig(base2)
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
    pose: (base2, t, anchor) => popPose(base2, t, anchor, { shards: 5, reach: 20, jolt: 0.35 })
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
    pose: (base2, t, anchor) => popPose(base2, t, anchor, { shards: 7, reach: 26, jolt: 0.8 })
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
    pose: (base2, t, anchor) => popPose(base2, t, anchor, { shards: 10, reach: 34, jolt: 1 })
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
  function bloomPose(base2, t, extra) {
    const r = cloneRig(base2);
    const props = [];
    const shine = swell(t, 0.1, 0.46) * extra.shine;
    r.rays.forEach((ray, i) => {
      ray.lengthScale = base2.rays[i].lengthScale + shine;
    });
    const fallen = ease2((t - SEED_DROPS_AT) / (SEED_LANDS_BY - SEED_DROPS_AT));
    const seedOpacity = ease2(t / SEED_APPEARS_BY) * (1 - ease2((t - SEED_FADES_FROM) / (SEED_GONE - SEED_FADES_FROM)));
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
    const sprout = ease2((t - SPROUT_AT) / (SPROUT_DONE - SPROUT_AT));
    const sproutOpacity = Math.min(1, sprout * 4) * (1 - ease2((t - FLOWER_AT) / 0.14));
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
    const bloom = ease2((t - FLOWER_AT) / (FLOWER_DONE - FLOWER_AT));
    const flowerOpacity = Math.min(1, bloom * 4) * (1 - ease2((t - TAKEN_IN) / (1 - TAKEN_IN)));
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
    r.rotation = base2.rotation + lean;
    r.x = base2.x + lean * 0.35;
    r.faceTilt = base2.faceTilt - lean * 0.5;
    r.smile.depth = base2.smile.depth * (1 + held * 0.16);
    r.smile.span = base2.smile.span * (1 + held * 0.06);
    if (extra.hop) r.y = base2.y - swell(t, 0.58, 0.88) * 2.4;
    const focus = sprout > 0 || bloom > 0 ? bloomCentre() : {
      x: SEED_HELD.x + (PLANT.x - SEED_HELD.x) * fallen,
      y: SEED_HELD.y + (PLANT.y - SEED_HELD.y) * fallen
    };
    const mag = Math.max(1, Math.hypot(focus.x, focus.y));
    const gaze = {
      x: base2.eyes.left.gaze.x + (focus.x / mag - base2.eyes.left.gaze.x) * held,
      y: base2.eyes.left.gaze.y + (focus.y / mag - base2.eyes.left.gaze.y) * held
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
    pose: (base2) => {
      const r = cloneRig(base2);
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
    pose: (base2, t) => bloomPose(base2, t, { shine: 0.05, gleam: 0, bloom: 1, hop: false, lean: 1.4 })
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
    pose: (base2, t) => bloomPose(base2, t, { shine: 0.11, gleam: 1, bloom: 1, hop: false, lean: 2.2 })
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
    pose: (base2, t) => bloomPose(base2, t, { shine: 0.16, gleam: 2, bloom: 1.12, hop: true, lean: 3 })
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
  var SEQUENCES = AUTHORED.map(withLimbActing);
  var SEQUENCE_BY_ID = new Map(
    SEQUENCES.map((s) => [s.id, s])
  );
  var GROUPS = [...new Set(SEQUENCES.map((s) => s.group))].sort();

  // apps/character-lab/src/gallery.ts
  var HOLD_MS = 500;
  var base = defaultRig();
  var cards = [];
  var speed = 1;
  var paused = false;
  var scrub = 0;
  var elapsed = 0;
  var last = performance.now();
  var boil = 0;
  var filmTime = 0;
  function make(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== void 0) node.textContent = text;
    return node;
  }
  function progressAt(seq, ms) {
    const local = ms % (seq.duration + HOLD_MS);
    return local < seq.duration ? local / seq.duration : null;
  }
  function build() {
    createSunnyView(document.getElementById("rest"), { decorative: true }).draw(base);
    const grid = document.getElementById("grid");
    const groups = /* @__PURE__ */ new Map();
    for (const seq of SEQUENCES) {
      const list = groups.get(seq.group) ?? [];
      list.push(seq);
      groups.set(seq.group, list);
    }
    for (const [group, list] of groups) {
      const section = make("section", "group");
      section.append(make("h2", "", group));
      const row = make("div", "row");
      for (const seq of list) {
        const card = make("article", "card");
        const stage = make("div", "stage");
        const art = make("div", "art");
        stage.append(art);
        const meta = make("div", "meta");
        meta.append(make("strong", "", seq.id));
        const facts = [
          seq.duration <= 1 ? "still" : `${seq.duration} ms`,
          seq.loop ? "loops" : "once",
          `${seq.intensity}+`,
          seq.canInterrupt ? "interruptible" : "not interruptible"
        ];
        meta.append(make("span", "facts", facts.join(" \xB7 ")));
        if (seq.assets.length > 0) {
          meta.append(make("span", "facts", `props: ${seq.assets.join(", ")}`));
        }
        meta.append(
          make("span", "facts", `reduced motion \u2192 ${seq.reducedMotionFallback ?? "rest pose"}`)
        );
        const track = make("div", "track");
        const bar = make("div", "bar");
        track.append(bar);
        const clock = make("span", "clock", "");
        card.append(stage, track, clock, meta);
        row.append(card);
        cards.push({ seq, view: createSunnyView(art, { decorative: true }), bar, clock });
      }
      section.append(row);
      grid.append(section);
    }
  }
  function render() {
    for (const card of cards) {
      const { seq } = card;
      let t;
      if (paused) t = scrub;
      else t = seq.duration <= 1 ? 0 : progressAt(seq, filmTime);
      card.view.draw(t === null ? base : seq.pose(base, t), { boil });
      card.bar.style.width = `${(t ?? 1) * 100}%`;
      card.bar.classList.toggle("holding", t === null);
      card.clock.textContent = t === null ? "holding at rest" : `t = ${t.toFixed(2)} (${Math.round(t * seq.duration)} ms)`;
    }
  }
  function tick(now) {
    if (!paused) elapsed += (now - last) * speed;
    last = now;
    const clock = cartoonClock(elapsed);
    filmTime = clock.time;
    boil = cartoonClock(now).boil;
    render();
    requestAnimationFrame(tick);
  }
  function controls() {
    const speedSelect = document.getElementById("speed");
    speedSelect.addEventListener("change", () => {
      speed = Number(speedSelect.value);
    });
    const pauseButton = document.getElementById("pause");
    const scrubber = document.getElementById("scrub");
    pauseButton.addEventListener("click", () => {
      paused = !paused;
      pauseButton.textContent = paused ? "Play" : "Pause";
      scrubber.disabled = !paused;
    });
    scrubber.addEventListener("input", () => {
      scrub = Number(scrubber.value) / 1e3;
    });
    const overlay = document.getElementById("overlay");
    overlay.addEventListener("change", () => {
      document.body.classList.toggle("with-reference", overlay.checked);
    });
    document.getElementById("restart").addEventListener("click", () => {
      elapsed = 0;
    });
  }
  build();
  controls();
  requestAnimationFrame(tick);
})();
//# sourceMappingURL=gallery.js.map
