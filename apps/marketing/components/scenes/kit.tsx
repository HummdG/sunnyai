/**
 * The scene kit: the furniture of Sunny's world, drawn the way the character
 * is drawn -- a confident ink line round flat fills, from a short palette
 * (paper, cream, orange, pale orange, grey, wood, and ink for night).
 *
 * Every piece is a plain SVG group positioned in its scene's own units, so a
 * scene reads like a stage direction: a house here, a moon there, Sunny in
 * front. Server components: no state, no effects, nothing to hydrate.
 */

export const INK = '#171717';
export const PAPER = '#FFFDF7';
export const CREAM = '#FBF4E8';
export const ORANGE = '#FF7900';
export const PALE = '#FFE2C2';
export const GREY = '#B7BCC4';
export const WOOD = '#C98B4A';
export const PANEL = '#2B3A55';
/** The colour switcher's presets, as paint. */
export const PAINT_COLOURS = [ORANGE, '#7C4DFF', '#1FA463', '#1A73E8'] as const;

/** The line every piece is drawn with. */
export const LINE = {
  stroke: INK,
  strokeWidth: 2.6,
  strokeLinejoin: 'round',
  strokeLinecap: 'round',
} as const;

const fine = { ...LINE, strokeWidth: 1.8 } as const;

interface At {
  x: number;
  y: number;
}

/** The ground: a gentle hill line across the scene, filled below. */
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
  return (
    <path
      d={`M-10 ${y + bulge}C${width * 0.25} ${y - bulge} ${width * 0.6} ${y + bulge * 0.6} ${width + 10} ${y - bulge * 0.4}V${y + 400}H-10Z`}
      fill={fill}
      {...LINE}
    />
  );
}

/** A solar panel: a dark grid in a grey frame, tilted to the sky. */
export function SolarPanel({
  x,
  y,
  w = 60,
  h = 34,
  skew = -10,
}: At & { w?: number; h?: number; skew?: number }): React.JSX.Element {
  const cells = [];
  for (let i = 1; i < 4; i++)
    cells.push(
      <line
        key={`v${i}`}
        x1={(w * i) / 4}
        y1={0}
        x2={(w * i) / 4}
        y2={h}
        stroke={GREY}
        strokeWidth={1.2}
      />,
    );
  cells.push(<line key="h" x1={0} y1={h / 2} x2={w} y2={h / 2} stroke={GREY} strokeWidth={1.2} />);
  return (
    <g transform={`translate(${x} ${y}) skewX(${skew})`}>
      <rect width={w} height={h} rx={2} fill={PANEL} {...LINE} />
      {cells}
      <path
        d={`M${w * 0.12} ${h * 0.2}L${w * 0.32} ${h * 0.2}`}
        stroke="#fff"
        strokeOpacity={0.55}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </g>
  );
}

/** A house with a pitched roof; `panels` puts solar panels on the roof. */
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
  const peak = h * 0.62;
  const win = (wx: number): React.JSX.Element => (
    <g key={wx}>
      <rect
        x={wx}
        y={h * 0.25}
        width={w * 0.17}
        height={h * 0.26}
        rx={2}
        fill={lit ? '#FFC94A' : PAPER}
        {...fine}
      />
      <line x1={wx + w * 0.085} y1={h * 0.25} x2={wx + w * 0.085} y2={h * 0.51} {...fine} />
    </g>
  );
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d={`M-8 2L${w / 2} ${-peak}L${w + 8} 2Z`} fill={roof} {...LINE} />
      {Array.from({ length: panels }, (_, i) => (
        <SolarPanel
          key={i}
          x={w * 0.5 + 6 + i * 2}
          y={-peak * 0.72 + i * 22}
          w={w * 0.26}
          h={16}
          skew={-38}
        />
      ))}
      <rect x={0} y={0} width={w} height={h} fill={PAPER} {...LINE} />
      {win(w * 0.12)}
      {!door && win(w * 0.42)}
      {win(w * 0.71)}
      {door && (
        <g>
          <path
            d={`M${w * 0.4} ${h}V${h * 0.5}Q${w * 0.5} ${h * 0.4} ${w * 0.6} ${h * 0.5}V${h}`}
            fill={ORANGE}
            {...LINE}
          />
          <circle cx={w * 0.56} cy={h * 0.76} r={1.8} fill={INK} />
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
      <rect x={6} y={8} width={w} height={h} rx={14} fill={INK} />
      <rect width={w} height={h} rx={14} fill={PAPER} {...LINE} />
      <path d={`M0 30H${w}`} {...LINE} />
      {[18, 34, 50].map((cx, i) => (
        <circle key={cx} cx={cx} cy={15} r={4.6} fill={i === 0 ? ORANGE : CREAM} {...fine} />
      ))}
      <rect x={70} y={7} width={Math.min(220, w - 90)} height={16} rx={8} fill={CREAM} {...fine} />
      <text x={82} y={19} fontSize={10} fontFamily="var(--font-sans), sans-serif" fill={INK}>
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

/** A crescent moon. */
export function Moon({ x, y, r = 26 }: At & { r?: number }): React.JSX.Element {
  return (
    <path
      d={`M${x + r * 0.2} ${y - r}A${r} ${r} 0 1 0 ${x + r} ${y + r * 0.3}A${r * 0.8} ${r * 0.8} 0 1 1 ${x + r * 0.2} ${y - r}Z`}
      fill="#FFE7A6"
      {...LINE}
    />
  );
}

/** Four-pointed stars, the 1930s twinkle. */
export function Stars({
  points,
  size = 7,
  fill = CREAM,
}: {
  points: Array<[number, number]>;
  size?: number;
  fill?: string;
}): React.JSX.Element {
  return (
    <g>
      {points.map(([x, y], i) => {
        const s = size * (i % 2 === 0 ? 1 : 0.7);
        return (
          <path
            key={i}
            d={`M${x} ${y - s}Q${x} ${y} ${x + s} ${y}Q${x} ${y} ${x} ${y + s}Q${x} ${y} ${x - s} ${y}Q${x} ${y} ${x} ${y - s}Z`}
            fill={fill}
          />
        );
      })}
    </g>
  );
}

/** A desk: a thick top on two tapered legs. */
export function Desk({ x, y, w = 220 }: At & { w?: number }): React.JSX.Element {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path
        d={`M14 14L6 96H20L32 14ZM${w - 14} 14L${w - 6} 96H${w - 20}L${w - 32} 14Z`}
        fill={WOOD}
        {...LINE}
      />
      <rect width={w} height={16} rx={4} fill={WOOD} {...LINE} />
    </g>
  );
}

/** An anglepoise lamp throwing a cone of light. */
export function Lamp({ x, y, light = true }: At & { light?: boolean }): React.JSX.Element {
  return (
    <g transform={`translate(${x} ${y})`}>
      {light && <path d="M34 -66L120 6H-6Z" fill="#FFE7A6" opacity={0.55} />}
      <path d="M-10 0H22" {...LINE} strokeWidth={5} />
      <path d="M6 0L-6 -40L30 -64" fill="none" {...LINE} strokeWidth={4} />
      <path d="M22 -78L52 -54L34 -46Q26 -62 14 -66Z" fill={ORANGE} {...LINE} />
    </g>
  );
}

/** A shelf of books. */
export function Shelf({ x, y, w = 200 }: At & { w?: number }): React.JSX.Element {
  const palette = [ORANGE, PANEL, PALE, WOOD, GREY, ORANGE, PAPER, PANEL];
  // Enough books to fill the shelf, with a gap at the end to lean one in.
  const count = Math.max(4, Math.floor((w - 40) / 17));
  const colours = Array.from({ length: count }, (_, i) => palette[i % palette.length]!);
  let cursor = 8;
  const books = colours.map((fill, i) => {
    const bw = 12 + ((i * 7) % 9);
    const bh = 34 + ((i * 11) % 16);
    const book = (
      <rect key={i} x={cursor} y={-bh} width={bw} height={bh} rx={2} fill={fill} {...fine} />
    );
    cursor += bw + 2;
    return book;
  });
  return (
    <g transform={`translate(${x} ${y})`}>
      {books}
      <rect x={0} y={0} width={w} height={10} rx={3} fill={WOOD} {...LINE} />
    </g>
  );
}

/** The installer's van, side on. */
export function Van({
  x,
  y,
  w = 190,
  label = 'SOLAR',
}: At & { w?: number; label?: string }): React.JSX.Element {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path
        d={`M0 0V-60Q0 -70 10 -70H${w * 0.62}L${w * 0.86} -42Q${w} -38 ${w} -26V0Z`}
        fill={PAPER}
        {...LINE}
      />
      <path d={`M${w * 0.64} -64L${w * 0.82} -42H${w * 0.64}Z`} fill="#CFE6FF" {...fine} />
      <rect x={12} y={-48} width={w * 0.44} height={22} rx={4} fill={ORANGE} {...fine} />
      <text
        x={12 + w * 0.22}
        y={-32}
        textAnchor="middle"
        fontSize={12}
        fontWeight={800}
        fontFamily="var(--font-sans), sans-serif"
        fill={INK}
      >
        {label}
      </text>
      {[w * 0.2, w * 0.78].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy={2} r={15} fill={INK} />
          <circle cx={cx} cy={2} r={6} fill={GREY} />
        </g>
      ))}
    </g>
  );
}

/** A fluffy cartoon cloud. */
export function Cloud({ x, y, s = 1 }: At & { s?: number }): React.JSX.Element {
  return (
    <path
      transform={`translate(${x} ${y}) scale(${s})`}
      d="M0 0Q-2 -16 14 -18Q20 -32 38 -26Q50 -38 64 -24Q80 -24 78 -8Q86 2 72 6H6Q-8 6 0 0Z"
      fill={PAPER}
      {...LINE}
    />
  );
}

/** A burst of short print rays behind something important. */
export function Sunburst({
  x,
  y,
  r = 110,
  count = 16,
  fill = PALE,
}: At & { r?: number; count?: number; fill?: string }): React.JSX.Element {
  const rays = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const b = a + Math.PI / count;
    rays.push(
      <path
        key={i}
        d={`M${x} ${y}L${x + Math.cos(a) * r} ${y + Math.sin(a) * r}L${x + Math.cos(b) * r} ${y + Math.sin(b) * r}Z`}
        fill={fill}
      />,
    );
  }
  return <g>{rays.filter((_, i) => i % 2 === 0)}</g>;
}

/** A potted plant, to make a room a room. */
export function Plant({ x, y }: At): React.JSX.Element {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path
        d="M0 -20Q-24 -46 -10 -62Q2 -44 0 -20ZM2 -22Q22 -54 36 -46Q28 -26 2 -22ZM0 -22Q-30 -30 -34 -16Q-14 -8 0 -22Z"
        fill="#7FB069"
        {...LINE}
      />
      <path d="M-14 -20H16L12 6H-10Z" fill={ORANGE} {...LINE} />
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
      {children}
      <rect x={-32} y={0} width={64} height={tall} rx={4} fill={PAPER} {...LINE} />
      <text
        x={0}
        y={tall / 2 + 5}
        textAnchor="middle"
        fontSize={13}
        fontWeight={800}
        fontFamily="var(--font-sans), sans-serif"
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
      <rect
        x={0}
        y={0}
        width={labels.length * 74 + 16}
        height={84}
        rx={10}
        fill={PAPER}
        {...LINE}
      />
      {labels.map((label, i) => (
        <g key={label} transform={`translate(${16 + i * 74} 12)`}>
          <rect width={58} height={40} rx={8} fill={CREAM} {...fine} />
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
      <text
        x={75}
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

/** A door, half open, with light spilling out. */
export function Door({ x, y }: At): React.JSX.Element {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={0} y={-120} width={70} height={120} fill="#FFE7A6" {...LINE} />
      <path d="M70 -120L104 -108V8L70 0Z" fill={ORANGE} {...LINE} />
      <circle cx={96} cy={-54} r={3} fill={INK} />
    </g>
  );
}

/** An easel with a canvas on it: a portrait of the sun, in your colour. */
export function Easel({ x, y }: At): React.JSX.Element {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path
        d="M20 0L60 -230M140 0L100 -230M80 -230V8"
        fill="none"
        {...LINE}
        strokeWidth={6}
        stroke={WOOD}
      />
      <path d="M20 0L60 -230M140 0L100 -230M80 -230V8" fill="none" {...LINE} strokeWidth={1.6} />
      <rect x={6} y={-206} width={148} height={130} rx={4} fill={PAPER} {...LINE} />
      <circle cx={80} cy={-141} r={30} fill="var(--sunny-brand-orange, #FF7900)" {...LINE} />
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
      <path d="M0 -76H160" {...LINE} strokeWidth={6} stroke={WOOD} />
    </g>
  );
}

/** Paint pots, for the colours scene. */
export function PaintPots({
  x,
  y,
  colours,
}: At & { colours: readonly string[] }): React.JSX.Element {
  return (
    <g transform={`translate(${x} ${y})`}>
      {colours.map((c, i) => (
        <g key={c} transform={`translate(${i * 46} 0)`}>
          <path d="M0 -34H36V-2Q36 4 30 4H6Q0 4 0 -2Z" fill={GREY} {...LINE} />
          <ellipse cx={18} cy={-34} rx={18} ry={6} fill={c} {...LINE} />
        </g>
      ))}
    </g>
  );
}
