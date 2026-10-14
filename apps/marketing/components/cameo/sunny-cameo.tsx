'use client';

import { SEQUENCE_BY_ID } from '@sunny/animation-engine';
import { createSunnyView, defaultRig, limbPose, type LimbPoseName } from '@sunny/character';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { joinStage, openChat, prefersReducedMotion } from './stage.js';

export type BubbleSide = 'left' | 'right' | 'top';

/**
 * A speech bubble in the 1930s ink style (brand guidelines E3): warm white,
 * a heavy wobbly ink outline and a tail pointing at Sunny. The words are real
 * text in the page, so they are read, translated and zoomed like any other.
 */
export function SpeechBubble({
  side = 'right',
  shown = true,
  decorative = false,
  children,
}: {
  side?: BubbleSide;
  shown?: boolean;
  /** Extra flavour only (e.g. a hover aside): hidden from assistive tech. */
  decorative?: boolean;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <span
      className={`speech-bubble speech-${side}${shown ? ' is-shown' : ''}`}
      aria-hidden={decorative ? true : undefined}
    >
      {children}
    </span>
  );
}

export interface SunnyCameoProps {
  /** The resting pose, and the pose a sequence starts from. */
  pose?: LimbPoseName;
  /** A sequence from `@sunny/animation-engine` to perform when triggered. */
  sequence?: string;
  /** Repeat the sequence while this cameo has the lead. */
  loop?: boolean;
  /** Draw a single frame (0..1) of the sequence as the still. */
  at?: number;
  /** Hold the still and never perform (calm placements like the footer). */
  still?: boolean;
  size?: number;
  /** Head only, for badge sizes. */
  head?: boolean;
  /** Mirror Sunny so a pose faces the other way. */
  flip?: boolean;
  bubble?: ReactNode;
  bubbleSide?: BubbleSide;
  /** When the bubble appears after the cameo comes into view. */
  bubbleDelayMs?: number;
  /** Show the bubble once in view, or only while hovered (busy layouts). */
  bubbleOn?: 'view' | 'hover';
  /** What starts the performance. */
  trigger?: 'inview' | 'hover' | 'always';
  /** Lead priority on the shared stage (B3: one animated character at a time). */
  priority?: number;
  /** Makes the cameo a button: `'chat'` opens the widget, or a callback. */
  action?: 'chat' | (() => void);
  /** Accessible name when the cameo is a button. */
  label?: string;
  className?: string;
}

/**
 * Sunny as a cameo in the interface: a small live character, optionally with
 * something to say, that performs when it comes into view (or on hover) and
 * otherwise holds a still pose of the same meaning. All cameos share one
 * animation loop and take turns (`stage.ts`).
 */
export function SunnyCameo({
  pose = 'hips',
  sequence,
  loop = false,
  at,
  still: holdStill = false,
  size = 96,
  head = false,
  flip = false,
  bubble,
  bubbleSide = 'right',
  bubbleDelayMs = 250,
  bubbleOn = 'view',
  trigger = 'inview',
  priority = 1,
  action,
  label,
  className,
}: SunnyCameoProps): React.JSX.Element {
  const host = useRef<HTMLSpanElement | null>(null);
  const root = useRef<HTMLElement | null>(null);
  const [bubbleShown, setBubbleShown] = useState(false);
  const [hovered, setHovered] = useState(false);
  const hoverRef = useRef<() => void>(() => {});
  const hasBubble = bubble !== undefined && bubble !== null && bubble !== false;

  useEffect(() => {
    const node = host.current;
    const box = root.current;
    if (!node || !box) return;
    const view = createSunnyView(node, { decorative: true });
    const base = defaultRig();
    base.limbs = limbPose(pose);
    const performance = sequence ? SEQUENCE_BY_ID.get(sequence) : undefined;
    const reduced = prefersReducedMotion();
    const still =
      performance && at !== undefined
        ? () => view.draw(performance.pose(base, at))
        : () => view.draw(base);
    still();

    let bubbleTimer = 0;
    const showBubble = (): void => {
      if (!hasBubble || bubbleOn === 'hover') return;
      window.clearTimeout(bubbleTimer);
      bubbleTimer = window.setTimeout(() => setBubbleShown(true), reduced ? 0 : bubbleDelayMs);
    };

    if (!performance || reduced || holdStill || performance.duration <= 1) {
      const io = new IntersectionObserver(([entry]) => {
        if (entry?.isIntersecting) showBubble();
      });
      io.observe(box);
      return () => {
        io.disconnect();
        window.clearTimeout(bubbleTimer);
        view.destroy();
      };
    }

    let started: number | null = null;
    const stage = joinStage({
      priority,
      perform(time, boil) {
        started ??= time;
        const elapsed = time - started;
        const t = loop
          ? (elapsed % performance.duration) / performance.duration
          : Math.min(1, elapsed / performance.duration);
        view.draw(performance.pose(base, t), { boil });
        if (!loop && t >= 1) {
          stage.setWants(false);
          started = null;
        }
      },
      rest() {
        started = null;
        still();
      },
    });

    const play = (): void => {
      started = null;
      stage.setWants(true);
    };
    // A hover always earns an encore.
    hoverRef.current = play;

    let seen = false;
    const io = new IntersectionObserver(
      ([entry]) => {
        const ratio = entry?.isIntersecting ? entry.intersectionRatio : 0;
        stage.setVisibility(ratio);
        if (ratio > 0 && !seen) {
          seen = true;
          showBubble();
          if (trigger === 'inview' || trigger === 'always') play();
        }
        if (trigger === 'always' && ratio > 0) stage.setWants(true);
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    io.observe(box);

    return () => {
      io.disconnect();
      stage.leave();
      window.clearTimeout(bubbleTimer);
      view.destroy();
    };
  }, [
    pose,
    sequence,
    loop,
    at,
    holdStill,
    head,
    priority,
    trigger,
    hasBubble,
    bubbleDelayMs,
    bubbleOn,
  ]);

  const classes = `sunny-cameo cameo-bubble-${bubbleSide}${flip ? ' is-flipped' : ''}${
    className ? ` ${className}` : ''
  }`;
  const figure = (
    <>
      <span
        ref={host}
        className="cameo-figure"
        style={{ width: size, height: size }}
        aria-hidden="true"
      />
      {bubble ? (
        <SpeechBubble
          side={bubbleSide}
          shown={bubbleOn === 'hover' ? hovered : bubbleShown}
          decorative={bubbleOn === 'hover'}
        >
          {bubble}
        </SpeechBubble>
      ) : null}
    </>
  );

  if (action) {
    return (
      <button
        ref={(el) => {
          root.current = el;
        }}
        type="button"
        className={`${classes} is-action`}
        aria-label={label}
        onClick={() => (action === 'chat' ? openChat() : action())}
        onMouseEnter={() => {
          setHovered(true);
          hoverRef.current();
        }}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => {
          setHovered(true);
          hoverRef.current();
        }}
        onBlur={() => setHovered(false)}
      >
        {figure}
      </button>
    );
  }
  return (
    <span
      ref={(el) => {
        root.current = el;
      }}
      className={classes}
      onMouseEnter={() => {
        setHovered(true);
        hoverRef.current();
      }}
      onMouseLeave={() => setHovered(false)}
    >
      {figure}
    </span>
  );
}
