import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { FONT_DIRECTORY, FONT_FACES, fontFileUrl } from '../src/index.js';

/**
 * The committed typeface, checked against the document that describes it.
 *
 * A binary in a repository has one failure mode that no type checker reaches: it
 * is not the file anyone thinks it is. It can be truncated by a bad checkout
 * setting, swapped for a different subset of the same family, or re-fetched and
 * silently changed because the upstream project shipped a new release. None of
 * those break a build. They show up as letterforms.
 *
 * So the digests are recorded in `PROVENANCE.md` and checked here against what is
 * on disk, rather than the other way round: the document is the claim, and this
 * is what stops the claim going stale. What the widget does with the same
 * manifest — the faces it registers and from which URLs — is in
 * `packages/widget/test/fonts.test.ts`.
 */
const fontsDirectory = fileURLToPath(new URL('../fonts/', import.meta.url));
const provenance = readFileSync(new URL('../fonts/PROVENANCE.md', import.meta.url), 'utf8');

function digest(file: string): string {
  return createHash('sha256')
    .update(readFileSync(new URL(`../fonts/${file}`, import.meta.url)))
    .digest('hex');
}

/** `File | Bytes | SHA-256` rows out of the provenance table. */
function recordedFiles(): { file: string; bytes: number; sha256: string }[] {
  const rows = [
    ...provenance.matchAll(/^\|\s*(\S+\.woff2)\s*\|\s*(\d+)\s*\|\s*([0-9a-f]{64})\s*\|$/gm),
  ];
  return rows.map(([, file, bytes, sha256]) => ({
    file: file!,
    bytes: Number(bytes),
    sha256: sha256!,
  }));
}

describe('the committed typeface', () => {
  it('ships exactly the subsets the tokens name, and nothing else', () => {
    // Both halves matter. A file on disk that no token mentions is a file the
    // browser is not allowed to use; a token naming a file that is not on disk
    // is an `@font-face` that 404s in production and passes every other test.
    const onDisk = readdirSync(fontsDirectory)
      .filter((name) => name.endsWith('.woff2'))
      .sort();

    expect(onDisk).toEqual(FONT_FACES.map((face) => face.file).sort());
  });

  it('records every shipped file in the provenance table, byte count included', () => {
    const recorded = recordedFiles();

    expect(recorded.map((row) => row.file).sort()).toEqual(
      FONT_FACES.map((face) => face.file).sort(),
    );

    for (const face of FONT_FACES) {
      const row = recorded.find((candidate) => candidate.file === face.file);
      expect(row, `${face.file} is not in PROVENANCE.md`).toBeDefined();
      expect(face.bytes).toBe(row!.bytes);
      // And the number in the document is the number on disk, not a remembered
      // one: `stat` would agree with a truncated file, this does not.
      expect(readFileSync(new URL(`../fonts/${face.file}`, import.meta.url)).byteLength).toBe(
        row!.bytes,
      );
    }
  });

  it('holds the bytes the provenance table records', () => {
    for (const { file, sha256 } of recordedFiles()) {
      expect(digest(file), `${file} is not the file PROVENANCE.md describes`).toBe(sha256);
    }
  });

  it('ships woff2 files rather than something renamed to look like one', () => {
    // The four-byte signature is `wOF2` big-endian. A font served with
    // `content-type: font/woff2` that is not one is refused by the browser with
    // the same message as any other decode failure, which sends whoever is
    // reading the console to the wrong layer entirely.
    for (const face of FONT_FACES) {
      const header = readFileSync(new URL(`../fonts/${face.file}`, import.meta.url)).subarray(0, 4);
      expect(header.toString('latin1'), face.file).toBe('wOF2');
    }
  });

  it('ships the licence the fonts are redistributed under', () => {
    // The OFL asks for the licence text and the copyright notice to travel with
    // the files, and the provenance document quotes that same notice — so this
    // checks both that the file is there and that the quote is still the one in
    // it rather than a paraphrase someone tidied up.
    const licence = readFileSync(new URL('../fonts/OFL.txt', import.meta.url), 'utf8');

    expect(licence).toContain('SIL OPEN FONT LICENSE Version 1.1');
    expect(licence).toContain('Copyright 2020 The Plus Jakarta Sans Project Authors');
    expect(provenance).toContain('Copyright 2020 The Plus Jakarta Sans Project Authors');
  });

  it('describes both subsets, since the widget declares a range per face', () => {
    expect([...new Set(FONT_FACES.map((face) => face.subset))].sort()).toEqual([
      'latin',
      'latin-ext',
    ]);
  });

  it('claims the combining marks both files hold but Google does not declare', () => {
    // The measured correction in `PROVENANCE.md`, pinned so it cannot be undone
    // by regenerating the ranges from the published CSS. Without it, NFD text —
    // which is what macOS hands you when a name is copied from a file name —
    // draws its accents from the system font at a weight that does not match the
    // letter underneath.
    for (const face of FONT_FACES) {
      for (const mark of ['U+0300', 'U+0301', 'U+0303', 'U+0309', 'U+0323']) {
        expect(face.unicodeRange, `${face.file} must claim ${mark}`).toContain(mark);
      }
    }
  });
});

describe('fontFileUrl', () => {
  const DIRECTORY = 'https://cdn.example.test/assets/sunny/v2';

  it('resolves each subset absolute, against the directory it is given', () => {
    // Absolute is not a preference here. The URL is handed to `new FontFace()`
    // from a page we do not own; a relative one would be resolved by *that*
    // page's base and 404 on the customer's site.
    for (const face of FONT_FACES) {
      expect(fontFileUrl(DIRECTORY, face)).toBe(`${DIRECTORY}/${FONT_DIRECTORY}/${face.file}`);
    }
  });

  it('does not care whether the directory arrives with a trailing slash', () => {
    // The directory comes from `new URL('.', script.src)`, which includes one.
    // A caller passing a bare prefix is reasonable, a double slash is not
    // harmless on every CDN, and the difference costs one comparison here rather
    // than a rule at every call site.
    for (const face of FONT_FACES) {
      expect(fontFileUrl(`${DIRECTORY}/`, face)).toBe(fontFileUrl(DIRECTORY, face));
    }
  });

  it('keeps the file names the manifest records', () => {
    // The one thing this function must not do is invent a name: the digest
    // table in `PROVENANCE.md` is checked against `FONT_FACES`, so a URL built
    // from anything else is a URL that has never been verified to exist.
    const urls = FONT_FACES.map((face) => fontFileUrl(DIRECTORY, face));
    expect(urls).toHaveLength(FONT_FACES.length);
    expect(new Set(urls).size).toBe(FONT_FACES.length);
  });
});
