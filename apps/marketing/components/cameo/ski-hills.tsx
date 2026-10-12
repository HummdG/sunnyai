'use client';

import {
  cloneRig,
  createSunnyView,
  defaultRig,
  limbPose,
  toViewBox,
  type SunnyRig,
} from '@sunny/character';
import { useEffect, useRef, useState } from 'react';

import { Hills } from '../hills.js';
import { SpeechBubble } from './sunny-cameo.js';
import { joinStage, openChat, prefersReducedMotion } from './stage.js';

/**
 * The hills with a mini Sunny skiing down them (owner's brief, 2026-10-12):
 * Sunny skis in, hops a crest, lands in a puff, skids to a stop and says
 * something, then pushes off and skis out. Clicking Sunny (or the bubble)
 * opens the chat. Sunny rides the front hill's real surface: the same curve
 * `hills.tsx` draws, read at the hill's current scroll offset.
 */

const COPY = "Don't let your savings go downhill — chat with me!";

// The front hill in `hills.tsx`: wave(16, 140, 2.4) over a 2880-unit strip
// drawn at 200% of the container's width, eight quadratic segments of 360.
const FRONT = { base: 140, amp: 16, phase: 2.4, segment: 360, strip: 2880, height: 200 };

/** Height (units, y down) and slope (dy/du) of the front hill at strip unit `u`. */
function frontHill(u: number): { y: number; slope: number } {
  const x = ((u % FRONT.strip) + FRONT.strip) % FRONT.strip;
  const seg = Math.floor(x / FRONT.segment);
  const t = (x - seg * FRONT.segment) / FRONT.segment;
  const up = seg % 2 === 0 ? -1 : 1;
  const y0 = FRONT.base + Math.sin(FRONT.phase) * FRONT.amp;
  const cy = FRONT.base + up * FRONT.amp * 1.6 + Math.sin(FRONT.phase) * FRONT.amp * 0.2;
  return {
    y: y0 + 2 * t * (1 - t) * (cy - y0),
    slope: (2 * (1 - 2 * t) * (cy - y0)) / FRONT.segment,
  };
}

/** Knees bent, hands forward on the poles: the skiing stance. */
function skiRig(): SunnyRig {
  const rig = cloneRig(defaultRig());
  const limbs = limbPose('rest');
  // The side rays become arms on the poles and the lower rays become legs on
  // the skis (`morph: 1`): Sunny's limbs are always its own rays.
  limbs.arms.left = {
    ...limbs.arms.left,
    hand: { x: -50, y: 40 },
    shape: 'fist',
    bend: -0.25,
    morph: 1,
  };
  limbs.arms.right = {
    ...limbs.arms.right,
    hand: { x: 54, y: 36 },
    shape: 'fist',
    bend: 0.25,
    morph: 1,
  };
  limbs.legs.left = { ...limbs.legs.left, foot: { x: -16, y: 80 }, bend: 0.45, morph: 1 };
  limbs.legs.right = { ...limbs.legs.right, foot: { x: 18, y: 80 }, bend: -0.45, morph: 1 };
  rig.limbs = limbs;
  return rig;
}

const ease = (t: number): number => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;
const easeIn = (t: number): number => Math.min(1, Math.max(0, t)) ** 2;

type Phase = 'in' | 'stop' | 'out' | 'wait';
const PHASES: ReadonlyArray<[Phase, number]> = [
  ['in', 4600],
  ['stop', 7000],
  ['out', 2200],
  ['wait', 2600],
];
const CYCLE = PHASES.reduce((sum, [, ms]) => sum + ms, 0);

function phaseAt(ms: number): { phase: Phase; p: number } {
  let t = ms % CYCLE;
  for (const [phase, duration] of PHASES) {
    if (t < duration) return { phase, p: t / duration };
    t -= duration;
  }
  return { phase: 'wait', p: 1 };
}

export function SkiHills(): React.JSX.Element {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const skierRef = useRef<HTMLButtonElement | null>(null);
  const figureRef = useRef<HTMLSpanElement | null>(null);
  const sunnyRef = useRef<HTMLSpanElement | null>(null);
  const polesRef = useRef<SVGGElement | null>(null);
  const [talking, setTalking] = useState(false);

  useEffect(() => {
    const stageEl = stageRef.current;
    const skier = skierRef.current;
    const figure = figureRef.current;
    const sunnyHost = sunnyRef.current;
    const poles = polesRef.current;
    if (!stageEl || !skier || !figure || !sunnyHost || !poles) return;

    const view = createSunnyView(sunnyHost, { decorative: true });
    const reduced = prefersReducedMotion();
    const front = stageEl.querySelector<SVGElement>('.hill-front');
    const roll = front?.getAnimations?.()[0];

    let width = stageEl.clientWidth;
    let height = stageEl.clientHeight;
    let size = width >= 1024 ? 118 : 84;
    const resize = new ResizeObserver(() => {
      width = stageEl.clientWidth;
      height = stageEl.clientHeight;
      size = width >= 1024 ? 118 : 84;
      sunnyHost.style.width = `${size}px`;
      sunnyHost.style.height = `${size}px`;
    });
    resize.observe(stageEl);
    sunnyHost.style.width = `${size}px`;
    sunnyHost.style.height = `${size}px`;

    /** Ground under container pixel `px`: y in pixels and the angle in degrees. */
    const ground = (px: number): { y: number; angle: number } => {
      const timing = roll?.effect?.getComputedTiming();
      const duration = Number(timing?.duration) || 30000;
      const current = Number(roll?.currentTime ?? 0);
      const shift = -((current % duration) / duration) * width;
      const u = ((px - shift) / (2 * width)) * FRONT.strip;
      const { y, slope } = frontHill(u);
      const pxPerUnitX = (2 * width) / FRONT.strip;
      const pxPerUnitY = height / FRONT.height;
      return {
        y: (y / FRONT.height) * height,
        angle: (Math.atan((slope * pxPerUnitY) / pxPerUnitX) * 180) / Math.PI,
      };
    };

    const place = (px: number, lift: number, extraAngle: number, rig: SunnyRig, boil: number) => {
      const { y, angle } = ground(px);
      skier.style.transform = `translate(${px - size / 2}px, ${y - size * 0.97 - lift}px)`;
      figure.style.transform = `rotate(${angle * 0.8 + extraAngle}deg)`;
      view.draw(rig, { boil });
      // Poles from each hand to the snow behind it.
      const lines = poles.querySelectorAll('line');
      const hands = [rig.limbs.arms.left.hand, rig.limbs.arms.right.hand];
      hands.forEach((hand, i) => {
        const line = lines[i];
        if (!line) return;
        const at = toViewBox(rig, hand);
        line.setAttribute('x1', at.x.toFixed(1));
        line.setAttribute('y1', (at.y - 6).toFixed(1));
        line.setAttribute('x2', (at.x - 34).toFixed(1));
        line.setAttribute('y2', '194');
      });
    };

    const puff = (px: number): void => {
      if (reduced) return;
      const { y } = ground(px);
      const el = document.createElement('span');
      el.className = 'ski-puff';
      el.style.left = `${px}px`;
      el.style.top = `${y}px`;
      for (let i = 0; i < 5; i += 1) el.appendChild(document.createElement('i'));
      stageEl.appendChild(el);
      window.setTimeout(() => el.remove(), 700);
    };

    // Left of centre, with the bubble beside Sunny at head height: inside the
    // hills band, clear of the hero's buttons above at every width.
    const stopX = (): number => width * (width >= 1024 ? 0.3 : 0.2);
    const restRig = skiRig();

    const standStill = (show: boolean): void => {
      place(stopX(), 0, 0, restRig, 0);
      setTalking(show);
    };

    if (reduced) {
      standStill(true);
      return () => {
        resize.disconnect();
        view.destroy();
      };
    }

    let paused = false;
    let landedAt = -1;
    let jumped = false;
    let lastPhase: Phase = 'wait';
    let wasTalking = false;
    let startMs: number | null = null;

    const stage = joinStage({
      priority: 5,
      perform(time, boil) {
        if (paused) return;
        startMs ??= time;
        const elapsed = time - startMs;
        const { phase, p } = phaseAt(elapsed);
        const rig = cloneRig(restRig);
        let px = -size;
        let lift = 0;
        let tilt = 0;

        if (phase === 'in') {
          if (lastPhase !== 'in') {
            jumped = false;
            landedAt = -1;
          }
          px = -size + (stopX() + size) * ease(p * 1.05);
          // One hop over the first crest past a fifth of the way in.
          const jumpStart = 0.32;
          const jumpEnd = 0.46;
          if (p >= jumpStart && p < jumpEnd) {
            const tau = (p - jumpStart) / (jumpEnd - jumpStart);
            lift = Math.sin(Math.PI * tau) * size * 0.42;
            tilt = -8 * Math.sin(Math.PI * tau);
            rig.stretch = 0.08 * Math.sin(Math.PI * tau);
            jumped = true;
          } else if (jumped && landedAt < 0 && p >= jumpEnd) {
            landedAt = elapsed;
            puff(px);
          }
          if (landedAt >= 0 && elapsed - landedAt < 220) {
            rig.squash = 0.14 * (1 - (elapsed - landedAt) / 220);
          }
          // A bob on every film frame or two: skis chattering on the snow.
          rig.y += Math.sin(elapsed / 90) * 0.8;
          rig.eyes.left.gaze = { x: 0.7, y: 0.1 };
          rig.eyes.right.gaze = { x: 0.7, y: 0.1 };
          if (p > 0.9 && lastPhase === 'in' && landedAt >= 0 && !wasTalking) {
            // The skid at the end throws up a little spray.
            if (Math.floor(p * 40) % 4 === 0) puff(px + size * 0.3);
          }
        } else if (phase === 'stop') {
          px = stopX();
          if (lastPhase !== 'stop') {
            puff(px + size * 0.35);
            setTalking(true);
            wasTalking = true;
          }
          // Settling, then a cheerful little bounce while talking.
          rig.squash = Math.max(0, 0.12 * (1 - p * 6));
          rig.y -= Math.abs(Math.sin(elapsed / 260)) * 1.6;
          rig.eyes.left.gaze = { x: -0.2, y: -0.25 };
          rig.eyes.right.gaze = { x: -0.2, y: -0.25 };
          if (p > 0.94 && wasTalking) {
            setTalking(false);
            wasTalking = false;
          }
        } else if (phase === 'out') {
          px = stopX() + (width - stopX() + size * 1.5) * easeIn(p);
          rig.eyes.left.gaze = { x: 0.8, y: 0 };
          rig.eyes.right.gaze = { x: 0.8, y: 0 };
          tilt = -4;
        } else {
          px = -size * 2;
        }
        lastPhase = phase;
        place(px, lift, tilt, rig, boil);
      },
      rest() {
        startMs = null;
        standStill(false);
        wasTalking = false;
      },
    });

    const io = new IntersectionObserver(
      ([entry]) => {
        const ratio = entry?.isIntersecting ? entry.intersectionRatio : 0;
        stage.setVisibility(ratio);
        stage.setWants(ratio >= 0.5);
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    io.observe(stageEl);

    // Keyboard users get Sunny stood still and talking, so the button they
    // focused is where they can see it.
    const onFocus = (): void => {
      paused = true;
      standStill(true);
    };
    const onBlur = (): void => {
      paused = false;
      startMs = null;
      setTalking(false);
    };
    skier.addEventListener('focus', onFocus);
    skier.addEventListener('blur', onBlur);

    standStill(false);
    skier.style.transform = `translate(${-size * 2}px, 0px)`;

    return () => {
      io.disconnect();
      resize.disconnect();
      stage.leave();
      skier.removeEventListener('focus', onFocus);
      skier.removeEventListener('blur', onBlur);
      view.destroy();
    };
  }, []);

  return (
    <div className="hills-stage" ref={stageRef}>
      <Hills />
      <button
        ref={skierRef}
        type="button"
        className={`skier${talking ? ' is-talking' : ''}`}
        onClick={openChat}
        aria-label={`${COPY} Opens the chat.`}
      >
        <span className="skier-figure" ref={figureRef}>
          <span className="skier-sunny" ref={sunnyRef} aria-hidden="true" />
          <svg className="skier-gear" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
            <g ref={polesRef} className="ski-poles">
              <line x1="60" y1="140" x2="26" y2="194" />
              <line x1="154" y1="136" x2="120" y2="194" />
            </g>
            <g className="skis">
              <path className="ski-ink" d="M44 192 H150 Q166 192 171 178" />
              <path className="ski-fill" d="M44 192 H150 Q166 192 171 178" />
              <path className="ski-ink" d="M56 198 H160 Q176 198 181 184" />
              <path className="ski-fill" d="M56 198 H160 Q176 198 181 184" />
            </g>
          </svg>
        </span>
        <SpeechBubble side="right" shown={talking}>
          {COPY}
        </SpeechBubble>
      </button>
    </div>
  );
}
