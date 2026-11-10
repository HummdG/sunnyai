/** Roof specs for the roof model and drawing tests: the sample house, and two built from it. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SAMPLE = JSON.parse(
  readFileSync(fileURLToPath(new URL('../assets/sample/house.spec.json', import.meta.url)), 'utf8'),
) as unknown;

type P = [number, number];

/** A spec built from the sample with these parts and no neighbours. */
export function specWith(
  parts: { id: string; outer: P[]; kinds: string[]; type: string; eave: number }[],
): unknown {
  const base = SAMPLE as Record<string, unknown> & { parts: object[]; context: object };
  return {
    ...base,
    builtForm: 'detached',
    parts: parts.map((p, i) => ({
      ...base.parts[0],
      id: p.id,
      role: i === 0 ? 'main' : 'rear',
      footprint: { outer: p.outer, holes: [] },
      edgeKinds: p.kinds,
      eaveHeight: p.eave,
      roof: { type: p.type, pitchDeg: 35 },
      chimneys: [],
    })),
    facade: { front: { partId: parts[0]!.id, edge: 0 } },
    context: { ...base.context, neighbours: [] },
  };
}

/** A main gabled block and a flat rear part sharing 4 m of its north wall (the fitter's cut). */
export const L_SPEC = specWith([
  {
    id: 'main',
    outer: [
      [0, 0],
      [8, 0],
      [8, 6],
      [0, 6],
    ],
    kinds: ['eave', 'gable', 'eave', 'gable'],
    type: 'gabled',
    eave: 5,
  },
  {
    id: 'rear-1',
    outer: [
      [0, 6],
      [4, 6],
      [4, 10],
      [0, 10],
    ],
    kinds: ['eave', 'eave', 'eave', 'eave'],
    type: 'flat',
    eave: 3,
  },
]);

export const HIP_SPEC = specWith([
  {
    id: 'main',
    outer: [
      [0, 0],
      [10, 0],
      [10, 6],
      [0, 6],
    ],
    kinds: ['eave', 'eave', 'eave', 'eave'],
    type: 'hipped',
    eave: 5,
  },
]);

/** The sample as a semi: its first attached neighbour gone, the other kept. */
export const SEMI_SPEC: unknown = (() => {
  const base = SAMPLE as Record<string, unknown> & {
    context: { neighbours: { attached?: boolean }[] };
  };
  const first = base.context.neighbours.findIndex((n) => n.attached);
  return {
    ...base,
    builtForm: 'semi-detached',
    context: {
      ...base.context,
      neighbours: base.context.neighbours.filter((_, i) => i !== first),
    },
  };
})();
