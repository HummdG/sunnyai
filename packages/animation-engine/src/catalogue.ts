import { GROUPS, SEQUENCES } from './sequences.js';

/**
 * The animation catalogue: every behavioural moment Sunny has, named and
 * described for a human.
 *
 * `sequences.ts` is the machine's vocabulary -- groups, variants, priorities.
 * This is the same set of moments written for the people who have to make
 * decisions about them: a tenant asking what their assistant can do, the
 * animation gallery the marketing site is meant to show, and the person adding
 * the next animation.
 *
 * The two are kept in step by a test rather than by discipline. Every group must
 * have exactly one entry here and every entry must name a group that exists, so
 * an animation cannot be added without being described, and a description cannot
 * outlive the animation it describes. That bijection is the whole reason this is
 * a file rather than a paragraph in a document that drifts.
 *
 * It is also where the honest answer to "is this reachable?" lives. A group
 * exists because the engine has a variant for it; whether anything ever *asks*
 * for it is a separate fact, and one that had never been written down. Two
 * moments turned out to have no caller at all -- see `asked`.
 */

/** What kind of thing the moment is, for grouping a gallery or a settings page. */
export type CatalogueCategory =
  /** Something Sunny does on its own, unprompted. */
  | 'reflex'
  /** The resting layer underneath everything else. */
  | 'ambient'
  /** Part of holding a conversation: listening, thinking, speaking, pointing. */
  | 'conversation'
  /** A reaction to something that happened. */
  | 'reaction'
  /** Something the visitor started, played out by Sunny. */
  | 'play';

/**
 * Who asks for this moment today.
 *
 * - `engine`: the engine requests it itself, from the event named in `askedBy`.
 * - `gesture`: the engine asks for it in response to a pointer gesture, through
 *   `SunnyAnimator.tap()`. The engine owns the response and the host owns the
 *   input, so the moment exists in the engine and still needs wiring: nothing
 *   forwards a pointer gesture yet.
 * - `app`: nothing in the engine asks for it; an application has to call
 *   `SunnyAnimator.play(group)`. Nothing does yet.
 * - `nobody`: no caller exists. The animation is implemented, tested and
 *   unreachable in production, which is a fact worth stating rather than
 *   discovering.
 */
export type AskState = 'engine' | 'gesture' | 'app' | 'nobody';

export interface CatalogueEntry {
  /** The group name an application uses to ask for this moment. */
  group: string;
  /** A short human name, for a gallery label. */
  name: string;
  /** One sentence on what the visitor sees. */
  description: string;
  category: CatalogueCategory;
  /** Who asks for it today. See `AskState`. */
  asked: AskState;
  /**
   * The application event that asks for it, when one does. Absent for the
   * ambient layers, which play because of the state rather than an event, for
   * the moments a gesture asks for, and for the moments nothing asks for.
   */
  askedBy?: string;
  /**
   * Present when `asked` is not `engine`: what is missing, stated plainly enough
   * that whoever picks it up does not have to rediscover it.
   */
  note?: string;
}

export const CATALOGUE: readonly CatalogueEntry[] = [
  {
    group: 'blink',
    name: 'Blink',
    description: 'A reflex: the eyes close for a moment and open again, on a seeded cadence.',
    category: 'reflex',
    asked: 'engine',
    askedBy: 'the animator’s own blink timer',
  },
  {
    group: 'idle',
    name: 'Resting',
    description: 'Breathing and glancing around at nothing in particular. Deliberately sparse.',
    category: 'ambient',
    asked: 'engine',
    askedBy: 'the ambient layer of the idle and relaxing states',
  },
  {
    group: 'listen',
    name: 'Listening',
    description: 'A small perk of attention when the visitor arrives or starts typing.',
    category: 'conversation',
    asked: 'nobody',
    note:
      '`attention` requests `open`, and the listening state’s ambient layer is the idle ' +
      'group, so nothing ever asks for the perk. Either the listening state’s ambient ' +
      'should be this group, or `attention` should request both.',
  },
  {
    group: 'think',
    name: 'Thinking',
    description: 'The rays turn while the answer is being worked out.',
    category: 'conversation',
    asked: 'engine',
    askedBy: 'the ambient layer of the thinking state',
  },
  {
    group: 'eureka',
    name: 'Eureka',
    description: 'The answer arrives: a question mark turns into a spark.',
    category: 'conversation',
    asked: 'engine',
    askedBy: '`speaking_started` when it follows thinking',
  },
  {
    group: 'speak',
    name: 'Speaking',
    description:
      'A gentle pulse while the answer streams in, so the character is never still ' +
      'while it is the one talking.',
    category: 'conversation',
    asked: 'engine',
    askedBy: 'the ambient layer of the speaking state',
  },
  {
    group: 'guide',
    name: 'Pointing',
    description: 'Sunny points at the part of the host page the answer refers to.',
    category: 'conversation',
    asked: 'engine',
    askedBy: '`guiding_started`',
  },
  {
    group: 'charge',
    name: 'Charging a panel',
    description: 'A solar panel unfolds, a beam of sunlight lands on it and the battery fills.',
    category: 'conversation',
    asked: 'nobody',
    note:
      'A12, and one of the plan’s five flagship sequences. Nothing requests the group: it ' +
      'belongs to the solar-education moment, and no tool or stream event has been wired ' +
      'to it yet.',
  },
  {
    group: 'open',
    name: 'The bubble opens',
    description: 'The launcher bubbles open into the panel, and Sunny settles into the header.',
    category: 'conversation',
    asked: 'engine',
    askedBy: '`attention`',
  },
  {
    group: 'celebrate',
    name: 'Celebration',
    description: 'Something went well for the visitor, and Sunny enjoys it.',
    category: 'reaction',
    asked: 'engine',
    askedBy: '`celebrate`',
  },
  {
    group: 'cool',
    name: 'Sunglasses',
    description: 'Sunny has done something well and knows it. The shades come out.',
    category: 'reaction',
    asked: 'engine',
    askedBy: '`impress`',
  },
  {
    group: 'confused',
    name: 'Confusion',
    description: 'A question landed badly, or the answer is genuinely uncertain.',
    category: 'reaction',
    asked: 'engine',
    askedBy: '`confused`',
  },
  {
    group: 'error',
    name: 'Something went wrong',
    description: 'The turn failed. A sweat drop, a deflate, and a recovery back to rest.',
    category: 'reaction',
    asked: 'engine',
    askedBy: '`turn_failed`',
  },
  {
    group: 'celebrate-glow',
    name: 'Glowing',
    description: 'After a celebration: a happy little bounce with fists pumping, eyes squinting.',
    category: 'ambient',
    asked: 'engine',
    askedBy: 'the ambient layer of the celebrating state',
  },
  {
    group: 'ponder',
    name: 'Pondering',
    description: 'After a double take: a slow puzzled sway, one brow up, scratching the chin.',
    category: 'ambient',
    asked: 'engine',
    askedBy: 'the ambient layer of the confused state',
  },
  {
    group: 'droop',
    name: 'Drooping',
    description:
      'After an error: slumped with the rays hanging, breathing slowly until the next turn.',
    category: 'ambient',
    asked: 'engine',
    askedBy: 'the ambient layer of the error state',
  },
  {
    group: 'play',
    name: 'Playing along',
    description:
      'A short burst of showing off when a game starts: a shuffle, a run or a dance, ' +
      'depending on the tenant’s motion setting.',
    category: 'play',
    asked: 'engine',
    askedBy: '`play_started`',
  },
  {
    group: 'arcade',
    name: 'Arcade spin',
    description:
      'Her rays fold flat and she rolls: a whole turn at a walking pace, or two fast ' +
      'revolutions with a hop, depending on the tenant’s motion setting.',
    category: 'play',
    asked: 'engine',
    askedBy: '`spin` — a wave cleared in an arcade game',
  },
  {
    group: 'relax',
    name: 'Taking a break',
    description:
      'The visitor closes the chat and Sunny gets a deckchair out: it unfolds, she ' +
      'lies back, and at the stronger settings the shades come down or she dozes off.',
    category: 'ambient',
    asked: 'engine',
    askedBy: '`dismissed`',
  },
  {
    group: 'balloon',
    name: 'The balloon',
    description:
      'A balloon comes up out of her hands and floats there while she watches it, then ' +
      'is let go.',
    category: 'play',
    asked: 'gesture',
    note:
      'The engine asks for this when `SunnyAnimator.tap()` is called with a point on ' +
      'the body, so the host has to forward a pointer gesture. Nothing in the widget ' +
      'does yet, and until one does a tap on the character does nothing at all.',
  },
  {
    group: 'pop',
    name: 'Popping it',
    description: 'The balloon bursts where the visitor touched it, and she flinches.',
    category: 'play',
    asked: 'gesture',
    note:
      'Reached by tapping the balloon rather than the body, so it needs the same ' +
      'forwarded gesture the float does. The burst is drawn at the point the visitor ' +
      'touched instead of at a position the moment chose for itself, which is the ' +
      'reason the scheduler carries an anchor.',
  },
  {
    group: 'bloom',
    name: 'Planting a flower',
    description:
      'A seed drops into the ground beside her, her rays stretch over it, a shoot comes ' +
      'up out of the soil and opens into a flower.',
    category: 'play',
    asked: 'app',
    note:
      'The solar showcase (A11), and nothing in the engine asks for it. It has no ' +
      'event because it is not a response to anything: an application calls ' +
      '`SunnyAnimator.play("bloom")` when it wants to show a visitor what sunlight ' +
      'does, which is a decision no machine event could make.',
  },
];

/** The entry for a group, or undefined when the group is not catalogued. */
export function catalogueEntry(group: string): CatalogueEntry | undefined {
  return CATALOGUE.find((entry) => entry.group === group);
}

/** Every sequence that belongs to a catalogued moment, strongest first. */
export function sequencesForGroup(group: string): readonly string[] {
  return SEQUENCES.filter((sequence) => sequence.group === group)
    .sort((a, b) => b.priority - a.priority)
    .map((sequence) => sequence.id);
}

/**
 * The groups the engine never asks for by itself, at any intensity: no event
 * requests them, so a host has to. What they need stated is *wiring* rather than
 * implementation, which is a different fact from being unreachable -- see below.
 */
export const UNWIRED_GROUPS: readonly string[] = CATALOGUE.filter(
  (entry) => entry.asked !== 'engine',
).map((entry) => entry.group);

/** The groups with no caller, so "unreachable" is a query rather than a guess. */
export const UNREACHABLE_GROUPS: readonly string[] = CATALOGUE.filter(
  (entry) => entry.asked === 'nobody',
).map((entry) => entry.group);

/** Groups the catalogue knows about but the engine does not, or vice versa. */
export function catalogueGaps(): { undocumented: string[]; orphaned: string[] } {
  const documented = new Set(CATALOGUE.map((entry) => entry.group));
  const existing = new Set<string>(GROUPS);
  return {
    undocumented: GROUPS.filter((group) => !documented.has(group)),
    orphaned: CATALOGUE.filter((entry) => !existing.has(entry.group)).map((entry) => entry.group),
  };
}
