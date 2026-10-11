# The self-hosted typeface

Plus Jakarta Sans, variable, in two subsets. One family for the whole product:
`packages/ui/src/index.ts` names it once and both surfaces read that name — the
widget builds its `@font-face` from `fontFaceCss()`, the marketing site loads the
same files through `next/font/local`.

The files are committed rather than fetched at build time, and they are fetched
from a font service rather than left as a link to it:

- The repository builds and the tests pass with no network. A link to
  `fonts.googleapis.com` is a third-party dependency in the critical path of the
  marketing page, in the visitor's privacy budget, and in CI.
- The widget is embedded on other people's sites. A face it cannot serve itself
  is a face those sites do not get.

`OFL.txt` beside this file is the licence the fonts are redistributed under.
Keeping it next to the bytes is what the licence asks for; `packages/ui/test/fonts.test.ts`
verifies that the files on disk are the ones recorded below, so this document
cannot quietly go stale.

## What was taken

Fetched on 2026-10-11 from the Google Fonts CSS API (v12 of the family), asking
for `wght@400..800` with a browser user agent — which is what makes the API serve
one variable `woff2` per subset, and `unicode-range`, rather than a stack of
static weights.

| File                              | Bytes | SHA-256                                                          |
| --------------------------------- | ----- | ---------------------------------------------------------------- |
| plus-jakarta-sans-latin-ext.woff2 | 21728 | 38e3b8fd8045048eb311d90170a4429ed2c8f405852dc3d91b5af8452758703f |
| plus-jakarta-sans-latin.woff2     | 27348 | 153fc85b70298beeb1d61a5f723331649e7f23bb77302a66e61cb3e2fbdb5e79 |

Asking for `wght@400..700` and for `wght@400..800` returns a byte-identical
latin file (same digest), so the range in the CSS request is a declaration, not a
clamping: the file carries the family's whole `wght` axis, 200–800, and the
`@font-face` may declare any part of it.

## What the files are

Measured with `fontTools` off the committed bytes, not read off a product page.

| File      | Codepoints | Units/em | x-height       | Cap height     | `wght` axis          |
| --------- | ---------- | -------- | -------------- | -------------- | -------------------- |
| latin     | 229        | 1000     | 536 (0.536 em) | 745 (0.745 em) | 200–800, default 400 |
| latin-ext | 307        | 1000     | 536 (0.536 em) | 745 (0.745 em) | 200–800, default 400 |

Both faces are the same variable file subsetted two ways, so they share metrics
and the two can be mixed within one paragraph without a step change in size.

## Why these ranges

The `unicode-range` each face declares is Google's published range for the
subset, with one correction, and both halves are deliberate.

A face is only consulted for a codepoint its range claims, so a range that is
too narrow costs the visitor a fallback glyph and a range that is too wide costs
them a download they did not need. Google's `latin` range is 387 codepoints
against the 229 the file actually holds; `latin-ext` declares 1159 against 307.
The over-declaration is harmless — a declared codepoint the file lacks still
falls back per glyph — and it is left as published.

The correction is in the combining-diacritics block, where both faces declare
`U+0304, U+0308, U+0329`. Both files also hold `U+0300` (grave), `U+0301`
(acute), `U+0303` (tilde), `U+0309` (hook above) and `U+0323` (dot below) — and
none of those five is declared, by either range. Without them a string in Unicode
NFD, which is what macOS hands you when a name is copied out of a filename,
decomposes to a base letter plus a mark that no face on the page claims, and the
mark is drawn from the system font at a weight that does not match the letter
under it. The declared set is therefore the published marks plus those five, and
it is the same on both faces: with it, the union of the two ranges reaches every
codepoint in either file. (`U+0329` is declared and absent from both files;
over-declaring costs a download that would have happened anyway and a glyph that
still falls back, so it is left as published.)

Everything else — Vietnamese, Cyrillic, Greek, CJK — is _not_ claimed by either
face and renders in the host's own font, which is the intended behaviour: the
widget adds a typeface to a page, it does not take over the page's text.

## Licence

Plus Jakarta Sans is licensed under the SIL Open Font License 1.1. The copyright
line in `OFL.txt` is

> Copyright 2020 The Plus Jakarta Sans Project Authors (https://github.com/tokotype/PlusJakartaSans)

with **no Reserved Font Name** — the statement names no font that a modified
version must not use — so redistribution under the OFL, which this is, carries no
additional obligation beyond shipping the licence text and the copyright notice.
