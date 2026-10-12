/**
 * Rolling orange hills: three layered waves that drift at different speeds,
 * so the horizon reads as depth rather than a flat band. Each wave is drawn
 * twice across a 200%-wide strip and slid by half its width, which loops
 * seamlessly. Still under `prefers-reduced-motion` (see globals.css).
 */

// One period of a gentle wave, 1440 wide, repeated once to make the strip.
function wave(amplitude: number, base: number, phase: number): string {
  const w = 1440;
  const step = w / 4;
  let d = `M0 ${base + Math.sin(phase) * amplitude}`;
  for (let i = 0; i < 8; i++) {
    const x0 = i * step;
    const x1 = x0 + step;
    const up = i % 2 === 0 ? -1 : 1;
    const cy = base + up * amplitude * 1.6 + Math.sin(phase) * amplitude * 0.2;
    d += ` Q${x0 + step / 2} ${cy} ${x1} ${base + Math.sin(phase) * amplitude}`;
  }
  return `${d} V200 H0 Z`;
}

const LAYERS = [
  { className: 'hill hill-back', d: wave(18, 70, 0) },
  { className: 'hill hill-mid', d: wave(22, 105, 1.2) },
  { className: 'hill hill-front', d: wave(16, 140, 2.4) },
];

export function Hills({ tone = 'warm' }: { tone?: 'warm' | 'deep' }): React.JSX.Element {
  return (
    <div className={`hills hills-${tone}`} aria-hidden="true">
      {LAYERS.map((layer) => (
        <svg
          key={layer.className}
          className={layer.className}
          viewBox="0 0 2880 200"
          preserveAspectRatio="none"
          focusable="false"
        >
          <path d={layer.d} />
        </svg>
      ))}
    </div>
  );
}
