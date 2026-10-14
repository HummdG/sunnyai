import { SEQUENCE_BY_ID } from '@sunny/animation-engine';
import {
  defaultRig,
  limbPose,
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
   * (reading, typing, the deckchair) rather than a bare stance.
   */
  act?: string;
  at?: number;
  /** The moment played once when the scene comes into view, and on hover. */
  play?: string;
  /** Face the other way. */
  flip?: boolean;
  /** Lean the whole body, in degrees. */
  lean?: number;
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
  return rig;
}

/** A prop held at full strength. */
export function held(id: PropRig['id'], x: number, y: number, rotation = 0, scale = 1.6): PropRig {
  return { id, x, y, rotation, scale, opacity: 1 };
}
