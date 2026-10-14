# The website's display face

Fraunces, variable, Latin subset: the chunky "soft" serif the website's
headlines are set in (brand guidelines, Part I, Website). It is the website's
alone: the product's one family, Plus Jakarta Sans, lives in
`packages/ui/fonts/` and is shared with the widget, and that directory is
deliberately limited to it.

Committed rather than fetched at build time, for the same reasons as the
product family: the site builds with no network, and no third-party font
service sits in a visitor's critical path or privacy budget.

`OFL.txt` beside this file is the SIL Open Font License, Version 1.1, that the
font is redistributed under.

## What was taken

Fetched on 2026-10-14, with the owner's go-ahead, from the jsDelivr mirror of
the npm package `@fontsource-variable/fraunces` 5.3.0, file
`files/fraunces-latin-full-normal.woff2` (all four axes).

| File                 | Bytes  | SHA-256                                                          |
| -------------------- | ------ | ---------------------------------------------------------------- |
| fraunces-latin.woff2 | 121016 | 7e744849028e2219e2aa1bc467dc4032980dc4487c9c3da3010081cd72d3b103 |

## What the file is

Measured with `fontTools` off the committed bytes: 222 codepoints, and four
axes -- `opsz` 9–144, `wght` 100–900, `SOFT` 0–100, `WONK` 0–1. The site uses
`SOFT` 100 and `WONK` 1 at weight 800: the rounded, 1930s cut.
