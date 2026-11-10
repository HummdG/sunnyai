# Quotation Tab and Redesigned Quotation PDF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Installers customise their quotation PDF in a new Studio tab ("Your quotation"): logo, signer, accreditations, sections, deposit, validity, letter lines and their own T&Cs; and every quotation PDF is redesigned in the approved "survey drawing" style, with the real roof plan, reasons from the visitor's answers, and an unmistakable estimate notice.

**Architecture:** A per-tenant `QuotationSettings` (contracts, zod) lives in `tenant.config.quotation`, edited through new portal routes and snapshotted onto each `QuoteRecord` when the quote is made (with per-item reasons from the applied flow effects). The PDF renderer (`apps/api/src/proposal/`) is rebuilt as small page modules over shared layout primitives, drawing a roof plan rebuilt from the assessment's `spec.json` with a dependency-free panel layout. Studio gets a fourth tab with a settings column and a live PDF preview rendered by the API from a bundled sample house.

**Tech Stack:** TypeScript, zod 4, Fastify 5, pdfkit, `@sunny/sunscan-core` (synthesizeHouse), Next.js 16 / React (Studio), Vitest, Playwright (chromium).

**Spec:** `docs/superpowers/specs/2026-11-09-quotation-tab-design.md` (approved). The approved visual mockup is `.superpowers/brainstorm/57124-1794264688/content/pdf-styles.html`, option "B. The survey drawing" (git-ignored; open it in a browser). Executors read the spec and the mockup.

## Global Constraints

- Every figure in the PDF comes from the stored quote (and its snapshot); deposit = percentage of the total the Quotation page shows, or the fixed amount; balance = that total minus the deposit; never a figure the quote does not produce.
- Fixed at quote time: the installer's settings in force when a quote is created are snapshotted onto the quote; every later render of that quote uses the snapshot; "valid until" = quote `createdAt` + validity days, never the render date. Quotes without a snapshot render with defaults.
- Defaults (no saved settings): logo from Your brand; all sections on; deposit none; balance-due text "within 7 days of completion"; validity 30 days; no T&Cs section; default letter lines; signer = company name and its contact details; no accreditations.
- Cover and Quotation pages are always on. The estimate wording can never be switched off or edited away.
- Exact estimate copy (verbatim):
  - Quotation page title: `Estimated quotation`
  - Total label (Quotation page and cover rail): `Estimated total`
  - Notice under the Quotation title: `This is an estimate, not a final price. It is based on a 3D model of your roof and the answers you gave us. Your final price will be confirmed after a survey of your property, and it may go up or down.`
  - Cover notice beside the figures: `Estimate. Final price confirmed after a survey.`
  - Deposit label: `Deposit, payable once your survey has confirmed the final price`
- Studio copy (verbatim): tab `Your quotation`; locked switch label `Always shown`; logo link `Use a different logo for the PDF`.
- Limits: T&Cs up to 40,000 characters; letter lines, signer fields, balance-due text and MCS number up to 200 characters; up to 8 accreditation logos; deposit percent 1 to 100 (integer), fixed amount 1 to 1,000,000 (whole pounds); validity 1 to 365 days.
- Roof plan: drawn only when the assessment is reliable and the layout places every quoted panel; draws the whole roof with panels on the quoted faces, as an architect's plan (Task 14); never a schematic. Preview/sample uses a bundled sample house marked `Sample`.
- Tenant writes only through `tenants.update(id, mutate)` (never a whole-tenant save from a cached copy). New routes join `tests/security/tenant-isolation.test.ts`. Viewers read, admins and owners edit. Every plan.
- Brand-asset pruning must keep the quotation logo and accreditation logo ids alive (`brandingIds` in `apps/api/src/branding/meta.ts`).
- Fonts: Inter Tight (Light 300, Regular 400, SemiBold 600, ExtraBold 800) and IBM Plex Mono (Regular 400, Medium 500), OFL, in `apps/api/assets/fonts/` with their OFL licence files.
- No em dashes in any copy we write (PDF and Studio). The installer's pasted T&Cs are rendered as they wrote them.
- In Studio, assistant references use the assistant's name (`apps/marketing/lib/assistant-name.ts`); the PDF says `Prepared with Sunny`.
- `npm run typecheck` / `npm run lint` need `NODE_OPTIONS=--max-old-space-size=8192`. Playwright: `MARKETING_PORT=4196 ... --workers=1` (machine is short on memory; never the whole e2e suite). Prettier: check changed files only, or `.` with `--ignore-path .prettierignore --ignore-path .gitignore` plus an ignore file for `.claude/` and `.superpowers/`.
- Deploys use local docker builds only (never Cloud Build).

## Review Focus

1. **Pasted T&Cs from Word**: Windows line endings, tabs, bullet characters (•, ◦, -), curly quotes, very long unbroken words or URLs, and characters outside the bundled fonts: the page must never overflow or show missing-glyph boxes for common punctuation; unknown glyphs fall back rather than crash. (Task 8 test.)
2. **A fixed deposit larger than the total, or a total of zero/unpriced**: no negative balance and no deposit block without a complete total; a fixed deposit above the total shows the full total as the deposit and a £0 balance. (Task 7 test.)
3. **Long names and addresses in the dark rail** (company, customer, a 3-line address, a 30-character signer role): text wraps inside the rail and never overlaps the next label. (Task 7 test.)
4. **Extreme logo shapes** (a 10:1 wordmark, a square icon, a near-white logo on the dark rail): the logo fits its box keeping its aspect ratio; on the dark rail the light plate is used. (Task 6 test.)
5. **A homeowner re-downloads after the installer changed every setting**: the PDF is byte-for-byte the same content as the first time (snapshot), including validity date and T&Cs. (Task 3 and Task 10 tests.)

---

## File Structure

- `packages/contracts/src/quotation.ts` (new): `QuotationSettings` schema, defaults, limits.
- `apps/api/src/tenants.ts`: `config.quotation?: QuotationSettings`.
- `apps/api/src/routes/quotation.ts` (new): portal GET/PUT, preview PDF, sample PDF.
- `apps/api/src/routes/branding.ts`, `apps/api/src/branding/meta.ts`: upload kinds `pdf-logo` and `accreditation`; pruning keeps them.
- `apps/api/src/journey/quote.ts`, `apps/api/src/journey/service.ts`: `QuoteRecord.quotation` snapshot and `QuoteRecord.reasons`.
- `apps/api/src/proposal/reasons.ts` (new): reasons from applied effects and preset answers.
- `packages/sunscan-core/src/layout/panels.ts` (new): the pure panel layout moved out of `packages/sunscan-viewer/src/panels.ts` (viewer re-exports it).
- `apps/api/src/proposal/roof-plan.ts` (new): spec.json to a plan-view drawing model.
- `apps/api/src/proposal/copy.ts` (new): fixed letter sentences and estimate copy.
- `apps/api/src/proposal/terms.ts` (new): T&Cs text to blocks.
- `apps/api/src/proposal/layout.ts` (new): fonts, colours, primitives (rail, labels, rules, tables, header, footer).
- `apps/api/src/proposal/pages/{cover,system,performance,savings,quotation,terms}.ts` (new): one page module each.
- `apps/api/src/proposal/pdf.ts`: becomes the orchestrator (render order, section switches, page numbers).
- `apps/api/src/proposal/index.ts`: input assembly (snapshot or defaults, logos, roof plan).
- `apps/api/assets/sample/` (new): sample house `spec.json` and sample quote JSON.
- `apps/marketing/components/dashboard/quotation/*` (new): the Studio tab.
- `apps/marketing/app/dashboard/studio/page.tsx`, `apps/marketing/lib/portal-api.ts`, `apps/marketing/app/dashboard.css`.

---

### Task 1: The settings contract

**Files:**

- Create: `packages/contracts/src/quotation.ts`
- Modify: `packages/contracts/src/index.ts` (export)
- Test: `packages/contracts/test/quotation.test.ts`

**Interfaces:**

- Produces:

  ```ts
  export type DepositRule =
    { kind: 'none' } | { kind: 'percent'; percent: number } | { kind: 'fixed'; amountGbp: number };
  export interface QuotationSettings {
    version: number;
    updatedAt: string;
    logoAssetId: string | null; // null = use Your brand's logo
    signer: { name: string; role: string; phone: string; email: string } | null; // null = company defaults
    accreditations: { mcsNumber: string; logoAssetIds: string[] };
    sections: { system: boolean; performance: boolean; savings: boolean; terms: boolean };
    deposit: DepositRule;
    balanceDue: string;
    validityDays: number;
    letter: { opening: string; closing: string };
    terms: string;
  }
  export const quotationSettingsSchema: z.ZodType<QuotationSettings>;
  export const QUOTATION_LIMITS: {
    terms: 40000;
    line: 200;
    accreditationLogos: 8;
    validityMin: 1;
    validityMax: 365;
    percentMin: 1;
    percentMax: 100;
    fixedMin: 1;
    fixedMax: 1000000;
  };
  export function defaultQuotationSettings(): QuotationSettings; // version 0, updatedAt '', defaults from Global Constraints, letter lines ''
  ```

- [ ] **Step 1: Write failing tests**: `defaults match the spec` (all sections on except `terms: false`, deposit none, balanceDue `within 7 days of completion`, validityDays 30, signer null, logoAssetId null); `refuses terms over 40000 characters`; `refuses a percent of 0, 101 or 12.5`; `refuses 9 accreditation logos`; `refuses validity 0 and 366`; `trims text fields`; `accepts a full valid settings object`.
- [ ] **Step 2: Run** `npx vitest run packages/contracts/test/quotation.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the schema and defaults.
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat(contracts): quotation settings`.

### Task 2: Store, routes and logo uploads

**Files:**

- Modify: `apps/api/src/tenants.ts` (`config.quotation?: QuotationSettings`, server-only: make sure `configFor` drops it), `apps/api/src/routes/branding.ts` (upload kinds `pdf-logo`, `accreditation`, processed like `wordmark`), `apps/api/src/branding/meta.ts` (`brandingIds` also keeps `config.quotation.logoAssetId` and `accreditations.logoAssetIds`; change its parameter to take the tenant config or add a second helper and use it at every prune call site), `apps/api/src/server.ts` (register routes), `tests/security/tenant-isolation.test.ts`
- Create: `apps/api/src/routes/quotation.ts`
- Test: `apps/api/test/quotation-routes.test.ts`

**Interfaces:**

- Consumes: Task 1.
- Produces (all under `/v1/portal/tenants/:tenantId/quotation`):
  - `GET` (viewer): `{ settings: QuotationSettings, saved: boolean, assets: { logo: BrandAssetView | null, accreditations: BrandAssetView[] } }` (`settings` = stored or defaults).
  - `PUT` (admin): body `{ settings }` minus version/updatedAt; validates; every referenced asset id must exist for this tenant (else 400 `That image is no longer available. Upload it again.`); saves via `tenants.update` with `version` = stored + 1 and `updatedAt` = now; returns the GET shape.
  - Routes for preview/sample are added in Task 10.

- [ ] **Step 1: Write failing tests**: GET returns defaults with `saved: false`; PUT round-trip bumps version; PUT with an unknown asset id is 400 with that message; viewer PUT is 403; uploads with kind `pdf-logo` and `accreditation` succeed and are not pruned after a later upload once saved in settings (and unsaved ones still are, after the grace period); `configFor` output has no `quotation` key; the routes are in the tenant-isolation sweep.
- [ ] **Step 2: Run** `npx vitest run apps/api/test/quotation-routes.test.ts tests/security`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): quotation settings routes and PDF logo uploads`.

### Task 3: Snapshot and reasons on the quote

**Files:**

- Create: `apps/api/src/proposal/reasons.ts`
- Modify: `apps/api/src/journey/quote.ts` (`QuoteRecord.quotation?: QuotationSnapshot`, `QuoteRecord.reasons?: Record<string, string>` keyed by line-item sku), `apps/api/src/journey/service.ts` (`createQuote` fills both), `apps/api/src/store.ts` / `firestore-store.ts` only if quote persistence needs the new fields listed
- Test: `apps/api/test/quotation-snapshot.test.ts`

**Interfaces:**

- Consumes: Task 1; `AppliedEffect` (`apps/api/src/flow/effects.ts`, carries `questionId`, `value`, `effect`); the resolved flow's `question(id).prompt` and `.label(value)`.
- Produces:
  ```ts
  export interface QuotationSnapshot extends Omit<QuotationSettings, 'signer'> {
    signer: { name: string; role: string; phone: string; email: string }; // resolved: settings or company defaults
    companyName: string;
    colour: string;
    website: string | null;
  }
  export function snapshotFor(
    tenant: Tenant,
    settings: QuotationSettings | undefined,
  ): QuotationSnapshot; // in reasons.ts or a sibling
  export function reasonsFor(
    effects: AppliedEffect[],
    flow: ResolvedFlow,
    answers: Record<string, string>,
    option: QuoteOptionView,
  ): Record<string, string>;
  ```
- Reason copy (fixed sentences, exact):
  - From a flow effect that added or swapped-in an item: `You answered "<answer label>" to "<question prompt>".` (straight double quotes, the installer's wording).
  - From preset answers, when the option includes a battery and lifestyle includes `evening_use`: battery sku gets `You told us you use most of your electricity in the evening.`
  - When an EV charger line exists and lifestyle includes `ev_now`: `You told us you drive an electric car.`; `ev_planned`: `You told us you are planning an electric car.`
  - A flow-effect reason wins over a preset reason for the same sku. Items without a reason get no entry.

- [ ] **Step 1: Write failing tests**: a quote created after the installer saved settings carries `quotation` equal to `snapshotFor(tenant, settings)`; changing settings afterwards does not change the stored quote's snapshot; a quote with no saved settings gets the defaults snapshot with signer = company name and contact; the EV-charger effect from a custom question yields the exact flow-effect sentence; `ev_now` yields the preset sentence; a battery with `evening_use` yields its sentence; an item with no cause has no reason.
- [ ] **Step 2: Run** `npx vitest run apps/api/test/quotation-snapshot.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same plus `apps/api/test/quote-journey.test.ts apps/api/test/flow-effects.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(quote): snapshot quotation settings and item reasons when a quote is made`.

### Task 4: Pure panel layout in sunscan-core

**Files:**

- Create: `packages/sunscan-core/src/layout/panels.ts` (+ export from the package's entry used by the API)
- Modify: `packages/sunscan-viewer/src/panels.ts` (import the pure functions from sunscan-core; keep `buildPanelObjects` and three.js code there; keep its public exports identical)
- Test: `packages/sunscan-core/test/panel-layout.test.ts` (move/copy the existing pure-layout tests from the viewer and its parity test)

**Interfaces:**

- Produces (same names and types as today in the viewer): `PANEL_LAYOUT`, `isSuitablePlane`, `layoutPanels(mesh: HouseMesh, opts: PanelLayoutOptions): PanelLayout`, `PanelPlacement`, `PanelLayoutOptions`, `PanelLayout`. No `three` import in sunscan-core.

- [ ] **Step 1:** Move the pure code; run `npx vitest run packages/sunscan-core packages/sunscan-viewer`. Expected: PASS (behaviour unchanged).
- [ ] **Step 2:** Add test `sunscan-core has no three dependency` (read the module source or package.json deps and assert no `three`).
- [ ] **Step 3: Run** the same. Expected: PASS. Run typecheck.
- [ ] **Step 4: Commit** `refactor(sunscan): panel layout without three.js, usable on the server`.

### Task 5: The roof plan model

**Files:**

- Create: `apps/api/src/proposal/roof-plan.ts`, `apps/api/assets/sample/house.spec.json` (copy one generated from a public test address in `fixtures/sunscan/test-addresses.json`, e.g. from `.data-dev/sunscan-artefacts/t_demo0001/*/spec.json` whose address is in that file; record which address in a sibling `README.md`)
- Test: `apps/api/test/roof-plan.test.ts`

**Interfaces:**

- Consumes: `synthesizeHouse` (`packages/sunscan-core/src/model/synthesize.ts`), Task 4 `layoutPanels`.
- Produces:

  ```ts
  export interface RoofPlan {
    faces: { id: number; outline: [number, number][]; pitchDeg: number; azimuthDeg: number }[]; // plan view metres, x east, y north
    panels: [number, number][][]; // each panel's four corners in plan view
    bounds: { minX: number; minY: number; maxX: number; maxY: number };
    dimensions: { widthM: number; depthM: number };
    mainFacing: string; // e.g. 'South'
    sample: boolean;
  }
  export function roofPlanFor(
    spec: unknown,
    opts: { panelCount: number; planeIds?: number[]; reliable: boolean; sample?: boolean },
  ): RoofPlan | null;
  ```

  Returns null when `reliable` is false, the spec does not parse, or the layout leaves any panel unplaced. Only faces holding at least one panel are returned.

- [ ] **Step 1: Write failing tests** using the sample house: returns faces and exactly `panelCount` panels for a count that fits; null when `reliable: false`; null when `panelCount` exceeds capacity; null for malformed spec; bounds contain every face point; panels lie inside their face outline (point-in-polygon on each corner, 1 cm tolerance).
- [ ] **Step 2: Run** `npx vitest run apps/api/test/roof-plan.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** (project roof-face triangles to the XY plane, merge per face id into an outline, project panel placements likewise).
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat(proposal): plan view of the real roof with its panels`.

### Task 6: Fonts, layout primitives, header and footer

**Files:**

- Create: `apps/api/src/proposal/layout.ts`; fonts and OFL files in `apps/api/assets/fonts/` (fetch once from Google Fonts; record source URLs in `apps/api/assets/fonts/README.md`)
- Test: `apps/api/test/proposal-layout.test.ts`

**Interfaces:**

- Produces:
  ```ts
  export const PAGE: { width: 595.28; height: 841.89; margin: 40 };
  export interface Theme {
    ink: string;
    muted: string;
    rule: string;
    railBg: string;
    railText: string;
    railLabel: string;
    accent: string;
  } // railBg derived from the brand colour, darkened until white text is >= 7:1
  export function themeFor(brandHex: string): Theme;
  export function registerFonts(doc: PDFKit.PDFDocument): void; // names: 'sans-300','sans-400','sans-600','sans-800','mono-400','mono-500'
  export function label(doc, text: string, x: number, y: number, opts?): number; // uppercase mono, letter-spaced; returns next y
  export function rail(doc, theme: Theme, widthFraction: number): { x: number; width: number };
  export function drawLogo(
    doc,
    png: Buffer | null,
    fallbackName: string,
    box: { x; y; w; h },
    onDark: boolean,
  ): void; // keeps aspect ratio; null -> company name in sans-800
  export function header(doc, ctx: PageContext): void;
  export function footer(doc, ctx: PageContext, page: number, of: number): void; // footer: company, MCS number, accreditation logos (max height 14pt), contact, `NN / MM`, `Prepared with Sunny`
  ```
- [ ] **Step 1: Write failing tests**: `themeFor('#FF7900').railBg` gives white text contrast >= 7:1 and `themeFor('#0f2a3d')` keeps a navy; `drawLogo` with a 10:1 PNG and a 1:1 PNG keeps aspect ratio within the box (inspect the computed rect via a returned value or a spy); fonts register without throwing; footer text contains `Prepared with Sunny` and `01 / 06` (extract text from a one-page render).
- [ ] **Step 2: Run** `npx vitest run apps/api/test/proposal-layout.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** For PDF text extraction in tests, add `pdfjs-dist` (devDependency) and a small helper `apps/api/test/pdf-text.ts` (`pdfText(buf): Promise<string[]>` per page).
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat(proposal): survey-drawing layout primitives and fonts`.

### Task 7: Cover and Quotation pages, and the copy

**Files:**

- Create: `apps/api/src/proposal/copy.ts`, `apps/api/src/proposal/pages/cover.ts`, `apps/api/src/proposal/pages/quotation.ts`
- Test: `apps/api/test/proposal-pages-core.test.ts`

**Interfaces:**

- Consumes: Tasks 3, 5, 6.
- Produces:
  ```ts
  export interface ProposalDoc {
    /* everything a page needs */ quote: QuoteRecord;
    option: QuoteOptionView;
    chosen: boolean;
    others: QuoteOptionView[];
    snapshot: QuotationSnapshot;
    customer: { name: string | null; address: string | null };
    roofPlan: RoofPlan | null;
    roofFacts: ProposalRoof | null;
    logo: Buffer | null;
    accreditationLogos: Buffer[];
    generatedAt: Date;
    reference: string;
    validUntil: Date;
  }
  export function letterParagraphs(doc: ProposalDoc): string[]; // copy.ts
  export function money(doc: ProposalDoc): {
    total: number | null;
    totalLabel: string;
    vatNote: string;
    deposit: number | null;
    balance: number | null;
  } | null;
  export function drawCover(pdf, doc: ProposalDoc, theme: Theme): void;
  export function drawQuotation(
    pdf,
    doc: ProposalDoc,
    theme: Theme,
    opts: { mcsBlock: boolean; termsFollow: boolean },
  ): void;
  ```
- Reference format: `Q-` + the quote id without its `q_` prefix, upper-cased, last 8 characters (fixes "Q-Q_TEST_1").
- Letter (fixed sentences; first name from `customer.name`, else `Hello,`): greeting `Dear <first name>,`; opening line from settings if set; one sentence describing the system (`We'd recommend <n> panels on your <facing>-facing roof` + `with a <kWh> kWh battery` when present + `.`); then each reason sentence from Task 3 exactly as written (no rewording); `Every figure here is an estimate until we survey your property.`; closing line from settings if set; sign-off: signer name, role, phone, email.
- Headline: chosen -> `Your chosen system`, else `The system we recommend`; plus the plain-words line from the mockup (`<Number word> panels[, one battery], your <facing>-facing roof.`).
- Cover rail labels (mono): `Prepared for`, `Recommended` (or `Your choice`), `Generation`, `Year-one saving`, `Estimated total`, `Quote`; plus the cover notice (exact) beside the figures.
- Quotation page: title, notice, numbered items (`01`...) with reason line under the item when present and `Priced by your installer` for `installerPriced`; total row `Estimated total` with `vatNote`; money block only when the total is complete; deposit row label exact (Global Constraints) with basis (`25% of the estimated total` or `Fixed deposit`); balance row `Balance, <balanceDue>`; `Valid until <d Month yyyy>`; `Notes` block (Sentinel line with price marked optional, option warnings, quote warnings, `estimatedFrom` sentence as stored, roof-limited, above-budget); MCS block when `opts.mcsBlock` (annual generation + the MCS disclaimer sentence from today's pdf.ts); acceptance block (`Signed` and `Date` lines and `To go ahead, contact <signer name> on <phone> or <email>.`); `Terms and conditions follow.` when `termsFollow`.

- [ ] **Step 1: Write failing tests** (render each page alone, extract text): reference prints `Q-` + 8 upper-case chars; the four exact estimate strings appear; deposit 25% of £13,277 prints `£3,319` and balance `£9,958`; fixed deposit above the total prints the total as deposit and `£0` balance; unpriced quote has no `Estimated total` figure and shows `Priced by your installer`; a reason line appears under the EV charger; chosen vs recommended headline; MCS block present only when asked; letter starts `Dear Sam,` for `Sam Patel` and `Hello,` with no name; no em dash in any extracted text; a 3-line address and long company name stay within the rail (text x within rail bounds).
- [ ] **Step 2: Run** `npx vitest run apps/api/test/proposal-pages-core.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat(proposal): cover and estimated quotation pages`.

### Task 8: System, Performance, Savings and Terms pages

**Files:**

- Create: `apps/api/src/proposal/pages/system.ts`, `pages/performance.ts`, `pages/savings.ts`, `pages/terms.ts`, `apps/api/src/proposal/terms.ts`
- Test: `apps/api/test/proposal-pages-rest.test.ts`, `apps/api/test/proposal-terms.test.ts`

**Interfaces:**

- Consumes: Tasks 6 and 7 (`ProposalDoc`, `Theme`).
- Produces: `drawSystem(pdf, doc, theme, opts: { othersHere: boolean })`, `drawPerformance(pdf, doc, theme)`, `drawSavings(pdf, doc, theme)`, `drawTerms(pdf, doc, theme)`; `parseTerms(text: string): ({ kind: 'heading'; text: string } | { kind: 'para'; text: string } | { kind: 'item'; marker: string; text: string })[]`.
- System: equipment entries (panels, inverter, battery, other line items of note) with `warrantyYears` from the catalogue when present; roof facts; the roof plan when present (drawn with dimensions, pitch, north arrow; caption `Sample` when `roofPlan.sample`); `Other options we looked at` table (size, battery, estimated total, generation, savings a year, payback) when `othersHere`.
- Performance: monthly generation chart and MCS installation data and calculation in the new style; keep today's MCS wording verbatim.
- Savings: cumulative chart with the negative label drawn clear of the axis (fixes `£-12,348` overlap: format negatives as `-£12,348`), year-one and 25-year figures, payback, environmental figures, assumptions.
- Terms parsing rules: normalise `\r\n`; blank line ends a paragraph; a line under 80 chars in capitals, or without terminal punctuation and followed by a paragraph, is a heading; lines starting with `\d+[.)]`, `-`, `•`, `◦`, `*` are items keeping their marker; long unbroken tokens are allowed to break anywhere.

- [ ] **Step 1: Write failing tests**: `parseTerms` on a Word-style paste (CRLF, tabs, `•` bullets, numbered `1.`/`2)`, curly quotes, a 300-char URL) yields the right kinds and no lost text; drawing that paste never writes beyond the page margins (all text positions within bounds) and spans more pages for 40,000 characters; system page lists warranties and the other-options table; savings page shows `-£` formatting and the label sits outside the bars; performance keeps the MCS disclaimer text verbatim.
- [ ] **Step 2: Run** both test files. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat(proposal): system, performance, savings and terms pages`.

### Task 13: PDF colours (added 2026-11-10 at the owner's request; runs after Task 8, before Task 9)

**Files:**

- Modify: `packages/contracts/src/quotation.ts` (+ its test), `apps/api/src/proposal/snapshot.ts` (+ snapshot test), `apps/api/src/proposal/layout.ts` (`themeFor`) (+ layout test)

**Interfaces:**

- `QuotationSettings.colours: { rail: string | null; accent: string | null }` (`#rrggbb`, lower-cased on parse; null = use Your brand colour). Default `{ rail: null, accent: null }`. Stored settings saved before this field existed must still parse (default it).
- `QuotationSnapshot` carries the resolved `colours: { rail: string; accent: string }` (brand colour where null, falling back as today when the brand colour is invalid).
- `themeFor(brandHex: string, opts?: { rail?: string; accent?: string }): Theme`: rail from `opts.rail` else brand, darkened keeping hue until white text >= 7:1; accent from `opts.accent` else brand, darkened until >= 4.5:1 on white. Export `readableRail(hex)` and `readableAccent(hex)` returning `{ hex: string; adjusted: boolean }` for Studio's "adjusted" note (Task 11 calls them through the GET/PUT response: add `colourNotes: { rail: { hex, adjusted }, accent: { hex, adjusted } }` to the quotation GET shape in `apps/api/src/routes/quotation.ts`).
- Task 9 builds the theme from `snapshot.colours`. Task 11 adds a "Colours" card (two colour inputs, each with `Use my brand colour`, and the note `Adjusted so text stays readable.` when adjusted) to the tab and its e2e test.

- [ ] **Step 1: Write failing tests**: defaults null; refuses `red` and `#12345`; lower-cases `#FF7900`; old stored settings without `colours` parse; snapshot resolves null to the brand colour; `themeFor('#0f2a3d', { rail: '#ffe066' })` rail gives white text >= 7:1 and `adjusted: true` for that rail; an explicit accent is used (darkened only if needed); GET returns `colourNotes`.
- [ ] **Step 2: Run** the three test files and `apps/api/test/quotation-routes.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat(quotation): installers choose the PDF colours`.

### Task 14: The roof as an architect's plan (added 2026-11-10 at the owner's request; runs after Task 13, before Task 9)

The first render looked unprofessional (one tilted face floating in a tinted box, heavy solid panels, a sideways label, page-aligned width/depth). Redraw per the spec's "Drawn as an architect's roof plan" paragraph.

**Files:**

- Modify: `apps/api/src/proposal/roof-plan.ts` (+ `apps/api/test/roof-plan.test.ts`), `apps/api/src/proposal/plan-drawing.ts` (+ its tests in the page test files), callers in `pages/cover.ts` and `pages/system.ts` only as needed

**Interfaces:**

- `RoofPlan` changes (all in metres, already rotated so the main face's eave is level, eave at the bottom of the drawing, y up):
  ```ts
  export interface RoofPlan {
    footprints: { outline: [number, number][]; partyEdges: number[] }[]; // the house's own polygon: every spec part's footprint.outer (holes ignored), partyEdges = indices of edges whose edgeKinds is 'party'
    neighbours: [number, number][][]; // attached neighbours only (context.neighbours[].attached), outer rings
    faces: {
      id: number;
      outline: [number, number][];
      pitchDeg: number;
      azimuthDeg: number;
      panelled: boolean;
    }[]; // every roof face
    lines: { kind: 'ridge' | 'hip' | 'valley'; from: [number, number]; to: [number, number] }[]; // shared edges between faces, classified
    panels: [number, number][][];
    bounds: { minX: number; minY: number; maxX: number; maxY: number };
    rotationDeg: number; // applied rotation; the north arrow points at (rotate plan-north by this)
    mainFace: {
      id: number;
      eaveM: number;
      rafterM: number;
      eave: [[number, number], [number, number]];
    }; // eave = lowest edge of the main face; rafter = slope length eave to ridge
    mainFacing: string;
    sample: boolean;
  }
  ```
  `dimensions` (axis-aligned) is removed. Null rules unchanged. Main face = the face holding most panels.
- Footprints and neighbours are in the same frame as the synthesised mesh (check synthesizeHouse's coordinate frame against `parts[].footprint` and transform if needed), rotated with everything else; bounds cover footprints and faces; attached neighbours are clipped to the drawing frame, never extend the bounds.
- `drawRoofPlan(pdf, plan, box, theme)`: the house footprint as the heavy wall line (party edges drawn as a double/dashed line), attached neighbours in faint line, white ground, thin frame rule, mono title block `ROOF PLAN · <FACING> · <pitch>° PITCH` (`· SAMPLE` when sample; flat roofs `ROOF PLAN · FLAT ROOF`), north arrow rotated by `rotationDeg`, faces in fine ink line (panelled faces slightly heavier), ridge/hip/valley lines, panels as fine-outlined cells with a light accent tint, one dimension line along the main eave (`EAVE 7.4 M`) and one along the main face's slope direction (`RAFTER 5.1 M`, the true slope length, not the plan length), all text level. No rounded boxes, no filled background.

- [ ] **Step 1: Write failing tests**: the sample house returns its footprint (4 corners, matching the spec's `parts[0].footprint.outer` after the same rotation, within 1 cm) with its two party edges, and its attached neighbour(s); every roof face lies within the footprint grown by the overhang (+5 cm); the sample house returns every face (both gable slopes) with `panelled` set only where panels are; a ridge line exists; after rotation the main eave is level (its two points share y within 1 cm) and lies at the bottom of the main face; `eaveM` and `rafterM` match the sample face's real edge lengths (within 5 cm); panels still inside their face after rotation; drawing text contains `ROOF PLAN`, `EAVE`, `RAFTER`, `SAMPLE` for the sample and no `OVERALL`; no rotated text (all pdfjs text items have a horizontal transform).
- [ ] **Step 2: Run** `npx vitest run apps/api/test/roof-plan.test.ts apps/api/test/proposal-pages-core.test.ts apps/api/test/proposal-pages-rest.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**; render the cover and system page to PNG and check against the spec paragraph.
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat(proposal): the roof drawn as an architect's plan`.

### Task 9: Assemble the document

**Files:**

- Modify: `apps/api/src/proposal/pdf.ts` (orchestrator: page order cover, system, performance, savings, quotation, terms; skip off sections; `mcsBlock` = performance off; `othersHere` = system on; page numbers `NN / MM`), `apps/api/src/proposal/index.ts` (`proposalInputFor` builds `ProposalDoc`: snapshot or `snapshotFor(tenant, undefined)`, logos from the brand store (snapshot `logoAssetId` else Your brand's wordmark/icon), accreditation PNGs, roof plan from `deps.sunscan.getArtefact(tenant.id, assessmentId, 'spec.json')` with the quote's panel count and the summary's `reliable`), and `apps/api/src/routes/proposal.ts` only as needed to pass the brand store and sunscan deps
- Test: update `apps/api/test/proposal.test.ts`

- [ ] **Step 1: Write failing tests**: default quote renders 5 pages (no terms) and with terms on 6+; turning off system/performance/savings removes those pages and moves `Other options we looked at` onto the quotation page and adds the MCS block; a quote with a snapshot renders the snapshot's deposit/validity/T&Cs even after the tenant's settings change (render twice, compare extracted text); validity date = createdAt + days; quote without an assessment renders with no roof plan and no error; existing route tests (visitor PDF, email, portal lead PDF) still pass.
- [ ] **Step 2: Run** `npx vitest run apps/api/test/proposal.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**; remove now-dead code from the old pdf.ts.
- [ ] **Step 4: Run** `npx vitest run apps/api/test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(proposal): the redesigned quotation PDF`.

### Task 10: Preview and sample PDF

**Files:**

- Create: `apps/api/assets/sample/quote.json` (a sample `QuoteRecord` shape with the sample address; panel count that fits the sample house), helper `apps/api/src/proposal/sample.ts`
- Modify: `apps/api/src/routes/quotation.ts`, `tests/security/tenant-isolation.test.ts`
- Test: extend `apps/api/test/quotation-routes.test.ts`

**Interfaces:**

- Produces:
  - `POST /v1/portal/tenants/:tenantId/quotation/preview` (viewer): body `{ settings }` (unsaved allowed, validated) returns `application/pdf` rendered from the sample quote re-priced from the tenant's published list when there is one (`buildQuote` with the sample answers), else demo pricing; roof plan from the sample house with `sample: true`. Rate-limited per tenant (30 per minute). Never reads a real lead.
  - `GET /v1/portal/tenants/:tenantId/quotation/sample.pdf` (viewer): the same with saved settings, `content-disposition: attachment; filename="<company>-sample-quotation.pdf"`.
- [ ] **Step 1: Write failing tests**: preview returns a PDF whose text contains the unsaved T&Cs heading and the sample address and `Sample`; sample.pdf uses saved settings; viewer can preview; another tenant's member gets 404 (sweep); preview with invalid settings is 400.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): quotation preview and sample PDF`.

### Task 11: The "Your quotation" Studio tab

**Files:**

- Create: `apps/marketing/components/dashboard/quotation/{quotation-tab.tsx,settings-form.tsx,logo-fields.tsx,accreditations.tsx,section-switches.tsx,pdf-preview.tsx}`
- Modify: `apps/marketing/app/dashboard/studio/page.tsx` (fourth tab, `?tab=quotation`), `apps/marketing/lib/portal-api.ts` (types and calls for Tasks 2 and 10), `apps/marketing/app/dashboard.css`
- Test: `tests/e2e/quotation-tab.spec.ts`; update `tests/e2e/dashboard.spec.ts` if tab counts are asserted

- Layout per the first mockup (`.superpowers/brainstorm/57124-1794264688/content/quote-pdf-tab.html`): left column cards (Logo, Signed by, Accreditations, What the PDF includes, Deposit and validity, Letter, Your terms and conditions); right column sticky preview with page chips (Cover, System, Performance, Savings, Quotation, Terms; only those present) that jump the embedded PDF (`<iframe>` of a blob URL with `#page=N`), refreshed 800 ms after the last change; `Download a sample PDF` button; `Save quotation` and `Unsaved changes` as on other tabs. Cover and Quotation switches locked with `Always shown`. Deposit as a segmented control (Percentage / Fixed amount / None) with its input. Validity shows the example date text `Shown as a date, for example "Valid until <date>".`. Viewers: all inputs disabled, no save, preview still works. Copy uses the assistant's name where it refers to the assistant.
- [ ] **Step 1: Write failing e2e tests**: open `?tab=quotation`; set signer, MCS number, deposit 25%, validity 45, paste T&Cs with a heading, turn performance off; the preview refreshes and the Quotation chip is present and Performance chip is gone; save, reload, values persist; upload a PDF logo and an accreditation logo; viewer sees everything read-only; `Download a sample PDF` downloads a file whose name ends `-sample-quotation.pdf`.
- [ ] **Step 2: Run** `MARKETING_PORT=4196 npx playwright test tests/e2e/quotation-tab.spec.ts --workers=1`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same plus `tests/e2e/dashboard.spec.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(studio): the quotation tab`.

### Task 12: Visual check and whole suite

**Files:**

- Test: `apps/api/test/proposal-visual.test.ts` (renders the sample PDF to PNGs via `pdfjs-dist` + `@napi-rs/canvas` or an equivalent already in the repo; writes them to `.cache/shots/quotation/` when `SUNNY_SHOTS_DIR` is set; asserts page count and that no text item lies outside the page)

- [ ] **Step 1:** Write and run the visual test; open the PNGs and compare with the mockup option B; fix visual gaps (spacing, overlaps, AI-looking elements: no rounded stat cards, no coloured banner blocks, no underline bars).
- [ ] **Step 2: Run** `npm test`, typecheck, lint, prettier (per Global Constraints), `npm run test:firestore`, and `MARKETING_PORT=4196 npx playwright test tests/e2e/quotation-tab.spec.ts tests/e2e/dashboard.spec.ts tests/e2e/conversation-editor.spec.ts --workers=1`. Expected: all pass.
- [ ] **Step 3: Commit** `test(proposal): visual check of the redesigned quotation`.
