# Sunny — Rive animator brief

**Version:** 1.0 · 2026-10-12
**For:** the animator building Sunny in Rive
**Decision record:** `docs/architecture/adr-007-character-runtime.md`

## 1. The job

Build Sunny, the mascot for an AI assistant that solar installers put on their
websites, as an interactive Rive character. Sunny sits in a chat launcher in the
corner of a web page, lives in the chat panel header, and appears large in the
marketing site's hero. Visitors should see Sunny and think _"I want that on my
website."_

The engineering team builds everything around the file: loading, the chat
logic, the state machine driver and accessibility. **You own how Sunny looks and
moves.** Part 5 is the only fixed technical contract; inside it, timing,
acting and staging are your call.

## 2. Reference and style

**Canonical artwork:** `sunny.png` (1254×1254, repo root). Rebuild it as clean
vectors; at rest, the Rive character should be indistinguishable from it.

Features that must survive:

- Vivid orange body (`#FF7900`) with a **heavy black ink outline**.
- **Eight rounded triangular rays, detached from the body** with a small gap,
  each with its own outline. They are not perfectly evenly spaced in the
  reference — match the reference.
- **Tall oval eyes** with cream whites (`#FFF1E5` or matched from the art),
  large black pupils looking up-right, and the **notched highlight** cut into
  each pupil.
- Small arched **brows**.
- A long, bold, **confident smile** with **cheek creases** at both ends — these
  carry much of the character's charm.

**Style:** early-1930s rubber-hose (Fleischer / early Disney influence),
restrained. Cheerful, confident, slightly cheeky. Expressive timing, squash and
stretch, elastic rays, overshoot and settle. **Not:** distressed or grainy
textures, a children's-game aesthetic, Fanta trademarks or bottle shapes, or
Sonic-style spins.

**Limbs and hands:** any ray can become a rubber-hose arm (a bendy tube, no
elbow) ending in a classic cartoon glove. **Please send two or three hand
designs for owner approval before rigging them.** When the arm retracts, the ray
must return to its exact rest shape and position.

**Palette (tokens):** brand orange `#FF7900`, deep orange `#FF6500`, soft orange
`#FFB066`, pale orange `#FFF1E5`, warm white `#FFFCF8`, ink `#171717`, muted
`#727272`.

## 3. Rig requirements

- **Body:** position, rotation, squash/stretch (mesh or bones), anticipation and
  overshoot.
- **Rays (×8):** independently transformable — wobble, spin as a ring, flare,
  droop — and each able to morph into an arm and back.
- **Eyes:** aim (2D, e.g. a joystick driven by `lookX`/`lookY`), blink,
  squint, widen. Highlights stay at the upper-left of the pupil as the eyes aim.
- **Brows:** raise, furrow, asymmetric (cheeky).
- **Mouth:** rest smile; at least: open talk shapes (2–3 for a speaking loop),
  grin, "o", wobbly uncertain, embarrassed.
- **Theme colour:** the body and ray fill must be recolourable at runtime
  (tenants pick orange, purple, green, blue or a custom colour). Outlines,
  eyes and mouth stay as drawn. Bind the body and ray fills to the `bodyColor`
  view model property (§5.2).
- **Props** attach to hands and are fully removed at the end of every sequence.

## 4. Sequences

Durations are guides, not limits. Every sequence must:

- **Be interruptible.** When `interrupt` fires, blend back to rest within
  about 150–250 ms. No props left behind, no ray left as an arm, no bent shapes.
- **End in exactly the rest pose** (so the next sequence starts clean).
- **Have a reduced-motion variant** (§5.3): a near-still version that conveys the
  same meaning with an expression change or a fade, no travel or spin.
- Read clearly at **64 px** (launcher) as well as **400 px** (hero).

### 4.1 Flagship — deliver first (milestone 1)

| ID  | Name                                                | Beats                                                                                                                                                                                                                                       | ~Duration                      |
| --- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| A01 | **Idle**                                            | Gentle breathing, rays with a faint lazy drift, occasional blink (randomised 3–7 s), eyes follow `lookX`/`lookY`. Every 15–30 s a small personality beat (glance around, a brow raise). Sparse — must never feel busy on a customer's site. | loop                           |
| —   | **Listening**                                       | Perks up: slight lean forward, eyes widen and look at the panel, rays lift.                                                                                                                                                                 | ~0.6 s then hold               |
| A02 | **Thinking → eureka**                               | Rays rotate slowly as a ring; one ray becomes an arm and strokes the "chin"; another becomes a bobbing "?" over the head. Eureka: eyes pop, "?" turns to a spark or bulb, rays flare, settle.                                               | loop + 1.2 s eureka            |
| —   | **Speaking**                                        | Mouth talk cycle with small body bounce on emphasis.                                                                                                                                                                                        | loop                           |
| A03 | **Sunglasses**                                      | An arm reaches off-frame, pulls out shades, flips them on with a cheeky grin and a brow raise; holds; takes them off and tucks them away.                                                                                                   | ~2.5 s                         |
| A12 | **Charge a panel**                                  | A small solar panel unfolds from a hand, Sunny beams light onto it, a battery or phone fills with a satisfying level-up, thumbs-up, panel folds away.                                                                                       | ~3 s                           |
| —   | **Bubble open** (the chat opening — most important) | From launcher size: Sunny reacts to the click (squash, eyes up), small fizzy bubbles rise, a bubble expands (the panel opens in code underneath — see §5.4), Sunny lands in the header avatar spot and gives a small wave or smile.         | **400–650 ms**, must feel fast |

### 4.2 Supporting states

| Name           | Beats                                                        |
| -------------- | ------------------------------------------------------------ |
| Guiding        | Ray-arm points in a direction set by `pointAngle` (degrees). |
| Celebrating    | Elastic bounce, rays flare, a small sparkle burst.           |
| Confused       | Head tilt, wobbly mouth, one brow up, a little shrug.        |
| Error          | Brief deflate and apologetic look, recover.                  |
| Relaxing (A04) | See §4.3.                                                    |

### 4.3 Library — milestone 2 onwards

| ID  | Name                  | Notes                                                                                        |
| --- | --------------------- | -------------------------------------------------------------------------------------------- |
| A04 | Deckchair             | Chair unfolds, shades on, relax; stops immediately on any interaction.                       |
| A05 | Balloon               | Balloon floats, gaze follows it; tap to pop (pop position from `popX`/`popY`).               |
| A07 | Shuffle, run, dance   | Three separate short moves.                                                                  |
| A10 | Arcade spin           | Original fast roll; returns to the exact rest pose.                                          |
| A11 | Plant a flower        | Seed, shine on it, sprout, flower blooms.                                                    |
| A13 | Kickflip              | Mini skateboard, flip, wobble on landing.                                                    |
| A14 | Barrel roll           | 360° roll.                                                                                   |
| A15 | **Melting ice cream** | Signature comedy beat: pulls out an ice cream, Sunny's own heat melts it, embarrassed smile. |
| A16 | Rubik's cube          | Turns faces, solves it.                                                                      |
| A17 | Impossible cube       | Turns it, gets confused, shrugs — clearly playful, not a real solver.                        |
| A18 | Seasonal              | Spring/summer/autumn/winter accessories (opt-in, controlled by `season`).                    |

Games (tic-tac-toe, ping pong, Space Invaders) are built in code; Sunny only
needs **reaction** moments for them: think, win, lose, draw, and a paddle-arm
pose for ping pong. List those separately in your estimate.

## 5. Technical contract

The engineering team will code against exactly these names. If anything here
does not suit how you want to build it, say so **before** rigging — renaming
later is cheap for neither side. The code-side copy of this contract is
`packages/character-rive/src/contract.ts`, and a test fails if the two drift.

The contract is **data binding only**: one view model, auto-bound, drives the
state machine and carries signals back. Do not use state machine inputs or Rive
Events for anything in this list — Rive's documentation marks Events as
deprecated in favour of data binding, and state machine transitions are
conditioned on data-bound properties.

### 5.1 Files, artboards and runtime limits

| File              | Artboard | Contents                                                      |
| ----------------- | -------- | ------------------------------------------------------------- |
| `sunny.riv`       | `Sunny`  | Character, §4.1 and §4.2. Must stay small — target ≤ 150 KB.  |
| `sunny-props.riv` | `Sunny`  | Same character plus §4.3 library and props. Loaded on demand. |

- Square artboard, 500 × 500. At rest the character (ray tip to ray tip) fills
  the centre ~60%, leaving room for props, arms and bubbles inside the frame.
- One state machine per artboard, named **`SunnyMachine`**.
- One view model, named **`SunnyVM`**, set as the artboard's default with a
  default instance (the app binds it with `autoBind`).
- The site plays the file with Rive's **`@rive-app/canvas-lite`** runtime, the
  smallest web runtime. So, **do not use:** Rive Text, Layouts, Scripting,
  Audio or Vector Feathering — that runtime does not draw them. No embedded
  raster images, no fonts.
- Deliver the `.rev` source file with each `.riv` export.

### 5.2 View model properties the app writes (app → Rive)

| Property                                                      | Type    | Meaning                                                                                                                                                                      |
| ------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state`                                                       | Enum    | Behavioural state, values exactly: `idle`, `listening`, `thinking`, `speaking`, `guiding`, `celebrating`, `confused`, `relaxing`, `playing`, `error`. A change blends to it. |
| `intensity`                                                   | Enum    | `off`, `minimal`, `balanced`, `playful`. Scales amplitude/frequency of idle personality and chooses moment variants where you provide them.                                  |
| `season`                                                      | Enum    | `none`, `spring`, `summer`, `autumn`, `winter`.                                                                                                                              |
| `reducedMotion`                                               | Boolean | When true, use reduced-motion variants (§5.3).                                                                                                                               |
| `lookX`, `lookY`                                              | Number  | Eye aim, −100…100, 0 = straight ahead.                                                                                                                                       |
| `pointAngle`                                                  | Number  | Guiding direction in degrees, 0 = up, clockwise, 0…360.                                                                                                                      |
| `popX`, `popY`                                                | Number  | Where the balloon pop lands, in artboard coordinates.                                                                                                                        |
| `bodyColor`                                                   | Color   | Theme colour for body and rays. Always fully opaque.                                                                                                                         |
| `interrupt`                                                   | Trigger | Stop the current moment and blend to rest within ~150–250 ms.                                                                                                                |
| `eureka`, `sunglasses`, `charge`, `open`, `celebrate`, `spin` | Trigger | One-shot moments (§4.1/§4.2).                                                                                                                                                |
| Library triggers                                              | Trigger | `deckchair`, `balloon`, `pop`, `shuffle`, `run`, `dance`, `roll`, `flower`, `kickflip`, `barrelRoll`, `iceCream`, `rubiks`, `impossibleCube` — in `sunny-props.riv` only.    |

### 5.3 Reduced motion and intensity

- `reducedMotion` true: no body travel, no spinning, no bubbles. Expression
  changes and short cross-fades only. Blinks are fine.
- `intensity` `off`: hold the rest pose; blink only.
- `intensity` `minimal`: idle breathing and blinks, no personality beats.

### 5.4 View model properties the file sets (Rive → app)

Signals back to the app are **view model triggers** that the state machine
fires (for example from a state's entry or a timeline key). The app observes
them.

| Property         | Type    | Fire when                                                                                                 |
| ---------------- | ------- | --------------------------------------------------------------------------------------------------------- |
| `moment`         | String  | Set to the trigger name of the one-shot moment (e.g. `iceCream`) **before** firing either trigger below.  |
| `momentStarted`  | Trigger | A one-shot moment begins.                                                                                 |
| `momentFinished` | Trigger | It has fully returned to rest with props cleared.                                                         |
| `openExpand`     | Trigger | In the bubble-open moment, the frame the bubble starts expanding — the app opens the panel on this frame. |
| `openSettled`    | Trigger | Sunny has landed in the header position.                                                                  |
| `popHit`         | Trigger | The balloon burst.                                                                                        |

## 6. Acceptance

For each delivery:

1. **Rest pose:** side by side with `sunny.png` at 400 px, reviewed and
   approved by the owner.
2. **Each sequence** recorded as a video at 64 px and 400 px, approved by the
   owner.
3. **Interrupt test:** firing `interrupt` at any point of any moment returns to
   rest cleanly — the engineering team automates this check.
4. **Reduced motion:** each moment has its reduced variant.
5. **Performance:** 60 fps on a mid-range laptop and a mid-range phone in the
   engineering team's test page; file size within §5.1.
6. **Contract:** every name in §5 exists and behaves as described.

## 7. Delivery plan

| Milestone | Contents                                                                                             |
| --------- | ---------------------------------------------------------------------------------------------------- |
| M0        | Vector rebuild of the rest pose; 2–3 glove/hand options; rig test with eyes and blink. Owner review. |
| M1        | Everything in §4.1 and §4.2, wired to §5. Owner review.                                              |
| M2        | §4.3 library and game reactions, in `sunny-props.riv`.                                               |

Please quote per milestone, and flag anything in this brief that you would
change.
