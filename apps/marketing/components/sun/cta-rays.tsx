'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A call to action with three of Sunny's rays shooting out towards it as it
 * comes into view -- the sun pointing at the button, without a cartoon of one
 * standing beside it with a speech bubble.
 */
export function CtaRays({ children }: { children: React.ReactNode }): React.JSX.Element {
  const node = useRef<HTMLSpanElement>(null);
  const [lit, setLit] = useState(false);

  useEffect(() => {
    const el = node.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setLit(entry?.isIntersecting ?? false), {
      threshold: 0.8,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <span className={`cta-rays${lit ? ' is-lit' : ''}`} ref={node}>
      <span className="cta-ray r1" aria-hidden="true" />
      <span className="cta-ray r2" aria-hidden="true" />
      <span className="cta-ray r3" aria-hidden="true" />
      {children}
    </span>
  );
}
