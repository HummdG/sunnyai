import {
  BrowserFrame,
  Cloud,
  CopyLines,
  Desk,
  Door,
  Easel,
  Ground,
  House,
  INK,
  Lamp,
  LINE,
  Moon,
  ORANGE,
  PAINT_COLOURS,
  PaintPots,
  PALE,
  PAPER,
  ScriptTag,
  Shelf,
  SolarPanel,
  Stand,
  Stars,
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
          <House x={30} y={360} w={110} h={64} panels={2} door={false} />
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

/** Day and night: Sunny at the desk under the lamp, answering at 2am. */
export function NightShiftScene(): React.JSX.Element {
  return (
    <Scene
      width={560}
      height={420}
      label="Night time: Sunny sits at a desk under a lamp, typing on a laptop, while the clock on the wall reads two o'clock."
      back={
        <>
          <rect x={0} y={0} width={560} height={420} fill={INK} />
          <Moon x={470} y={78} r={30} />
          <Stars
            points={[
              [60, 60],
              [140, 110],
              [250, 50],
              [380, 120],
              [520, 170],
              [330, 80],
              [90, 170],
            ]}
          />
          <House x={360} y={300} w={150} h={90} lit panels={2} door={false} />
          <g transform="translate(110 120)">
            <circle r={34} fill={PAPER} {...LINE} />
            <path d="M0 0V-22M0 0L16 9" {...LINE} strokeWidth={3.4} />
            <circle r={3} fill={INK} />
          </g>
        </>
      }
      front={
        <>
          <Lamp x={70} y={296} />
          <Desk x={40} y={296} w={300} />
        </>
      }
      sunny={{ pose: 'hips', act: 'lookup-laptop', at: 0.2, play: 'lookup-laptop' }}
      at={{ x: 92, y: 120 }}
      size={210}
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

/** Recommending: three packages on stands, Sunny presenting the middle one. */
export function RecommendScene(): React.JSX.Element {
  return (
    <Scene
      width={560}
      height={420}
      label="Sunny presents three solar packages on stands labelled Good, Better and Best."
      back={
        <>
          <Ground y={380} width={560} bulge={8} />
          <Stand x={110} y={290} label="Good" tall={60}>
            <SolarPanel x={-30} y={-34} w={60} h={30} skew={-12} />
          </Stand>
          <Stand x={220} y={260} label="Better" tall={90}>
            <SolarPanel x={-34} y={-38} w={68} h={34} skew={-12} />
          </Stand>
          <Stand x={330} y={300} label="Best" tall={50}>
            <SolarPanel x={-38} y={-44} w={76} h={38} skew={-12} />
            <rect
              x={-12}
              y={-80}
              width={24}
              height={30}
              rx={4}
              fill={PALE}
              {...LINE}
              strokeWidth={1.8}
            />
          </Stand>
        </>
      }
      sunny={{ pose: 'present', play: 'gesture-palm' }}
      at={{ x: 330, y: 150 }}
      size={240}
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

/** The call to action: Sunny on a rooftop among the panels. Bare, on orange. */
export function RooftopScene(): React.JSX.Element {
  return (
    <Scene
      width={520}
      height={360}
      bare
      label="Sunny cheers on a rooftop covered in solar panels."
      back={
        <>
          <Cloud x={30} y={40} s={0.8} />
          <Cloud x={380} y={70} s={0.6} />
          <House x={70} y={262} w={380} h={78} panels={0} door={false} roof={PAPER} />
          <SolarPanel x={156} y={214} w={64} h={30} skew={-30} />
          <SolarPanel x={300} y={214} w={64} h={30} skew={30} />
        </>
      }
      sunny={{ pose: 'cheer', play: 'celebrate-bounce' }}
      at={{ x: 180, y: 34 }}
      size={160}
    />
  );
}
