'use client';

import type { LimbPoseName } from '@sunny/character';
import { useEffect, useState } from 'react';

import { SunnyCameo } from './sunny-cameo.js';

/** Fired by the dashboard when something is saved, so Sunny can react. */
export const CHEER_EVENT = 'sunny:cheer';

/** Tell the sidebar Sunny something went well (a save, a publish). */
export function cheer(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHEER_EVENT));
}

/**
 * The sidebar's Sunny: on duty, waves when hovered, gives a thumbs-up for a
 * couple of seconds whenever the installer saves something. Personality at
 * the edge of the workspace (guidelines B2: dashboard everyday 4/10).
 */
export function SidebarSunny(): React.JSX.Element {
  const [cheering, setCheering] = useState(false);

  useEffect(() => {
    let timer = 0;
    const onCheer = (): void => {
      setCheering(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setCheering(false), 2600);
    };
    window.addEventListener(CHEER_EVENT, onCheer);
    return () => {
      window.removeEventListener(CHEER_EVENT, onCheer);
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <div className="sidebar-sunny">
      <SunnyCameo
        key={cheering ? 'cheer' : 'duty'}
        pose={cheering ? 'thumbsUp' : 'hips'}
        sequence={cheering ? 'celebrate-still' : 'listening-perk'}
        trigger={cheering ? 'inview' : 'hover'}
        size={56}
        priority={1}
      />
      <span>
        <strong>{cheering ? 'Nice one!' : 'Sunny is on duty'}</strong>
        <span className="muted">{cheering ? 'Saved and live.' : 'Answering on your website.'}</span>
      </span>
    </div>
  );
}

interface Greeting {
  pose: LimbPoseName;
  sequence: string;
  say: string;
}

/** What Sunny says, and does, depending on the time of day. */
export function greetingFor(hour: number): Greeting {
  if (hour >= 5 && hour < 12) {
    return {
      pose: 'wave',
      sequence: 'listening-perk',
      say: 'Morning! Kettle’s on. Here’s the overnight news.',
    };
  }
  if (hour >= 12 && hour < 17) {
    return {
      pose: 'thumbsUp',
      sequence: 'celebrate-still',
      say: 'Afternoon! Here’s how today’s shaping up.',
    };
  }
  if (hour >= 17 && hour < 22) {
    return { pose: 'hips', sequence: 'cool-shades', say: 'Evening. Shades on, still answering.' };
  }
  return {
    pose: 'chin',
    sequence: 'thinking-whirr',
    say: 'Burning the midnight oil? I never clock off.',
  };
}

/**
 * The overview's greeting Sunny. Only shown when nothing serious is waiting:
 * never beside a safety escalation (guidelines B2, dial 0).
 */
export function GreetingSunny(): React.JSX.Element | null {
  const [hour, setHour] = useState<number | null>(null);
  useEffect(() => setHour(new Date().getHours()), []);
  if (hour === null) return null;
  const g = greetingFor(hour);
  return (
    <div className="greeting-cameo">
      <SunnyCameo
        pose={g.pose}
        sequence={g.sequence}
        size={120}
        bubble={g.say}
        bubbleSide="left"
        priority={3}
      />
    </div>
  );
}
