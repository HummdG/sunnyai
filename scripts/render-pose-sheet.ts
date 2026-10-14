/**
 * Renders the hand and shoe drawings, enlarged, and every pose in the limb
 * library onto one contact sheet, for comparing against `reference_poses.png`
 * by eye.
 *
 *   npx tsx scripts/render-pose-sheet.ts [out.png]
 */
import { writeFileSync } from 'node:fs';

import { Resvg } from '@resvg/resvg-js';
import {
  defaultRig,
  HANDS,
  LIMB_POSES,
  limbPose,
  renderSunny,
  SUNNY_THEME,
  SIT_DROP,
  type LimbPoseName,
} from '@sunny/character';

const CELL = 240;
const COLS = 6;
const HAND_CELL = (COLS * CELL) / Object.keys(HANDS).length;
const HAND_ROW = 170;

const label = (x: number, y: number, text: string): string =>
  `<text x="${x + 8}" y="${y + 18}" font-size="14" font-family="sans-serif">${text}</text>`;

const hands = (Object.keys(HANDS) as Array<keyof typeof HANDS>).map((name, i) => {
  const art = HANDS[name];
  const x = i * HAND_CELL;
  const place = `translate(${x + HAND_CELL / 2} ${name === 'shoe' ? 95 : 140}) scale(4.4)`;
  return (
    `<g transform="${place}"><path d="${art.ink}" fill="${SUNNY_THEME.ink}"/>` +
    `<path d="${art.fill}" fill="${SUNNY_THEME.body}"/>` +
    `<path d="${art.lines}" fill="${SUNNY_THEME.ink}"/></g>` +
    label(x, 0, name)
  );
});

const names = Object.keys(LIMB_POSES) as LimbPoseName[];
const SITTING: readonly LimbPoseName[] = ['sit', 'read', 'type', 'recline'];
const rows = Math.ceil(names.length / COLS);
const poses = names.map((name, i) => {
  const rig = defaultRig();
  rig.limbs = limbPose(name);
  // The sitting poses are drawn with the body lowered onto the ground, as the
  // sequences that use them do.
  if (SITTING.includes(name)) rig.y += SIT_DROP;
  const x = (i % COLS) * CELL;
  const y = HAND_ROW + Math.floor(i / COLS) * CELL;
  return (
    renderSunny(rig, { size: CELL }).replace('<svg ', `<svg x="${x}" y="${y}" `) + label(x, y, name)
  );
});

const sheet =
  `<svg xmlns="http://www.w3.org/2000/svg" width="${COLS * CELL}" height="${HAND_ROW + rows * CELL}">` +
  `<rect width="100%" height="100%" fill="#fff"/>${hands.join('')}${poses.join('')}</svg>`;
const png = new Resvg(sheet, { font: { loadSystemFonts: true } }).render().asPng();
const out = process.argv[2] ?? 'pose-sheet.png';
writeFileSync(out, png);
console.log(`wrote ${out}`);
