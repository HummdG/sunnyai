import {
  Birds,
  BrowserFrame,
  Cloud,
  CodeStrip,
  Easel,
  Ground,
  INK,
  InTray,
  LeadCard,
  ORANGE,
  PackageCard,
  PAINT_COLOURS,
  PaintPots,
  Rosette,
  SiteMock,
  SpeechBubble,
  Stars,
  Sunburst,
  Van,
} from './kit.js';
import { SemiDetached, Terrace } from './homes.js';
import { Scene } from './scene.js';
import { held } from './still.js';

/**
 * The home page's scenes, one per section. Each is a little stage direction:
 * the set, where Sunny stands, what Sunny is doing, and the moment it plays
 * when it comes into view.
 */

/**
 * The hero: an installer's website, with Sunny stepping out of the chat
 * corner to say hello. Their street of homes stands on the hill behind.
 */
export function HeroScene(): React.JSX.Element {
  return (
    <Scene
      width={560}
      height={480}
      label="Sunny, a cartoon sun, says hello from the corner of a solar installer's website, with a street of houses on the hill behind."
      testId="hero-stage"
      back={
        <>
          <rect width={560} height={480} fill="#FFF6E6" />
          <Sunburst x={430} y={330} r={280} count={28} />
          <Cloud x={436} y={52} s={0.9} />
          <Birds
            points={[
              [470, 120],
              [494, 106],
            ]}
          />
          <Ground y={410} width={560} bulge={12} />
          <Terrace x={16} y={420} s={0.36} count={3} panels={2} panelEvery={1} />
          <BrowserFrame x={30} y={34} w={410} h={300} url="brightside-solar.co.uk">
            <SiteMock w={410} h={270} />
          </BrowserFrame>
          <SpeechBubble
            x={226}
            y={262}
            w={148}
            lines={['Hi! Thinking', 'about solar?']}
            tail="right"
          />
        </>
      }
      sunny={{
        pose: 'rest',
        play: 'listening-perk',
        look: { x: -0.4, y: 0.1 },
        expression: 'hello',
      }}
      at={{ x: 340, y: 232 }}
      size={200}
    />
  );
}
/** Qualifying: a close look at the roof, the answers ticked off. */
export function QualifyScene(): React.JSX.Element {
  return (
    <Scene
      width={560}
      height={420}
      label="Sunny inspects a house's roof through a magnifying glass, holding a clipboard with a ticked checklist."
      back={
        <>
          <Cloud x={60} y={60} s={0.8} />
          <Ground y={360} width={560} />
          <SemiDetached x={292} y={372} s={0.94} panels={4} />
        </>
      }
      sunny={{
        pose: 'magnify',
        act: 'lookup-magnify',
        at: 0.25,
        play: 'lookup-magnify',
        props: [held('clipboard', 66, -6, 10)],
        expression: 'focused',
      }}
      at={{ x: 60, y: 150 }}
      size={240}
    />
  );
}

/**
 * Recommending: three packages laid out as printed product cards, and Sunny
 * hovering over the middle one -- the one with the rosette, the best fit.
 */
export function RecommendScene(): React.JSX.Element {
  return (
    <Scene
      width={560}
      height={440}
      shadow={false}
      label="Three solar packages laid out as product cards, Starter, Plus and Complete; Sunny hovers over the Plus card, which wears a Best fit rosette."
      back={
        <>
          <Sunburst x={280} y={130} r={200} count={24} />
          <Birds
            points={[
              [70, 70],
              [96, 54],
              [470, 80],
            ]}
          />
          <PackageCard x={24} y={190} w={160} h={218} name="Starter" level={1} />
          <PackageCard x={376} y={190} w={160} h={218} name="Complete" level={3} />
          <PackageCard x={194} y={160} w={172} h={248} name="Plus" level={2} chosen />
          <Rosette x={362} y={250} label="BEST FIT" />
        </>
      }
      sunny={{
        pose: 'rest',
        play: 'gesture-point',
        look: { x: 0.1, y: 0.8 },
        tilt: 4,
        expression: 'knowing',
      }}
      at={{ x: 214, y: 6 }}
      size={140}
    />
  );
}

/** Handing over: a sealed lead, straight to the installer's van. */
export function HandoverScene(): React.JSX.Element {
  return (
    <Scene
      width={560}
      height={420}
      label="Sunny holds out a sealed envelope, a new lead, beside the installer's van."
      back={
        <>
          <Cloud x={390} y={50} s={0.8} />
          <Ground y={370} width={560} bulge={10} />
          <Van x={300} y={350} w={220} />
        </>
      }
      sunny={{
        pose: 'hold',
        play: 'gesture-nod',
        props: [held('envelope', 72, -2, -10, 1.8)],
        expression: 'proud',
      }}
      at={{ x: 40, y: 140 }}
      size={250}
    />
  );
}

/**
 * Storyboard panel one: the installer's page and its markup, the one line
 * being added, and Sunny turning up in the corner of the site because of it.
 */
export function PasteScene(): React.JSX.Element {
  return (
    <Scene
      width={300}
      height={240}
      shadow={false}
      label="An installer's website above its code, with one highlighted line, a script tag, being added; Sunny appears in the corner of the site."
      back={
        <>
          <BrowserFrame x={14} y={12} w={214} h={136} url="brightside-solar.co.uk">
            {/* The full-size page, shrunk to fit: it is the same site as the hero's. */}
            <g transform={`scale(${214 / 410})`}>
              <SiteMock w={410} h={106 / (214 / 410)} />
            </g>
          </BrowserFrame>
          <CodeStrip x={30} y={156} w={196} />
          <path
            d="M240 200Q262 196 262 168"
            fill="none"
            stroke={INK}
            strokeWidth={2}
            strokeDasharray="2 5"
            strokeLinecap="round"
          />
        </>
      }
      sunny={{
        pose: 'rest',
        play: 'listening-perk',
        look: { x: -0.6, y: 0.3 },
        expression: 'curious',
      }}
      at={{ x: 196, y: 70 }}
      size={100}
    />
  );
}
/**
 * Storyboard panel three: the leads arriving -- an in-tray marked "New leads"
 * filling with ready-to-call cards, Sunny dropping in the next one.
 */
export function WelcomeScene(): React.JSX.Element {
  return (
    <Scene
      width={300}
      height={240}
      shadow={false}
      label="A wire in-tray labelled New leads, filling with cards for people ready to buy, as Sunny drops in another."
      back={
        <>
          <InTray x={26} y={214} w={170} label="NEW LEADS">
            <LeadCard x={24} y={-92} name="Aisha K." postcode="BS6" tilt={-6} />
            <LeadCard x={34} y={-80} name="Tom W." postcode="M20" tilt={4} />
          </InTray>
          <LeadCard x={150} y={44} name="Priya S." postcode="LS8" tilt={12} />
          <Stars
            points={[
              [150, 32],
              [276, 128],
            ]}
            size={6}
            fill={ORANGE}
          />
        </>
      }
      sunny={{
        pose: 'rest',
        play: 'celebrate-glow',
        look: { x: -0.4, y: 0.6 },
        expression: 'delighted',
      }}
      at={{ x: 186, y: 96 }}
      size={104}
    />
  );
}
/** Your colours: Sunny with a loaded brush beside the paint pots. */
export function ColoursScene(): React.JSX.Element {
  return (
    <Scene
      width={560}
      height={420}
      label="Sunny holds a paintbrush beside four open pots of paint."
      back={
        <>
          <Ground y={370} width={560} bulge={8} />
          <Easel x={340} y={360} />
          <PaintPots x={70} y={392} colours={PAINT_COLOURS} />
        </>
      }
      sunny={{
        pose: 'hold',
        play: 'gesture-nod',
        props: [held('paintbrush', 66, -10, 28, 1.9)],
        expression: 'pondering',
      }}
      at={{ x: 110, y: 120 }}
      size={250}
    />
  );
}

/**
 * The call to action: sunrise over a street of houses with panels on their
 * roofs, and Sunny coming up behind them. Framed like every other scene, so it
 * reads as a picture on the orange band rather than a cut-out on it.
 */
export function SunriseScene(): React.JSX.Element {
  return (
    <Scene
      width={520}
      height={380}
      shadow={false}
      label="Sunrise over a street of houses with solar panels on their roofs, with Sunny rising behind them."
      back={
        <>
          <rect x={0} y={0} width={520} height={380} fill="#FFF1DC" />
          <Sunburst x={260} y={250} r={320} count={32} />
          <Cloud x={40} y={70} s={0.8} />
          <Cloud x={390} y={50} s={0.7} />
          <Birds
            points={[
              [150, 60],
              [176, 44],
              [380, 120],
            ]}
          />
        </>
      }
      front={
        <>
          <Ground y={354} width={520} bulge={4} />
          <Terrace x={80} y={356} s={1} count={5} panels={3} panelEvery={2} />
        </>
      }
      sunny={{
        pose: 'rest',
        play: 'celebrate-bounce',
        look: { x: 0, y: -0.2 },
        expression: 'laughing',
      }}
      at={{ x: 160, y: 8 }}
      size={200}
    />
  );
}

export { NightShiftScene, CorkboardScene as TeachScene } from './stories.js';
