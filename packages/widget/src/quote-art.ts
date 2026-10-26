/**
 * The little drawing on each quote option: a house in ink, its roof carrying
 * more panels the bigger the option, and a battery beside it when the option
 * has one. It shows the difference between the options before a figure is
 * read. Hidden from assistive technology: the card's text says the same thing.
 *
 * Markup rather than `el` (dom.ts) because nothing from the network goes in:
 * only the option's rank and whether it has a battery, both turned into our
 * own numbers here.
 */

/** Panels on the roof for the smallest, middle and largest option: columns × rows. */
const LAYOUT = [
  [3, 1],
  [3, 2],
  [4, 2],
] as const;

// A point on the roof face (a trapezoid, ridge to eave) from (u, v) in [0, 1]².
const at = (u: number, v: number) =>
  `${(54 - 20 * v + u * (52 + 40 * v)).toFixed(1)},${(30 + v * 28).toFixed(1)}`;
const quad = (u0: number, v0: number, u1: number, v1: number) =>
  `${at(u0, v0)} ${at(u1, v0)} ${at(u1, v1)} ${at(u0, v1)}`;

const ART = (panels: string, battery: string) =>
  `<svg viewBox="0 0 160 100" class="quote-art" aria-hidden="true" focusable="false">` +
  `<g stroke="#171717" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">` +
  `<path d="M149 17h4M138 6v-4M138 28v4M123 17h4M130 9l-3-3M146 9l3-3M130 25l-3 3M146 25l3 3" stroke-width="1.6"/>` +
  `<circle cx="138" cy="17" r="7.5" fill="#FF7900" stroke-width="1.6"/>` +
  `<rect x="92" y="20" width="8" height="14" fill="#FFFCF8"/>` +
  `<rect x="40" y="56" width="80" height="36" fill="#FFFCF8"/>` +
  `<polygon points="${quad(0, 0, 1, 1)}" fill="#F6DCC2"/>` +
  `<g stroke-width="1.6"><rect x="74" y="72" width="12" height="20" fill="#FF7900"/>` +
  `<rect x="50" y="66" width="14" height="11" fill="#FFFCF8"/><rect x="96" y="66" width="14" height="11" fill="#FFFCF8"/></g>` +
  `<g fill="#171717" stroke-width="1">${panels}</g>${battery}<path d="M14 92h136"/></g></svg>`;

const BATTERY =
  `<rect x="125" y="70" width="14" height="22" rx="2.5" fill="#FFFCF8"/><rect x="129" y="67" width="6" height="3" fill="#171717"/>` +
  `<path d="M133.5 74 128.5 82H132l-1.5 7 5-8.5H132z" fill="#FF7900" stroke-width="1"/>`;

export function optionArt(rank: number, battery: boolean): SVGSVGElement {
  const [cols, rows] = LAYOUT[Math.max(0, Math.min(LAYOUT.length - 1, rank))]!;
  let panels = '';
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const u0 = 0.115 + (c * 0.8) / cols;
      const u1 = 0.085 + ((c + 1) * 0.8) / cols;
      const v0 = 0.16 + (r * 0.76) / rows;
      const v1 = 0.08 + ((r + 1) * 0.76) / rows;
      const du = u1 - u0;
      const dv = v1 - v0;
      // the panel, and a glint across it
      panels +=
        `<polygon points="${quad(u0, v0, u1, v1)}"/>` +
        `<polyline points="${at(u0 + du * 0.2, v0 + dv * 0.75)} ${at(u0 + du * 0.55, v0 + dv * 0.25)}" stroke="#FFB066" stroke-width="1.2"/>`;
    }
  }
  const host = document.createElement('div');
  host.innerHTML = ART(panels, battery ? BATTERY : '');
  return host.firstChild as SVGSVGElement;
}
