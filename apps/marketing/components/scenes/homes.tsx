/**
 * The homes Sunny's customers live in: British houses, drawn front-on the way
 * you see them from the street -- a slate roof facing you with the panels lying
 * on it, brick fronts, white bay windows, chimney pots, a low wall and a hedge.
 *
 * One light, from the upper left: shade goes under the eaves, inside the bay
 * returns and down the right-hand edges, never all over. Silhouettes get the
 * heavy ink line, inner detail the thin one, and each front carries only a few
 * details so a house reads at a glance and never competes with Sunny.
 *
 * Every house is drawn with its front wall's bottom-left corner at (x, y), and
 * grows up and to the right from there.
 */

import { ContactShadow, DOTS, DOTS_ORANGE, HATCH, INK, LEAF, LINE, ORANGE, PAPER } from './kit.js';

export const BRICK = '#E2A07A';
export const SLATE = '#5B6472';
const SLATE_DARK = '#454C58';
const TERRACOTTA = '#D9734E';
const NAVY = '#2B3A55';
const DOOR_COLOURS = [ORANGE, NAVY, '#3F7D5A', '#B04E00', '#7C4DFF'] as const;

const fine = { ...LINE, strokeWidth: 1.6 } as const;
const hair = { ...LINE, strokeWidth: 1.1 } as const;

/** A wall of brick: the colour, then the courses, then the outline. */
function BrickWall({
  x,
  y,
  w,
  h,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
}): React.JSX.Element {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill={BRICK} />
      <rect x={x} y={y} width={w} height={h} fill="url(#sk-brick)" />
      <rect x={x} y={y} width={w} height={h} fill="none" {...LINE} />
    </g>
  );
}

/** A white-framed sash window, optionally lit from inside. */
export function Sash({
  x,
  y,
  w,
  h,
  lit = false,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  lit?: boolean;
}): React.JSX.Element {
  return (
    <g>
      {/* The stone lintel and sill. */}
      <rect x={x - 4} y={y - 6} width={w + 8} height={6} fill={PAPER} {...fine} />
      <rect x={x} y={y} width={w} height={h} fill={PAPER} {...LINE} />
      <rect x={x + 4} y={y + 4} width={w - 8} height={h - 8} fill={lit ? '#FFD66B' : '#C9DCEB'} />
      {lit ? (
        <rect x={x + 4} y={y + 4} width={w - 8} height={h - 8} fill={DOTS_ORANGE} opacity={0.5} />
      ) : (
        <path
          d={`M${x + 8} ${y + h * 0.42}L${x + w * 0.42} ${y + 8}`}
          stroke="#fff"
          strokeWidth={2}
          strokeLinecap="round"
        />
      )}
      <path
        d={`M${x + 4} ${y + h / 2}H${x + w - 4}M${x + w / 2} ${y + 4}V${y + h - 4}`}
        stroke={PAPER}
        strokeWidth={2.4}
      />
      <path
        d={`M${x + 4} ${y + h / 2}H${x + w - 4}M${x + w / 2} ${y + 4}V${y + h - 4}`}
        {...hair}
      />
      <rect x={x - 3} y={y + h} width={w + 6} height={5} rx={1} fill={PAPER} {...fine} />
    </g>
  );
}

/**
 * A bay window, projecting from the front: a broad front light flanked by two
 * angled returns (the right one in shade), under its own little slate roof.
 */
function Bay({
  x,
  y,
  w,
  h,
  lit = false,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  lit?: boolean;
}): React.JSX.Element {
  const side = w * 0.18;
  const front = { x: x + side, w: w - side * 2 };
  return (
    <g>
      {/* The bay's roof. */}
      <path
        d={`M${x - 4} ${y}L${x + side + 4} ${y - 14}H${x + w - side - 4}L${x + w + 4} ${y}Z`}
        fill={SLATE}
        {...LINE}
      />
      <path d={`M${x + w - side - 4} ${y - 14}L${x + w + 4} ${y}H${x + w - side}Z`} fill={DOTS} />
      {/* The returns, then the front. */}
      <path d={`M${x} ${y}H${front.x}V${y + h}H${x + 2}Z`} fill={PAPER} {...LINE} />
      <path
        d={`M${front.x + front.w} ${y}H${x + w}L${x + w - 2} ${y + h}H${front.x + front.w}Z`}
        fill={PAPER}
        {...LINE}
      />
      <path
        d={`M${front.x + front.w} ${y}H${x + w}L${x + w - 2} ${y + h}H${front.x + front.w}Z`}
        fill={HATCH}
      />
      <rect
        x={x + 3}
        y={y + 6}
        width={side - 5}
        height={h - 18}
        fill={lit ? '#FFD66B' : '#C9DCEB'}
        {...hair}
      />
      <rect
        x={front.x + front.w + 3}
        y={y + 6}
        width={side - 6}
        height={h - 18}
        fill={lit ? '#FFD66B' : '#B3C7D8'}
        {...hair}
      />
      <Sash x={front.x + 2} y={y + 6} w={front.w - 4} h={h - 18} lit={lit} />
      {/* The brick base the bay stands on. */}
      <rect x={x} y={y + h - 10} width={w} height={10} fill={BRICK} {...fine} />
    </g>
  );
}

/** A front door with a fanlight, a number and a step. */
function Door({
  x,
  y,
  w,
  h,
  colour,
  number,
  canopy = false,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  colour: string;
  number: number;
  canopy?: boolean;
}): React.JSX.Element {
  return (
    <g>
      {canopy && (
        <g>
          <path
            d={`M${x - 10} ${y - 8}L${x + w / 2} ${y - 18}L${x + w + 10} ${y - 8}Z`}
            fill={SLATE}
            {...LINE}
          />
          <path d={`M${x - 8} ${y - 8}V${y + 4}M${x + w + 8} ${y - 8}V${y + 4}`} {...fine} />
        </g>
      )}
      <rect x={x - 3} y={y - 3} width={w + 6} height={h + 3} fill={PAPER} {...fine} />
      <path
        d={`M${x} ${y + h * 0.2}A${w / 2} ${w / 2} 0 0 1 ${x + w} ${y + h * 0.2}Z`}
        fill="#FFE7A6"
        {...hair}
      />
      <rect x={x} y={y + h * 0.2} width={w} height={h * 0.8} fill={colour} {...LINE} />
      <rect
        x={x + w * 0.2}
        y={y + h * 0.3}
        width={w * 0.6}
        height={h * 0.22}
        rx={1.5}
        fill="none"
        {...hair}
      />
      <rect
        x={x + w * 0.2}
        y={y + h * 0.6}
        width={w * 0.6}
        height={h * 0.28}
        rx={1.5}
        fill="none"
        {...hair}
      />
      <circle cx={x + w * 0.82} cy={y + h * 0.56} r={1.8} fill="#FFD66B" {...hair} />
      <text
        x={x + w / 2}
        y={y + h * 0.13}
        textAnchor="middle"
        fontSize={7}
        fontWeight={800}
        fontFamily="var(--font-sans), sans-serif"
        fill={INK}
      >
        {number}
      </text>
      <rect x={x - 5} y={y + h} width={w + 10} height={4} rx={1} fill={PAPER} {...fine} />
    </g>
  );
}

/** A chimney stack with terracotta pots. */
function Chimney({
  x,
  y,
  w = 26,
  h = 34,
  pots = 2,
}: {
  x: number;
  y: number;
  w?: number;
  h?: number;
  pots?: number;
}): React.JSX.Element {
  return (
    <g>
      {Array.from({ length: pots }, (_, i) => {
        const px = x + (w / (pots + 1)) * (i + 1) - 4;
        return (
          <path
            key={i}
            d={`M${px} ${y - 4}L${px + 1} ${y - 14}H${px + 7}L${px + 8} ${y - 4}Z`}
            fill={TERRACOTTA}
            {...fine}
          />
        );
      })}
      <rect x={x - 3} y={y - 5} width={w + 6} height={6} rx={1} fill={PAPER} {...fine} />
      <BrickWall x={x} y={y} w={w} h={h} />
      <rect x={x + w - 6} y={y + 1.4} width={4.6} height={h - 2.8} fill={HATCH} />
    </g>
  );
}

/**
 * Solar panels lying on a front roof plane: a grid of `cols` by `rows`
 * panels whose top-left is at (x, y), with a frame, a glare and a thin
 * shadow along the bottom where the array sits proud of the slates.
 */
export function RoofPanels({
  x,
  y,
  cols,
  rows = 2,
  pw = 20,
  ph = 13,
}: {
  x: number;
  y: number;
  cols: number;
  rows?: number;
  pw?: number;
  ph?: number;
}): React.JSX.Element {
  const w = cols * pw;
  const h = rows * ph;
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push(
        <g key={`${r}-${c}`}>
          <rect x={x + c * pw + 1} y={y + r * ph + 1} width={pw - 2} height={ph - 2} fill={NAVY} />
          <path
            d={`M${x + c * pw + pw / 3} ${y + r * ph + 1}V${y + r * ph + ph - 1}M${x + c * pw + (2 * pw) / 3} ${y + r * ph + 1}V${y + r * ph + ph - 1}M${x + c * pw + 1} ${y + r * ph + ph / 2}H${x + c * pw + pw - 1}`}
            stroke="#5A6B8C"
            strokeWidth={0.8}
          />
        </g>,
      );
    }
  }
  return (
    <g>
      <rect x={x + 2} y={y + h} width={w} height={3} fill={SLATE_DARK} />
      <rect x={x} y={y} width={w} height={h} fill="#9AA3AF" {...LINE} />
      {cells}
      <path
        d={`M${x + w * 0.12} ${y + h - 3}L${x + w * 0.32} ${y + 3}M${x + w * 0.22} ${y + h - 3}L${x + w * 0.4} ${y + 3}`}
        stroke="#fff"
        strokeOpacity={0.4}
        strokeWidth={2.2}
        strokeLinecap="round"
      />
    </g>
  );
}

/**
 * A front-facing slate roof over a wall of width `w`: a trapezoid from the
 * eaves up to the ridge, ridge tiles along the top, the fascia board under the
 * eaves and a band of shade beneath it.
 */
function Roof({
  w,
  top,
  rise,
  inset,
}: {
  w: number;
  top: number;
  rise: number;
  inset: number;
}): React.JSX.Element {
  const d = `M-10 ${top}L${inset} ${top - rise}H${w - inset}L${w + 10} ${top}Z`;
  return (
    <g>
      <path d={d} fill={SLATE} />
      <path
        d={`M${w * 0.5} ${top - rise}H${w - inset}L${w + 10} ${top}H${w * 0.62}Z`}
        fill={DOTS}
        opacity={0.6}
      />
      {[0.33, 0.66].map((f) => (
        <path
          key={f}
          d={`M${-10 + (inset + 10) * f} ${top - rise * f}H${w + 10 - (inset + 10) * f}`}
          stroke={SLATE_DARK}
          strokeWidth={1}
        />
      ))}
      <path d={d} fill="none" {...LINE} />
      <path d={`M${inset - 2} ${top - rise}H${w - inset + 2}`} {...LINE} strokeWidth={5} />
      <rect x={-10} y={top} width={w + 20} height={6} fill={PAPER} {...fine} />
      <rect x={0} y={top + 6} width={w} height={6} fill={DOTS} />
    </g>
  );
}

/** A low front wall with a hedge on top, broken by paths to the doors. */
function FrontGarden({
  w,
  gaps,
}: {
  w: number;
  gaps: ReadonlyArray<[number, number]>;
}): React.JSX.Element {
  const runs: Array<[number, number]> = [];
  let from = -6;
  for (const [a, b] of [...gaps].sort((p, q) => p[0] - q[0])) {
    runs.push([from, a]);
    from = b;
  }
  runs.push([from, w + 6]);
  return (
    <g>
      {gaps.map(([a, b]) => (
        <path key={a} d={`M${a} 0L${a - 6} 22H${b + 6}L${b} 0Z`} fill="#EFE3CF" {...fine} />
      ))}
      {runs.map(([a, b]) =>
        b - a < 6 ? null : (
          <g key={a}>
            <path
              d={`M${a} 6Q${a + 2} -10 ${a + 12} -8Q${(a + b) / 2} -16 ${b - 12} -8Q${b - 2} -10 ${b} 6Z`}
              fill={LEAF}
              {...fine}
            />
            <rect x={a} y={4} width={b - a} height={12} fill={BRICK} {...fine} />
            <rect x={a - 1} y={2} width={b - a + 2} height={4} rx={1} fill={PAPER} {...hair} />
          </g>
        ),
      )}
    </g>
  );
}

interface HomeProps {
  x: number;
  y: number;
  /** Scale; 1 is the natural size. */
  s?: number;
  /** How many panels across the array on the roof (0 for none). */
  panels?: number;
  /** Windows lit from inside (night). */
  lit?: boolean | 'one';
}

/**
 * A pair of semis sharing a chimney: the most British house there is. Bay
 * windows downstairs, sashes upstairs, doors side by side at the party wall.
 */
export function SemiDetached({
  x,
  y,
  s = 1,
  panels = 4,
  lit = false,
}: HomeProps): React.JSX.Element {
  const W = 240;
  const H = 128;
  const litAll = lit === true;
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <ContactShadow x={W / 2} y={18} rx={W * 0.6} ry={9} />
      <Chimney x={W / 2 - 16} y={-H - 78} w={32} h={44} pots={4} />
      <Roof w={W} top={-H} rise={52} inset={42} />
      {panels > 0 && (
        <RoofPanels x={W * 0.53} y={-H - 46} cols={Math.min(panels, 4)} rows={2} pw={21} ph={17} />
      )}
      <BrickWall x={0} y={-H} w={W} h={H} />
      <path d={`M${W / 2} ${-H}V0`} {...fine} />
      <rect x={W - 10} y={-H + 12} width={8.6} height={H - 13.4} fill={HATCH} />
      {/* Upstairs. */}
      <Sash x={22} y={-H + 26} w={42} h={36} lit={litAll || lit === 'one'} />
      <Sash x={W / 2 - 42} y={-H + 30} w={24} h={30} lit={litAll} />
      <Sash x={W / 2 + 18} y={-H + 30} w={24} h={30} lit={litAll} />
      <Sash x={W - 64} y={-H + 26} w={42} h={36} lit={litAll} />
      {/* Downstairs: bays at the ends, doors at the middle. */}
      <Bay x={12} y={-56} w={66} h={56} lit={litAll} />
      <Bay x={W - 78} y={-56} w={66} h={56} lit={litAll} />
      <Door x={W / 2 - 38} y={-58} w={24} h={58} colour={ORANGE} number={12} />
      <Door x={W / 2 + 14} y={-58} w={24} h={58} colour={NAVY} number={14} />
      <FrontGarden
        w={W}
        gaps={[
          [W / 2 - 40, W / 2 - 12],
          [W / 2 + 12, W / 2 + 40],
        ]}
      />
    </g>
  );
}

/**
 * A terrace: `count` narrow houses in a row under one roof, chimneys on the
 * party walls, each door its own colour.
 */
export function Terrace({
  x,
  y,
  s = 1,
  count = 4,
  panels = 3,
  panelEvery = 2,
  lit = false,
}: HomeProps & { count?: number; panelEvery?: number }): React.JSX.Element {
  const hw = 72;
  const W = hw * count;
  const H = 116;
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <ContactShadow x={W / 2} y={18} rx={W * 0.56} ry={9} />
      {Array.from({ length: count + 1 }, (_, i) =>
        i === 0 || i === count || i % 2 === 0 ? (
          <Chimney
            key={i}
            x={Math.min(Math.max(i * hw - 12, 30), W - 54)}
            y={-H - 66}
            w={24}
            h={34}
            pots={2}
          />
        ) : null,
      )}
      <Roof w={W} top={-H} rise={42} inset={34} />
      {panels > 0 &&
        Array.from({ length: count }, (_, i) =>
          i % panelEvery === 0 ? (
            <RoofPanels
              key={i}
              x={i * hw + hw / 2 - (panels * 16) / 2 + (i === 0 ? 14 : 0)}
              y={-H - 34}
              cols={panels}
              rows={2}
              pw={16}
              ph={13}
            />
          ) : null,
        )}
      <BrickWall x={0} y={-H} w={W} h={H} />
      {Array.from({ length: count }, (_, i) => {
        const hx = i * hw;
        const isLit = lit === true || (lit === 'one' && i === Math.floor(count / 2));
        return (
          <g key={i}>
            {i > 0 && <path d={`M${hx} ${-H + 12}V0`} {...hair} />}
            <Sash x={hx + 10} y={-H + 24} w={22} h={30} lit={isLit} />
            <Sash x={hx + 40} y={-H + 24} w={22} h={30} lit={lit === true} />
            <Sash x={hx + 10} y={-56} w={26} h={34} lit={lit === true} />
            <Door
              x={hx + 44}
              y={-54}
              w={20}
              h={54}
              colour={DOOR_COLOURS[i % DOOR_COLOURS.length]!}
              number={2 * i + 1}
            />
          </g>
        );
      })}
      <rect x={W - 10} y={-H + 12} width={8.6} height={H - 13.4} fill={HATCH} />
      <FrontGarden
        w={W}
        gaps={Array.from(
          { length: count },
          (_, i) => [i * hw + 42, i * hw + 66] as [number, number],
        )}
      />
    </g>
  );
}

/**
 * A detached, double-fronted house: a central door under a porch canopy,
 * windows either side, panels across the roof.
 */
export function Detached({ x, y, s = 1, panels = 5, lit = false }: HomeProps): React.JSX.Element {
  const W = 220;
  const H = 128;
  const litAll = lit === true;
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <ContactShadow x={W / 2} y={18} rx={W * 0.6} ry={9} />
      <Chimney x={18} y={-H - 64} w={26} h={40} pots={2} />
      <Chimney x={W - 44} y={-H - 64} w={26} h={40} pots={2} />
      <Roof w={W} top={-H} rise={50} inset={38} />
      {panels > 0 && (
        <RoofPanels
          x={W / 2 - (panels * 18) / 2}
          y={-H - 42}
          cols={panels}
          rows={2}
          pw={18}
          ph={14}
        />
      )}
      <BrickWall x={0} y={-H} w={W} h={H} />
      <rect x={W - 10} y={-H + 12} width={8.6} height={H - 13.4} fill={HATCH} />
      <Sash x={22} y={-H + 26} w={40} h={36} lit={litAll || lit === 'one'} />
      <Sash x={W / 2 - 14} y={-H + 22} w={28} h={30} lit={litAll} />
      <Sash x={W - 62} y={-H + 26} w={40} h={36} lit={litAll} />
      <Bay x={14} y={-56} w={62} h={56} lit={litAll} />
      <Bay x={W - 76} y={-56} w={62} h={56} lit={litAll} />
      <Door x={W / 2 - 13} y={-58} w={26} h={58} colour={ORANGE} number={7} canopy />
      <FrontGarden w={W} gaps={[[W / 2 - 16, W / 2 + 16]]} />
    </g>
  );
}
