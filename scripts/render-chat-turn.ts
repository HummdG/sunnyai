/**
 * Renders a whole chat turn, as the widget's animator acts it, to numbered PNG
 * frames for review -- and, with Pillow installed, to an animated GIF:
 *
 *   npx tsx scripts/render-chat-turn.ts <out-dir>
 *   python scripts/frames-to-gif.py <out-dir> chat-turn.gif
 *
 * The script is the same event sequence a real conversation sends (see
 * `machineEventForStreamEvent`), on a fixed clock, so the result is
 * reproducible: open the chat, type, think, look it up in the knowledge base,
 * answer with gestures, nod, celebrate a saved lead, and finally get the
 * deckchair out when nobody says anything.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Resvg } from '@resvg/resvg-js';
import { SunnyAnimator, type MachineEvent } from '@sunny/animation-engine';
import { cartoonClock, defaultRig, renderSunny } from '@sunny/character';

const out = process.argv[2] ?? 'chat-turn-frames';
mkdirSync(out, { recursive: true });

const FPS = 20;
const SIZE = 320;

/** [time in ms, event, caption shown under Sunny]. */
const SCRIPT: Array<[number, MachineEvent | null, string]> = [
  [0, null, 'Resting'],
  [600, { type: 'attention' }, 'Chat opened: a wave'],
  [2_000, { type: 'user_typing' }, 'Visitor typing: leans in'],
  [3_600, { type: 'turn_started' }, 'Message sent: thinking'],
  [5_200, { type: 'lookup', kind: 'book' }, 'Knowledge base: reads up'],
  [8_400, { type: 'lookup_finished' }, 'Found it'],
  [8_800, { type: 'speaking_started' }, 'Answering: eureka, then gestures'],
  [16_000, { type: 'turn_finished' }, 'Done: a nod'],
  [18_000, { type: 'celebrate' }, 'Lead saved: celebrates'],
  [22_500, null, 'Waiting… fidgets, then the deckchair'],
];
const END = 72_000;
/** The quiet wait is long; skip most of it so the GIF stays watchable. */
const FAST_FROM = 24_000;
const FAST_TO = 64_000;

const sunny = new SunnyAnimator(defaultRig(), { intensity: 'playful', seed: 11 });
let caption = '';
let next = 0;
let frame = 0;
const step = 1000 / FPS;

for (let t = 0; t <= END; t += step) {
  while (next < SCRIPT.length && SCRIPT[next]![0] <= t) {
    const [, event, text] = SCRIPT[next++]!;
    if (event) sunny.dispatch(event, t);
    caption = text;
  }
  const { rig } = sunny.frame(t);
  // In the long quiet wait, draw only every eighth frame (a time-lapse).
  if (t > FAST_FROM && t < FAST_TO && Math.round(t / step) % 8 !== 0) continue;
  const { boil } = cartoonClock(t);
  const svg = renderSunny(rig, { size: SIZE, boil })
    .replace('<svg ', '<svg y="0" ')
    .replace(/^<svg[^>]*>/, (open) => open.replace(/height="\d+"/, `height="${SIZE}"`));
  const label = `${caption}${t > FAST_FROM && t < FAST_TO ? ' (8× speed)' : ''}`;
  const page =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE + 36}">` +
    `<rect width="100%" height="100%" fill="#FFFCF8"/>${svg}` +
    `<text x="${SIZE / 2}" y="${SIZE + 24}" text-anchor="middle" font-family="sans-serif" font-size="15" fill="#171717">${label}</text></svg>`;
  const png = new Resvg(page, { font: { loadSystemFonts: true } }).render().asPng();
  writeFileSync(join(out, `frame-${String(frame++).padStart(5, '0')}.png`), png);
}
console.log(`wrote ${frame} frames to ${out}`);
