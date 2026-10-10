import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { ACTUAL_DIR, BASELINE_DIR, SCENES, pngFor } from './scenes.js';

/**
 * Visual regression for the character, against committed PNGs.
 *
 * Plan §12 asks for visual snapshots and this repository has never had them:
 * `docs/RELEASE_CHECKLIST.md` has carried "Vitest snapshots only, **not**
 * pixel-diffed" for as long as it has existed. This closes that, and D-16
 * records why it is aimed here rather than at a page.
 *
 * In short: a screenshot of a web page is a different image on every operating
 * system — font hinting, subpixel antialiasing and the installed font set all
 * differ — so a baseline generated on Windows fails on Linux CI for reasons
 * unrelated to the change under review. Those tests get deleted, and a deleted
 * test protects nothing. Sunny has none of that: paths and circles, no text,
 * rasterised by `resvg` with its own rasteriser and no system fonts, driven by an
 * engine that is deterministic on purpose. Same input, same image, every machine.
 *
 * Byte equality rather than a pixel-difference budget, for the same reason: the
 * pipeline is deterministic, so "differs by one pixel" and "differs" are the same
 * event, and a tolerance would only add a second way for a real regression to
 * pass. A mismatch writes the actual image to `.data-visual/actual/` so the
 * failure can be reviewed by eye.
 *
 * Regenerate deliberately, having looked at what moved:
 *
 *   npm run test:visual:update
 */

describe('character rendering', () => {
  it('renders the scenes that should differ differently', () => {
    // Guards the degenerate pass: if the rasteriser silently produced one blank
    // image for everything, every baseline below would still match and the suite
    // would be green while checking nothing at all. It is not a bijection, and
    // deliberately so -- three scenes are *supposed* to coincide, and spelling
    // that out is more useful than a loosened threshold:
    //
    //   `celebrating-off`             an intensity of `off` resolves no sequence
    //                                 at all, so the character rests
    //   `celebrating-reduced-motion`  resolves `celebrate-still`, whose pose is
    //                                 the resting pose
    //   `relaxing-reduced-motion`     resolves `relax-still`, which is the same
    //                                 pose for the same reason: there is no
    //                                 honest still of a deckchair arriving, so a
    //                                 visitor who asked for less motion gets the
    //                                 resting pose rather than a frozen chair
    //
    // Different reasons, the same image, and all three correct. Any *other* pair
    // coinciding fails here, so it has to be explained rather than discovered --
    // which is the check that caught the bug this suite was extended for: until
    // A04, `relaxing` borrowed the idle layer and a break looked exactly like
    // standing still.
    const byDigest = new Map<string, string[]>();

    for (const scene of SCENES) {
      const digest = pngFor(scene).toString('base64');
      byDigest.set(digest, [...(byDigest.get(digest) ?? []), scene.name]);
    }

    const coincident = [...byDigest.values()].filter((names) => names.length > 1);
    expect(coincident).toEqual([
      ['celebrating-off', 'celebrating-reduced-motion', 'relaxing-reduced-motion'],
    ]);
    expect(byDigest.size).toBe(SCENES.length - 2);
    // Every scene is rasterised here rather than one, and each walks the frame
    // loop up to its capture time. Slower than the default budget, on purpose.
  }, 60_000);

  it('draws a moving scene differently from the resting one', () => {
    // The specific failure this suite was written against: a harness that jumped
    // straight to a capture time rendered the *start* of every sequence, so a
    // celebration looked exactly like rest. A general "are these distinct"
    // check would have gone on passing if only one pair had collapsed.
    const resting = pngFor(SCENES[0]!);
    const celebrating = pngFor(SCENES.find((scene) => scene.name === 'celebrating')!);

    expect(Buffer.compare(resting, celebrating)).not.toBe(0);
  });

  describe.each(SCENES)('$name', (scene) => {
    it('matches the committed baseline', () => {
      const baselinePath = `${BASELINE_DIR}/${scene.name}.png`;

      if (!existsSync(baselinePath)) {
        // A missing baseline is not a pass, and must not read as an ENOENT.
        throw new Error(
          `No baseline for "${scene.name}". Run \`npm run test:visual:update\`, ` +
            'look at the image, then commit it with the reason.',
        );
      }

      const expected = readFileSync(baselinePath);
      const actual = pngFor(scene);

      if (Buffer.compare(expected, actual) !== 0) {
        mkdirSync(ACTUAL_DIR, { recursive: true });
        writeFileSync(`${ACTUAL_DIR}/${scene.name}.png`, actual);
      }

      expect(
        Buffer.compare(expected, actual),
        `"${scene.name}" no longer matches its baseline.\n` +
          `  expected: ${baselinePath}\n` +
          `  actual:   ${ACTUAL_DIR}/${scene.name}.png\n` +
          'Open the two side by side. If the change is intended, run ' +
          '`npm run test:visual:update` and commit the new baseline with the reason.',
      ).toBe(0);
    });
  });
});
