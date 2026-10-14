'use client';

import { LOOKUP_GROUP } from '@sunny/animation-engine';
import { defaultRig, renderSunny } from '@sunny/character';
import { useEffect, useRef, useState } from 'react';

import { filmNow, useSunny } from '../use-sunny.js';
import { onSunnyAct, publishSun, type SunnyAct } from './sun-bus.js';

/**
 * The website's one Sunny.
 *
 * The site used to scatter a dozen cameos down the home page, each with a
 * joke. Now there is one character, and it travels: it rises in the hero
 * (wherever the page puts a `data-sunny-dock`), and as the visitor scrolls
 * it hops down to the corner -- where the chat launcher would be -- and acts
 * out each section it passes (`data-sunny-act` on the section): a magnifying
 * glass over the features, the laptop by the install steps, a finger-gun at
 * the plans, the deckchair at the footer.
 *
 * It *is* the chat launcher on this site: clicking it opens the real widget
 * (which is loaded with `data-launcher="none"`), and it steps aside while the
 * panel -- with its own Sunny in the header -- is open. So there is never more
 * than one Sunny in view.
 *
 * Everything else that reacts to Sunny (shadows, the warm light, the ray
 * dividers) follows the position this publishes on the sun bus and as CSS
 * custom properties on the root element.
 */

/** The element is laid out at this size and scaled, so moving it never reflows. */
const BOX = 320;
/** Below this viewport width the corner Sunny is smaller. */
const NARROW = 760;

/** Identical on server and client, so hydration matches; the loop takes over. */
const FIRST_FRAME = renderSunny(defaultRig(), { decorative: true });

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const smooth = (t: number): number => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

interface Place {
  x: number;
  y: number;
  size: number;
}

/** The corner Sunny sits in once it has left the hero. */
function corner(): Place {
  const narrow = window.innerWidth < NARROW;
  const size = narrow ? 84 : 124;
  const inset = narrow ? 12 : 20;
  return {
    x: window.innerWidth - inset - size / 2,
    y: window.innerHeight - inset - size / 2,
    size,
  };
}

export function SunnyGuide(): React.JSX.Element {
  const shell = useRef<HTMLButtonElement>(null);
  const stage = useRef<HTMLSpanElement>(null);
  const animator = useSunny(stage, { greet: false, pose: 'hips' });
  /** The chat panel is open: its header has a Sunny of its own. */
  const [chatting, setChatting] = useState(false);
  /** The section in view has a Sunny of its own. */
  const [aside, setAside] = useState(false);

  // ── where Sunny is, and the light it casts ──────────────────────────────
  useEffect(() => {
    const node = shell.current;
    if (!node) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const root = document.documentElement;
    let handle = 0;
    let travelling = false;
    let written = '';

    const step = (): void => {
      handle = requestAnimationFrame(step);
      const dock = document.querySelector<HTMLElement>('[data-sunny-dock]');
      const end = corner();
      let place = end;
      let p = 1;
      if (dock) {
        const r = dock.getBoundingClientRect();
        const centre = r.top + window.scrollY + r.height / 2;
        // 0 while the dock is where the page put it; 1 once the visitor has
        // scrolled most of the way past it.
        p = clamp01(window.scrollY / Math.max(1, centre * 0.9));
        if (reduced) p = p < 0.5 ? 0 : 1;
        const k = smooth(p);
        const start = {
          x: r.left + r.width / 2,
          y: r.top + r.height / 2,
          size: Math.min(r.width, r.height),
        };
        place = {
          x: lerp(start.x, end.x, k),
          // A hop: the path arcs up on its way down to the corner.
          y: lerp(start.y, end.y, k) - (reduced ? 0 : Math.sin(Math.PI * k) * 90),
          size: lerp(start.size, end.size, k),
        };
      }

      const moving = p > 0.03 && p < 0.97;
      if (moving && !travelling) animator.current?.play('fidget-hop', filmNow());
      travelling = moving;

      const scrollable = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const elevation = reduced ? 1 : 1 - clamp01(window.scrollY / scrollable);

      const transform = `translate3d(${(place.x - BOX / 2).toFixed(1)}px, ${(place.y - BOX / 2).toFixed(1)}px, 0) scale(${(place.size / BOX).toFixed(4)})`;
      if (transform !== written) {
        written = transform;
        node.style.transform = transform;
        node.dataset.docked = p >= 1 ? 'corner' : p <= 0 ? 'hero' : 'travelling';
        node.classList.add('is-placed');

        // Shadows fall away from the sun, longer as it sets.
        const dx = clamp01((window.innerWidth / 2 - place.x) / window.innerWidth + 0.5) * 2 - 1;
        root.style.setProperty('--sun-x', `${place.x.toFixed(0)}px`);
        root.style.setProperty('--sun-y', `${place.y.toFixed(0)}px`);
        root.style.setProperty('--sun-elev', elevation.toFixed(3));
        root.style.setProperty('--shadow-x', `${(dx * 12).toFixed(1)}px`);
        root.style.setProperty('--shadow-y', `${(8 + (1 - elevation) * 14).toFixed(1)}px`);
        publishSun({ x: place.x, y: place.y, size: place.size, elevation });
      }
    };
    handle = requestAnimationFrame(step);
    return () => cancelAnimationFrame(handle);
  }, [animator]);

  // ── acting out the section in view ──────────────────────────────────────
  useEffect(() => {
    let active: Element | null = null;
    const perform = (act: SunnyAct | 'attention' | 'celebrate'): void => {
      const sunny = animator.current;
      if (!sunny) return;
      const now = filmNow();
      sunny.noteActivity(now);
      for (const group of Object.values(LOOKUP_GROUP)) sunny.scheduler.cancel(group);
      // Each section starts from rest: a wave in the hero leaves Sunny
      // listening, and the props and gestures only come out from idle.
      if (sunny.state !== 'idle') sunny.dispatch({ type: 'idle' }, now);
      switch (act) {
        case 'book':
          sunny.play(LOOKUP_GROUP.book, now);
          break;
        case 'laptop':
          sunny.play(LOOKUP_GROUP.laptop, now);
          break;
        case 'magnifier':
          sunny.play(LOOKUP_GROUP.magnifier, now);
          break;
        case 'point':
          sunny.play('gesture-point', now);
          break;
        case 'peace':
          sunny.play('fidget-peace', now);
          break;
        case 'cheer':
        case 'celebrate':
          sunny.dispatch({ type: 'celebrate' }, now);
          break;
        case 'impress':
          sunny.dispatch({ type: 'impress' }, now);
          break;
        case 'wave':
        case 'attention':
          sunny.dispatch({ type: 'attention' }, now);
          sunny.play('listen', now);
          break;
        case 'deckchair':
          sunny.dispatch({ type: 'idle_timeout' }, now);
          break;
        case 'away':
        case 'none':
          break;
      }
    };

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || entry.target === active) continue;
          active = entry.target;
          perform(((entry.target as HTMLElement).dataset.sunnyAct ?? 'none') as SunnyAct);
        }
      },
      // A line across the middle of the screen: the section crossing it is the
      // one Sunny is "in".
      { rootMargin: '-48% 0px -48% 0px' },
    );
    // The footer is short and sits at the very end of the page, so it may
    // never reach the middle line: it counts as soon as most of it is in view.
    const end = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || entry.target === active) continue;
          active = entry.target;
          perform(((entry.target as HTMLElement).dataset.sunnyAct ?? 'none') as SunnyAct);
        }
      },
      { threshold: 0.6 },
    );
    // A section with a Sunny of its own: step aside the moment any of it is
    // on screen, not when it reaches the middle, so two never show together.
    const showing = new Set<Element>();
    const away = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) showing.add(entry.target);
        else showing.delete(entry.target);
      }
      setAside(showing.size > 0);
    });
    const watch = (): void => {
      for (const node of document.querySelectorAll('[data-sunny-act]')) {
        if ((node as HTMLElement).dataset.sunnyAct === 'away') away.observe(node);
        else if (node.tagName === 'FOOTER') end.observe(node);
        else io.observe(node);
      }
    };
    // Sections render with the page; give the client a frame to mount them.
    const id = window.setTimeout(watch, 0);

    // Scrolling is the visitor doing something: hold off the deckchair.
    let last = 0;
    const onScroll = (): void => {
      const now = performance.now();
      if (now - last < 500) return;
      last = now;
      animator.current?.noteActivity(filmNow());
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    const offAct = onSunnyAct(perform);

    return () => {
      window.clearTimeout(id);
      io.disconnect();
      end.disconnect();
      away.disconnect();
      window.removeEventListener('scroll', onScroll);
      offAct();
    };
  }, [animator]);

  // ── stepping aside for the chat panel ───────────────────────────────────
  useEffect(() => {
    const open = (): void => setChatting(true);
    const close = (): void => setChatting(false);
    window.addEventListener('sunny:open', open);
    window.addEventListener('sunny:close', close);
    return () => {
      window.removeEventListener('sunny:open', open);
      window.removeEventListener('sunny:close', close);
    };
  }, []);

  return (
    <button
      ref={shell}
      type="button"
      className={`sunny-guide${chatting || aside ? ' is-away' : ''}`}
      aria-label="Chat with Sunny"
      onClick={() => {
        (window as unknown as { sunny?: { open?: () => void } }).sunny?.open?.();
      }}
    >
      <span
        className="sunny-guide-stage"
        ref={stage}
        data-testid="hero-stage"
        dangerouslySetInnerHTML={{ __html: FIRST_FRAME }}
      />
    </button>
  );
}
