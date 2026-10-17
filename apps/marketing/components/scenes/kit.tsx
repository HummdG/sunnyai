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
        <pattern id="sk-brick" width="18" height="10" patternUnits="userSpaceOnUse">
          <path
            d="M0 0H18M0 5H18M6 0V5M15 5V10"
            stroke={INK}
            strokeWidth="0.7"
            opacity="0.18"
            fill="none"
          />
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

/** A browser window: the installer's website, where Sunny lives. */
export function BrowserFrame({
  x,
  y,
  w,
  h,
  url = 'your-solar-company.co.uk',
  children,
}: At & { w: number; h: number; url?: string; children?: React.ReactNode }): React.JSX.Element {
  // The address bar grows to its text, and the text shrinks before it would
  // ever run out of the bar on a narrow window.
  const room = w - 90;
  const natural = url.length * 5.5 + 26;
  const pill = Math.min(room, Math.max(120, natural));
  const urlSize = natural > room ? (9.5 * (room - 26)) / (natural - 26) : 9.5;
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
      <rect x={70} y={7} width={pill} height={16} rx={8} fill={PAPER} {...fine} />
      <path d="M78 15.5a3 3 0 1 1 0.01 0Z" fill={GREY} />
      <text x={86} y={18.6} fontSize={urlSize} fontFamily="var(--font-sans), sans-serif" fill={INK}>
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

/** A speech bubble with a tail, holding a line or two of text. */
export function SpeechBubble({
  x,
  y,
  w,
  lines,
  tail = 'left',
  fill = PAPER,
}: At & {
  w: number;
  lines: readonly string[];
  tail?: 'left' | 'right' | 'down';
  fill?: string;
}): React.JSX.Element {
  const h = 14 + lines.length * 15;
  const tails = {
    left: `M18 ${h - 2}L6 ${h + 14}L32 ${h - 2}`,
    right: `M${w - 32} ${h - 2}L${w - 6} ${h + 14}L${w - 18} ${h - 2}`,
    down: `M${w / 2 - 10} ${h - 2}L${w / 2} ${h + 14}L${w / 2 + 10} ${h - 2}`,
  } as const;
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={4} y={5} width={w} height={h} rx={12} fill={INK} />
      <path d={tails[tail]} fill={fill} {...LINE} />
      <rect width={w} height={h} rx={12} fill={fill} {...LINE} />
      {lines.map((line, i) => (
        <text
          key={i}
          x={12}
          y={21 + i * 15}
          fontSize={12.5}
          fontWeight={700}
          fontFamily="var(--font-sans), sans-serif"
          fill={INK}
        >
          {line}
        </text>
      ))}
    </g>
  );
}

/** The chat panel itself: a header with Sunny's name, then the conversation. */
export function ChatWindow({
  x,
  y,
  w,
  h,
  messages,
}: At & {
  w: number;
  h: number;
  messages: ReadonlyArray<{ from: 'visitor' | 'sunny'; text: string }>;
}): React.JSX.Element {
  let cursor = 44;
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={6} y={8} width={w} height={h} rx={16} fill={INK} />
      <rect width={w} height={h} rx={16} fill={PAPER} {...LINE} />
      <path
        d={`M1.4 34V16Q1.4 1.4 16 1.4H${w - 16}Q${w - 1.4} 1.4 ${w - 1.4} 16V34Z`}
        fill={PALE}
      />
      <path d={`M0 34H${w}`} {...LINE} />
      <circle cx={20} cy={18} r={8} fill={ORANGE} {...fine} />
      <text
        x={34}
        y={22}
        fontSize={11.5}
        fontWeight={800}
        fontFamily="var(--font-display), serif"
        fill={INK}
      >
        Sunny · Your Solar Co.
      </text>
      {messages.map((m, i) => {
        const bw = Math.min(w - 40, 18 + m.text.length * 6.2);
        const bx = m.from === 'visitor' ? w - bw - 12 : 12;
        const top = cursor;
        cursor += 34;
        return (
          <g key={i}>
            <rect
              x={bx}
              y={top}
              width={bw}
              height={26}
              rx={10}
              fill={m.from === 'visitor' ? '#E4E7EC' : ORANGE}
              {...fine}
            />
            <text
              x={bx + 9}
              y={top + 17}
              fontSize={10.5}
              fontWeight={700}
              fontFamily="var(--font-sans), sans-serif"
              fill={INK}
            >
              {m.text}
            </text>
          </g>
        );
      })}
      <g transform={`translate(12 ${cursor})`}>
        <rect width={44} height={22} rx={11} fill={PALE} {...hair} />
        {[12, 22, 32].map((cx, i) => (
          <circle key={cx} cx={cx} cy={11} r={2.6} fill={INK} opacity={0.35 + i * 0.25} />
        ))}
      </g>
    </g>
  );
}

/** A cork pinboard in a wooden frame. Its contents are its children. */
export function Corkboard({
  x,
  y,
  w,
  h,
  children,
}: At & { w: number; h: number; children?: React.ReactNode }): React.JSX.Element {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={6} y={8} width={w} height={h} rx={6} fill={INK} />
      <rect width={w} height={h} rx={6} fill={WOOD} {...LINE} />
      <rect x={10} y={10} width={w - 20} height={h - 20} rx={2} fill="#D9A86C" {...fine} />
      <rect x={10} y={10} width={w - 20} height={h - 20} rx={2} fill={DOTS_FINE} opacity={0.6} />
      {children}
    </g>
  );
}

/** One of the installer's documents, pinned up: what it is, drawn on it. */
export function PinnedDoc({
  x,
  y,
  kind,
  tilt = 0,
}: At & { kind: 'spec' | 'price' | 'warranty' | 'faq'; tilt?: number }): React.JSX.Element {
  const title = { spec: 'Spec sheet', price: 'Price list', warranty: 'Warranty', faq: 'FAQ' }[kind];
  return (
    <g transform={`translate(${x} ${y}) rotate(${tilt})`}>
      <rect x={3} y={4} width={78} height={96} fill={INK} opacity={0.25} />
      <rect width={78} height={96} fill={PAPER} {...LINE} />
      <text
        x={8}
        y={16}
        fontSize={9}
        fontWeight={800}
        fontFamily="var(--font-sans), sans-serif"
        fill={INK}
      >
        {title}
      </text>
      <path d="M8 21H70" {...hair} />
      {kind === 'spec' && (
        <g>
          <SolarPanel x={12} y={30} w={52} h={26} skew={-10} />
          <path
            d="M10 70H58M10 78H50M10 86H44"
            stroke={GREY}
            strokeWidth={3}
            strokeLinecap="round"
          />
        </g>
      )}
      {kind === 'price' &&
        [0, 1, 2, 3, 4].map((r) => (
          <g key={r}>
            <path d={`M8 ${34 + r * 12}H38`} stroke={GREY} strokeWidth={3} strokeLinecap="round" />
            <text
              x={44}
              y={37 + r * 12}
              fontSize={8.5}
              fontWeight={800}
              fontFamily="var(--font-sans), sans-serif"
              fill={INK}
            >
              {['£4,200', '£6,850', '£8,400', '£11,100', '£2,950'][r]}
            </text>
          </g>
        ))}
      {kind === 'warranty' && (
        <g>
          <path
            d="M10 32H66M10 40H60M10 48H66M10 56H44"
            stroke={GREY}
            strokeWidth={3}
            strokeLinecap="round"
          />
          <circle cx={56} cy={78} r={11} fill={ORANGE} {...fine} />
          <circle cx={56} cy={78} r={7} fill="none" {...hair} strokeDasharray="2 2" />
          <path d="M10 80Q20 70 26 82T42 80" fill="none" {...fine} />
        </g>
      )}
      {kind === 'faq' &&
        [0, 1, 2].map((r) => (
          <g key={r}>
            <text
              x={8}
              y={38 + r * 22}
              fontSize={11}
              fontWeight={800}
              fontFamily="var(--font-display), serif"
              fill={ORANGE}
            >
              Q
            </text>
            <path
              d={`M20 ${34 + r * 22}H66M20 ${41 + r * 22}H54`}
              stroke={GREY}
              strokeWidth={3}
              strokeLinecap="round"
            />
          </g>
        ))}
      {/* The drawing pin. */}
      <circle cx={39} cy={-2} r={5.5} fill="#E8432E" {...fine} />
      <circle cx={37.5} cy={-3.5} r={1.6} fill="#fff" opacity={0.7} />
    </g>
  );
}

/** Red string, sagging a little, from pin to pin: the detective's board. */
export function RedString({
  from,
  to,
}: {
  from: [number, number];
  to: [number, number];
}): React.JSX.Element {
  const [ax, ay] = from;
  const [bx, by] = to;
  return (
    <path
      d={`M${ax} ${ay}Q${(ax + bx) / 2} ${Math.max(ay, by) + 22} ${bx} ${by}`}
      fill="none"
      stroke="#D7322A"
      strokeWidth={2.2}
      strokeLinecap="round"
    />
  );
}

/** A wooden signpost with arms pointing left and right, each with a label. */
export function Signpost({
  x,
  y,
  arms,
}: At & { arms: ReadonlyArray<{ label: string; dir: 'left' | 'right' }> }): React.JSX.Element {
  const h = 70 + arms.length * 34;
  return (
    <g transform={`translate(${x} ${y})`}>
      <ContactShadow x={0} y={2} rx={34} />
      <rect x={-6} y={-h} width={12} height={h} rx={3} fill={WOOD} {...LINE} />
      <rect x={1} y={-h + 2} width={4} height={h - 4} fill={HATCH} />
      <path d={`M-9 ${-h}L0 ${-h - 10}L9 ${-h}Z`} fill={WOOD} {...LINE} />
      {arms.map((arm, i) => {
        const ay = -h + 14 + i * 34;
        const len = 30 + arm.label.length * 6.8;
        const d =
          arm.dir === 'right'
            ? `M-4 ${ay}H${len}L${len + 12} ${ay + 12}L${len} ${ay + 24}H-4Z`
            : `M4 ${ay}H${-len}L${-len - 12} ${ay + 12}L${-len} ${ay + 24}H4Z`;
        return (
          <g key={arm.label} transform={`rotate(${i % 2 === 0 ? -2 : 2} 0 ${ay + 12})`}>
            <path d={d} transform="translate(3 4)" fill={INK} />
            <path d={d} fill={i === 0 ? ORANGE : PAPER} {...LINE} />
            <text
              x={arm.dir === 'right' ? 8 : -8}
              y={ay + 16.5}
              textAnchor={arm.dir === 'right' ? 'start' : 'end'}
              fontSize={12}
              fontWeight={800}
              fontFamily="var(--font-display), serif"
              fill={INK}
            >
              {arm.label}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/**
 * A believable installer's homepage, drawn to fit inside a `BrowserFrame` of
 * width `w` (below its address bar): the company's name and nav, a banner with
 * a headline, a "Get a quote" button and a pair of semis with panels on the
 * roof, then a row of three feature tiles.
 */
export function SiteMock({
  w,
  h,
  name = 'Brightside Solar',
}: {
  w: number;
  h: number;
  name?: string;
}): React.JSX.Element {
  const banner = { x: 12, y: 30, w: w - 24, h: Math.min(130, h * 0.52) };
  const tilesY = banner.y + banner.h + 12;
  const tileW = (w - 24 - 16) / 3;
  return (
    <g>
      {/* The site's own header. */}
      <circle cx={22} cy={15} r={7} fill={ORANGE} {...hair} />
      <text
        x={34}
        y={19}
        fontSize={11}
        fontWeight={800}
        fontFamily="var(--font-display), serif"
        fill={INK}
      >
        {name}
      </text>
      {[0, 1, 2].map((i) => (
        <rect key={i} x={w - 130 + i * 40} y={12} width={30} height={5} rx={2.5} fill={GREY} />
      ))}
      <path d={`M0 26H${w}`} stroke={GREY} strokeWidth={1} />
      {/* The banner. */}
      <rect
        x={banner.x}
        y={banner.y}
        width={banner.w}
        height={banner.h}
        rx={8}
        fill={PALE}
        {...fine}
      />
      <rect
        x={banner.x}
        y={banner.y}
        width={banner.w}
        height={banner.h}
        rx={8}
        fill={DOTS_FINE}
        opacity={0.35}
      />
      <text
        x={banner.x + 14}
        y={banner.y + 30}
        fontSize={15}
        fontWeight={800}
        fontFamily="var(--font-display), serif"
        fill={INK}
      >
        Clean power,
      </text>
      <text
        x={banner.x + 14}
        y={banner.y + 48}
        fontSize={15}
        fontWeight={800}
        fontFamily="var(--font-display), serif"
        fill={INK}
      >
        for your home.
      </text>
      <rect
        x={banner.x + 14}
        y={banner.y + 58}
        width={banner.w * 0.38}
        height={4}
        rx={2}
        fill={GREY}
      />
      <rect
        x={banner.x + 14}
        y={banner.y + 67}
        width={banner.w * 0.3}
        height={4}
        rx={2}
        fill={GREY}
      />
      <g transform={`translate(${banner.x + 14} ${banner.y + banner.h - 36})`}>
        <rect x={2} y={3} width={78} height={22} rx={11} fill={INK} />
        <rect width={78} height={22} rx={11} fill={ORANGE} {...fine} />
        <text
          x={39}
          y={15}
          textAnchor="middle"
          fontSize={9.5}
          fontWeight={800}
          fontFamily="var(--font-sans), sans-serif"
          fill={INK}
        >
          Get a quote
        </text>
      </g>
      <SemiDetachedMini x={banner.x + banner.w - 128} y={banner.y + banner.h - 6} />
      {/* Three feature tiles. */}
      {tilesY + 40 < h &&
        [0, 1, 2].map((i) => (
          <g key={i} transform={`translate(${12 + i * (tileW + 8)} ${tilesY})`}>
            <rect
              width={tileW}
              height={Math.min(46, h - tilesY - 8)}
              rx={6}
              fill={PAPER}
              {...hair}
            />
            <circle cx={14} cy={14} r={7} fill={[ORANGE, PALE, '#CFE6D6'][i]} {...hair} />
            <rect x={26} y={10} width={tileW - 36} height={4} rx={2} fill={INK} opacity={0.75} />
            <rect x={10} y={28} width={tileW - 20} height={3.5} rx={1.75} fill={GREY} />
          </g>
        ))}
    </g>
  );
}

/**
 * A small semi-detached pair, drawn simply enough to sit inside a picture on a
 * web page (the full `SemiDetached` is too detailed at this size).
 */
function SemiDetachedMini({ x, y }: At): React.JSX.Element {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d="M-6 -56L20 -78H96L122 -56Z" fill="#5B6472" {...fine} />
      <rect x={58} y={-76} width={28} height={14} rx={1} fill={PANEL} {...hair} />
      <path d="M65 -76V-62M72 -76V-62M79 -76V-62M58 -69H86" stroke="#5A6B8C" strokeWidth={0.7} />
      <rect x={52} y={-90} width={12} height={14} fill="#E2A07A" {...hair} />
      <rect x={0} y={-56} width={116} height={56} fill="#E2A07A" {...fine} />
      <path d="M58 -56V0" {...hair} />
      {[8, 34, 70, 96].map((wx) => (
        <rect key={wx} x={wx} y={-48} width={14} height={14} fill="#C9DCEB" {...hair} />
      ))}
      {[8, 92].map((wx) => (
        <rect key={wx} x={wx} y={-26} width={18} height={18} fill="#C9DCEB" {...hair} />
      ))}
      <rect x={42} y={-28} width={11} height={28} fill={ORANGE} {...hair} />
      <rect x={63} y={-28} width={11} height={28} fill={PANEL} {...hair} />
    </g>
  );
}

/** A code editor strip: the page's markup, with the one line being added lit up. */
export function CodeStrip({ x, y, w }: At & { w: number }): React.JSX.Element {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={5} y={6} width={w} height={70} rx={10} fill={INK} opacity={0.35} />
      <rect width={w} height={70} rx={10} fill="#1E2433" {...LINE} />
      <text x={12} y={18} fontSize={9} fontFamily="ui-monospace, monospace" fill="#8C96A8">
        {'<body>'}
      </text>
      <rect x={6} y={25} width={w - 12} height={20} rx={5} fill={ORANGE} />
      <text
        x={14}
        y={39}
        fontSize={10}
        fontWeight={700}
        fontFamily="ui-monospace, monospace"
        fill={INK}
      >
        {'<script src="sunny.js">'}
      </text>
      <rect x={w - 18} y={28} width={2.4} height={14} fill={INK} />
      <text x={12} y={60} fontSize={9} fontFamily="ui-monospace, monospace" fill="#8C96A8">
        {'</body>'}
      </text>
    </g>
  );
}

/** A lead, as a card: who, where, and that they are ready. */
export function LeadCard({
  x,
  y,
  name,
  postcode,
  tilt = 0,
}: At & { name: string; postcode: string; tilt?: number }): React.JSX.Element {
  return (
    <g transform={`translate(${x} ${y}) rotate(${tilt})`}>
      <rect x={4} y={5} width={120} height={64} rx={8} fill={INK} opacity={0.3} />
      <rect width={120} height={64} rx={8} fill={PAPER} {...LINE} />
      <circle cx={18} cy={18} r={9} fill={PALE} {...fine} />
      <circle cx={18} cy={15} r={3.4} fill={INK} opacity={0.6} />
      <path d="M11 24Q18 18 25 24" fill={INK} opacity={0.6} />
      <text
        x={34}
        y={17}
        fontSize={10.5}
        fontWeight={800}
        fontFamily="var(--font-sans), sans-serif"
        fill={INK}
      >
        {name}
      </text>
      <text
        x={34}
        y={29}
        fontSize={8.5}
        fontWeight={700}
        fontFamily="var(--font-sans), sans-serif"
        fill={INK}
        opacity={0.6}
      >
        {postcode} · 3-bed semi
      </text>
      <rect x={10} y={40} width={44} height={16} rx={8} fill={ORANGE} {...hair} />
      <text
        x={32}
        y={51}
        textAnchor="middle"
        fontSize={8.5}
        fontWeight={800}
        fontFamily="var(--font-sans), sans-serif"
        fill={INK}
      >
        Ready
      </text>
      <rect x={60} y={46} width={50} height={4} rx={2} fill={GREY} />
    </g>
  );
}

/** A wire in-tray with a label on its front lip. Its contents are its children. */
export function InTray({
  x,
  y,
  w,
  label,
  children,
}: At & { w: number; label: string; children?: React.ReactNode }): React.JSX.Element {
  return (
    <g transform={`translate(${x} ${y})`}>
      <ContactShadow x={w / 2} y={6} rx={w * 0.6} />
      <path d={`M0 0L10 -40H${w - 10}L${w} 0Z`} fill="#E4E7EC" {...LINE} />
      {children}
      <path d={`M-4 0H${w + 4}L${w - 4} -24H4Z`} fill={GREY} {...LINE} />
      <path d={`M10 -6H${w - 10}M14 -14H${w - 14}`} stroke={INK} strokeWidth={1} opacity={0.4} />
      <rect x={w / 2 - 44} y={-20} width={88} height={16} rx={3} fill={PAPER} {...fine} />
      <text
        x={w / 2}
        y={-8.5}
        textAnchor="middle"
        fontSize={9.5}
        fontWeight={800}
        fontFamily="var(--font-sans), sans-serif"
        fill={INK}
        letterSpacing={1}
      >
        {label}
      </text>
    </g>
  );
}

/** A sign-up card: the installer's details going in, a tick, and the button. */
export function SignUpCard({ x, y, w = 190 }: At & { w?: number }): React.JSX.Element {
  const field = (fy: number, label: string, value: string): React.JSX.Element => (
    <g transform={`translate(14 ${fy})`}>
      <text
        fontSize={8}
        fontWeight={800}
        fontFamily="var(--font-sans), sans-serif"
        fill={INK}
        opacity={0.65}
        letterSpacing={0.6}
      >
        {label}
      </text>
      <rect y={5} width={w - 28} height={22} rx={6} fill={PAPER} {...fine} />
      <text
        x={8}
        y={20}
        fontSize={10}
        fontWeight={700}
        fontFamily="var(--font-sans), sans-serif"
        fill={INK}
      >
        {value}
      </text>
    </g>
  );
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={6} y={8} width={w} height={196} rx={14} fill={INK} />
      <rect width={w} height={196} rx={14} fill={CREAM} {...LINE} />
      <text
        x={14}
        y={26}
        fontSize={14}
        fontWeight={800}
        fontFamily="var(--font-display), serif"
        fill={INK}
      >
        Create your account
      </text>
      {field(46, 'COMPANY', 'Brightside Solar')}
      {field(88, 'WEBSITE', 'brightside-solar.co.uk')}
      <rect x={14} y={128} width={14} height={14} rx={3} fill={ORANGE} {...fine} />
      <path
        d="M17 135L20 138L25 131"
        fill="none"
        stroke={INK}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <text
        x={34}
        y={139}
        fontSize={9}
        fontWeight={700}
        fontFamily="var(--font-sans), sans-serif"
        fill={INK}
      >
        Show Sunny on my site only
      </text>
      <rect x={16} y={158} width={w - 28} height={26} rx={13} fill={INK} />
      <rect x={14} y={155} width={w - 28} height={26} rx={13} fill={ORANGE} {...fine} />
      <text
        x={w / 2}
        y={172}
        textAnchor="middle"
        fontSize={11}
        fontWeight={800}
        fontFamily="var(--font-sans), sans-serif"
        fill={INK}
      >
        Start free
      </text>
    </g>
  );
}

/** A phone lying on a desk, a new lead's card on its screen. */
export function PhoneWithLead({ x, y }: At): React.JSX.Element {
  return (
    <g transform={`translate(${x} ${y})`}>
      <ContactShadow x={60} y={206} rx={72} />
      <rect x={6} y={8} width={120} height={200} rx={20} fill={INK} opacity={0.35} />
      <rect width={120} height={200} rx={20} fill={INK} {...LINE} />
      <rect x={8} y={14} width={104} height={174} rx={12} fill="#FFF6E6" />
      <rect x={44} y={6} width={32} height={5} rx={2.5} fill="#3A4152" />
      <text
        x={16}
        y={34}
        fontSize={8}
        fontWeight={800}
        fontFamily="var(--font-sans), sans-serif"
        fill={INK}
        opacity={0.6}
        letterSpacing={0.6}
      >
        NOW · SUNNY
      </text>
      <text
        x={16}
        y={48}
        fontSize={12}
        fontWeight={800}
        fontFamily="var(--font-display), serif"
        fill={INK}
      >
        New lead!
      </text>
      <g transform="translate(14 58) scale(0.76)">
        <LeadCard x={0} y={0} name="Priya S." postcode="LS8" />
      </g>
      <rect x={16} y={124} width={88} height={4} rx={2} fill={GREY} />
      <rect x={16} y={133} width={70} height={4} rx={2} fill={GREY} />
      <rect x={16} y={150} width={88} height={24} rx={12} fill={ORANGE} {...fine} />
      <text
        x={60}
        y={166}
        textAnchor="middle"
        fontSize={10}
        fontWeight={800}
        fontFamily="var(--font-sans), sans-serif"
        fill={INK}
      >
        Call Priya
      </text>
    </g>
  );
}
