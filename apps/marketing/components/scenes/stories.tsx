import { Sash, SemiDetached, Detached, Terrace } from './homes.js';
import {
  Birds,
  ChatWindow,
  Cloud,
  Corkboard,
  Ground,
  INK,
  LINE,
  Moon,
  PinnedDoc,
  RedString,
  Signpost,
  SpeechBubble,
  Stars,
} from './kit.js';
import { Scene } from './scene.js';

/**
 * The four scenes that tell how Sunny works without Sunny having hands: a
 * light in one window at two in the morning, a conversation, a detective's
 * board of the installer's own documents, and a signpost to the guides.
 */

/** Where the terrace in the night scene stands, and how big it is drawn. */
const STREET = { x: 30, y: 398, s: 1.15 } as const;
/** The lit upstairs window, in the terrace's own units (see `Terrace`). */
const LIT_WINDOW = { x: 3 * 72 + 10, y: -116 + 24, w: 22, h: 30 } as const;

/**
 * "Answers, day and night": a terraced street at two in the morning, every
 * window dark but one. Sunny hangs over the rooftops like a sun that never
 * set, shining into that window, and the question gets its answer.
 */
export function NightShiftScene(): React.JSX.Element {
  const win = {
    x: STREET.x + LIT_WINDOW.x * STREET.s,
    y: STREET.y + LIT_WINDOW.y * STREET.s,
    w: LIT_WINDOW.w * STREET.s,
    h: LIT_WINDOW.h * STREET.s,
  };
  const sun = { x: 118, y: 104 };
  return (
    <Scene
      width={560}
      height={420}
      shadow={false}
      label="A terraced street at night with every window dark but one. Sunny shines over the rooftops into that lit window, where someone has asked whether their roof is suitable, and Sunny answers."
      back={
        <>
          <rect width={560} height={420} fill="#1B2130" />
          <Stars
            points={[
              [240, 40],
              [300, 90],
              [372, 30],
              [420, 120],
              [520, 160],
              [30, 200],
              [210, 150],
            ]}
          />
          <Moon x={488} y={66} r={26} />
          <Terrace x={STREET.x} y={STREET.y} s={STREET.s} count={6} panels={3} panelEvery={2} />
          {/* Night falls on the street; only the one window is spared. */}
          <rect x={0} y={110} width={560} height={310} fill="#141A28" opacity={0.55} />
          <path
            d={`M${sun.x - 30} ${sun.y + 20}L${sun.x + 26} ${sun.y - 22}L${win.x + win.w + 6} ${win.y + 4}L${win.x - 4} ${win.y + win.h}Z`}
            fill="#FFE7A6"
            opacity={0.28}
          />
          <circle
            cx={win.x + win.w / 2}
            cy={win.y + win.h / 2}
            r={30}
            fill="#FFD66B"
            opacity={0.25}
          />
          <g transform={`translate(${STREET.x} ${STREET.y}) scale(${STREET.s})`}>
            <Sash {...LIT_WINDOW} lit />
          </g>
          <SpeechBubble x={334} y={222} w={170} lines={['Is my roof suitable?']} tail="left" />
          <SpeechBubble
            x={186}
            y={34}
            w={196}
            lines={['Facing south? Perfect.', 'Let’s take a look.']}
            tail="left"
            fill="#FFE2C2"
          />
        </>
      }
      sunny={{ pose: 'rest', play: 'gesture-nod', look: { x: 0.8, y: 0.7 }, expression: 'kind' }}
      at={{ x: sun.x - 75, y: sun.y - 75 }}
      size={150}
    />
  );
}

/** "Sunny answers and asks": the conversation itself, Sunny at its corner. */
export function ConversationScene(): React.JSX.Element {
  return (
    <Scene
      width={300}
      height={240}
      shadow={false}
      label="A chat window: the visitor asks if their roof is OK, Sunny answers and asks how many bedrooms the house has."
      back={
        <ChatWindow
          x={14}
          y={14}
          w={204}
          h={206}
          messages={[
            { from: 'visitor', text: 'Is my roof OK?' },
            { from: 'sunny', text: 'Looks great for solar!' },
            { from: 'sunny', text: 'How many bedrooms?' },
          ]}
        />
      }
      sunny={{
        pose: 'rest',
        play: 'speaking-pulse',
        look: { x: -0.8, y: 0.2 },
        expression: 'talking',
      }}
      at={{ x: 196, y: 104 }}
      size={104}
    />
  );
}

/** Where each document is pinned on the corkboard, in the scene's units. */
const DOCS = [
  { kind: 'spec', x: 30, y: 34, tilt: -4 },
  { kind: 'price', x: 112, y: 30, tilt: 3 },
  { kind: 'warranty', x: 32, y: 128, tilt: 2 },
  { kind: 'faq', x: 114, y: 126, tilt: -3 },
] as const;
const DOC_SCALE = 0.86;

/**
 * "Teach Sunny your business": the installer's own documents pinned to a
 * corkboard -- spec sheet, price list, warranty, FAQ -- and joined to Sunny
 * with red string. Sunny knows what the installer knows.
 */
export function CorkboardScene(): React.JSX.Element {
  const sunny = { x: 254, y: 118 };
  return (
    <Scene
      width={300}
      height={240}
      shadow={false}
      label="A corkboard with the installer's spec sheet, price list, warranty and FAQ pinned to it, each joined to Sunny with red string."
      back={
        <>
          <Corkboard x={14} y={16} w={196} h={208} />
          {DOCS.map((doc) => (
            <g key={doc.kind} transform={`translate(${doc.x} ${doc.y}) scale(${DOC_SCALE})`}>
              <PinnedDoc x={0} y={0} kind={doc.kind} tilt={doc.tilt} />
            </g>
          ))}
          {DOCS.map((doc) => (
            <RedString
              key={doc.kind}
              from={[doc.x + 39 * DOC_SCALE, doc.y - 2 * DOC_SCALE]}
              to={[sunny.x - 30, sunny.y]}
            />
          ))}
          <circle
            cx={sunny.x - 30}
            cy={sunny.y}
            r={4}
            fill="#D7322A"
            stroke={INK}
            strokeWidth={1.4}
          />
        </>
      }
      sunny={{
        pose: 'rest',
        play: 'thinking-eureka',
        look: { x: -0.8, y: -0.1 },
        tilt: -6,
        expression: 'thinking',
      }}
      at={{ x: sunny.x - 52, y: sunny.y - 52 }}
      size={104}
    />
  );
}

/**
 * The Resources intro: a signpost at a fork in a lane, its arms naming the
 * page's three guides, homes along the road, and Sunny floating beside it.
 */
export function SignpostScene(): React.JSX.Element {
  return (
    <Scene
      width={560}
      height={420}
      shadow={false}
      label="A signpost at a fork in a country lane, pointing to Installing, Your catalogue and Personality, with homes along the road and Sunny floating beside it."
      back={
        <>
          <rect width={560} height={420} fill="#FFF6E6" />
          <Cloud x={60} y={60} s={0.8} />
          <Cloud x={420} y={44} s={0.7} />
          <Birds
            points={[
              [300, 70],
              [326, 56],
              [470, 120],
            ]}
          />
          <Ground y={276} width={560} bulge={10} />
          <SemiDetached x={24} y={292} s={0.42} panels={4} />
          <Terrace x={404} y={288} s={0.38} count={3} panels={2} panelEvery={1} />
          <Detached x={168} y={274} s={0.26} panels={4} />
          {/* The lane, forking at the post. */}
          <path
            d="M196 420C236 360 268 330 276 300C262 290 206 286 150 284L164 278C220 278 268 280 282 292C296 280 344 272 420 270L428 278C356 282 306 290 292 302C300 332 330 366 380 420Z"
            fill="#EFE3CF"
            {...LINE}
          />
        </>
      }
      front={
        <Signpost
          x={286}
          y={380}
          arms={[
            { label: 'Installing', dir: 'right' },
            { label: 'Your catalogue', dir: 'left' },
            { label: 'Personality', dir: 'right' },
          ]}
        />
      }
      sunny={{
        pose: 'rest',
        play: 'fidget-look',
        look: { x: 0.8, y: 0.4 },
        expression: 'reassuring',
      }}
      at={{ x: 40, y: 22 }}
      size={150}
    />
  );
}
