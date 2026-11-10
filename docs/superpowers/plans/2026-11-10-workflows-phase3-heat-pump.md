# Workflows Phase 3: Heat Pump Quote and PDF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A built-in "Heat pump quote" workflow that the installer switches on. It asks about the home and its heating, then shows the visitor priced heat pump options. Each option has an indicative heat loss, a recommended pump size, the installer's price, the £7,500 Boiler Upgrade Scheme grant shown separately, and running costs compared with today. A PDF estimate comes with it.

**Architecture:**

- **Engine:** a new pure package, `@sunny/heat-pump-engine`, does the calculation.
- **Pricing:** comes from the installer's published price list (new `heat_pump` / `heat_pump_install` categories).
- **Quote record:** `QuoteRecord` becomes a union keyed by `kind`. Existing solar rows (no `kind`) read as solar, and every solar-only consumer narrows with a guard.
- **Chat:** the workflow runtime from Phase 1 gains a `HEAT_PUMP` question bank and a heat pump status. `get_quote_options` dispatches on the workflow's engine.
- **Proposal PDF:** gains heat pump pages and reuses the cover, quotation and terms pages.

**Tech Stack:** TypeScript, zod, Vitest, pdfkit (existing proposal renderer), the widget (vanilla TS).

**Spec:** `docs/superpowers/specs/2026-11-10-workflows-design.md` (Phase 3 section)

## Global Constraints

- **No em or en dashes.** No em dash (U+2014) or en dash (U+2013) in any visitor-facing text, PDF text or UI.
- **Server decides.** The server decides what is asked and what anything costs. The model words questions and never invents a figure.
- **Every rate and rule value is dated data, owner-verifiable.** BUS amount and eligibility, fuel prices, design temperatures, fabric heat-loss rates and SCOP each sit in `packages/heat-pump-engine/src/data/*.ts` with `source` and `effectiveFrom` strings, and the module header says "Values to verify against current Ofgem and price-cap figures before launch". No network lookups are made during the build.
- **Heat loss is indicative only.** Every heat pump quote and PDF carries this disclaimer, verbatim: `This is an indicative estimate. Your installer will confirm the heat loss with a room-by-room survey (MCS MIS 3005) before a final price.`
- **BUS appears only as a deduction.** It is a separate deduction line and is never a price-list item. It applies only when the engine says `eligible === true`; `'unsure'` shows the grant as "may apply, your installer will confirm" and does not deduct it.
- **Solar quotes are unchanged.** Every existing solar test passes unchanged except where a type narrowing forces a mechanical edit.
- **Firestore:** never write `undefined`.

## Review Focus

1. **Old rows.** A stored solar quote row with no `kind` must still render its card, choose, lead, PDF and email follow-up exactly as before. Test in Task 3.
2. **A heat pump quote reaching a solar-only consumer.** This covers the portal lead detail, email follow-up, `chosenPackage` and the roof plan. Each must not crash and must show heat pump facts or nothing. Test in Task 3/6.
3. **No priced heat pump units.** The quote must be unpriced ("Priced by your installer"), not throw. It must not show a negative price after the grant. Test in Task 2/4.
4. **Floor area unknown, or an absurd floor area (1 or 5000 m²).** The engine falls back to bedrooms or clamps, and never returns NaN or Infinity. Test in Task 1.
5. **A postcode in Scotland, Northern Ireland or a crown dependency (IM, JE, GY), or a TD/DG border area.** No grant is deducted. Scotland, NI and the crown dependencies get a clear reason; TD and DG are `'unsure'`. Test in Task 1.

---

### Task 1: The heat pump engine package

**Files:**

- Create `packages/heat-pump-engine/` with:
  - `package.json`: name `@sunny/heat-pump-engine`, `"type":"module"`, `main`/`exports` = `./src/index.ts`, like `@sunny/quote-engine`
  - `src/index.ts`, `src/types.ts`, `src/heat-loss.ts`, `src/demand.ts`, `src/sizing.ts`, `src/running-cost.ts`, `src/bus.ts`, `src/nation.ts`, `src/options.ts`
  - `src/data/fabric.ts`, `src/data/design-temps.ts`, `src/data/fuel-prices.ts`, `src/data/bus-rules.ts`, `src/data/scop.ts`
  - `test/*.test.ts`
- Modify: `vitest.config.ts` (alias, if packages are aliased there), and the root `tsconfig` paths if needed. Follow how `@sunny/quote-engine` is wired.

**Interfaces:**

- Produces:
  ```ts
  export type AgeBand =
    'pre_1919' | '1919_1944' | '1945_1964' | '1965_1982' | '1983_1995' | '1996_2006' | '2007_on';
  export type Walls =
    | 'solid_uninsulated'
    | 'solid_insulated'
    | 'cavity_unfilled'
    | 'cavity_filled'
    | 'timber_or_modern'
    | 'unsure';
  export type Loft = 'none' | 'some' | 'good' | 'unsure'; // some ≈ <200mm, good ≈ 270mm+
  export type Glazing = 'single' | 'double' | 'triple' | 'unsure';
  export type Fuel =
    'gas' | 'oil' | 'lpg' | 'electric_storage' | 'electric_direct' | 'heat_pump' | 'other';
  export type Emitters = 'radiators_standard' | 'radiators_large' | 'underfloor' | 'unsure';
  export interface HeatPumpInput {
    postcode: string;
    propertyType: string;
    ageBand: AgeBand;
    floorAreaM2: number | null;
    bedrooms: number | null;
    walls: Walls;
    loft: Loft;
    glazing: Glazing;
    currentFuel: Fuel;
    emitters: Emitters;
    hotWater: 'cylinder' | 'combi';
    occupants: number | null;
    ownership: string;
    annualSpendGbp: number | null;
    epcRecommendsInsulation: 'yes' | 'no' | 'unsure' | null;
  }
  export type Nation = 'england' | 'wales' | 'scotland' | 'northern_ireland' | 'border' | 'unknown';
  export interface BusVerdict {
    eligible: boolean | 'unsure';
    amountGbp: number;
    reasons: string[];
  }
  export interface HeatPumpEstimate {
    floorAreaM2: number;
    floorAreaAssumed: boolean;
    peakHeatLossKw: number;
    annualSpaceHeatKwh: number;
    annualHotWaterKwh: number;
    recommendedKw: number;
    scop: number;
    runningCost: {
      currentGbp: number;
      heatPumpGbp: number;
      fuelPencePerKwh: number;
      elecPencePerKwh: number;
      boilerEfficiency: number;
    };
    bus: BusVerdict;
    nation: Nation;
    warnings: string[];
    assumptions: string[];
  }
  export function nationOf(postcode: string): Nation;
  export function estimate(input: HeatPumpInput): HeatPumpEstimate;
  export const STANDARD_SIZES_KW: readonly number[]; // [5, 6, 7, 8.5, 10, 12, 14, 16]
  export const HEAT_PUMP_DISCLAIMER: string; // verbatim from Global Constraints
  export const DATA_EFFECTIVE_FROM: string; // e.g. '2026-10-01'
  ```
- Rules the engine implements:
  - **Floor area:** `floorAreaM2` if 20 to 1000. Otherwise use a bedrooms fallback (`{1:50, 2:70, 3:90, 4:120, 5:150}`, 5+ = 150, default 90). Set `floorAreaAssumed: true` and add an assumption line.
  - **Peak heat loss:** `floorArea × W/m²(ageBand) × wallFactor × loftFactor × glazingFactor × (21 − designTemp) / (21 − (−2))`, in kW, rounded to 0.1.
  - **Base W/m²** at −2°C design (dated table): pre_1919 110, 1919_1944 100, 1945_1964 90, 1965_1982 80, 1983_1995 65, 1996_2006 55, 2007_on 45.
  - **Factors:**
    - walls: solid_uninsulated 1.15, solid_insulated 0.9, cavity_unfilled 1.1, cavity_filled 0.9, timber_or_modern 0.85, unsure 1.0
    - loft: none 1.1, some 1.0, good 0.92, unsure 1.0
    - glazing: single 1.1, double 1.0, triple 0.95, unsure 1.0
  - **Design temperature:** a dated table by postcode area. Scottish and northern areas −4 to −5, most of England −2 to −3, the far south-west −1. Unknown areas default to −3.
  - **Annual space heat:** `peakHeatLossKw × 1000 × degreeHours / (21 − designTemp) / 1000`, with `degreeHours` = 55000 (dated constant).
  - **Hot water:** `occupants` (default bedrooms + 1, max 6) × 800 kWh.
  - **Size:** the smallest `STANDARD_SIZES_KW` ≥ peak heat loss. Above 16, cap at 16 with the warning `This home may need a larger or second heat pump. Your installer will advise.`
  - **SCOP:** underfloor 3.6, radiators_large 3.3, radiators_standard 3.0, unsure 3.0. Subtract 0.2 for `pre_1919` and `1919_1944`.
  - **Running cost:**
    - current = (space + hot water) / boilerEfficiency × fuel price
    - boiler efficiency: gas 0.85, oil 0.85, lpg 0.85, electric 1.0, heat_pump = its SCOP
    - heat pump = (space + hot water) / SCOP × electricity price
    - electricity price: the dated price-cap unit rate. Not the solar regional table, which this plan keeps solar-only.
    - When `annualSpendGbp` is given and `currentFuel` is not electric, add an assumption line that the spend was noted, without replacing the modelled figure.
  - **BUS:**
    - The amount is £7,500.
    - eligible when the nation is England or Wales, ownership is in (own, mortgage, landlord), and currentFuel is in (gas, oil, lpg, electric_storage, electric_direct, other).
    - `heat_pump` gives ineligible, reason `Already has a heat pump.`
    - Scotland gives ineligible, reason `The Boiler Upgrade Scheme covers England and Wales. Home Energy Scotland offers its own support.`
    - NI, the Isle of Man, Jersey and Guernsey (`crown_dependency`) give ineligible, reason `The Boiler Upgrade Scheme covers England and Wales.`
    - A border area (TD, DG) gives `'unsure'`, reason `We could not tell from the postcode whether this is in England or Scotland.`
    - `other` fuel gives `'unsure'`, reason `Your installer will check whether your current heating qualifies.`
    - Renters give ineligible, reason `The grant goes to the property owner.`
    - `epcRecommendsInsulation === 'yes'` adds a reason line only (it no longer blocks; dated rule note), and does not change eligibility.
- **Nation by postcode area:**
  - Scotland areas: AB, DD, DG, EH, FK, G, HS, IV, KA, KW, KY, ML, PA, PH, TD, ZE.
  - DG and TD are `border` (they straddle England and Scotland). NI is BT. IM, JE and GY are `crown_dependency`. Wales: CF, LD, LL, NP, SA. SY (Shropshire and Powys) is `england`: both nations are in the grant.
  - Everything else is England, and unparseable is `unknown` (giving `'unsure'`).

- [ ] **Step 1: Write the failing tests:**
  - `nationOf` for `EH1 1AA`, `BT1 1AA`, `CF10 1AA`, `SY23 1AA`, `TD15 1AA`, `NR4 7TJ` and `garbage`.
  - Golden `estimate` for a 1965_1982 semi, 90 m², cavity_filled, some loft, double glazing, gas, standard radiators, NR4 7TJ. Assert peak heat loss, the size picked and BUS eligible £7,500, with exact numbers computed from the rules above in the test.
  - `floorAreaM2: null, bedrooms: 3` gives 90 and `floorAreaAssumed`.
  - `floorAreaM2: 5000` falls back.
  - A large old home caps at 16 with the warning.
  - Every numeric field is finite for a matrix of all enums.
  - The BUS cases: renter, heat_pump, Scotland, TD, NI.
  - No U+2014 or U+2013 in any exported string.
- [ ] **Step 2: Run** `npx vitest run packages/heat-pump-engine`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run packages/heat-pump-engine` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(heat-pump): estimate engine with dated UK data"`

### Task 2: Heat pump price list and pricing

**Files:**

- Modify:
  - `apps/api/src/catalogue/price-list.ts`: add `'heat_pump'` and `'heat_pump_install'` to `PRICE_ITEM_CATEGORIES`; add optional `role?: 'base_install' | 'cylinder' | 'radiator' | 'powerflush' | 'controls' | 'electrical'` on `PriceItem` and its schema; extend CSV import to read a `role` column when present.
  - `packages/contracts/src/catalogue.ts`: add `'heat_pump'` to `PRODUCT_CATEGORIES` and the second category enum at `:350`.
- Create: `apps/api/src/journey/heat-pump/pricing.ts`
- Test: `apps/api/test/heat-pump-pricing.test.ts`, `apps/api/test/catalogue-price-list.test.ts` (extend)

**Interfaces:**

- Produces:
  ```ts
  export interface HeatPumpUnit {
    sku: string;
    name: string;
    outputKw: number;
    priceGbp: number | null;
  } // outputKw from item.powerW / 1000
  export interface HeatPumpExtras {
    baseInstall: PricedLine | null;
    cylinder: PricedLine | null;
    radiatorEach: PricedLine | null;
    powerflush: PricedLine | null;
    controls: PricedLine | null;
    electrical: PricedLine | null;
  }
  export interface PricedLine {
    sku: string;
    label: string;
    unitGbp: number;
  }
  export interface HeatPumpPricing {
    units: HeatPumpUnit[];
    extras: HeatPumpExtras;
    vatRatePercent: number;
    currency: 'GBP';
    label: string;
    version: string;
  }
  export function heatPumpPricingFrom(list: PriceList | null): HeatPumpPricing | null; // null when no heat_pump items
  ```
- Mapping rules:
  - A `heat_pump` item without `powerW` is skipped.
  - `priceFor(item, {quantity: 1})`: priced gives pounds; bespoke or unpriced gives `priceGbp: null`.
  - `heat_pump_install` items map by `role`; the first item per role wins.
  - VAT on heat pumps in Great Britain is 0% (dated rule in the engine's data). Use the price list's own VAT field if it has one, else 0.

- [ ] **Step 1: Write the failing tests:**
  - A list with two units (7 kW priced, 10 kW `quote_only`) plus base_install and cylinder gives the units with `priceGbp` 7 kW = the price and 10 kW = null, plus the extras.
  - A list with no heat_pump items gives null.
  - The CSV import accepts category `heat_pump` and a `role` column.
- [ ] **Step 2: Run** `npx vitest run apps/api/test/heat-pump-pricing.test.ts apps/api/test/catalogue-price-list.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same tests, `npx vitest run apps/api` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(catalogue): heat pump price items and pricing"`

### Task 3: Quote record and card become kinds

**Files:**

- Modify:
  - `apps/api/src/journey/quote.ts`: `QuoteRecord` gains `kind?: 'solar'`
  - new `apps/api/src/journey/heat-pump/record.ts`: `HeatPumpQuoteRecord`
  - `apps/api/src/store.ts`: `StoredQuote = QuoteRecord | HeatPumpQuoteRecord` in `saveQuote`, `getQuote` and `listQuotes`; also `firestore-store.ts`
  - every consumer listed in the exploration: `journey/service.ts` (journeyView `quoted`, toQuoteCard), `journey/choose.ts`, `routes/quote.ts`, `routes/proposal.ts`, `routes/portal.ts:836`, `channels/email/followup.ts:63,177`, `proposal/*`, `workflows/agent-tools.ts:124`
  - `packages/contracts/src/chat.ts`: `quoteCardSchema`
- Test: `apps/api/test/quote-kinds.test.ts`. Existing solar tests must pass.

**Interfaces:**

- Produces:
  ```ts
  export interface HeatPumpOptionView {
    id: string;
    label: string;
    isRecommended: boolean;
    headline: string;
    outputKw: number;
    unitName: string;
    priceGbp: number | null;
    grantGbp: number;
    priceAfterGrantGbp: number | null;
    priceLabel: string;
    lineItems: QuoteLineItem[];
    runningCostGbp: number;
    currentCostGbp: number;
    annualSavingsGbp: number;
    inclusions: string[];
    warnings: string[];
    installerPriced: boolean;
  }
  export interface HeatPumpQuoteRecord {
    kind: 'heat_pump';
    id;
    tenantId;
    sessionId;
    createdAt;
    priced: boolean;
    pricing: QuoteRecord['pricing'];
    estimate: HeatPumpEstimate;
    postcode: string;
    options: HeatPumpOptionView[];
    recommendedId: string;
    warnings: string[];
    disclaimer: string;
    leadId: string | null;
    chosenOptionId?;
    chosenAt?;
    quotation?: QuotationSnapshot;
    warranties?: Record<string, number>;
    workflowId?: string;
  }
  export type StoredQuote = QuoteRecord | HeatPumpQuoteRecord;
  export function isSolarRecord(q: StoredQuote): q is QuoteRecord; // q.kind === undefined || q.kind === 'solar'
  ```
- `quoteCardSchema` becomes `{ kind?: 'solar' | 'heat_pump', ... }`:
  - A solar card is unchanged; a missing kind reads as solar.
  - A heat pump card has options of `heatPumpOptionCardSchema` `{id, label, isRecommended, headline, outputKw, priceGbp|null, grantGbp, priceAfterGrantGbp|null, priceLabel, runningCostGbp, currentCostGbp, annualSavingsGbp, installerPriced?}` (max 3).
  - Use a zod union so old cards parse as solar.
- Consumer rules:
  - `toQuoteCard(q: StoredQuote)` maps both kinds.
  - `chosenPackage` and the solar timeline run only for solar. For heat pump, `/choose` saves the choice and returns `{chosen: option}`.
  - Portal lead quote returns the record as is. `lead-detail.tsx` shows heat pump facts (`outputKw`, price, grant) when `kind === 'heat_pump'`.
  - Email `quoteFacts` for heat pump: `${o.outputKw} kW heat pump, ${price}, Boiler Upgrade Scheme grant ${grant}`.
  - Proposal routes: still a 404 for heat pump in this task (Task 5 adds it).
  - The workflow `quoted` check counts any quote kind for the workflow's engine.

- [ ] **Step 1: Write the failing tests:**
  - A legacy solar row with no `kind` round-trips through `saveQuote`/`getQuote`/`listQuotes` and `toQuoteCard`, unchanged (snapshot).
  - A heat pump record round-trips, and `toQuoteCard` gives `kind: 'heat_pump'`.
  - `/v1/quote/:id/choose` on a heat pump record gives 200 with the chosen option.
  - Email `quoteFacts` on a heat pump record contains `kW heat pump`.
  - `quoteCardSchema.parse` accepts an old solar card without `kind`.
- [ ] **Step 2: Run** `npx vitest run apps/api/test/quote-kinds.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** with type narrowing at every consumer. Run `npm run typecheck` to find them all.
- [ ] **Step 4: Run** `npx vitest run apps/api packages/contracts` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "refactor(quote): quotes come in kinds; solar unchanged"`

### Task 4: Heat pump workflow in chat

**Files:**

- Modify:
  - `apps/api/src/flow/banks.ts`: `HEAT_PUMP` bank, with `bankFor('heat_pump')` → `HEAT_PUMP`; update `flow-resolve.test.ts:1099`
  - `apps/api/src/questionnaire.ts`: add `HEAT_PUMP_QUESTIONS` beside `DISCOVERY_QUESTIONS`; `QUESTIONS` is unchanged
  - `apps/api/src/workflows/templates.ts`: `heatPumpTemplate(now)`, plus `templateFor('heat_pump_quote')`
  - `apps/api/src/workflows/tenant.ts`: a missing built-in heat pump workflow is appended disabled to any set read, migrated or stored
  - `apps/api/src/workflows/status.ts`: heat pump branch
  - `apps/api/src/workflows/agent-tools.ts` and `apps/api/src/journey/agent-tools.ts`: `quoteRefusal` and `get_quote_options` dispatch on engine
  - `apps/api/src/routes/quote.ts`: `/v1/quote/options` dispatches on the session's active workflow engine
- Create: `apps/api/src/journey/heat-pump/{status.ts,service.ts}`
- Test: `apps/api/test/heat-pump-journey.test.ts`

**Interfaces:**

- **HEAT_PUMP bank:**
  - No fixed start and no followers.
  - Questions are the shared presets `address`, `property_type`, `ownership` and `motivation`, plus the HEAT_PUMP_QUESTIONS below.
  - Default steps in this order: `motivation, property_type, ownership, address, hp_age, hp_floor_area (optional), hp_bedrooms, hp_walls, hp_loft, hp_glazing, hp_current_heating, hp_emitters, hp_hot_water, hp_occupants (optional), hp_annual_spend (optional), hp_epc (optional), hp_outdoor_space`.
  - `hp_bedrooms` appears only when `hp_floor_area` is skipped or unanswered.
  - The template motivation prompt is `"First, what would you most like from a new heating system?"`.
- `HEAT_PUMP_QUESTIONS`. Each id is followed by its prompt, verbatim, then its options. Option values match the engine enums.
  - `hp_age`: "Roughly when was the home built?" with pre_1919, 1919_1944, 1945_1964, 1965_1982, 1983_1995, 1996_2006, 2007_on, unsure (unsure maps to 1965_1982 with an assumption line).
  - `hp_floor_area`: "Do you know the floor area, in square metres? It is on your EPC. You can skip this." Numeric, 20 to 1000.
  - `hp_bedrooms`: "How many bedrooms does it have? Answer 1 to 5, where 5 means five or more." Numeric, 1 to 5.
  - `hp_walls`: "What are the outside walls like?" with the Walls enum.
  - `hp_loft`: "How well insulated is the loft?" with the Loft enum.
  - `hp_glazing`: "What kind of windows does it have?" with the Glazing enum.
  - `hp_current_heating`: "How is the home heated today?" with the Fuel enum.
  - `hp_emitters`: "What do you heat the rooms with now?" with the Emitters enum.
  - `hp_hot_water`: "Do you have a hot water cylinder, or a combi boiler?" with cylinder or combi.
  - `hp_occupants`: "How many people live there?" Numeric, 1 to 10.
  - `hp_annual_spend`: "Roughly what do you spend on heating a year, in pounds? You can skip this." Numeric, 50 to 10000.
  - `hp_epc`: "Does your EPC recommend loft or cavity wall insulation?" with yes, no, unsure.
  - `hp_outdoor_space`: "Is there space outside for a unit about the size of a large suitcase on its side, near the house?" with yes, no, unsure (no adds the warning `The installer will need to check where the outdoor unit can go.`).
  - Every option gets an `OPTION_LABELS` entry with plain wording and no dashes.
- **Heat pump template:**
  - id `wf_heat_pump`, name `Heat pump quote`, enabled false
  - description `Works out an indicative heat pump estimate for the visitor's home, with the Boiler Upgrade Scheme grant.`
  - triggers `['heat pump quote','air source heat pump','how much is a heat pump','boiler replacement']`
  - interests `['heating']`, all pages, outcome `{kind:'quote', engine:'heat_pump'}`, template `{id:'heat_pump_quote', version:1}`
- **Status and service:**
  ```ts
  export function hpStatus(
    workflow: Workflow,
    answers: Record<string, string>,
    opts?: { quoted?: boolean },
  ): WorkflowView; // ready when required() empty, unasked() empty, and a postcode parses from address
  export function heatPumpInputFrom(answers: Record<string, string>): HeatPumpInput | null;
  export async function createHeatPumpQuote(
    deps: JourneyDeps & { heatPumpPricing: (tenantId: string) => Promise<HeatPumpPricing | null> },
    tenantId: string,
    sessionId: string,
    workflow: Workflow,
  ): Promise<
    { ok: true; quote: HeatPumpQuoteRecord } | { ok: false; missing: string[]; next: string | null }
  >;
  ```
- **Options:** up to three, built from the recommended size:
  1. `Heat pump only`: the unit at the recommended size or the next priced size up, plus `baseInstall`, `controls` and `electrical` when priced.
  2. `With a new hot water cylinder`: option 1 plus `cylinder`. Only when `hotWater === 'combi'` or the cylinder is priced. Recommended when the home has a combi.
  3. `With radiator upgrades`: option 2 plus `radiatorEach × max(3, bedrooms + 1)` and `powerflush`. Only when emitters is `radiators_standard` or unsure, and age is older than 1983. Recommended when it is offered.
- **Pricing per option:**
  - `priceGbp` = the sum of priced lines, or null when the unit is unpriced. Unpriced means `installerPriced: true` and the label `Priced by your installer`.
  - `grantGbp` = `bus.eligible === true ? 7500 : 0`.
  - `priceAfterGrantGbp` = `max(0, price − grant)`, or null.
  - The quote carries the snapshot, warranties and brand-asset pinning exactly as `createQuote` does (reuse those helpers).
- **Tool dispatch:** `get_quote_options` and `/v1/quote/options` dispatch on the active workflow's engine (solar goes to `createQuote`; heat_pump goes to `createHeatPumpQuote`). The heat pump tool summary tells the model the figures are indicative, subject to a survey, and that the grant is shown separately. On success the workflow completes with the `quoteId`, as solar does.
- **Workflow status:** `workflowStatus` routes the heat_pump engine to `hpStatus`, giving `readyForQuote` (not `readyForLead`).

- [ ] **Step 1: Write the failing tests** in `heat-pump-journey.test.ts`, using ScriptedProvider and FileStore as in `workflow-tools.test.ts`:
  - **Template:** `wf_heat_pump` exists disabled in a fresh tenant's set and in a stored set that lacked it.
  - **Question order:** with it enabled, `start_workflow wf_heat_pump` asks `motivation` first. Saving answers walks the order above. `hp_bedrooms` is asked only when floor area is skipped.
  - **Quote:** when ready, `get_quote_options` emits a `quote` event with `kind: 'heat_pump'`, and the session completes.
  - **Grant:** a Scottish postcode gives `grantGbp: 0`.
  - **Unpriced:** a price list with no heat pump items gives an unpriced quote, with `installerPriced: true` and no throw.
  - **No dashes:** the template and the HEAT_PUMP_QUESTIONS contain no em or en dashes.
- [ ] **Step 2: Run** `npx vitest run apps/api/test/heat-pump-journey.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run apps/api` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(heat-pump): heat pump quote workflow in chat"`

### Task 5: Heat pump PDF estimate

**Files:**

- Modify:
  - `apps/api/src/proposal/index.ts`: `proposalDocFor` / `proposalPdf` / `proposalFilename` dispatch on kind
  - `apps/api/src/proposal/pdf.ts`: title `Heat pump estimate for ...` for heat pump
  - `apps/api/src/routes/proposal.ts`: allow heat pump
- Create: `apps/api/src/proposal/heat-pump/{doc.ts, system.ts, running-costs.ts, grant.ts, quotation-lines.ts}`
- Test: `apps/api/test/proposal-heat-pump.test.ts` (use `apps/api/test/pdf-text.ts` to read text)

**Interfaces:**

- Pages, in order:
  1. **Cover:** reused; the heading reads "Heat pump estimate".
  2. **Your heat pump:** recommended size; estimated peak heat loss; floor area (with "assumed from bedrooms" when it was assumed); the unit name; options compared.
  3. **Running costs:** a table of current fuel and yearly cost, heat pump yearly cost, the difference, and the SCOP used, plus the assumptions lines and the date of the prices.
  4. **Boiler Upgrade Scheme:** eligibility, amount, reasons, and the line `The installer applies for the grant and it comes off your invoice.`
  5. **Estimated quotation:** reuse `drawQuotation` with the option's `lineItems` plus a separate deduction row `Boiler Upgrade Scheme grant  −£7,500`. Use a plain minus sign (U+2212), or the word "less", never an en dash. The total after the grant follows.
  6. **Terms:** reused when on.
- `QuotationSettings.sections` toggles apply: system maps to "Your heat pump", performance maps to "Running costs", savings maps to "Boiler Upgrade Scheme".
- The disclaimer (Global Constraints) appears on the Your heat pump page and above the quotation total.
- Filename `heat-pump-estimate-<postcode>.pdf`.

- [ ] **Step 1: Write the failing tests.** The PDF text of a heat pump quote contains:
  - `Heat pump estimate`
  - the recommended `kW`
  - `Boiler Upgrade Scheme`
  - the deduction line
  - the MIS 3005 disclaimer

  With `sections.performance` off, there is no running-costs page. There is no U+2014 or U+2013 anywhere in the text. A solar proposal is unchanged: existing proposal tests pass.

- [ ] **Step 2: Run** `npx vitest run apps/api/test/proposal-heat-pump.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run apps/api` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(proposal): heat pump estimate PDF"`

### Task 6: Widget card, Studio and verification

**Files:**

- Modify:
  - `packages/widget/src/widget.ts`: `#showQuote` renders the heat pump variant
  - `packages/widget/src/styles.ts`: reuse `.quote-*`
  - `apps/marketing/components/dashboard/lead-detail.tsx`
  - `apps/marketing/components/dashboard/workflows/*`: the outcome select offers `Heat pump quote` for custom workflows, and the heat pump workflow shows its own presets (the routes return `presetViews(HEAT_PUMP)` for a heat pump workflow)
  - `apps/api/src/routes/workflows.ts`: presets per workflow bank; `checkWorkflow` `needs_address` also for the heat_pump engine
- Test: the widget test for the card; `apps/api/test/workflow-routes.test.ts` (extend)

**Interfaces:**

- **Heat pump card:**
  - Per option it shows `<outputKw> kW heat pump` and the price with `After the £7,500 grant: £X` when `grantGbp > 0`.
  - Stats: `Running cost about £Y a year` and `About £Z a year less than now` when `annualSavingsGbp > 0`. Otherwise `About £Z a year more than now, but low carbon`.
  - Same choose and PDF and email actions.
  - No solar art (use the existing neutral art, or none).
- **Studio:** a workflow's presets come from its own bank. The GET and PUT views include `presets` for each workflow's bank.

- [ ] **Step 1: Write the failing tests:**
  - The widget renders a heat pump card from a fixture `QuoteCard` with `kind: 'heat_pump'` and shows `kW heat pump` and `After the £7,500 grant`.
  - `GET /workflows/wf_heat_pump` returns presets that include `hp_age`.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Verify.** Run `npx vitest run`, `npm run typecheck`, `NODE_OPTIONS=--max-old-space-size=8192 npm run lint`, `git diff --name-only main...HEAD | xargs npx prettier --check`, `npm run build -w apps/marketing`, then the e2e conversation-editor spec. Expected: all pass.
- [ ] **Step 4: Commit.** `git commit -m "feat(heat-pump): widget card, Studio presets and lead view"`
