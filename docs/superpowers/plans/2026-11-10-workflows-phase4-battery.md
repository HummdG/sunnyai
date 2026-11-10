# Workflows Phase 4: Battery Quote (homes with solar) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A built-in "Battery quote" workflow for homes that already have solar. It asks about the existing system, usage and tariff. It then shows up to three battery sizes, priced at the installer's retrofit prices, with yearly savings from extra solar self-use and (on a time-of-use tariff) cheap-rate charging, plus a PDF estimate.

**Architecture:**

- **Engine.** A pure `battery/` module in `@sunny/quote-engine` reuses `calcSelfConsumption` and `resolveAnnualKwh`. New dated time-of-use rate data feeds it.
- **Phase 3 pattern.** Everything else mirrors Phase 3:
  - a `BATTERY` bank, a disabled `wf_battery` template appended to every set, and a `batteryStatus`
  - a `createBatteryQuote` service, and a `kind: 'battery'` quote record and card
  - battery PDF pages, the widget card, the lead page, the follow-up email facts and Studio presets
- **Engine-agnostic first.** Where Phase 3 hard-coded `heat_pump`, the code becomes engine-agnostic in the same edit. Examples: appending missing built-ins, `quoteKind`, and the `get_quote_options` dispatch.

**Tech Stack:** TypeScript, zod, Vitest, pdfkit, the widget.

**Spec:** `docs/superpowers/specs/2026-11-10-workflows-design.md` (Phase 4 section)

## Global Constraints

- **No dashes.** No em dash (U+2014) or en dash (U+2013) in any visitor-facing text, PDF text or UI.
- **Server decides.** The server decides what is asked and what anything costs. The model never invents a figure. Tool data carries every figure the card shows.
- **Dated data.** Rates and rules are dated data in `packages/quote-engine/src/battery/data.ts` with `source` and `effectiveFrom`, plus the header "Values to verify against current tariffs and HMRC guidance before launch". No network lookups during the build. Values:
  - **Economy 7:** day 30.0p, night 15.0p.
  - **Smart time-of-use:** peak 28.0p, cheap 8.0p, from `'2026-10-01'`.
  - **Battery VAT:** `BATTERY_RETROFIT_VAT_PERCENT = 0`, source `'UK zero rate for energy-saving materials including retrofitted batteries, to 31 March 2027 (to verify)'`.
- **Disclaimer.** Every battery quote and PDF carries this, verbatim: `This is an indicative estimate. Your installer will check your existing solar system, inverter and consumer unit at a survey before a final price.`
- **Solar and heat pump unchanged.** Solar and heat pump behaviour is unchanged, and their tests pass.
- **Partial prices.** No partial price is ever shown as a full price. An option missing any of its own lines is installer-priced as a whole (Phase 3 rule).
- **Firestore.** Never write `undefined` to Firestore.
- **Builds and wiring.** A new `@sunny/*` import must appear in `apps/api/package.json` and `scripts/build-api.mjs` (tests/tooling enforces this). Relative imports carry `.js`.

## Review Focus

1. **A home with no existing solar picks the battery workflow.** Starting the battery workflow with `existing_system` answered `none` must say a battery quote needs solar and offer the solar quote instead. It must never quote. Test in Task 4.
2. **PV size unknown, or absurd PV size and usage.** `bat_pv_kwp` absent with no panel count falls back to 4 kWp with an assumption line. Absurd values clamp. The result is never NaN, Infinity or negative savings. Test in Task 1.
3. **A standard (single-rate) tariff.** There is no shift saving. Only self-use savings apply, and the card must not mention cheap-rate charging. Test in Task 1.
4. **A battery that is priced with-solar only, with no retrofit price.** That option is installer-priced, never priced at the with-solar figure. Test in Task 2.
5. **A non-hybrid inverter with no AC-coupling item priced.** The whole option is installer-priced, with a warning that an extra unit is needed. Test in Task 4.

---

### Task 1: Battery estimate engine

**Files:**

- Create: `packages/quote-engine/src/battery/{index.ts, data.ts, estimate.ts}`, exported from `packages/quote-engine/src/index.ts`
- Test: `packages/quote-engine/test/battery.test.ts`

**Interfaces:**

- Produces:
  ```ts
  export type BatteryTariff =
    'standard' | 'economy7' | 'smart_tou' | 'import_export' | 'already_exports' | 'unknown';
  export type BatteryGoal = 'savings' | 'backup' | 'cheap_rate' | 'unsure';
  export interface BatteryInput {
    postcode: string;
    pvKwp: number | null;
    panelCount: number | null;
    usage: QuoteUsage;
    tariff: BatteryTariff;
    lifestyle: string[];
    goal: BatteryGoal;
  }
  export interface BatterySizing {
    capacityKwh: number;
    extraSelfUseKwh: number;
    shiftKwh: number;
    selfUseSavingGbp: number;
    shiftSavingGbp: number;
    annualSavingGbp: number;
  }
  export interface BatteryEstimate {
    pvKwp: number;
    pvKwpAssumed: boolean;
    annualGenerationKwh: number;
    annualUseKwh: number;
    importPence: number;
    exportPence: number;
    offPeakPence: number | null;
    peakPence: number | null;
    recommendedKwh: number;
    sizing(capacityKwh: number): BatterySizing;
    warnings: string[];
    assumptions: string[];
  }
  export function batteryEstimate(input: BatteryInput): BatteryEstimate;
  export const BATTERY_DISCLAIMER: string;
  export const BATTERY_RETROFIT_VAT_PERCENT: number;
  ```
- Rules:
  - **PV size.** Use `pvKwp` if between 0.5 and 25. Otherwise `panelCount × 0.43` if the count is between 2 and 60. Otherwise 4.0, with `pvKwpAssumed` and the assumption line `Assumed a typical 4 kWp solar system.`
  - **Generation.** `pvKwp × 950` kWh a year (dated UK average yield; to verify).
  - **Use.** `resolveAnnualKwh(usage, importPence)`, clamped to 500..30000.
  - **Rates.** Import and export from `getTariffForPostcode(postcode)`. The time-of-use pair comes from data for economy7 and smart_tou, else null.
  - **Self-use saving.**
    - `extraSelfUseKwh = calcSelfConsumption(gen, use, true, cap).selfConsumptionKwh − calcSelfConsumption(gen, use, false).selfConsumptionKwh`, minimum 0
    - `selfUseSavingGbp = extraSelfUseKwh × (importPence − exportPence) / 100`
  - **Shift saving** (time-of-use tariffs only).
    - `spareKwh = max(0, cap × 365 × 0.9 − extraSelfUseKwh)`
    - `eveningKwh = use × 0.75 − (self-consumption with battery − direct)`, approximated as `use × 0.6`
    - `shiftKwh = min(spareKwh, eveningKwh)`
    - `shiftSavingGbp = shiftKwh × (peak − offPeak) / 100`
  - **Recommended size.**
    - Daily surplus = `max(0, (gen − direct self-use) / 365)`.
    - Daily evening need = `use × 0.6 / 365`.
    - The base is the smaller of the two.
    - For the smart_tou and economy7 tariffs, or goal `cheap_rate`, the base is the evening need instead.
    - Add 20% when `lifestyle` includes `ev_now`, `ev_planned`, `heatpump_now` or `heatpump_planned`.
    - Round to the nearest 0.5 and clamp to 2.5..20 kWh.
  - **Warnings.**
    - goal `backup`: `Backup power needs a compatible inverter and a changeover switch. Your installer will confirm.`
    - tariff `standard` or `unknown`: the assumption line `On a single-rate tariff the battery saves by storing your own solar.`
  - **Rounding.** Every figure rounds to whole pounds or kWh, and stays finite and non-negative.

- [ ] **Step 1: Write the failing tests:**
  - A golden estimate for a 4 kWp, 3,200 kWh, standard tariff home at `NR4 7TJ`, computed in the test from the rules.
  - smart_tou gives a shift saving above 0; standard gives a shift saving of 0.
  - The PV size fallbacks.
  - Absurd usage clamps.
  - Every output is finite and at least 0 across a matrix of tariffs, goals, PV sizes and usage.
  - There are no dashes in the exported strings.
- [ ] **Step 2: Run** `npx vitest run packages/quote-engine/test/battery.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run packages/quote-engine` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(battery): retrofit battery estimate with dated tariff data"`

### Task 2: Battery retrofit pricing

**Files:**

- Modify:
  - `apps/api/src/catalogue/price-list.ts`: the `role` enum gains `'ac_coupling'`, which is valid on `inverter` items. The importer warns on an unknown role for the category.
- Create:
  - `apps/api/src/journey/battery/pricing.ts`
- Test: `apps/api/test/battery-pricing.test.ts`. The solar `catalogue-pricing` output must stay identical.

**Interfaces:**

- Produces:
  ```ts
  export interface RetrofitBattery {
    sku: string;
    name: string;
    capacityKwh: number;
    priceGbp: number | null;
    expansion: { sku: string; capacityKwh: number; priceGbp: number; maxUnits: number } | null;
  }
  export interface BatteryPricing {
    batteries: RetrofitBattery[];
    acCoupling: PricedLine | null;
    vatRatePercent: number;
    label: string;
    version: string;
  }
  export function batteryPricingFrom(list: PriceList | null): BatteryPricing | null;
  ```
- Rules:
  - Battery items need `capacityWh`, or they are skipped.
  - The price is `priceFor(item, {context: 'retrofit'})`. It is never the with-solar price; a null retrofit price gives `priceGbp: null`.
  - `acCoupling` is the first priced `inverter` item with `role: 'ac_coupling'`.
  - VAT is always `BATTERY_RETROFIT_VAT_PERCENT`.
  - The result is null when there are no battery items.
  - The solar mapping in `catalogue-pricing.ts` is not changed.

- [ ] **Step 1: Write the failing tests.** Using the hsenergy fixture:
  - FOX-EC2900 retrofit is £3,195, with its expansion carried.
  - A with-solar-only battery gives `priceGbp: null`.
  - An `ac_coupling` inverter row is picked up.
  - A list with a 20% VAT row still gives VAT 0.
  - The solar pricing output is identical with and without an `ac_coupling` row.
- [ ] **Step 2: Run** `npx vitest run apps/api/test/battery-pricing.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run apps/api` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(battery): retrofit battery pricing from the price list"`

### Task 3: Battery quote kind

**Files:**

- Create: `apps/api/src/journey/battery/record.ts`
- Modify:
  - `apps/api/src/journey/heat-pump/record.ts`: `StoredQuote` adds `BatteryQuoteRecord`, and `quoteKind` returns `'battery'`.
  - `packages/contracts/src/chat.ts`: add `batteryOptionCardSchema` and `batteryQuoteCardSchema` (kind literal `'battery'`) to the `quoteCardSchema` union.
  - Every consumer that branches on kind: `toQuoteCard`, `routes/quote.ts` choose, `routes/proposal.ts` (404 until Task 5), `followup.ts`, `routes/portal.ts`, `lead-detail.tsx` (placeholder facts until Task 6), and the widget's early return for an unknown kind.
- Test: `apps/api/test/quote-kinds.test.ts` (extend)

**Interfaces:**

```ts
export interface BatteryOptionView {
  id;
  label;
  isRecommended;
  headline;
  capacityKwh: number;
  batteryName: string;
  priceGbp: number | null;
  priceLabel: string;
  lineItems: QuoteLineItem[];
  annualSavingsGbp: number;
  selfUseSavingGbp: number;
  shiftSavingGbp: number;
  paybackYears: number | null;
  warnings: string[];
  installerPriced: boolean;
}
export interface BatteryQuoteRecord {
  kind: 'battery';
  id;
  tenantId;
  sessionId;
  createdAt;
  priced: boolean;
  pricing: QuoteRecord['pricing'];
  estimate: Omit<BatteryEstimate, 'sizing'>;
  postcode: string;
  tariff: BatteryTariff;
  options: BatteryOptionView[];
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
```

- The card option is `{id, label, isRecommended, headline, capacityKwh, priceGbp|null, priceLabel, annualSavingsGbp, shiftSavingGbp, paybackYears|null, installerPriced?, warnings? max 5}`.
- Payback is `price / annualSaving` rounded to 0.5, and null when the option is unpriced or the saving is 0.

- [ ] **Step 1: Write the failing tests:**
  - A battery record round-trips through the store and `toQuoteCard`, giving `kind: 'battery'`.
  - `/choose` works.
  - The email facts contain `kWh battery`.
  - Old solar cards and heat pump cards still parse.
- [ ] **Step 2: Run** `npx vitest run apps/api/test/quote-kinds.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Narrow every consumer; `npm run typecheck` finds them.
- [ ] **Step 4: Run** `npx vitest run` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "refactor(quote): battery quote kind"`

### Task 4: Battery workflow in chat

**Files:**

- Modify:
  - `apps/api/src/flow/banks.ts`: a `BATTERY` bank, and `bankFor('battery')` returns `BATTERY`.
  - `apps/api/src/questionnaire.ts`: `BATTERY_QUESTIONS`.
  - `apps/api/src/workflows/templates.ts`: `batteryTemplate`, and `templateFor('battery_quote')`.
  - `apps/api/src/workflows/tenant.ts`: append every missing built-in generically (heat pump and battery), disabled, within the 12 limit.
  - `apps/api/src/workflows/status.ts`: route the `battery` engine.
  - `apps/api/src/journey/agent-tools.ts`: `PricedEngine` gains `'battery'`, plus the dispatch and refusal text.
  - `apps/api/src/routes/quote.ts`: the `/v1/quote/options` dispatch.
- Create: `apps/api/src/journey/battery/{status.ts, service.ts}`
- Test: `apps/api/test/battery-journey.test.ts`

**Interfaces:**

- **The `BATTERY` bank.** No fixed start and no followers.
  - It holds the shared presets `motivation`, `address`, `existing_system`, `usage_source` (with its group `annual_kwh` / `monthly_cost` / `household_size`), `tariff_type` and `lifestyle`, plus `BATTERY_QUESTIONS`.
  - Default steps, in this order: `motivation, existing_system, address, bat_pv_kwp (optional), bat_panels, usage_source, tariff_type, lifestyle, bat_inverter, bat_goal`.
  - `bat_panels` appears only when `bat_pv_kwp` is skipped.
- **`BATTERY_QUESTIONS`.** Wording is verbatim.
  - `bat_pv_kwp`: `"Do you know the size of your solar system in kWp? It is on your installation paperwork. You can skip this."` Numeric, 0.5 to 25.
  - `bat_panels`: `"Roughly how many solar panels do you have?"` Numeric, 2 to 60.
  - `bat_inverter`: `"Is your solar inverter a hybrid one that can take a battery?"` Options: `hybrid`, `standard`, `unsure`.
  - `bat_goal`: `"What would you most like a battery to do?"` Options: `savings`, `backup`, `cheap_rate`, `unsure`.
  - Labels, in the same order: Store my solar to use later, Keep the lights on in a power cut, Charge on a cheap overnight rate, Not sure.
  - The battery template's `motivation` prompt: `"First, what would you most like from a home battery?"`
- **The template.**
  - id `wf_battery`, name `Battery quote`, enabled false
  - description `Works out battery options for a home that already has solar panels.`
  - triggers `['battery quote','add a battery','home battery','battery for my solar']`
  - interests `['battery']`, all pages
  - outcome `{kind:'quote', engine:'battery'}`, template `{id:'battery_quote', version:1}`
- **The no-solar guard.** When `existing_system` is `none`, `batteryStatus` returns stage `'not_suitable'` with the prompt `A battery quote is for homes that already have solar panels. I can work out a solar and battery quote instead.` The step data carries `suggestWorkflowId: 'wf_solar'` when that workflow is available on this page.
  - `get_quote_options` refuses with the same sentence.
  - `existing_system` values `battery` and `solar_battery` add the warning `You already have a battery. Your installer can advise on adding more storage.`
- **Service:**
  ```ts
  export function batteryInputFrom(answers: Record<string, string>): BatteryInput | null;
  export async function createBatteryQuote(
    deps: JourneyDeps & { batteryPricing: (tenantId: string) => Promise<BatteryPricing | null> },
    tenantId: string,
    sessionId: string,
    workflow: Workflow,
  ): Promise<
    { ok: true; quote: BatteryQuoteRecord } | { ok: false; missing: string[]; next: string | null }
  >;
  ```
- **Options.** Up to three sizes from `pricing.batteries`, or from fallback sizes when there is no pricing:
  1. the smallest battery at or above `recommendedKwh`, or the largest below it
  2. the next size up
  3. one size down, or the next up again
  - Labels: `Recommended`, `More storage`, `Smaller`.
  - Each option is sized by `estimate.sizing(capacityKwh)`.
- **Line items.** The battery's retrofit price, plus `acCoupling` when `bat_inverter` is `standard` or `unsure`.
  - When that line is needed but unpriced, the option is installer-priced, with the warning `Your inverter may need an extra unit to charge a battery. Your installer will check.`
  - Any unpriced line makes the whole option installer-priced (Phase 3 rule).
  - The label is `Indicative price, 0% VAT`.
- **Reuse.** The quote carries the snapshot, warranties and brand pinning, exactly as heat pump does. It completes the workflow with the `quoteId`.

- [ ] **Step 1: Write the failing tests** in `battery-journey.test.ts`, using ScriptedProvider and FileStore:
  - `wf_battery` is present and disabled.
  - Once enabled, `start_workflow wf_battery` asks `motivation` first.
  - `existing_system: none` gives `not_suitable`, a refusal and the `wf_solar` suggestion.
  - A full answer set yields a `quote` event with `kind: 'battery'` and 3 options.
  - On a standard tariff, `shiftSavingGbp` is 0.
  - A non-hybrid inverter with no `ac_coupling` priced gives installer-priced options.
  - Free-text "about 4 kWp" reads as 4.
  - There are no dashes in the template or questions.
- [ ] **Step 2: Run** `npx vitest run apps/api/test/battery-journey.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run apps/api packages` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(battery): battery quote workflow in chat"`

### Task 5: Battery PDF estimate

**Files:**

- Modify:
  - `apps/api/src/proposal/index.ts`, `pdf.ts`: dispatch on kind. The title is `Battery estimate for ...` and the filename `battery-estimate-<postcode>.pdf`.
  - `apps/api/src/routes/proposal.ts`: serve battery PDFs.
  - `journey/service.ts`: the battery card `proposalAvailable`, following the solar rule.
- Create: `apps/api/src/proposal/battery/{doc.ts, system.ts, savings.ts, quotation-lines.ts}`
- Test: `apps/api/test/proposal-battery.test.ts`

**Interfaces:**

- Pages, in order:
  1. The cover, reused, with the heading "Battery estimate".
  2. **Your battery:** existing solar kWp (`assumed` when assumed), yearly use, recommended size, the options compared, and the disclaimer.
  3. **Savings:** a table of self-use saving, cheap-rate saving (only on a time-of-use tariff), total and payback, plus the rates used and their date.
  4. The quotation, reused through `drawQuotationWith`. It has no grant row. Installer-priced options show `Priced so far` and no total.
  5. Terms.
- `sections` toggles: system maps to "Your battery", and savings and performance map to "Savings" (either one on).

- [ ] **Step 1: Write the failing tests.** The PDF text contains `Battery estimate`, the recommended `kWh`, `Savings` and the disclaimer. A standard tariff has no cheap-rate row. There are no dashes. Solar and heat pump PDFs are unchanged: run a hash check before and after, then remove it.
- [ ] **Step 2: Run** `npx vitest run apps/api/test/proposal-battery.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run apps/api` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(proposal): battery estimate PDF"`

### Task 6: Widget card, lead page, email, Studio and verification

**Files:**

- Create: `packages/widget/src/battery-card.ts`
- Modify:
  - `packages/widget/src/widget.ts`
  - `apps/marketing/components/dashboard/lead-detail.tsx`, plus `battery-lead-text.ts`
  - `apps/api/src/channels/email/followup.ts`: `batteryFacts`
  - `apps/marketing/components/dashboard/workflows/workflow-settings.tsx`: the outcome select gains `Battery quote`
  - `apps/marketing/components/dashboard/workflows/model.ts`: `outcomeLabel`
  - `apps/api/src/flow/check.ts`: `needs_address` also applies to the battery engine
- Test: `packages/widget/test/battery-card.test.ts`; extend `workflow-routes.test.ts`

**Interfaces:**

- **Widget card.**
  - Each option shows `<capacityKwh> kWh battery`, its price or the installer-priced label, and `Saves about £X a year`.
  - When `shiftSavingGbp > 0`, it adds `including about £Y from cheap-rate charging`.
  - It shows `Pays back in about N years` when payback is set, and the warnings.
  - Choose, PDF (`battery-estimate.pdf`) and email work as for heat pump.
  - The screen-reader text is `N battery quote options shown.`
- **Lead page.** Shows kWh, price, savings and the warnings, and uses "Priced at survey" for unpriced options.
- **Email facts.** `${o.capacityKwh} kWh battery, ${price}, saves about ${saving} a year`.
- **Studio.** `GET /workflows/wf_battery` presets include `bat_inverter`.

- [ ] **Step 1: Write the failing tests:**
  - The widget card text for priced, installer-priced and time-of-use options.
  - The route presets.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Verify.** Run, in order: `npx vitest run`, `npm run typecheck`, `NODE_OPTIONS=--max-old-space-size=8192 npm run lint`, prettier on the changed files, `npm run build -w apps/marketing`, the widget build, `node scripts/build-api.mjs` (then delete dist), and the e2e conversation-editor spec. Expected: all pass.
- [ ] **Step 4: Commit.** `git commit -m "feat(battery): widget card, lead page, email and Studio"`
