'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * The page's progress as a little sun in the header: one ray per section,
 * each filling with orange as the visitor reaches its section. Clicking a ray
 * jumps there.
 *
 * Decorative to assistive technology -- the sections are already headings and
 * the skip link already exists, so the dial adds nothing a screen reader
 * needs -- which also keeps its small ray targets out of the tab order.
 */
const SIZE = 30;
const CENTRE = SIZE / 2;

export function ProgressDial(): React.JSX.Element | null {
  const pathname = usePathname();
  const [sections, setSections] = useState<HTMLElement[]>([]);
  const [reached, setReached] = useState(-1);

  useEffect(() => {
    // One ray per top-level section that has an id, up to the eight a sun has.
    const found = [...document.querySelectorAll<HTMLElement>('main section[id]')].slice(0, 8);
    setSections(found);
    setReached(-1);
    if (found.length < 3) return;
    const update = (): void => {
      const line = window.innerHeight * 0.5;
      let last = -1;
      found.forEach((section, i) => {
        if (section.getBoundingClientRect().top <= line) last = i;
      });
      setReached(last);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [pathname]);

  if (sections.length < 3) return null;

  const rays = sections.map((section, i) => {
    const angle = (i / sections.length) * Math.PI * 2;
    const at = (r: number, spread = 0): string =>
      `${(CENTRE + Math.sin(angle + spread) * r).toFixed(2)} ${(CENTRE - Math.cos(angle + spread) * r).toFixed(2)}`;
    return (
      <path
        key={section.id}
        className={i <= reached ? 'dial-ray is-lit' : 'dial-ray'}
        d={`M${at(9, -0.32)}L${at(14.2)}L${at(9, 0.32)}Z`}
        onClick={() => section.scrollIntoView({ behavior: 'smooth', block: 'start' })}
      />
    );
  });

  return (
    <svg
      className="progress-dial"
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      width={SIZE}
      height={SIZE}
      aria-hidden="true"
      focusable="false"
    >
      {rays}
      <circle
        className={reached >= sections.length - 1 ? 'dial-core is-lit' : 'dial-core'}
        cx={CENTRE}
        cy={CENTRE}
        r={6.6}
      />
    </svg>
  );
}
