# Provenance — `@sunny/quote-engine`

Ported on **2026-10-12** from SunScan v1, read-only:
`C:\Work\Arkalith\SunScan\sunscan\src\lib` (no git history there; content
hashes of every source file and data file are in `source-hashes.json`).

| v1 file                                                                                                                       | Here                                                       |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `pricing/{types,computeQuote,tiers,tierHardware,siteContext}.ts`                                                              | `src/pricing/`                                             |
| `recommend/{buildOptionSet,buildBudgetLadder,evaluateConfig,roofCapacity,deriveGeometry,sentinel,optionTypes,ladderTypes}.ts` | `src/recommend/`                                           |
| `solarCalculations.ts`, `consumption.ts`, `panelLayout.ts`, `types.ts`                                                        | `src/`                                                     |
| `geometry.ts`                                                                                                                 | `src/geometry.ts` (no proj4, see below)                    |
| `mcs.ts`, `tariff.ts` + `data/mcs_irradiance.csv`, `data/mcs_postcode_zones.csv`, `data/regional_tariffs.csv`                 | `src/mcs.ts`, `src/tariff.ts`, `src/data/*.ts` (generated) |
| `src/app/api/[installerSlug]/journey/results/route.ts` (input assembly)                                                       | `src/input.ts` (`buildQuoteInput`)                         |
| tests in `recommend/__tests__`, `pricing/__tests__`, `__tests__/{consumption,tariff}.test.ts`                                 | `test/` (all passing)                                      |

**Changed, and only this:** imports (relative ESM paths), strict-index fixes
(`!` where v1 relied on a guaranteed element), Prettier formatting, the CSV
files read at runtime replaced by generated typed modules (same lookup logic),
`proj4` BNG conversions dropped (unused by the engine), `KWH_PER_KWP_UK` and
`TIER_DEMAND_FACTOR` exported, and the Prisma catalogue loader not ported
(pricing arrives as `TenantPricing`, see `src/pricing-source.ts`).

**Not ported:** `catalogueLoader.ts` (database), `pricing/dev.ts`, the bill
parser, Google Solar / OS API clients, the report generator (see
`docs/integration/quote-journey.md`).

**Demo price list:** `fixtures/pricing/hsenergy-demo-pricelist.json`, generated
by `scripts/import-sunscan-pricelist.mjs` from v1's `prisma/seed.ts` (HSEnergy
2026 master list, v 23rd Feb 2026) and spot-checked against
`Residential Sales Pricelists - Google Sheets.pdf` in `test/pricelist.test.ts`.
Labelled DEMO DATA. Production pricing comes from each installer's published
price list (`apps/api/src/journey/catalogue-pricing.ts`).
