'use client';

import { useEffect, useState } from 'react';

import { api } from '../../lib/portal-api.js';

/** GET …/leads/:id/roof-picture (apps/api/src/homedata/roof-image.ts). */
interface RoofPicture {
  width: number;
  height: number;
  image: string;
  imageryYear: number | null;
  faces: {
    facing: string;
    pitchDeg: number;
    areaM2: number;
    panelCount: number;
    colour: string;
    panels: [number, number, number, number, number][];
  }[];
}

const capitalised = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The lead's house from above, as the visitor saw it in the chat: Google's
 * aerial photo with the panels it fits on each roof face. Renders nothing when
 * Google had no roof or imagery for the address.
 */
export function RoofPhoto({ basePath }: { basePath: string }) {
  const [picture, setPicture] = useState<RoofPicture | null>(null);

  useEffect(() => {
    setPicture(null);
    api<RoofPicture>(`${basePath}/roof-picture`)
      .then((p) => setPicture(p.image.startsWith('data:image/jpeg;base64,') ? p : null))
      .catch(() => setPicture(null));
  }, [basePath]);

  if (!picture || picture.faces.length === 0) return null;
  return (
    <figure className="roof-photo" style={{ margin: '12px 0', maxWidth: 420 }}>
      <div style={{ position: 'relative', lineHeight: 0, borderRadius: 10, overflow: 'hidden' }}>
        {/* A data URL from Sunny's API: nothing for next/image to optimise. */}
        <img
          src={picture.image}
          alt="The house from above"
          width={picture.width}
          height={picture.height}
          style={{ display: 'block', width: '100%', height: 'auto' }}
        />
        <svg
          viewBox={`0 0 ${picture.width} ${picture.height}`}
          aria-hidden="true"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        >
          {picture.faces.map((face, i) => (
            <g key={i} fill={face.colour} fillOpacity={0.55} stroke={face.colour} strokeWidth={0.8}>
              {face.panels.map(([x, y, w, h, deg], j) => (
                <rect
                  key={j}
                  x={x - w / 2}
                  y={y - h / 2}
                  width={w}
                  height={h}
                  transform={`rotate(${deg} ${x} ${y})`}
                />
              ))}
            </g>
          ))}
        </svg>
      </div>
      <figcaption>
        <ul className="chip-row" aria-label="Roof faces" style={{ marginTop: 8 }}>
          {picture.faces.map((face, i) => (
            <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                aria-hidden="true"
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 3,
                  background: face.colour,
                  display: 'inline-block',
                }}
              />
              <span className="small">
                {capitalised(face.facing)}-facing · {face.pitchDeg}° · {face.panelCount} panels
              </span>
            </li>
          ))}
        </ul>
        <p className="small muted">
          Aerial imagery: Google{picture.imageryYear ? `, ${picture.imageryYear}` : ''}. Panel
          positions are Google&apos;s estimate.
        </p>
      </figcaption>
    </figure>
  );
}
