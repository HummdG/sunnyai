# Installer catalogue: products and price list

How an installer's product list and price list reach Sunny, how they are
kept honest, and how the quote engine reads them.

Code: `apps/api/src/catalogue/*`, routes in `apps/api/src/routes/catalogue-portal.ts`,
dashboard pages under `apps/dashboard/app/products/*`.

## Two things, published separately

|          | **Products** (catalogue)                                                                               | **Price list**                                                                                                                                                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What     | The panels, inverters, batteries, chargers and extras the installer sells, with specs                  | Everything a quote is priced from: PV base price by panel count, panel uplifts, mounting, scaffold and electrical extras, admin fee, battery with-solar / retrofit prices and expansions, optional extras, trenching bands, VAT, budget bands |
| Schema   | `productSchema` (`packages/contracts/src/catalogue.ts`)                                                | `priceListSchema` (`apps/api/src/catalogue/price-list.ts`)                                                                                                                                                                                    |
| Template | `docs/templates/product-catalogue-template.csv`                                                        | `docs/templates/price-list-template.csv`                                                                                                                                                                                                      |
| Read by  | Chat tools `search_catalogue`, `recommend_packages`, `validate_compatibility` via `store.listProducts` | The quote engine via `getPublishedPriceList(store, tenantId)`                                                                                                                                                                                 |

Both follow the same lifecycle: **upload → preview (row-level issues) →
publish** as a numbered version with a stored snapshot, and **rollback** from
history. Nothing a visitor or a quote sees changes until an installer
publishes. Drafts and previews live in the portal workspace
(`Store.getCatalogueState`), which the chat never reads (tested in
`apps/api/test/catalogue-portal.test.ts`, "grounding").

## How products arrive

1. **CSV upload** in the dashboard (Products › Upload): drag-and-drop, preview
   with every rejected row explained, publish (replace or add).
2. **Google Sheet** (Products › Google Sheet): the installer pastes a Sheet link
   in the template's columns. Sunny reads it every 15 minutes
   (`POST /v1/catalogue/sync-due`, Cloud Scheduler) through the Drive export
   API with the same service account as the knowledge pipeline
   (`GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON`). Changes become **drafts** for
   approval; with "publish automatically" on, a sheet with **zero errors**
   publishes directly. **Blocked on Drive credentials**: without them the
   portal says so and nothing is read.
3. **The installer's website**: "Find products on my website" reads the
   product tables on pages the knowledge pipeline already crawled. A
   deterministic extractor turns product tables (one row per product) and spec
   tables (`field | value`) into records and runs them through the **same
   importer as a CSV**, so a website row meets every unit, currency and
   duplicate rule a spreadsheet does. When `GEMINI_API_KEY` is set, pages that
   look like product pages but have no readable table go to Gemini with a JSON
   schema and the instruction to copy values as written, `null` when absent,
   never inferred, and the answer goes through the same importer. Every draft
   records the URL each field was read from; website prices are `indicative`
   until the installer approves them. A rejected draft is not suggested again.
4. **Manual edits**: the product drawer edits one product as a new version. A
   price can be marked **verified** only with a source to point at.
5. **Start from the HSEnergy example** (new installers): loads HSEnergy's real
   2026 products and price list as **previews labelled as an example**, to edit
   and publish.

## The price list

### CSV format

One row per price. Rows that share a `Key` make one item (a table's rows, a
tiered price's bands). `Pricing` selects the columns read:

| Pricing                | Columns                                                                                                                               | Example                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `flat`                 | Amount                                                                                                                                | Admin fee £350                                                                       |
| `per_unit`             | Amount, Unit (`panel`, `metre`, `roof`, `unit`, `side`, `storey`, `kwh`, `job`), optional Flat fee                                    | Mounting £30 per panel; Enphase £250 + £150 per panel                                |
| `percent`              | Percent (of the PV base price)                                                                                                        | Premium panel "Add 7.5%"                                                             |
| `table`                | From (panel count), Amount; one row per count                                                                                         | PV base price, 1–50 panels                                                           |
| `tier`                 | Unit, From, To, Amount (fixed part), Per unit, Counts (`all` / `above`), Band SKU; `bespoke` in Amount for a band priced individually | Bird mesh: £600 up to 20 panels, then £600 + £30 per panel above 20; trenching bands |
| `with_solar`           | Price with solar, Price retrofit; optional Expansion SKU / price / capacity / Max units, Additional unit discount                     | Fox ESS EQ4800: £3,995 / £4,695, +4.8 kWh units at £1,395 (max 7)                    |
| `quote_only`           | —                                                                                                                                     | Always referred to a person                                                          |
| `vat` (Category `vat`) | Percent, Prices include VAT                                                                                                           | 0 / 5 / 20                                                                           |
| Category `budget_band` | Key (id), Name (label), From, To (amounts)                                                                                            | "£6,000 to £8,000"                                                                   |

Other columns: `Category` (`pv`, `panel_uplift`, `mounting`, `inverter`,
`battery`, `scaffold`, `electrical`, `optional`, `trenching`, `admin`, `other`),
`Name`, `Manufacturer`, `Model` (links an item to a product), `Mandatory`,
`Price status` (`indicative` when the amount is not on the installer's sheet as
written; default `verified`), `Exclusive group` (alternatives — a quote picks
at most one, e.g. `tigo`, `eps`), `Capacity (kWh)`, `Power (kW)`, `Currency`,
`Notes`.

Validation reports every problem with its row: unreadable amounts, missing
units, overlapping bands, duplicate table rows, mixed currencies. A file with
errors cannot be published. Missing VAT is a warning — quotes then say VAT is
to be confirmed; nothing is assumed.

### For the quote engine (WS8)

```ts
import { getPublishedPriceList } from 'apps/api/src/catalogue/price-list-service.js';
import { priceFor, type PriceItem } from 'apps/api/src/catalogue/price-list.js';

const list = await getPublishedPriceList(store, tenantId); // null → no price list: don't quote
const item = list.items.find((i) => i.key === 'OPT-BIRDMESH')!;
priceFor(item, { quantity: 24 }); // { status: 'priced', amountMinor: 72000 }
priceFor(pvBase, { quantity: 12 }); // table lookup; 51 panels → 'unpriced'
priceFor(uplift, { pvBaseMinor: 647100 }); // percent of the PV base price
priceFor(battery, { context: 'retrofit' }); // with_solar | retrofit
priceFor(trenchSoft, { quantity: 200 }); // { status: 'bespoke', … }
```

`priceFor` never interpolates or extrapolates: a quantity outside the table or
every band is `unpriced`, a bespoke band is `bespoke`. All amounts are integer
pence in `list.currency`. VAT is `list.vatRatePercent` (null = not stated) and
`list.pricesIncludeVat`.

**SunScan v1 mapping (1:1 by SKU).** The HSEnergy example keeps every SKU from
`SunScan/sunscan/prisma/seed.ts` as the item `key`:

| seed.ts table                                                                                | Price-list item                                                                                 |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `PV_BASE` (panelCount, kwp, priceGbp)                                                        | `PV-BASE`, `table` by panel count (kWp in each row's label)                                     |
| `PANELS` (`upliftType` base / percent / flat_per_panel)                                      | `panel_uplift` items keyed by panel SKU: `percent` 0 / 7.5 / 8, `per_unit` £150 per panel       |
| `INVERTERS` (`priceGbp: 0`)                                                                  | `inverter` items, `flat` £0, `indicative` (not on the 2026 sheet)                               |
| `MOUNTING` (`pricePerPanel`, `appliesTo`)                                                    | `mounting` items, `per_unit` per panel; `appliesTo` in Notes                                    |
| `BATTERIES` (with solar, retrofit, expansion SKU/capacity/price/max, `multiUnitDiscountGbp`) | `battery` items, `with_solar` + `expansion` + `additionalUnitDiscountMinor`                     |
| `EXTRAS` `priceCalc: 'flat'`                                                                 | `flat` (`ELEC-ADMIN-FEE` `mandatory: true`, category `admin`)                                   |
| `EXTRAS` `per_panel`                                                                         | `per_unit` per panel                                                                            |
| `EXTRAS` `per_panel_with_threshold` (bird mesh)                                              | `tier`: 1–20 £600; 21+ £600 + £30 per panel `above` 20                                          |
| `EXTRAS` `fixed_plus_per_panel` (Enphase)                                                    | `per_unit` £150 per panel + Flat fee £250                                                       |
| `EXTRAS` `exclusiveGroup`                                                                    | `exclusiveGroup`                                                                                |
| `TRENCHING` (one SKU per band)                                                               | `TRENCH-SOFT` / `TRENCH-HARD` `tier` items; each band's `sku` is the seed SKU; 150 m+ `bespoke` |
| `BUDGET_BANDS`                                                                               | `budgetBands`                                                                                   |
| `STRUCT-FLATROOF-SURVEY` (flat £261)                                                         | `per_unit` £261 per **roof** (the sheet says "per roof")                                        |

`SENTINEL_CONFIG` (fractions) → the `sentinel` section (percentages, below).

Not carried over (not prices): survey options, coverage areas, finance options,
warranty text, branding.

### Sentinel (optional optimisation uplift)

SunScan v1's "Sentinel" layer: an indicative boost to yearly savings from smarter
battery charging, use and export, shown beside each quote option ("with
Sentinel: about £1,058 a year"). It never changes a price. It lives on the price
list as `sentinel` (null = not offered), in percentages as installers write them:

| Field                          | Meaning                                      | CSV row (`Category` = `sentinel`)     |
| ------------------------------ | -------------------------------------------- | ------------------------------------- |
| `enabled`                      | Show it on quotes                            | `Key` `enabled`, `Mandatory` yes/no   |
| `basePercent`                  | Base uplift on yearly savings                | `Key` `base`, `Percent`               |
| `tariffPercent[type]`          | Extra uplift for a tariff (`smart_tou`, ...) | `Key` `tariff:<type>`, `Percent`      |
| `lifestylePercent[tag]`        | Extra uplift for a lifestyle (`ev_now`, ...) | `Key` `lifestyle:<tag>`, `Percent`    |
| `batteryRequiredForFullUplift` | The full uplift needs a battery              | `Key` `battery_required`, `Mandatory` |
| `noBatteryPercent`             | Share of the uplift kept without a battery   | `Key` `no_battery`, `Percent`         |
| `capPercent`                   | Ceiling on the combined uplift               | `Key` `cap`, `Percent`                |
| `addedCostMinor`               | One-off cost of adding it                    | `Key` `cost`, `Amount`                |

`journey/catalogue-pricing.ts` (`sentinelConfigFrom`) maps it onto the engine
(percent / 100); absent or `enabled: false` → no uplift and quotes exactly as
without it. Installers edit it on **Products → Price list → Sentinel
optimisation**, which publishes a new price-list version (`PUT
…/catalogue/price-list/sentinel`, admin and above). The HSEnergy example carries
v1's seed values (12% base, +8% smart tariff, 40% without a battery, 30% cap);
a test checks the mapping reproduces v1's figures.

## The HSEnergy example

`apps/api/src/catalogue/examples/hsenergy.ts` is the single source; the
fixture files are generated from it and a test keeps them identical:

- `fixtures/catalogue/hsenergy-catalogue.csv` — 19 products.
- `fixtures/catalogue/hsenergy-price-list.csv` — 38 price-list items + 7 budget bands + Sentinel settings.

Sources (read-only): `SunScan/sunscan/prisma/seed.ts`, cross-checked against
`SunScan/Residential Sales Pricelists - Google Sheets.pdf` (HSEnergy Group
Ltd, v 23rd Feb 2026). Provenance: a product price is `verified` only where the
sheet states it as written (batteries' with-solar price, EV chargers, EPS);
panels and optimisers are priced through the price list, so their product row
carries no price. Inverters are not on the sheet and are `indicative`. The
sheet states no VAT rate, so none is set.

Seed the demo tenant (API running with `SUNNY_ADMIN_TOKEN`):

```
SUNNY_ADMIN_TOKEN=... npm run seed:hsenergy [tenantId]
```

## Routes

All under `/v1/portal/tenants/:tenantId/catalogue`, signed-in installer;
viewer/sales read, admin/owner write; another installer's id is a 404.

| Route                                                                                                                                      |                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `GET /`                                                                                                                                    | Products with source, counts, pending upload, Sheet, versions  |
| `GET /template.csv`, `GET /export.csv`                                                                                                     | Product template, published products as CSV                    |
| `POST /upload`, `POST /upload/:id/publish`, `DELETE /upload/:id`                                                                           | Preview, publish, discard                                      |
| `PATCH /products/:id`, `DELETE /products/:id`                                                                                              | Edit or remove one product (new version)                       |
| `POST /versions/:v/rollback`                                                                                                               | Restore a product version                                      |
| `GET /drafts`, `PATCH /drafts/:id`, `POST /drafts/approve`, `POST /drafts/reject`                                                          | Review Sheet/website drafts                                    |
| `PUT /sheet`, `DELETE /sheet`, `POST /sheet/sync`                                                                                          | Google Sheet source                                            |
| `POST /website/scan`                                                                                                                       | Find products on the crawled website                           |
| `GET /price-list`, `GET /price-list/template.csv`, `GET /price-list/export.csv`                                                            | Price list (with plain-English descriptions), template, export |
| `POST /price-list/upload`, `POST /price-list/upload/:id/publish`, `DELETE /price-list/upload/:id`, `POST /price-list/versions/:v/rollback` | Price list lifecycle                                           |
| `PUT /price-list/sentinel`                                                                                                                 | Set, change or switch off Sentinel (new price-list version)    |
| `POST /example`                                                                                                                            | HSEnergy example as editable previews                          |

Admin token: `POST /v1/catalogue/sync-due` (scheduler), `POST /v1/catalogue/example/publish` (demo seed).

## Still blocked or open

- **Google Sheet sync** needs `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON`; tested with a fake reader only. The export reads the Sheet's first tab.
- **Gemini extraction** needs `GEMINI_API_KEY`; tested with a fake response only.
- The Firestore half of the store contract test needs the emulator (`npm run test:firestore`).
- `@sunny/solar-rules`' importer does not accept its own category spelling `ev_charger` (it reads "EV charger"); exports and templates write the words.
