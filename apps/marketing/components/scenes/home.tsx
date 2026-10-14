import {
  BrowserFrame,
  Birds,
  Clock,
  Cloud,
  CopyLines,
  DOTS_FINE,
  Desk,
  Door,
  Easel,
  Ground,
  House,
  INK,
  Lamp,
  Laptop,
  LINE,
  Mug,
  NightWindow,
  ORANGE,
  PAINT_COLOURS,
  PaintPots,
  PackageCard,
  PALE,
  Rosette,
  ScriptTag,
  Shelf,
  SolarPanel,
  Sunburst,
  Van,
} from './kit.js';
import { Scene } from './scene.js';
import { held } from './still.js';

/**
 * The home page's scenes, one per section. Each is a little stage direction:
 * the set, where Sunny stands, what Sunny is doing, and the moment it plays
 * when it comes into view.
 */

/** The hero: Sunny stepping out of an installer's website to say hello. */
export function HeroScene(): React.JSX.Element {
  return (
    <Scene
      width={560}
      height={480}
      label="Sunny, a cartoon sun, waving hello from the corner of a solar installer's website, with houses and solar panels on the hill behind."
      testId="hero-stage"
      back={
        <>
          <Sunburst x={410} y={300} r={260} count={28} />
          <Cloud x={420} y={58} s={0.9} />
          <Ground y={420} width={560} />
          <House x={34} y={346} w={104} h={60} panels={2} door={false} />
          <BrowserFrame x={40} y={50} w={400} h={290}>
            <rect
              x={20}
              y={20}
              width={360}
              height={110}
              rx={8}
              fill={PALE}
              {...LINE}
              strokeWidth={1.8}
            />
            <SolarPanel x={210} y={46} w={120} h={56} skew={-14} />
            <CopyLines x={34} y={44} w={150} lines={2} />
            <CopyLines x={20} y={150} w={200} lines={3} heading={false} />
            <rect
              x={20}
              y={206}
              width={96}
              height={26}
              rx={13}
              fill={ORANGE}
              {...LINE}
              strokeWidth={1.8}
            />
          </BrowserFrame>
        </>
      }
      sunny={{ pose: 'wave', play: 'listening-perk', lean: -4 }}
      at={{ x: 300, y: 196 }}
      size={250}
    />
  );
}

/**
 * Day and night: a desk at two in the morning, a visitor's question on the
 * laptop and Sunny glowing beside it with the answer -- the light that is on
 * when the office is closed.
 */
export function NightShiftScene(): React.JSX.Element {
  return (
    <Scene
      width={560}
      height={420}
      shadow={false}
      label="A desk at night under a lamp: on the laptop, a visitor's question is being answered, and Sunny glows beside it while the clock reads two o'clock."
      back={
        <>
          <rect x={0} y={0} width={560} height={420} fill="#F3E4C8" />
          <rect x={0} y={0} width={560} height={420} fill={DOTS_FINE} opacity={0.5} />
          <NightWindow x={330} y={44} w={180} h={150} />
          <Clock x={100} y={92} r={32} />
          <Sunburst x={268} y={190} r={150} count={20} fill="#FFE7A6" />
        </>
      }
      front={
        <>
          <Lamp x={40} y={316} />
          <Desk x={20} y={316} w={520} />
          <Laptop x={70} y={316} w={170} />
          <Mug x={470} y={316} />
          <g transform="translate(250 196)">
            <path
              d="M0 0Q14 -16 34 -12"
              fill="none"
              stroke={INK}
              strokeWidth={2}
              strokeDasharray="2 5"
              strokeLinecap="round"
            />
          </g>
        </>
      }
      sunny={{ pose: 'rest', play: 'gesture-nod', look: { x: -0.7, y: 0.5 }, tilt: -6, grin: 1.15 }}
      at={{ x: 250, y: 100 }}
      size={190}
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
          <House x={300} y={250} w={200} h={120} panels={3} />
        </>
      }
      sunny={{
        pose: 'magnify',
        act: 'lookup-magnify',
        at: 0.25,
        play: 'lookup-magnify',
        props: [held('clipboard', 66, -6, 10)],
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
      sunny={{ pose: 'rest', play: 'gesture-nod', look: { x: 0.1, y: 0.8 }, tilt: 4, grin: 1.2 }}
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
      sunny={{ pose: 'hold', play: 'gesture-point', props: [held('envelope', 72, -2, -10, 1.8)] }}
      at={{ x: 40, y: 140 }}
      size={250}
    />
  );
}

/** Storyboard panel one: one line of code, pinned to the page. */
export function PasteScene(): React.JSX.Element {
  return (
    <Scene
      width={300}
      height={240}
      label="Sunny pins a big script tag onto a web page."
      back={
        <>
          <BrowserFrame x={20} y={20} w={190} h={150}>
            <CopyLines x={16} y={18} w={120} lines={3} />
          </BrowserFrame>
          <ScriptTag x={44} y={150} />
        </>
      }
      sunny={{ pose: 'thumbsUp', play: 'gesture-nod' }}
      at={{ x: 170, y: 70 }}
      size={150}
    />
  );
}

/** Storyboard panel two: Sunny reading up on your business. */
export function TeachScene(): React.JSX.Element {
  return (
    <Scene
      width={300}
      height={240}
      label="Sunny sits reading a book in front of a bookshelf."
      back={
        <>
          <Shelf x={30} y={70} w={240} />
          <Ground y={214} width={300} bulge={4} />
        </>
      }
      sunny={{ pose: 'hips', act: 'lookup-book', at: 0.3, play: 'lookup-book' }}
      at={{ x: 70, y: 66 }}
      size={160}
    />
  );
}

/** Storyboard panel three: the door opens and Sunny says hello. */
export function WelcomeScene(): React.JSX.Element {
  return (
    <Scene
      width={300}
      height={240}
      label="Sunny waves hello at an open door."
      back={
        <>
          <Ground y={214} width={300} bulge={4} />
          <Door x={180} y={210} />
        </>
      }
      sunny={{ pose: 'wave', play: 'listening-perk' }}
      at={{ x: 20, y: 60 }}
      size={160}
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
      sunny={{ pose: 'hold', play: 'gesture-palm', props: [held('paintbrush', 66, -10, 28, 1.9)] }}
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
          <Ground y={330} width={520} bulge={6} />
          <House x={18} y={250} w={130} h={84} panels={2} door={false} />
          <House x={196} y={262} w={130} h={74} panels={2} roof="#FFD0A6" />
          <House x={372} y={246} w={130} h={88} panels={3} door={false} />
        </>
      }
      sunny={{ pose: 'rest', play: 'celebrate-bounce', look: { x: 0, y: -0.2 }, grin: 1.25 }}
      at={{ x: 160, y: 50 }}
      size={200}
    />
  );
}
