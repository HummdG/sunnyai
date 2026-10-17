import { renderSunny, type ExpressionName } from '@sunny/character';

import {
  BrowserFrame,
  Cloud,
  Easel,
  GREY,
  Ground,
  INK,
  LINE,
  ORANGE,
  PALE,
  PackageCard,
  Plant,
  Rosette,
  SocketBoard,
  Sunburst,
  CodeStrip,
  SiteMock,
  SpeechBubble,
  PhoneWithLead,
  SignUpCard,
} from './kit.js';
import { Detached } from './homes.js';
import { Scene } from './scene.js';
import { PasteScene } from './home.js';
import { ConversationScene, CorkboardScene } from './stories.js';
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
      sunny={{ pose: 'present', play: 'gesture-palm', expression: 'proud' }}
      at={{ x: 320, y: 168 }}
      size={250}
    />
  );
}

/**
 * How it works: the installer's own site above its markup, the one added
 * line lit up, and Sunny already at home in the corner of the page.
 */
export function HowItWorksScene(): React.JSX.Element {
  return (
    <Scene
      width={560}
      height={440}
      shadow={false}
      label="An installer's website above its code, with the one added script line highlighted, and Sunny appearing in the corner of the site."
      back={
        <>
          <rect width={560} height={440} fill="#FFF6E6" />
          <Sunburst x={430} y={250} r={260} count={24} />
          <BrowserFrame x={26} y={30} w={360} h={250} url="brightside-solar.co.uk">
            <g transform={`scale(${360 / 410})`}>
              <SiteMock w={410} h={220 / (360 / 410)} />
            </g>
          </BrowserFrame>
          <g transform="translate(60 300) scale(1.45)">
            <CodeStrip x={0} y={0} w={200} />
          </g>
          <path
            d="M360 360Q420 360 432 300"
            fill="none"
            stroke={INK}
            strokeWidth={2.4}
            strokeDasharray="3 7"
            strokeLinecap="round"
          />
        </>
      }
      sunny={{
        pose: 'rest',
        play: 'listening-perk',
        look: { x: -0.6, y: 0.4 },
        expression: 'wonder',
      }}
      at={{ x: 330, y: 120 }}
      size={190}
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
      sunny={{ pose: 'wave', play: 'listening-perk', expression: 'hello' }}
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
      sunny={{
        pose: 'hold',
        play: 'thinking-eureka',
        props: [held('plug', 66, -10, 0, 1.8)],
        expression: 'idea',
      }}
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
          <Detached x={292} y={378} s={0.98} panels={5} />
        </>
      }
      sunny={{
        pose: 'hold',
        play: 'gesture-nod',
        props: [held('price-tag', 74, -4, -14, 2)],
        expression: 'content',
      }}
      at={{ x: 50, y: 140 }}
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
      sunny={{
        pose: 'hold',
        play: 'gesture-nod',
        props: [held('padlock', 68, -6, 0, 2)],
        expression: 'serene',
      }}
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
      sunny={{
        pose: 'hold',
        play: 'gesture-nod',
        props: [held('clipboard', 66, -14, 8, 2)],
        expression: 'focused',
      }}
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
    shadow={false}
    label="A sign-up card filled in with the installer's company name and website, with Sunny beside it."
    back={<SignUpCard x={16} y={16} w={186} />}
    sunny={{ pose: 'rest', play: 'listening-perk', look: { x: -0.7, y: 0.2 }, expression: 'kind' }}
    at={{ x: 196, y: 76 }}
    size={104}
  />,
  <CorkboardScene key="knowledge" />,
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
    sunny={{
      pose: 'hold',
      play: 'gesture-nod',
      props: [held('paintbrush', 66, -10, 28, 1.9)],
      expression: 'proud',
    }}
    at={{ x: 10, y: 60 }}
  />,
  <PasteScene key="paste" />,
];

/** The How it works storyboard: what a visitor experiences. */
export const VISIT_PANELS = [
  <Panel
    key="hello"
    shadow={false}
    label="An installer's website with Sunny popping out of the corner to say hello."
    back={
      <>
        <BrowserFrame x={14} y={14} w={214} h={166} url="brightside-solar.co.uk">
          <g transform={`scale(${214 / 410})`}>
            <SiteMock w={410} h={136 / (214 / 410)} />
          </g>
        </BrowserFrame>
        <SpeechBubble x={120} y={168} w={92} lines={['Hi there!']} tail="right" />
      </>
    }
    sunny={{ pose: 'rest', play: 'listening-perk', look: { x: -0.5, y: 0.2 }, expression: 'hello' }}
    at={{ x: 190, y: 110 }}
    size={104}
  />,
  <ConversationScene key="answers" />,
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
    sunny={{ pose: 'rest', play: 'gesture-point', look: { x: 0.3, y: 0.8 }, expression: 'knowing' }}
    at={{ x: 150, y: -10 }}
    size={110}
  />,
  <Panel
    key="lead"
    shadow={false}
    label="A phone showing a new lead from Sunny, ready to call, with Sunny beside it."
    back={<PhoneWithLead x={30} y={16} />}
    sunny={{
      pose: 'rest',
      play: 'celebrate-glow',
      look: { x: -0.7, y: 0.3 },
      expression: 'delighted',
    }}
    at={{ x: 170, y: 64 }}
    size={120}
  />,
];

/**
 * The expressions on the model sheet: a moment from the chat Sunny's
 * repertoire, the frame of it that reads best, and an animator's note.
 */
const MODEL_SHEET: ReadonlyArray<[expression: ExpressionName, note: string]> = [
  ['content', 'At rest'],
  ['hello', 'Hello!'],
  ['delighted', 'Lovely!'],
  ['laughing', 'Hooray!'],
  ['wonder', 'Ooh'],
  ['curious', 'What’s this?'],
  ['thinking', 'Thinking…'],
  ['pondering', 'Hmm…'],
  ['idea', 'An idea!'],
  ['knowing', 'This one'],
  ['proud', 'Chuffed'],
  ['serene', 'All in hand'],
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
      aria-label="Sunny's model sheet: twelve expressions, from at rest to all in hand."
    >
      <header>
        <span>SUNNY — Model sheet</span>
        <span>No. 1</span>
      </header>
      <ul>
        {MODEL_SHEET.map(([expression, note]) => (
          <li key={expression}>
            <span
              className="model-art"
              aria-hidden="true"
              dangerouslySetInnerHTML={{
                __html: renderSunny(stillRig({ pose: 'rest', expression }), {
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

export { SignpostScene as ResourcesScene } from './stories.js';
