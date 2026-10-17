import { renderSunny } from '@sunny/character';

import {
  BrowserFrame,
  Cloud,
  CopyLines,
  Desk,
  Easel,
  GREY,
  Ground,
  House,
  INK,
  Laptop,
  LINE,
  ORANGE,
  PALE,
  PackageCard,
  Plant,
  Rosette,
  Shelf,
  SocketBoard,
  Sunburst,
} from './kit.js';
import { Scene } from './scene.js';
import { held, stillRig, type SunnyDirection } from './still.js';

/**
 * The inner pages' scenes: one for each page's intro, the panels of the How it
 * works storyboard, and the Meet Sunny model sheet.
 */

/** Product: Sunny presenting the installer's dashboard, leads arriving. */
export function ProductScene(): React.JSX.Element {
  return (
    <Scene
      width={560}
      height={440}
      label="Sunny presents a dashboard showing new leads and a chart of enquiries."
      back={
        <>
          <Sunburst x={430} y={300} r={240} count={24} />
          <BrowserFrame x={30} y={40} w={360} h={300} url="dashboard.sunny.ai">
            <text
              x={20}
              y={34}
              fontSize={15}
              fontWeight={800}
              fill={INK}
              fontFamily="var(--font-sans), sans-serif"
            >
              New leads this week
            </text>
            {[0.45, 0.7, 0.55, 0.9, 0.75].map((h, i) => (
              <rect
                key={i}
                x={24 + i * 34}
                y={190 - h * 130}
                width={24}
                height={h * 130}
                rx={4}
                fill={i === 3 ? ORANGE : PALE}
                {...LINE}
                strokeWidth={1.8}
              />
            ))}
            <path
              d="M200 60H330M200 96H330M200 132H330M200 168H330"
              stroke={GREY}
              strokeWidth={8}
              strokeLinecap="round"
            />
            <circle cx={200} cy={60} r={8} fill={ORANGE} {...LINE} strokeWidth={1.6} />
            <circle cx={200} cy={96} r={8} fill={ORANGE} {...LINE} strokeWidth={1.6} />
          </BrowserFrame>
          <Ground y={400} width={560} bulge={6} />
        </>
      }
      sunny={{ pose: 'present', play: 'gesture-palm' }}
      at={{ x: 320, y: 168 }}
      size={250}
    />
  );
}

/** How it works: one line pinned to the installer's site, a thumbs up. */
export function HowItWorksScene(): React.JSX.Element {
  return (
    <Scene
      width={560}
      height={440}
      label="Sunny gives a thumbs up beside a website with a script tag pinned to it."
      back={
        <>
          <Sunburst x={420} y={320} r={240} count={24} />
          <BrowserFrame x={30} y={40} w={340} h={260}>
            <CopyLines x={24} y={26} w={220} lines={4} />
            <rect x={24} y={150} width={290} height={60} rx={8} fill={INK} />
            <text x={40} y={186} fontSize={15} fontFamily="ui-monospace, monospace" fill={PALE}>
              {'<script src="…sunny-widget.js">'}
            </text>
          </BrowserFrame>
          <Ground y={400} width={560} bulge={6} />
        </>
      }
      sunny={{ pose: 'thumbsUp', play: 'gesture-nod' }}
      at={{ x: 310, y: 160 }}
      size={250}
    />
  );
}

/** Meet Sunny: the star of the show, waving in the spotlight. */
export function SpotlightScene(): React.JSX.Element {
  return (
    <Scene
      width={560}
      height={440}
      label="Sunny waves hello on a little stage, in a spotlight."
      back={
        <>
          <rect x={0} y={0} width={560} height={440} fill={INK} />
          <path d="M200 -10H360L470 380H90Z" fill="#FFE7A6" opacity={0.9} />
          <ellipse cx={280} cy={384} rx={190} ry={28} fill={ORANGE} {...LINE} />
          <path d="M0 0Q60 80 40 440H0ZM560 0Q500 80 520 440H560Z" fill={ORANGE} {...LINE} />
        </>
      }
      sunny={{ pose: 'wave', play: 'listening-perk' }}
      at={{ x: 150, y: 130 }}
      size={260}
    />
  );
}

/** Integrations: plugging Sunny into the tools you already use. */
export function IntegrationsScene(): React.JSX.Element {
  return (
    <Scene
      width={560}
      height={420}
      label="Sunny holds a plug beside a socket board labelled CRM, Email, Webhooks and Calendar."
      back={
        <>
          <g transform="translate(40 50) scale(1.45)">
            <SocketBoard x={0} y={0} labels={['CRM', 'Email', 'Webhook', 'Calendar']} />
          </g>
          <Ground y={380} width={560} bulge={6} />
          <Plant x={480} y={380} />
        </>
      }
      sunny={{ pose: 'hold', play: 'gesture-point', props: [held('plug', 66, -10, 0, 1.8)] }}
      at={{ x: 150, y: 150 }}
      size={240}
    />
  );
}

/** Pricing: a price tag, a fair one. */
export function PricingScene(): React.JSX.Element {
  return (
    <Scene
      width={560}
      height={420}
      label="Sunny holds up a price tag in front of a house with solar panels."
      back={
        <>
          <Cloud x={70} y={60} s={0.8} />
          <Ground y={370} width={560} />
          <House x={300} y={260} w={210} h={110} panels={3} />
        </>
      }
      sunny={{ pose: 'hold', play: 'gesture-nod', props: [held('price-tag', 74, -4, -14, 2)] }}
      at={{ x: 50, y: 140 }}
      size={250}
    />
  );
}

/** Resources: reading up in the library. */
export function ResourcesScene(): React.JSX.Element {
  return (
    <Scene
      width={560}
      height={420}
      label="Sunny sits reading a book beneath shelves of books."
      back={
        <>
          <Shelf x={40} y={110} w={480} />
          <Shelf x={40} y={210} w={300} />
          <Ground y={390} width={560} bulge={4} />
          <Plant x={470} y={390} />
        </>
      }
      sunny={{ pose: 'hips', act: 'lookup-book', at: 0.3, play: 'lookup-book' }}
      at={{ x: 150, y: 150 }}
      size={250}
    />
  );
}

/** Privacy: Sunny keeps your visitors' details locked away. */
export function PrivacyScene(): React.JSX.Element {
  return (
    <Scene
      width={560}
      height={400}
      label="Sunny holds a padlock."
      back={
        <>
          <Sunburst x={280} y={230} r={230} count={24} />
          <Ground y={360} width={560} bulge={6} />
        </>
      }
      sunny={{ pose: 'hold', play: 'gesture-nod', props: [held('padlock', 68, -6, 0, 2)] }}
      at={{ x: 150, y: 110 }}
      size={250}
    />
  );
}

/** Terms: everything written down, and ticked. */
export function TermsScene(): React.JSX.Element {
  return (
    <Scene
      width={560}
      height={400}
      label="Sunny holds a clipboard with a ticked list."
      back={
        <>
          <Sunburst x={280} y={230} r={230} count={24} />
          <Ground y={360} width={560} bulge={6} />
        </>
      }
      sunny={{ pose: 'hold', play: 'gesture-nod', props: [held('clipboard', 66, -14, 8, 2)] }}
      at={{ x: 150, y: 110 }}
      size={250}
    />
  );
}

/** A small storyboard panel: a little set, Sunny doing one thing. */
function Panel({
  label,
  back,
  sunny,
  at,
  size = 160,
  shadow = true,
}: {
  label: string;
  back: React.ReactNode;
  sunny: SunnyDirection;
  at: { x: number; y: number };
  size?: number;
  shadow?: boolean;
}): React.JSX.Element {
  return (
    <Scene
      width={300}
      height={240}
      label={label}
      back={back}
      sunny={sunny}
      at={at}
      size={size}
      shadow={shadow}
    />
  );
}

const ground = <Ground y={214} width={300} bulge={4} />;

/** The How it works storyboard: setting up. */
export const SETUP_PANELS = [
  <Panel
    key="account"
    label="Sunny holds a clipboard, signing you up."
    back={
      <>
        {ground}
        <Cloud x={200} y={40} s={0.6} />
      </>
    }
    sunny={{ pose: 'hold', play: 'gesture-nod', props: [held('clipboard', 66, -12, 8, 1.8)] }}
    at={{ x: 60, y: 60 }}
  />,
  <Panel
    key="knowledge"
    label="Sunny reads a book in front of a bookshelf."
    back={
      <>
        <Shelf x={30} y={70} w={240} />
        {ground}
      </>
    }
    sunny={{ pose: 'hips', act: 'lookup-book', at: 0.3, play: 'lookup-book' }}
    at={{ x: 70, y: 66 }}
  />,
  <Panel
    key="colours"
    label="Sunny paints a portrait of the sun on an easel."
    back={
      <>
        {ground}
        <g transform="translate(150 0) scale(0.62)">
          <Easel x={40} y={340} />
        </g>
      </>
    }
    sunny={{ pose: 'hold', play: 'gesture-palm', props: [held('paintbrush', 66, -10, 28, 1.9)] }}
    at={{ x: 10, y: 60 }}
  />,
  <Panel
    key="paste"
    label="A website with one line of code added, and Sunny giving a thumbs up."
    back={
      <>
        <BrowserFrame x={20} y={20} w={190} h={150}>
          <CopyLines x={16} y={18} w={120} lines={3} />
        </BrowserFrame>
        <g transform="translate(40 150) rotate(-6)">
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
      </>
    }
    sunny={{ pose: 'thumbsUp', play: 'gesture-nod' }}
    at={{ x: 170, y: 70 }}
    size={150}
  />,
];

/** The How it works storyboard: what a visitor experiences. */
export const VISIT_PANELS = [
  <Panel
    key="hello"
    label="Sunny waves hello from the corner of a website."
    back={
      <>
        <BrowserFrame x={16} y={20} w={200} h={160}>
          <CopyLines x={16} y={18} w={130} lines={3} />
        </BrowserFrame>
        {ground}
      </>
    }
    sunny={{ pose: 'wave', play: 'listening-perk' }}
    at={{ x: 150, y: 66 }}
    size={150}
  />,
  <Panel
    key="answers"
    shadow={false}
    label="A visitor's question on a laptop screen, and Sunny glowing beside it with the answer."
    back={
      <>
        <Sunburst x={210} y={96} r={120} count={16} fill="#FFE7A6" />
        <Desk x={10} y={190} w={280} />
        <Laptop x={40} y={190} w={120} />
      </>
    }
    sunny={{ pose: 'rest', play: 'gesture-nod', look: { x: -0.7, y: 0.5 }, grin: 1.15 }}
    at={{ x: 160, y: 30 }}
    size={130}
  />,
  <Panel
    key="options"
    shadow={false}
    label="Two solar packages as product cards, the better fit wearing a rosette, with Sunny hovering above."
    back={
      <>
        <PackageCard x={30} y={96} w={104} h={130} name="Starter" level={1} />
        <PackageCard x={150} y={80} w={112} h={146} name="Plus" level={2} chosen />
        <Rosette x={252} y={92} label="BEST" />
      </>
    }
    sunny={{ pose: 'rest', play: 'gesture-nod', look: { x: 0.3, y: 0.8 }, grin: 1.2 }}
    at={{ x: 150, y: -10 }}
    size={110}
  />,
  <Panel
    key="lead"
    label="Sunny holds up a phone showing a new lead notification."
    back={
      <>
        {ground}
        <House x={190} y={150} w={90} h={60} panels={1} door={false} />
      </>
    }
    sunny={{ pose: 'hold', play: 'gesture-point', props: [held('phone', 64, -14, 8, 1.8)] }}
    at={{ x: 30, y: 60 }}
  />,
];

/**
 * The expressions on the model sheet: a moment from the chat Sunny's
 * repertoire, the frame of it that reads best, and an animator's note.
 */
const MODEL_SHEET: ReadonlyArray<[sequence: string, at: number, note: string]> = [
  ['idle-breathe', 0.1, 'At rest'],
  ['listening-perk', 0.4, 'Hello!'],
  ['thinking-whirr', 0.3, 'Thinking…'],
  ['thinking-eureka', 0.75, 'Got it!'],
  ['gesture-nod', 0.3, 'Of course'],
  ['celebrate-bounce', 0.4, 'Hooray!'],
  ['confused-tilt', 0.5, 'Hmm?'],
  ['error-deflate', 0.35, 'Oops'],
  ['lookup-book', 0.3, 'Reading up'],
  ['lookup-magnify', 0.25, 'Looking closely'],
  ['lookup-laptop', 0.2, 'On the case'],
  ['celebrate-glow', 0.3, 'Chuffed'],
];

/**
 * Sunny's model sheet: the character's expressions laid out the way an
 * animation studio lays out a character, on gridded paper with a note under
 * each drawing. The one place on the site where many Sunnys belong. Drawn
 * once, on the server.
 */
export function ModelSheet(): React.JSX.Element {
  return (
    <figure
      className="model-sheet"
      aria-label="Sunny's model sheet: twelve expressions, from at rest to chuffed."
    >
      <header>
        <span>SUNNY — Model sheet</span>
        <span>No. 1</span>
      </header>
      <ul>
        {MODEL_SHEET.map(([act, at, note]) => (
          <li key={act}>
            <span
              className="model-art"
              aria-hidden="true"
              dangerouslySetInnerHTML={{
                __html: renderSunny(stillRig({ pose: 'rest', act, at }), {
                  decorative: true,
                  size: 160,
                }),
              }}
            />
            <span className="model-note">{note}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
