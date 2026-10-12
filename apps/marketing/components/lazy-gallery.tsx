'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';

const Gallery = dynamic(() => import('./gallery.js'), {
  ssr: false,
  loading: () => <div className="gallery-placeholder">Loading Sunny…</div>,
});

/** Mounts the gallery (and fetches its code) only when it nears the viewport. */
export function LazyGallery(): React.JSX.Element {
  const marker = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const node = marker.current;
    if (!node) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: '300px' },
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={marker} data-testid="gallery">
      {near ? <Gallery /> : <div className="gallery-placeholder" />}
    </div>
  );
}
