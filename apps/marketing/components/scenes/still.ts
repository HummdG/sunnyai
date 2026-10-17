import { SEQUENCE_BY_ID } from '@sunny/animation-engine';
import {
  defaultRig,
  limbPose,
  withExpression,
  type ExpressionName,
  type LimbPoseName,
  type PropRig,
  type SunnyRig,
} from '@sunny/character';

/**
 * How a scene directs its Sunny: a stance, what it is holding, and the moment
 * it performs. Plain data, so it crosses from the server scene to the client.
 */
export interface SunnyDirection {
  /** The stance, from the pose library. */
  pose: LimbPoseName;
  /** Props in Sunny's hands, in the body frame (see `render.ts` for the art). */
  props?: PropRig[];
  /**
   * A sequence whose frame at `at` is the still: for a pose with acting in it
   * (reading, typing) rather than a bare stance.
   */
  act?: string;
  at?: number;
  /** The moment played once when the scene comes into view, and on hover. */
  play?: string;
  /** Face the other way. */
  flip?: boolean;
  /** Lean the whole body, in degrees. */
  lean?: number;
  /**
   * Where Sunny is looking, each axis -1..1 (+x right, +y down): at the thing
   * the scene is about, so the picture has a point of attention.
   */
  look?: { x: number; y: number };
  /** Tilt the head, in degrees. */
  tilt?: number;
  /**
   * The face Sunny pulls, from the character's expression library: the one
   * that fits what the scene is about. Omitted, Sunny wears the logo's face.
   */
  expression?: ExpressionName;
}

/**
 * Whether Sunny is drawn turned to face the other way. Asked for by `flip`,
 * and also whenever a scene has him looking left: the reference's pupils are
 * drawn looking right, and they cannot look left without looking wrong (a
 * slid pupil squeezes against the rim, a mirrored one looked derpy), so he
 * turns instead -- the whole character mirrored, as an animator would turn
 * him. Never with props, whose lettering would read backwards.
 */
export function turnsAway(direction: SunnyDirection): boolean {
  return !!direction.flip || ((direction.look?.x ?? 0) < -0.3 && !(direction.props?.length ?? 0));
}

/** The still Sunny of a scene direction. Pure: the server and client agree. */
export function stillRig(direction: SunnyDirection): SunnyRig {
  const base = defaultRig();
  base.limbs = limbPose(direction.pose);
  base.props = direction.props ?? [];
  if (direction.lean) base.rotation = direction.lean;
  const act = direction.act ? SEQUENCE_BY_ID.get(direction.act) : undefined;
  const rig = act ? act.pose(base, direction.at ?? 0.3) : base;
  if (act && direction.props) rig.props = [...rig.props, ...direction.props];
  if (direction.look) {
    // A turned Sunny is drawn mirrored, so a look to the left is a look to
    // his own side in the drawing.
    const look =
      turnsAway(direction) && !direction.flip
        ? { x: -direction.look.x, y: direction.look.y }
        : direction.look;
    rig.eyes.left.gaze = { ...look };
    rig.eyes.right.gaze = { ...look };
  }
  if (direction.tilt) rig.faceTilt += direction.tilt;
  // The expression goes on last, so a scene's `look` is the default gaze and
  // an expression that has somewhere of its own to look (thinking looks up)
  // wins.
  return direction.expression ? withExpression(rig, direction.expression) : rig;
}

/** A prop held at full strength. */
export function held(id: PropRig['id'], x: number, y: number, rotation = 0, scale = 1.6): PropRig {
  return { id, x, y, rotation, scale, opacity: 1 };
}
