/**
 * The scene kit: the furniture of Sunny's world, drawn the way the character
 * is drawn -- a confident ink line round flat fills -- and then finished the way
 * a 1930s print is finished: halftone dots and hatching for shade, small
 * details (roof tiles, window bars, wood grain, grass tufts) that reward a
 * second look, and a heavier outline round each object than inside it.
 *
 * Every piece is a plain SVG group positioned in its scene's own units, so a
 * scene reads like a stage direction: a house here, a moon there, Sunny in
 * front. Server components: no state, no effects, nothing to hydrate. The
 * print patterns (`url(#sk-…)`) are defined once per page by `SceneDefs`.
 */

export const INK = '#171717';
export const PAPER = '#FFFDF7';
export const CREAM = '#FBF4E8';
export const ORANGE = '#FF7900';
export const PALE = '#FFE2C2';
export const GREY = '#B7BCC4';
export const WOOD = '#C98B4A';
export const PANEL = '#2B3A55';
export const LEAF = '#7FB069';
/** The colour switcher's presets, as paint. */
export const PAINT_COLOURS = [ORANGE, '#7C4DFF', '#1FA463', '#1A73E8'] as const;

/** The outline every object is drawn with. */
export const LINE = {
  stroke: INK,
  strokeWidth: 2.8,
  strokeLinejoin: 'round',
  strokeLinecap: 'round',
} as const;

/** The finer line for detail inside an object. */
const fine = { ...LINE, strokeWidth: 1.6 } as const;
const hair = { ...LINE, strokeWidth: 1.1 } as const;

/** Print shading, laid over a fill. */
export const DOTS = 'url(#sk-dots)';
export const DOTS_FINE = 'url(#sk-dots-fine)';
export const HATCH = 'url(#sk-hatch)';
export const DOTS_ORANGE = 'url(#sk-dots-orange)';

interface At {
  x: number;
  y: number;
}

/**
 * The print patterns every scene shades with, defined once per page. Kept in
 * the document (not `display: none`, which would stop the patterns painting)
 * but out of sight and out of the accessibility tree.
 */
export function SceneDefs(): React.JSX.Element {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: 'absolute' }}>
      <defs>
        <pattern
          id="sk-dots"
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(30)"
        >
          <circle cx="3" cy="3" r="1.25" fill={INK} opacity="0.32" />
        </pattern>
        <pattern
          id="sk-dots-fine"
          width="4.5"
          height="4.5"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(30)"
        >
          <circle cx="2.25" cy="2.25" r="0.75" fill={INK} opacity="0.28" />
        </pattern>
        <pattern
          id="sk-dots-orange"
          width="7"
          height="7"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(30)"
        >
          <circle cx="3.5" cy="3.5" r="1.6" fill={ORANGE} opacity="0.55" />
        </pattern>
        <pattern
          id="sk-hatch"
          width="5"
          height="5"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line x1="0" y1="0" x2="0" y2="5" stroke={INK} strokeWidth="1" opacity="0.35" />
        </pattern>
      </defs>
    </svg>
  );
}

/** A soft halftone shadow on the ground, under something standing on it. */
export function ContactShadow({
  x,
  y,
  rx,
  ry = rx * 0.16,
}: At & { rx: number; ry?: number }): React.JSX.Element {
  return <ellipse cx={x} cy={y} rx={rx} ry={ry} fill={DOTS} />;
}

/** A few blades of grass, drawn with the fine line. */
export function Tufts({ points }: { points: ReadonlyArray<[number, number]> }): React.JSX.Element {
  return (
    <g>
      {points.map(([x, y], i) => (
        <path
          key={i}
          d={`M${x - 6} ${y}Q${x - 5} ${y - 7} ${x - 8} ${y - 11}M${x} ${y}Q${x} ${y - 9} ${x + 1} ${y - 14}M${x + 6} ${y}Q${x + 6} ${y - 6} ${x + 10} ${y - 10}`}
          fill="none"
          {...fine}
        />
      ))}
    </g>
  );
}

/**
 * The ground: a gentle hill across the scene, a hatched crest where it turns
 * away from the light, grass tufts and a pebble or two.
 */
export function Ground({
  y,
  width,
  fill = PALE,
  bulge = 18,
}: {
  y: number;
  width: number;
  fill?: string;
  bulge?: number;
}): React.JSX.Element {
  const d = `M-10 ${y + bulge}C${width * 0.25} ${y - bulge} ${width * 0.6} ${y + bulge * 0.6} ${width + 10} ${y - bulge * 0.4}V${y + 400}H-10Z`;
  return (
    <g>
      <path d={d} fill={fill} />
      <path d={d} fill={DOTS_FINE} opacity={0.55} transform={`translate(0 ${bulge * 0.5 + 10})`} />
      <path d={d} fill="none" {...LINE} />
      <Tufts
        points={[
          [width * 0.12, y + bulge * 0.35],
          [width * 0.47, y + bulge * 0.1 + 2],
          [width * 0.83, y - bulge * 0.05 + 4],
        ]}
      />
      <ellipse cx={width * 0.3} cy={y + bulge + 16} rx={5} ry={3} fill={PAPER} {...hair} />
      <ellipse cx={width * 0.68} cy={y + bulge + 22} rx={4} ry={2.4} fill={PAPER} {...hair} />
    </g>
  );
}

/** A solar panel: a dark cell grid in an aluminium frame, catching the light. */
export function SolarPanel({
  x,
  y,
  w = 60,
  h = 34,
  skew = -10,
}: At & { w?: number; h?: number; skew?: number }): React.JSX.Element {
  const lines = [];
  for (let i = 1; i < 6; i++)
    lines.push(
      <line
        key={`v${i}`}
        x1={(w * i) / 6}
        y1={2}
        x2={(w * i) / 6}
        y2={h - 2}
        stroke="#5A6B8C"
        strokeWidth={1}
      />,
    );
  for (let j = 1; j < 3; j++)
    lines.push(
      <line
        key={`h${j}`}
        x1={2}
        y1={(h * j) / 3}
        x2={w - 2}
        y2={(h * j) / 3}
        stroke="#5A6B8C"
        strokeWidth={1}
      />,
    );
  return (
    <g transform={`translate(${x} ${y}) skewX(${skew})`}>
      <rect x={2} y={h} width={w} height={4} fill={GREY} {...hair} />
      <rect width={w} height={h} rx={2} fill={PANEL} {...LINE} />
      {lines}
      <path
        d={`M${w * 0.1} ${h * 0.82}L${w * 0.42} ${h * 0.18}M${w * 0.22} ${h * 0.82}L${w * 0.5} ${h * 0.24}`}
        stroke="#fff"
        strokeOpacity={0.45}
        strokeWidth={2.2}
        strokeLinecap="round"
      />
    </g>
  );
}

/**
 * A storybook cottage: a chunky pitched roof with a deep eave, a chimney, two
 * four-pane windows and an arched door. `panels` lays that many solar panels
 * flat along the right-hand slope of the roof, where the sun is.
 *
 * Kept deliberately simple -- a few confident shapes, shade on the side away
 * from the light -- because a busy house fights Sunny for attention.
 */
export function House({
  x,
  y,
  w = 150,
  h = 96,
  roof = PALE,
  panels = 0,
  lit = false,
  door = true,
}: At & {
  w?: number;
  h?: number;
  roof?: string;
  panels?: number;
  lit?: boolean;
  door?: boolean;
}): React.JSX.Element {
  const peak = h * 0.7;
  const eave = 12;
  // The right-hand slope, from the ridge down to the eave.
  const ridge = { x: w / 2, y: -peak };
  const foot = { x: w + eave, y: 4 };
  const slope = Math.atan2(foot.y - ridge.y, foot.x - ridge.x);
  const slopeDeg = (slope * 180) / Math.PI;
  const slopeLen = Math.hypot(foot.x - ridge.x, foot.y - ridge.y);
  const panelW = (slopeLen * 0.72) / Math.max(1, panels);
  const win = (wx: number): React.JSX.Element => {
    const ww = w * 0.18;
    const wh = ww;
    const wy = h * 0.22;
    return (
      <g key={wx}>
        <rect
          x={wx}
          y={wy}
          width={ww}
          height={wh}
          rx={3}
          fill={lit ? '#FFD66B' : '#DCEBFA'}
          {...LINE}
        />
        {!lit && (
          <path
            d={`M${wx + ww * 0.18} ${wy + wh * 0.42}L${wx + ww * 0.42} ${wy + wh * 0.18}`}
            stroke="#fff"
            strokeWidth={2.4}
            strokeLinecap="round"
          />
        )}
        <path d={`M${wx + ww / 2} ${wy}V${wy + wh}M${wx} ${wy + wh / 2}H${wx + ww}`} {...fine} />
        <rect x={wx - 4} y={wy + wh} width={ww + 8} height={5} rx={2} fill={PAPER} {...fine} />
      </g>
    );
  };
  return (
    <g transform={`translate(${x} ${y})`}>
      <ContactShadow x={w / 2} y={h + 2} rx={w * 0.62} />
      {/* The chimney, behind the roof, with a curl of smoke. */}
      <rect
        x={w * 0.22}
        y={-peak * 0.86}
        width={w * 0.11}
        height={peak * 0.6}
        fill={PAPER}
        {...LINE}
      />
      <rect
        x={w * 0.22 - 4}
        y={-peak * 0.86 - 7}
        width={w * 0.11 + 8}
        height={8}
        rx={2}
        fill={GREY}
        {...fine}
      />
      <path
        d={`M${w * 0.275} ${-peak * 0.86 - 12}q-9 -9 0 -18q9 -9 0 -18`}
        fill="none"
        stroke={INK}
        strokeWidth={1.6}
        strokeLinecap="round"
        opacity={0.45}
      />
      {/* The walls, shaded on the side away from the light. */}
      <rect x={0} y={0} width={w} height={h} rx={3} fill={PAPER} {...LINE} />
      <rect x={w * 0.78} y={1.4} width={w * 0.22 - 1.4} height={h - 2.8} fill={HATCH} />
      {/* The roof: a deep eave, the right slope in shade. */}
      <path d={`M${-eave} 4L${w / 2} ${-peak}L${w + eave} 4Z`} fill={roof} />
      <path d={`M${w / 2} ${-peak}L${w + eave} 4H${w / 2 + 8}Z`} fill={DOTS} />
      <path d={`M${-eave} 4L${w / 2} ${-peak}L${w + eave} 4Z`} fill="none" {...LINE} />
      <path d={`M${-eave + 4} 4H${w + eave - 4}`} {...LINE} strokeWidth={5} />
      {/* Panels lying flat along the sunny slope. */}
      {Array.from({ length: panels }, (_, i) => {
        const along = slopeLen * 0.12 + i * (panelW + 4);
        return (
          <g
            key={i}
            transform={`translate(${ridge.x + Math.cos(slope) * along} ${ridge.y + Math.sin(slope) * along}) rotate(${slopeDeg})`}
          >
            <SolarPanel x={0} y={-18} w={panelW} h={14} skew={0} />
          </g>
        );
      })}
      {win(w * 0.1)}
      {!door && win(w * 0.41)}
      {win(w * 0.72)}
      {door && (
        <g>
          <path
            d={`M${w * 0.4} ${h}V${h * 0.52}Q${w * 0.5} ${h * 0.36} ${w * 0.6} ${h * 0.52}V${h}`}
            fill={ORANGE}
            {...LINE}
          />
          <circle cx={w * 0.56} cy={h * 0.76} r={2} fill={INK} />
          <rect x={w * 0.36} y={h} width={w * 0.28} height={4} rx={2} fill={GREY} {...fine} />
        </g>
      )}
    </g>
  );
}

/** A browser window: the installer's website, where Sunny lives. */
export function BrowserFrame({
  x,
  y,
  w,
  h,
  url = 'your-solar-company.co.uk',
  children,
}: At & { w: number; h: number; url?: string; children?: React.ReactNode }): React.JSX.Element {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={7} y={9} width={w} height={h} rx={14} fill={INK} />
      <rect width={w} height={h} rx={14} fill={PAPER} {...LINE} />
      <path d={`M0 30H${w}`} {...LINE} />
      <rect x={1.4} y={1.4} width={w - 2.8} height={27} rx={12} fill={CREAM} />
      <path d={`M0 30H${w}`} {...LINE} />
      {[18, 34, 50].map((cx, i) => (
        <circle key={cx} cx={cx} cy={15} r={4.6} fill={i === 0 ? ORANGE : PAPER} {...fine} />
      ))}
      <rect x={70} y={7} width={Math.min(220, w - 90)} height={16} rx={8} fill={PAPER} {...fine} />
      <path d="M78 15.5a3 3 0 1 1 0.01 0Z" fill={GREY} />
      <text x={86} y={19} fontSize={9.5} fontFamily="var(--font-sans), sans-serif" fill={INK}>
        {url}
      </text>
      <g transform="translate(0 30)">{children}</g>
    </g>
  );
}

/** Lines of placeholder copy on a page: a headline bar and body lines. */
export function CopyLines({
  x,
  y,
  w,
  lines = 3,
  heading = true,
}: At & { w: number; lines?: number; heading?: boolean }): React.JSX.Element {
  return (
    <g transform={`translate(${x} ${y})`}>
      {heading && <rect width={w * 0.7} height={12} rx={6} fill={INK} />}
      {Array.from({ length: lines }, (_, i) => (
        <rect
          key={i}
          y={(heading ? 24 : 0) + i * 14}
          width={w * (i === lines - 1 ? 0.6 : 1)}
          height={6}
          rx={3}
          fill={GREY}
        />
      ))}
    </g>
  );
}

/** A crescent moon with a crater or two. */
export function Moon({ x, y, r = 26 }: At & { r?: number }): React.JSX.Element {
  return (
    <g>
      <circle cx={x} cy={y} r={r * 1.9} fill="#FFE7A6" opacity={0.08} />
      <path
        d={`M${x + r * 0.2} ${y - r}A${r} ${r} 0 1 0 ${x + r} ${y + r * 0.3}A${r * 0.8} ${r * 0.8} 0 1 1 ${x + r * 0.2} ${y - r}Z`}
        fill="#FFE7A6"
        {...LINE}
      />
      <circle cx={x - r * 0.45} cy={y + r * 0.1} r={r * 0.12} fill="none" {...hair} />
      <circle cx={x - r * 0.15} cy={y + r * 0.55} r={r * 0.08} fill="none" {...hair} />
    </g>
  );
}

/** Four-pointed stars with twinkle lines, the 1930s night sky. */
export function Stars({
  points,
  size = 7,
  fill = CREAM,
}: {
  points: ReadonlyArray<[number, number]>;
  size?: number;
  fill?: string;
}): React.JSX.Element {
  return (
    <g>
      {points.map(([x, y], i) => {
        const s = size * (i % 2 === 0 ? 1 : 0.7);
        return (
          <g key={i}>
            <path
              d={`M${x} ${y - s}Q${x} ${y} ${x + s} ${y}Q${x} ${y} ${x} ${y + s}Q${x} ${y} ${x - s} ${y}Q${x} ${y} ${x} ${y - s}Z`}
              fill={fill}
            />
            {i % 3 === 0 && (
              <circle cx={x + s * 2.2} cy={y - s * 1.6} r={1.2} fill={fill} opacity={0.8} />
            )}
          </g>
        );
      })}
    </g>
  );
}

/** A desk: a thick, grained top on two tapered legs, a drawer underneath. */
export function Desk({ x, y, w = 220 }: At & { w?: number }): React.JSX.Element {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path
        d={`M14 14L6 96H20L32 14ZM${w - 14} 14L${w - 6} 96H${w - 20}L${w - 32} 14Z`}
        fill={WOOD}
        {...LINE}
      />
      <path d={`M14 14L6 96H12L22 14Z`} fill={HATCH} />
      <rect x={w * 0.55} y={14} width={w * 0.32} height={22} rx={2} fill={WOOD} {...fine} />
      <rect x={w * 0.55} y={14} width={w * 0.32} height={22} rx={2} fill={DOTS} />
      <rect x={w * 0.68} y={23} width={w * 0.06} height={4} rx={2} fill={INK} />
      <rect width={w} height={16} rx={4} fill={WOOD} {...LINE} />
      <path
        d={`M10 6Q${w * 0.3} 3 ${w * 0.45} 7T${w - 20} 6M24 11Q${w * 0.4} 9 ${w * 0.7} 11`}
        fill="none"
        {...hair}
        opacity={0.55}
      />
    </g>
  );
}

/** A mug of something hot. */
export function Mug({ x, y }: At): React.JSX.Element {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path
        d="M2 -26Q-2 -32 2 -38M10 -26Q6 -32 10 -38"
        fill="none"
        stroke={INK}
        strokeWidth={1.4}
        strokeLinecap="round"
        opacity={0.5}
      />
      <path d="M16 -16Q26 -16 24 -8Q22 -2 14 -4" fill="none" {...fine} />
      <path d="M-4 -20H18V-2Q18 2 14 2H0Q-4 2 -4 -2Z" fill={ORANGE} {...LINE} />
      <path d="M-4 -12H18" {...hair} />
    </g>
  );
}

/** An anglepoise lamp throwing a cone of light. */
export function Lamp({ x, y, light = true }: At & { light?: boolean }): React.JSX.Element {
  return (
    <g transform={`translate(${x} ${y})`}>
      {light && <path d="M34 -60L130 6H-10Z" fill="#FFE7A6" opacity={0.5} />}
      {light && <path d="M34 -60L130 6H-10Z" fill={DOTS_ORANGE} opacity={0.35} />}
      <path d="M-12 0H24" {...LINE} strokeWidth={6} />
      <path d="M6 0L-6 -40L30 -64" fill="none" {...LINE} strokeWidth={4.4} />
      <circle cx={-6} cy={-40} r={3.6} fill={GREY} {...fine} />
      <path d="M22 -78L54 -54L34 -46Q24 -62 12 -66Z" fill={ORANGE} {...LINE} />
      <path d="M22 -78L32 -70L18 -64Z" fill={DOTS} />
      <path d="M-12 0Q-30 4 -36 18" fill="none" {...fine} />
    </g>
  );
}

/** A shelf of books, with bookends and the odd book leaning. */
export function Shelf({ x, y, w = 200 }: At & { w?: number }): React.JSX.Element {
  const palette = [ORANGE, PANEL, PALE, WOOD, GREY, ORANGE, PAPER, PANEL];
  // Enough books to fill the shelf, with a gap at the end to lean one in.
  const count = Math.max(4, Math.floor((w - 60) / 17));
  let cursor = 10;
  const books = Array.from({ length: count }, (_, i) => {
    const fill = palette[i % palette.length]!;
    const bw = 12 + ((i * 7) % 9);
    const bh = 34 + ((i * 11) % 16);
    const book = (
      <g key={i}>
        <rect x={cursor} y={-bh} width={bw} height={bh} rx={2} fill={fill} {...fine} />
        <path d={`M${cursor} ${-bh + 6}h${bw}M${cursor} ${-10}h${bw}`} {...hair} />
        {i % 3 === 0 && (
          <rect
            x={cursor + bw / 2 - 2}
            y={-bh + 12}
            width={4}
            height={bh - 26}
            rx={2}
            fill={INK}
            opacity={0.6}
          />
        )}
      </g>
    );
    cursor += bw + 2;
    return book;
  });
  return (
    <g transform={`translate(${x} ${y})`}>
      {books}
      <g transform={`translate(${cursor + 8} 0) rotate(18)`}>
        <rect x={0} y={-40} width={13} height={40} rx={2} fill={ORANGE} {...fine} />
      </g>
      <rect x={0} y={0} width={w} height={10} rx={3} fill={WOOD} {...LINE} />
      <rect x={1.4} y={6} width={w - 2.8} height={3} fill={DOTS} />
      <path d={`M14 10V22M${w - 14} 10V22`} {...fine} />
    </g>
  );
}

/** The installer's van, side on, with a ladder on the roof. */
export function Van({
  x,
  y,
  w = 190,
  label = 'SOLAR',
}: At & { w?: number; label?: string }): React.JSX.Element {
  return (
    <g transform={`translate(${x} ${y})`}>
      <ContactShadow x={w / 2} y={16} rx={w * 0.55} />
      {/* A ladder strapped to the roof. */}
      <path d={`M14 -78H${w * 0.58}M14 -84H${w * 0.58}`} {...fine} />
      {Array.from({ length: 7 }, (_, i) => (
        <path key={i} d={`M${20 + i * ((w * 0.58 - 26) / 6)} -84V-78`} {...hair} />
      ))}
      <path
        d={`M0 0V-60Q0 -70 10 -70H${w * 0.62}L${w * 0.86} -42Q${w} -38 ${w} -26V0Z`}
        fill={PAPER}
        {...LINE}
      />
      <path d={`M2 -4H${w - 2}V-14H2Z`} fill={DOTS} />
      <path d={`M${w * 0.64} -64L${w * 0.82} -42H${w * 0.64}Z`} fill="#DCEBFA" {...fine} />
      <path
        d={`M${w * 0.68} -58L${w * 0.72} -46`}
        stroke="#fff"
        strokeWidth={2}
        strokeLinecap="round"
      />
      <path d={`M${w * 0.6} -66V-6`} {...fine} />
      <rect x={w * 0.64} y={-36} width={10} height={4} rx={2} fill={INK} />
      <circle cx={w - 4} cy={-24} r={4} fill="#FFD66B" {...fine} />
      <rect x={12} y={-50} width={w * 0.44} height={26} rx={4} fill={ORANGE} {...fine} />
      <circle cx={26} cy={-37} r={7} fill="#FFD66B" {...hair} />
      <text
        x={36 + w * 0.2}
        y={-32}
        textAnchor="middle"
        fontSize={11}
        fontWeight={800}
        fontFamily="var(--font-sans), sans-serif"
        fill={INK}
        letterSpacing={1}
      >
        {label}
      </text>
      {[w * 0.2, w * 0.78].map((cx) => (
        <g key={cx}>
          <path d={`M${cx - 22} 0A22 22 0 0 1 ${cx + 22} 0`} fill={CREAM} {...fine} />
          <circle cx={cx} cy={2} r={15} fill={INK} />
          <circle cx={cx} cy={2} r={7} fill={GREY} />
          <circle cx={cx} cy={2} r={2} fill={INK} />
        </g>
      ))}
    </g>
  );
}

/** A fluffy cartoon cloud, shaded underneath. */
export function Cloud({ x, y, s = 1 }: At & { s?: number }): React.JSX.Element {
  const d = 'M0 0Q-2 -16 14 -18Q20 -32 38 -26Q50 -38 64 -24Q80 -24 78 -8Q86 2 72 6H6Q-8 6 0 0Z';
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d={d} fill={PAPER} />
      <path d="M2 -2H76Q82 4 72 6H6Q-4 6 2 -2Z" fill={DOTS_FINE} />
      <path d={d} fill="none" {...LINE} />
      <path d="M22 -14Q26 -20 34 -18M50 -16Q56 -22 62 -16" fill="none" {...hair} />
    </g>
  );
}

/** A burst of print rays behind something important, half of them hatched. */
export function Sunburst({
  x,
  y,
  r = 110,
  count = 16,
  fill = PALE,
}: At & { r?: number; count?: number; fill?: string }): React.JSX.Element {
  const rays = [];
  for (let i = 0; i < count; i += 2) {
    const a = (i / count) * Math.PI * 2;
    const b = a + Math.PI / count;
    const d = `M${x} ${y}L${x + Math.cos(a) * r} ${y + Math.sin(a) * r}L${x + Math.cos(b) * r} ${y + Math.sin(b) * r}Z`;
    rays.push(<path key={i} d={d} fill={fill} />);
    if (i % 4 === 0) rays.push(<path key={`h${i}`} d={d} fill={DOTS_ORANGE} opacity={0.5} />);
  }
  return <g>{rays}</g>;
}

/** A potted plant, to make a room a room. */
export function Plant({ x, y }: At): React.JSX.Element {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path
        d="M0 -20Q-24 -46 -10 -62Q2 -44 0 -20ZM2 -22Q22 -54 36 -46Q28 -26 2 -22ZM0 -22Q-30 -30 -34 -16Q-14 -8 0 -22Z"
        fill={LEAF}
        {...LINE}
      />
      <path
        d="M-1 -24Q-8 -42 -10 -56M4 -24Q18 -38 30 -44M-2 -22Q-16 -22 -28 -18"
        fill="none"
        {...hair}
      />
      <path d="M-14 -20H16L12 6H-10Z" fill={ORANGE} {...LINE} />
      <path d="M-14 -20H16L15 -14H-13Z" fill={DOTS} />
    </g>
  );
}

/** A pedestal with a little sign on it, for presenting things. */
export function Stand({
  x,
  y,
  label,
  tall = 40,
  children,
}: At & { label: string; tall?: number; children?: React.ReactNode }): React.JSX.Element {
  return (
    <g transform={`translate(${x} ${y})`}>
      <ContactShadow x={0} y={tall} rx={44} />
      {children}
      <rect x={-36} y={-6} width={72} height={8} rx={2} fill={PAPER} {...fine} />
      <rect x={-32} y={0} width={64} height={tall} rx={3} fill={PAPER} {...LINE} />
      <rect x={18} y={1.4} width={12.6} height={tall - 2.8} fill={HATCH} />
      <text
        x={-6}
        y={tall / 2 + 5}
        textAnchor="middle"
        fontSize={13}
        fontWeight={800}
        fontFamily="var(--font-display), serif"
        fill={INK}
      >
        {label}
      </text>
    </g>
  );
}

/** A wall socket board with labelled sockets. */
export function SocketBoard({
  x,
  y,
  labels,
}: At & { labels: readonly string[] }): React.JSX.Element {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={5} y={6} width={labels.length * 74 + 16} height={84} rx={10} fill={INK} />
      <rect
        x={0}
        y={0}
        width={labels.length * 74 + 16}
        height={84}
        rx={10}
        fill={PAPER}
        {...LINE}
      />
      {[
        [8, 8],
        [labels.length * 74 + 8, 8],
        [8, 76],
        [labels.length * 74 + 8, 76],
      ].map(([sx, sy]) => (
        <g key={`${sx}-${sy}`}>
          <circle cx={sx} cy={sy} r={2.6} fill={GREY} {...hair} />
          <path d={`M${sx! - 1.6} ${sy}h3.2`} {...hair} />
        </g>
      ))}
      {labels.map((label, i) => (
        <g key={label} transform={`translate(${16 + i * 74} 12)`}>
          <rect width={58} height={40} rx={8} fill={CREAM} {...fine} />
          <rect x={2} y={30} width={54} height={8} rx={4} fill={DOTS} />
          <rect x={20} y={12} width={4} height={14} rx={1} fill={INK} />
          <rect x={34} y={12} width={4} height={14} rx={1} fill={INK} />
          <text
            x={29}
            y={62}
            textAnchor="middle"
            fontSize={11}
            fontWeight={800}
            fontFamily="var(--font-sans), sans-serif"
            fill={INK}
          >
            {label}
          </text>
        </g>
      ))}
    </g>
  );
}

/** A big, tilted `<script>` tag label, as if pinned to the page. */
export function ScriptTag({ x, y, rotate = -6 }: At & { rotate?: number }): React.JSX.Element {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate})`}>
      <rect x={4} y={5} width={150} height={44} rx={8} fill={INK} />
      <rect width={150} height={44} rx={8} fill={ORANGE} {...LINE} />
      <rect x={1.4} y={30} width={147} height={12} rx={6} fill={DOTS} />
      <circle cx={12} cy={10} r={3} fill={GREY} {...hair} />
      <text
        x={78}
        y={29}
        textAnchor="middle"
        fontSize={17}
        fontWeight={800}
        fontFamily="ui-monospace, monospace"
        fill={INK}
      >
        {'<script>'}
      </text>
    </g>
  );
}

/** A door, half open, with light spilling out across the floor. */
export function Door({ x, y }: At): React.JSX.Element {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d="M0 0L-40 26H70L70 0Z" fill="#FFE7A6" opacity={0.7} />
      <rect x={-6} y={-126} width={82} height={126} fill={PAPER} {...LINE} />
      <rect x={0} y={-120} width={70} height={120} fill="#FFE7A6" {...LINE} />
      <rect x={0} y={-120} width={70} height={120} fill={DOTS_ORANGE} opacity={0.35} />
      <path d="M70 -120L104 -108V8L70 0Z" fill={ORANGE} {...LINE} />
      <path d="M76 -100L98 -92V-62L76 -68ZM76 -50L98 -44V-10L76 -14Z" fill="none" {...fine} />
      <circle cx={96} cy={-54} r={3} fill={INK} />
    </g>
  );
}

/** An easel with a canvas on it: a portrait of the sun, in your colour. */
export function Easel({ x, y }: At): React.JSX.Element {
  return (
    <g transform={`translate(${x} ${y})`}>
      <ContactShadow x={80} y={2} rx={84} />
      <path d="M20 0L60 -230M140 0L100 -230M80 -230V8" fill="none" {...LINE} strokeWidth={7} />
      <path
        d="M20 0L60 -230M140 0L100 -230M80 -230V8"
        fill="none"
        stroke={WOOD}
        strokeWidth={4}
        strokeLinecap="round"
      />
      <rect x={6} y={-206} width={148} height={130} rx={4} fill={PAPER} {...LINE} />
      <rect x={12} y={-200} width={136} height={118} fill={DOTS_FINE} opacity={0.4} />
      <circle cx={80} cy={-141} r={30} fill="var(--sunny-brand-orange, #FF7900)" {...LINE} />
      <path d="M66 -146q4 -6 8 0M86 -146q4 -6 8 0M68 -130q12 10 24 0" fill="none" {...fine} />
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2;
        return (
          <path
            key={i}
            d={`M${80 + Math.cos(a) * 38} ${-141 + Math.sin(a) * 38}L${80 + Math.cos(a) * 52} ${-141 + Math.sin(a) * 52}`}
            {...LINE}
            strokeWidth={4}
          />
        );
      })}
      <path d="M0 -76H160" {...LINE} strokeWidth={7} />
      <path d="M0 -76H160" stroke={WOOD} strokeWidth={4} strokeLinecap="round" />
    </g>
  );
}

/** Paint pots, lids off, a drip down one side. */
export function PaintPots({
  x,
  y,
  colours,
}: At & { colours: readonly string[] }): React.JSX.Element {
  return (
    <g transform={`translate(${x} ${y})`}>
      <ContactShadow x={colours.length * 23} y={6} rx={colours.length * 26} />
      {colours.map((c, i) => (
        <g key={c} transform={`translate(${i * 46} 0)`}>
          <path d="M0 -34H36V-2Q36 4 30 4H6Q0 4 0 -2Z" fill={GREY} {...LINE} />
          <rect x={26} y={-30} width={8} height={32} fill={HATCH} />
          <path d="M4 -34Q6 -20 10 -24Q12 -30 14 -34Z" fill={c} {...hair} />
          <ellipse cx={18} cy={-34} rx={18} ry={6} fill={c} {...LINE} />
          <path
            d="M8 -36Q18 -32 28 -36"
            fill="none"
            stroke="#fff"
            strokeOpacity={0.5}
            strokeWidth={1.6}
            strokeLinecap="round"
          />
        </g>
      ))}
    </g>
  );
}

/**
 * An open laptop on a desk, its screen lit with a conversation: the visitor's
 * question, and Sunny's answer arriving.
 */
export function Laptop({ x, y, w = 150 }: At & { w?: number }): React.JSX.Element {
  const h = w * 0.62;
  return (
    <g transform={`translate(${x} ${y})`}>
      <ContactShadow x={w / 2} y={6} rx={w * 0.62} />
      <rect x={0} y={-h} width={w} height={h} rx={8} fill={INK} {...LINE} />
      <rect x={8} y={-h + 8} width={w - 16} height={h - 16} rx={4} fill="#FFF6DD" />
      <rect
        x={8}
        y={-h + 8}
        width={w - 16}
        height={h - 16}
        rx={4}
        fill={DOTS_ORANGE}
        opacity={0.18}
      />
      {/* The visitor's question, then Sunny's reply. */}
      <rect x={w * 0.42} y={-h + 16} width={w * 0.46} height={16} rx={8} fill={GREY} />
      <rect x={16} y={-h + 40} width={w * 0.58} height={26} rx={9} fill={ORANGE} {...hair} />
      <path
        d={`M24 ${-h + 49}h${w * 0.42}M24 ${-h + 57}h${w * 0.3}`}
        stroke={INK}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <circle cx={w * 0.8} cy={-h + 54} r={2.2} fill={INK} />
      <circle cx={w * 0.86} cy={-h + 54} r={2.2} fill={INK} opacity={0.6} />
      <path d={`M-14 0H${w + 14}L${w + 4} 8H-4Z`} fill={GREY} {...LINE} />
      <rect x={w / 2 - 14} y={1} width={28} height={3} rx={1.5} fill={INK} opacity={0.5} />
    </g>
  );
}

/** A window onto the night: moon, stars and the roofs across the street. */
export function NightWindow({
  x,
  y,
  w = 170,
  h = 150,
}: At & { w?: number; h?: number }): React.JSX.Element {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={-8} y={-8} width={w + 16} height={h + 16} rx={6} fill={WOOD} {...LINE} />
      <rect x={0} y={0} width={w} height={h} fill="#1E2433" {...LINE} />
      <Stars
        points={[
          [24, 22],
          [70, 46],
          [130, 18],
          [150, 70],
          [40, 80],
        ]}
        size={5}
      />
      <Moon x={w * 0.66} y={h * 0.34} r={18} />
      <path
        d={`M0 ${h}V${h * 0.74}L${w * 0.18} ${h * 0.6}L${w * 0.36} ${h * 0.74}V${h * 0.66}L${w * 0.56} ${h * 0.5}L${w * 0.76} ${h * 0.66}V${h * 0.72}L${w} ${h * 0.6}V${h}Z`}
        fill={INK}
      />
      <rect x={w * 0.1} y={h * 0.8} width={8} height={8} fill="#FFD66B" />
      <rect x={w * 0.62} y={h * 0.74} width={8} height={8} fill="#FFD66B" />
      <path d={`M${w / 2} 0V${h}M0 ${h / 2}H${w}`} stroke={WOOD} strokeWidth={6} />
      <path d={`M${w / 2} 0V${h}M0 ${h / 2}H${w}`} {...hair} />
      <rect x={-14} y={h + 6} width={w + 28} height={8} rx={3} fill={PAPER} {...LINE} />
    </g>
  );
}

/** A wall clock, hands at two in the morning. */
export function Clock({ x, y, r = 30 }: At & { r?: number }): React.JSX.Element {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={r + 6} fill={ORANGE} {...LINE} />
      <circle r={r} fill={PAPER} {...LINE} />
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return (
          <path
            key={i}
            d={`M${Math.sin(a) * r * 0.8} ${-Math.cos(a) * r * 0.8}L${Math.sin(a) * r * 0.92} ${-Math.cos(a) * r * 0.92}`}
            {...(i % 3 === 0 ? fine : hair)}
          />
        );
      })}
      <path d={`M0 0V${-r * 0.7}M0 0L${r * 0.42} ${-r * 0.24}`} {...LINE} strokeWidth={3.2} />
      <circle r={2.8} fill={INK} />
    </g>
  );
}

/** A home battery: a tall unit with a charge meter and a bolt. */
export function Battery({
  x,
  y,
  w = 34,
  h = 52,
}: At & { w?: number; h?: number }): React.JSX.Element {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={0} y={-h} width={w} height={h} rx={6} fill={PAPER} {...LINE} />
      <rect x={w * 0.7} y={-h + 2} width={w * 0.3 - 2} height={h - 4} fill={HATCH} />
      <path
        d={`M${w * 0.55} ${-h * 0.82}L${w * 0.32} ${-h * 0.48}H${w * 0.5}L${w * 0.42} ${-h * 0.2}L${w * 0.7} ${-h * 0.56}H${w * 0.52}Z`}
        fill={ORANGE}
        {...fine}
      />
      <rect x={w * 0.2} y={-h * 0.12} width={w * 0.6} height={3} rx={1.5} fill="#7FB069" />
    </g>
  );
}

/** A car charger on a post, its cable coiled. */
export function Charger({ x, y, h = 60 }: At & { h?: number }): React.JSX.Element {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={0} y={-h} width={20} height={h} rx={5} fill={PAPER} {...LINE} />
      <rect x={4} y={-h + 8} width={12} height={10} rx={2} fill="#7FB069" {...hair} />
      <path
        d={`M20 ${-h * 0.5}C38 ${-h * 0.5} 38 ${-h * 0.15} 22 ${-h * 0.15}C10 ${-h * 0.15} 14 0 30 -2`}
        fill="none"
        {...LINE}
        strokeWidth={3.4}
      />
      <rect x={26} y={-8} width={10} height={8} rx={2} fill={INK} />
    </g>
  );
}

/** An award rosette with ribbon tails: the one to pick. */
export function Rosette({ x, y, label }: At & { label: string }): React.JSX.Element {
  const petals = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2;
    return `${Math.cos(a) * 26} ${Math.sin(a) * 26}`;
  });
  return (
    <g transform={`translate(${x} ${y})`}>
      <path
        d="M-12 14L-20 50L-8 42L0 54L4 16ZM12 14L20 50L8 42L0 54L-4 16Z"
        fill={ORANGE}
        {...LINE}
      />
      <path d={`M${petals.join('L')}Z`} fill={ORANGE} {...LINE} strokeLinejoin="round" />
      <circle r={19} fill={PAPER} {...LINE} />
      <circle r={15} fill="none" {...hair} strokeDasharray="2 3" />
      <text
        y={3.5}
        textAnchor="middle"
        fontSize={label.length > 5 ? 7 : 9.5}
        fontWeight={800}
        fontFamily="var(--font-sans), sans-serif"
        fill={INK}
        letterSpacing={0.5}
      >
        {label}
      </text>
    </g>
  );
}

/**
 * A package, presented as a printed product card: its name across the top,
 * what is in the box drawn on it, and a row of price dots at the bottom.
 */
export function PackageCard({
  x,
  y,
  w = 140,
  h = 190,
  name,
  level,
  chosen = false,
}: At & {
  w?: number;
  h?: number;
  name: string;
  level: 1 | 2 | 3;
  chosen?: boolean;
}): React.JSX.Element {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={6} y={7} width={w} height={h} rx={14} fill={INK} />
      <rect width={w} height={h} rx={14} fill={PAPER} {...LINE} />
      <path
        d={`M1.4 34V14Q1.4 1.4 14 1.4H${w - 14}Q${w - 1.4} 1.4 ${w - 1.4} 14V34Z`}
        fill={chosen ? ORANGE : PALE}
      />
      <path d={`M0 34H${w}`} {...LINE} />
      <text
        x={w / 2}
        y={24}
        textAnchor="middle"
        fontSize={15}
        fontWeight={800}
        fontFamily="var(--font-display), serif"
        fill={INK}
      >
        {name}
      </text>
      {/* What is in the box: panels on top, then the battery and the charger. */}
      <SolarPanel x={w * 0.17} y={50} w={w * 0.66} h={w * 0.3} skew={-10} />
      <g transform={`translate(0 ${h - 52})`}>
        {level >= 2 && <Battery x={level >= 3 ? w * 0.18 : w / 2 - 15} y={0} w={30} h={46} />}
        {level >= 3 && <Charger x={w * 0.58} y={0} h={46} />}
        {level === 1 && (
          <text
            x={w / 2}
            y={-14}
            textAnchor="middle"
            fontSize={11}
            fontWeight={700}
            fontFamily="var(--font-sans), sans-serif"
            fill={INK}
            opacity={0.7}
          >
            Panels only
          </text>
        )}
      </g>
      <path d={`M14 ${h - 42}H${w - 14}`} {...hair} strokeDasharray="3 4" />
      {Array.from({ length: 3 }, (_, i) => (
        <circle
          key={i}
          cx={w / 2 - 16 + i * 16}
          cy={h - 22}
          r={5}
          fill={i < level ? ORANGE : PAPER}
          {...fine}
        />
      ))}
    </g>
  );
}

/** A couple of birds, the 1930s way: two ink strokes each. */
export function Birds({ points }: { points: ReadonlyArray<[number, number]> }): React.JSX.Element {
  return (
    <g>
      {points.map(([bx, by], i) => (
        <path key={i} d={`M${bx - 9} ${by}q5 -6 9 0q4 -6 9 0`} fill="none" {...fine} />
      ))}
    </g>
  );
}
