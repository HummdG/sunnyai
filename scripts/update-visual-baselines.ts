#!/usr/bin/env node
/**
 * Regenerate the visual baselines.
 *
 *   npm run test:visual:update
 *
 * Separate from the test on purpose. A test that can write its own expectation
 * passes for the wrong reason: it proves the renderer agrees with itself rather
 * than that anything is unchanged. Here the test only compares, and this script
 * only writes, so a green run means the images are what they were.
 *
 * It prints what it wrote and which images changed, because the useful part of
 * regenerating is noticing *which* baselines moved — one is a deliberate visual
 * change, thirteen is a broken renderer.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { BASELINE_DIR, SCENES, pngFor } from '../tests/visual/scenes.js';

mkdirSync(BASELINE_DIR, { recursive: true });

const changed: string[] = [];
const added: string[] = [];

for (const scene of SCENES) {
  const path = `${BASELINE_DIR}/${scene.name}.png`;
  const next = pngFor(scene);

  if (!existsSync(path)) {
    added.push(scene.name);
  } else if (Buffer.compare(readFileSync(path), next) !== 0) {
    changed.push(scene.name);
  }

  writeFileSync(path, next);
}

console.log(`visual: wrote ${SCENES.length} baselines to ${BASELINE_DIR}`);
if (added.length > 0) console.log(`visual: added    ${added.join(', ')}`);
if (changed.length > 0) console.log(`visual: changed  ${changed.join(', ')}`);
if (added.length === 0 && changed.length === 0) {
  console.log('visual: no baseline changed — the renderer is where it was.');
}
