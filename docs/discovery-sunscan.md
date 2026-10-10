# SunScan (web app) — Data Contract Extraction

Read-only extraction of the data contract of the `sunscan` Next.js web application, for an
integration adapter. Every claim is cited as `relative/path/to/file.ts:line` relative to the app
root `C:\Work\Arkalith\SunScan\sunscan`. Where something is not present, this report says
**NOT PRESENT** rather than guessing.

Stack observed: Next.js App Router (server components + `route.ts` handlers), TypeScript, Prisma ORM
over PostgreSQL (Supabase), Zod request validation, Supabase Auth (magic-link) + Supabase Storage
for gated PDFs, Resend for email, in-memory rate limiting.

Terminology note: the "questionnaire/wizard" is called the **journey** in code. The single source of
truth is `src/lib/journey/types.ts`.

---

## 1. Questionnaire / wizard

### 1.1 Step machine (single source of truth)

Defined in `src/lib/journey/types.ts`.

`StepId` union (`src/lib/journey/types.ts:119-121`):

```ts
export type StepId =
  | 'address'
  | 'roof'
  | 'roofFallback'
  | 'property'
  | 'usage'
  | 'lifestyle'
  | 'tariff'
  | 'existing'
  | 'motivation';
```

`STEP_ORDER` (`src/lib/journey/types.ts:123-126`):

```ts
const STEP_ORDER: StepId[] = [
  'address',
  'roof',
  'roofFallback',
  'property',
  'usage',
  'lifestyle',
  'tariff',
  'existing',
  'motivation',
];
```

`STEP_META` — display label + short code per step (`src/lib/journey/types.ts:128-138`):

| StepId         | label              | code     |
| -------------- | ------------------ | -------- |
| `address`      | `Your address`     | `SITE`   |
| `roof`         | `Your roof`        | `ROOF`   |
| `roofFallback` | `Roof details`     | `ROOF+`  |
| `property`     | `Your property`    | `PROP`   |
| `usage`        | `Electricity use`  | `USE`    |
| `lifestyle`    | `Energy lifestyle` | `LIFE`   |
| `tariff`       | `Your tariff`      | `TARIFF` |
| `existing`     | `Existing system`  | `EXIST`  |
| `motivation`   | `Goals & budget`   | `GOALS`  |

The wizard is a pure reducer over `JourneyState` (no DOM/IO) — `createInitialJourneyState`
(`src/lib/journey/types.ts:89-115`). Actions: `SET_ADDRESS`, `SET_ROOF`, `PATCH_ROOF_FALLBACK`,
`SET_PROPERTY_TYPE`, `SET_OWNERSHIP`, `PATCH_USAGE`, `TOGGLE_LIFESTYLE`, `SET_TARIFF`, `SET_EXISTING`,
`SET_MOTIVATION`, `SET_BUDGET`, `SET_FINANCE`, `NEXT`, `BACK`, `GOTO` (`src/lib/journey/types.ts:158+`).

### 1.2 Conditional logic (which answers reveal/hide a step)

`visibleSteps(state)` (`src/lib/journey/types.ts:144-149`):

```ts
export function visibleSteps(state: JourneyState): StepId[] {
  return STEP_ORDER.filter((id) => {
    if (id === 'roofFallback') return state.roof?.confidence === 'low';
    return true;
  });
}
```

So the **`roofFallback` step ("Roof details") is only shown when the modelled roof confidence is
`'low'`** — i.e. when roof derivation fell back to an estimate. All other steps are always in the
flow. Current step index is clamped to the visible list (`src/lib/journey/types.ts:151-154`).

### 1.3 Required/optional + validation rules per step

Gating for the "Next"/continue button lives in `canAdvance(state, step)` in
`src/components/journey/StartWizard.tsx:83-126`:

```ts
case 'address':      return state.address?.confirmed === true
case 'roof':         return true
case 'roofFallback': { const f = state.roofFallback
                       return f.sizeBand !== null && f.direction !== null && f.shading !== null }
case 'property':     return state.propertyType !== null && state.ownership !== null
case 'usage': {      const u = state.usage
                     if (u.source === null) return false
                     switch (u.source) {
                       case 'bill_ocr':
                       case 'manual_kwh':   return u.annualKwh !== null
                       case 'monthly_cost': return u.monthlyCostGbp !== null
                       case 'household':    return u.householdSize !== null
                       default:             return false } }
case 'lifestyle':    return true   // "Select all that apply" — empty is valid
case 'tariff':       return state.tariffType !== null
case 'existing':     return state.existing !== null
case 'motivation':   return state.motivation !== null && state.budgetBandId !== null
                            && state.financeInterest !== null
```

Per-step questions — field key (as used in `JourneyState`) → display label → input type → options:

**Step `address`** (component `src/components/journey/steps/AddressStep.tsx`).

- `address.raw` / `address.lat` / `address.lng` / `address.postcode` / `address.uprn?` / `address.confirmed`.
- Address search (text input) → `GET /api/os/address?q=...` (`AddressStep.tsx:42`); picking a result
  sets `AddressState`; confirming calls `POST /api/${installerSlug}/journey/derive-roof`
  (`AddressStep.tsx:66`). Required to continue: `address.confirmed === true`.
- `AddressState` type (`src/lib/journey/types.ts:30-37`): `{ raw, lat, lng, postcode, uprn?, confirmed }`.

**Step `roof`** (component `src/components/journey/steps/RoofStep.tsx`).

- Read-only display of the derived `RoofState` (no user input gates it; `canAdvance` returns `true`).
- `RoofState` type (`src/lib/journey/types.ts:39-49`): `{ source: GeometrySource; confidence:
'high'|'medium'|'low'; maxPanelCount: number; kwpPotential: number; pitchDeg: number;
mcsOrientationDeg: number; roofType: 'pitched'|'flat'|'ground'; insights:
GoogleSolarBuildingInsights | null }`.

**Step `roofFallback`** ("Roof details", `src/components/journey/steps/RoofFallbackStep.tsx`). Only
when confidence is low. Three sub-questions, all required:

- `roofFallback.sizeBand` — label `Roof size`, options (`RoofFallbackStep.tsx:13-18`):
  `small` ("Small"), `medium` ("Medium"), `large` ("Large"), `unsure` ("I'm not sure").
- `roofFallback.direction` — label `Main roof direction`, options (`RoofFallbackStep.tsx:20-29`):
  `south`, `south_east`, `south_west`, `east`, `west`, `east_west` ("East & west (both slopes)"),
  `north`, `unsure`.
- `roofFallback.shading` — label `Shading`, options (`RoofFallbackStep.tsx:31-37`):
  `none` ("No shading"), `trees` ("Some trees nearby"), `buildings` ("Nearby buildings"),
  `heavy` ("Heavy shading"), `unsure`.

**Step `property`** (`src/components/journey/steps/PropertyStep.tsx`).

- `propertyType` — label `Property type` (single-select), options (`PropertyStep.tsx:7-14`):
  `detached`, `semi`, `terraced`, `bungalow`, `flat`, `other`.
- `ownership` — label `Ownership` (single-select), options (`PropertyStep.tsx:16-23`):
  `own`, `mortgage`, `rent`, `social`, `landlord`, `other`. Choosing `rent`/`social` surfaces an
  on-screen permission note (fixture in the component).
- Both required.

**Step `usage`** (`src/components/journey/steps/UsageStep.tsx`).

- `usage.source` — label `How would you like to tell us about your usage?` (single-select), options
  (`UsageStep.tsx:14-35`):
  - `bill_ocr` — "Upload my electricity bill" (uploads to `POST /api/bill/parse`, `UsageStep.tsx:60`)
  - `manual_kwh` — "Enter my annual kWh"
  - `monthly_cost` — "Enter my typical monthly cost"
  - `household` — "I don't know" → household-size picker
- `householdSize` — options `1`..`4`, `5` ("5 or more") (`UsageStep.tsx:37-43`); stored as int.
- `usage.annualKwh`, `usage.monthlyCostGbp`, `usage.unitRatePence`, `usage.standingChargePence`,
  `usage.exportTariffPence`, `usage.supplier` are the numeric sub-fields
  (`src/lib/journey/types.ts:57-66`).
- Required per `canAdvance`: `source` non-null and the branch-specific value present.

**Step `lifestyle`** (`src/components/journey/steps/LifestyleStep.tsx`).

- `lifestyle` — multi-select array, optional. Options (`LifestyleStep.tsx:7-15`):
  `home_daytime`, `evening_use`, `ev_now`, `ev_planned`, `heatpump_now`, `heatpump_planned`,
  `high_daytime`.

**Step `tariff`** (`src/components/journey/steps/TariffStep.tsx`).

- `tariffType` — single-select, required. Options (`TariffStep.tsx:7-14`): `standard`, `economy7`,
  `smart_tou`, `import_export`, `already_exports`, `unknown`.

**Step `existing`** (`src/components/journey/steps/ExistingStep.tsx`).

- `existing` — single-select, required. Options (`ExistingStep.tsx:7-13`): `none`, `solar`,
  `battery`, `solar_battery`, `unsure`.

**Step `motivation`** ("Goals & budget", `src/components/journey/steps/MotivationStep.tsx`).

- `motivation` — single-select, required. Options (`MotivationStep.tsx:13-22`): `reduce_bills`,
  `price_protection`, `cheap_tariffs`, `earn_export`, `independence`, `carbon`, `home_value`,
  `exploring`.
- `budgetBandId` — budget band selection, required (bands are installer-configured; see §1.4).
- `financeInterest` — single-select, required. Options (`MotivationStep.tsx:24-29`): `yes`, `no`,
  `maybe`, `learn_more`.

### 1.4 Field unions (verbatim type definitions)

`src/lib/journey/types.ts:9-26`:

```ts
export type PropertyType = 'detached' | 'semi' | 'terraced' | 'bungalow' | 'flat' | 'other';
export type Ownership = 'own' | 'mortgage' | 'rent' | 'social' | 'landlord' | 'other';
export type RoofConfidence = 'high' | 'medium' | 'low';
export type RoofSizeBand = 'small' | 'medium' | 'large' | 'unsure';
export type RoofDirection =
  'south' | 'south_east' | 'south_west' | 'east' | 'west' | 'east_west' | 'north' | 'unsure';
export type ShadingLevel = 'none' | 'trees' | 'buildings' | 'heavy' | 'unsure';
export type UsageSource = 'bill_ocr' | 'manual_kwh' | 'monthly_cost' | 'household';
export type TariffType =
  'standard' | 'economy7' | 'smart_tou' | 'import_export' | 'already_exports' | 'unknown';
export type ExistingSystem = 'none' | 'solar' | 'battery' | 'solar_battery' | 'unsure';
export type LifestyleTag =
  | 'home_daytime'
  | 'evening_use'
  | 'ev_now'
  | 'ev_planned'
  | 'heatpump_now'
  | 'heatpump_planned'
  | 'high_daytime';
export type Motivation =
  | 'reduce_bills'
  | 'price_protection'
  | 'cheap_tariffs'
  | 'earn_export'
  | 'independence'
  | 'carbon'
  | 'home_value'
  | 'exploring';
export type FinanceInterest = 'yes' | 'no' | 'maybe' | 'learn_more';
```

`JourneyState` (`src/lib/journey/types.ts:72-87`):

```ts
export interface JourneyState {
  intent: JourneyIntent; // 'estimate' | 'survey'
  stepIndex: number;
  address: AddressState | null;
  roof: RoofState | null;
  roofFallback: RoofFallbackState; // { sizeBand, direction, shading } (each | null)
  propertyType: PropertyType | null;
  ownership: Ownership | null;
  usage: UsageState;
  lifestyle: LifestyleTag[];
  tariffType: TariffType | null;
  existing: ExistingSystem | null;
  motivation: Motivation | null;
  budgetBandId: string | null;
  financeInterest: FinanceInterest | null;
}
```

### 1.5 Budget bands + survey options (installer-configurable)

Defaults in `src/components/journey/InstallerWizard.tsx`:

- `DEFAULT_BUDGET_BANDS` (`InstallerWizard.tsx:6-12`) — ids: `under_6k`, `6k_10k`, `10k_15k`,
  `15k_plus`, `unsure` with `{ id, label, minGbp, maxGbp }`.
- `DEFAULT_SURVEY_OPTIONS` (`InstallerWizard.tsx:14`): `{ remote: true, onsite: true,
installerChoice: true }`.
- Installer-configured bands/options come from `InstallerConfig.budgetBandsJson` /
  `surveyOptionsJson` (`parseBudgetBands`/`parseSurveyOptions`, `InstallerWizard.tsx:16-37`).

### 1.6 Contact + outcome capture (results screen)

`src/components/journey/ResultsView.tsx`. The home-owner chooses `outcome` (`'report'` or
`'survey'`; survey adds a `surveyType` in `{remote, onsite, installer_choice}` —
`surveyChoices`, `ResultsView.tsx:391-399`). Contact fields (`ContactForm`, `ResultsView.tsx:351-362`):
`firstName`, `lastName`, `email`, `phone`, `addressRaw`, `postcode`,
`preferredContact` (`'' | 'email' | 'phone'`), `bestTime`, `comments`, `consent`.
Client validation `contactIsValid` (`ResultsView.tsx:379-388`) requires: `firstName`, `lastName`,
`email` matching `EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/` (`ResultsView.tsx:349`), `addressRaw`,
`postcode`, and `consent === true`. Submission POSTs the built lead body to
`/api/${installerSlug}/lead` (`ResultsView.tsx:560-564`). `buildLeadBody`
(`ResultsView.tsx:489-516`) sends `{ outcome, surveyType?, contact, journey, optionSet, selectedStep }`.

`LeadJourney` payload built by the wizard (`src/components/journey/ResultsView.tsx:20-41`,
assembled in `src/components/journey/StartWizard.tsx:28-55`).

---

## 2. Lead schema

### 2.1 Persistence location

Prisma model `Lead` in `prisma/schema.prisma:164-230` (PostgreSQL via Prisma). It relates to
`Installer` (`installerId`), optionally to `Report` (`reportId String? @unique`), and has many
`WebhookDelivery`. Indexes: `@@index([installerId, createdAt])`, `@@index([installerId, leadScore])`
(`prisma/schema.prisma:228-229`). Persistence is "persist-first": the row is created before any
delivery (`src/app/api/[installerSlug]/lead/route.ts:197-240`).

### 2.2 Lead model fields (verbatim, `prisma/schema.prisma:164-230`)

```prisma
model Lead {
  id          String    @id @default(cuid())
  createdAt   DateTime  @default(now())
  installerId String
  installer   Installer @relation(fields: [installerId], references: [id])
  reportId    String?   @unique
  report      Report?   @relation(fields: [reportId], references: [id])

  leadSource String // slug / embed / utm

  // Contact
  firstName  String
  lastName   String
  email      String
  phone      String?
  addressRaw String
  postcode   String
  uprn       String?

  // Property + roof
  propertyType           String // detached|semi|terraced|bungalow|flat
  ownership              String // own|mortgage|rent|social|landlord
  permissionFlag         Boolean @default(false)
  roofConfidence         String // high|medium|low
  maxPanelCount          Int
  systemSizePotentialKwp Float

  // Usage + tariff
  usageSource    String // bill_ocr|manual_kwh|monthly_cost|household
  annualKwh      Float
  monthlyCostGbp Float?
  tariffType     String
  existingSolar  String // new|upgrade|retrofit|optimisation
  evStatus       String // none|now|planned
  heatPumpStatus String
  lifestyleTags  String[]

  // Commercials
  motivation      String?
  budgetBandId    String
  financeInterest Boolean @default(false)

  // Generated options snapshot
  optionsJson         Json // OptionResult[] (3)
  recommendedOptionId String
  sentinelShown       Boolean @default(false)
  paybacksJson        Json

  // Outcomes
  reportRequested  Boolean @default(false)
  surveyRequested  Boolean @default(false)
  surveyType       String? // remote|onsite|installer_choice
  preferredContact String?
  bestTime         String?
  comments         String?
  consent          Boolean @default(false)

  // Scoring + delivery
  leadScore        String // hot|warm|nurture
  leadScoreReasons String[]
  emailSentAt      DateTime?

  webhookDeliveries WebhookDelivery[]

  @@index([installerId, createdAt])
  @@index([installerId, leadScore])
}
```

Field-level notes derived from the write in `src/app/api/[installerSlug]/lead/route.ts:198-239`:

- `leadSource` is written as **the installer slug** (`leadSource: installerSlug`, line 201). (The
  webhook payload separately reports `leadSource: 'SunScan Calculator'`, line 246.)
- `permissionFlag` = `ownership === 'rent' || ownership === 'social'` (line 211).
- `existingSolar` is derived from the journey `existing` via `EXISTING_MAP` (see §2.4).
- `evStatus` / `heatPumpStatus` are derived: `now` / `planned` / `none` from the `lifestyle` array
  via `lifestyleStatus()` (`route.ts:102-106`, `220-221`).
- `annualKwh` defaults to `DEFAULT_ANNUAL_KWH` when absent (line 216).
- `tariffType` defaults to `'unknown'` (line 218).
- `budgetBandId` defaults to `'unsure'` (line 224).
- `financeInterest` is a **boolean** on the Lead model, true when the journey `financeInterest` is in
  `['yes','maybe','learn_more']` (line 225).
- `optionsJson` = the 3 `OptionResult` objects; `paybacksJson` = `{ kind, paybackYears,
sentinelUpliftPercent }[]` (`route.ts:191-195`).

### 2.3 Submission endpoint

`POST /api/[installerSlug]/lead` — `src/app/api/[installerSlug]/lead/route.ts:147`.

- Rate limit: key `'lead'`, limit `10`, window `60_000` ms (`route.ts:151`).
- Slug: the `[installerSlug]` dynamic segment; resolved to an `Installer` via `resolveInstaller`
  (`route.ts:154-156`); unknown/suspended → 404 `{ error: 'unknown-installer' }`.

### 2.4 Request body (Zod `Body`, verbatim — `src/app/api/[installerSlug]/lead/route.ts:50-95`)

```ts
const Body = z.object({
  outcome: z.enum(['report', 'survey']),
  surveyType: z.enum(['remote', 'onsite', 'installer_choice']).nullable().optional(),
  contact: z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    email: z.string().email(),
    phone: z.string().nullable().optional(),
    addressRaw: z.string(),
    postcode: z.string(),
    preferredContact: z.string().nullable().optional(),
    bestTime: z.string().nullable().optional(),
    comments: z.string().nullable().optional(),
    consent: z.boolean(),
  }),
  journey: z.object({
    uprn: z.string().nullable().optional(),
    lat: z.number().nullable().optional(),
    lng: z.number().nullable().optional(),
    roof: z.object({
      confidence: z.enum(['high', 'medium', 'low']),
      maxPanelCount: z.number(),
      kwpPotential: z.number(),
      pitchDeg: z.number().nullable().optional(),
      mcsOrientationDeg: z.number().nullable().optional(),
      roofType: z.string().nullable().optional(),
    }),
    propertyType: z.string(),
    ownership: z.string(),
    usage: z.object({
      source: z.string().nullable(),
      annualKwh: z.number().nullable(),
      monthlyCostGbp: z.number().nullable(),
    }),
    tariffType: z.string().nullable(),
    existing: z.string().nullable(),
    lifestyle: z.array(z.string()),
    motivation: z.string().nullable(),
    budgetBandId: z.string().nullable(),
    financeInterest: z.string().nullable(),
  }),
  optionSet: z.object({ recommendedId: z.string(), options: z.array(OptionSchema) }),
  selectedStep: z.object({ priceGbp: z.number() }).passthrough().nullable().optional(),
});
```

`OptionSchema` (per-option, `route.ts:~20-48`) includes: `kind` (OptionKind, see §6), `isRecommended?`,
`label`, `panelCount`, `systemKwp`, `priceGbp`, `panelType`, `inverterType`,
`batteryType` (nullable/optional), `batteryCapacityKwh`, `results` (`ResultsSchema`: `annualSavingsPounds`,
`paybackYears`, plus fields), `sentinel` (`{ enabled: boolean, upliftPercent: number }`), and
`.passthrough()`. The schema for `results` mirrors `SolarResults` (§6.4).

`EXISTING_MAP` (`route.ts:98-100`):

```ts
const EXISTING_MAP: Record<string, string> = {
  none: 'new',
  solar: 'upgrade',
  battery: 'retrofit',
  solar_battery: 'optimisation',
  unsure: 'new',
};
```

### 2.5 Success response

`route.ts:360-370`:

```json
{
  "ok": true,
  "leadId": "<cuid>",
  "band": "hot|warm|nurture",
  "reportUrl": "<signed PDF url | null>",
  "delivery": { "emailSent": true, "emailSkipped": false, "webhookAttempts": 0 }
}
```

`reportUrl` is populated only for `outcome === 'report'` when `lat`/`lng` are present (gated PDF
generation, `route.ts:280-356`).

### 2.6 Error envelope

- `404 { error: 'unknown-installer' }` (`route.ts:156`)
- `400 { error: 'bad-request', issues: <Zod issues> }` (`route.ts:160`)
- `400 { error: 'consent-required' }` when `contact.consent` is false (`route.ts:163-164`)
- `429 { error: 'rate-limited', ... }` from `rateLimit` (see §5).

### 2.7 Outbound webhook payload (CRM)

Built at `route.ts:242-268`; delivered signed by HMAC-SHA256 (see §5.5). Shape:

```json
{
  "event": "lead.created",
  "leadId": "<cuid>",
  "installer": "<slug>",
  "leadSource": "SunScan Calculator",
  "score": "hot|warm|nurture",
  "scoreValue": 7,
  "outsideCoverage": true,
  "outcome": "report|survey",
  "surveyType": "remote|onsite|installer_choice|null",
  "contact": { ...the request contact object... },
  "property": { "type": "<propertyType>", "ownership": "<ownership>" },
  "roof": { "confidence", "maxPanelCount", "kwpPotential", "pitchDeg?", "mcsOrientationDeg?", "roofType?" },
  "usage": { "source", "annualKwh", "monthlyCostGbp" },
  "tariffType": "standard|...|null",
  "budgetBandId": "under_6k|...",
  "recommendedOptionId": "budget_fit|better_value|recommended",
  "options": [ { "kind", "panelCount", "systemKwp", "priceGbp", "paybackYears", "sentinelUpliftPercent" } ],
  "createdAt": "<ISO>"
}
```

### 2.8 WebhookDelivery model

`prisma/schema.prisma:232+` — audit rows persisted per attempt by
`src/lib/lead/deliver.ts:48-62` (`leadId`, `url`, `attempt`, `status`, `httpStatus`, `responseBody`,
`signature`).

---

## 3. Lead scoring

Exact function: `scoreLead(i: LeadScoreInput): LeadScore` in `src/lib/lead/scoreLead.ts:29-66`.

Band thresholds (`src/lib/lead/scoreLead.ts:64`):

```ts
const band: LeadBand = score >= 8 ? 'hot' : score >= 4 ? 'warm' : 'nurture';
```

i.e. **≥8 = `hot`, 4–7 = `warm`, <4 = `nurture`**. The raw integer `score` is also returned and is
sent as `scoreValue` in the CRM webhook (`route.ts:248`). `reasons` is a `string[]` of
`"{+/-}{pts} {reason}"` entries (`scoreLead.ts:32-35`), persisted to `Lead.leadScoreReasons`.

Point model (all in `scoreLead.ts:37-62`):

| Input condition                                 | Points | Reason string                        |
| ----------------------------------------------- | ------ | ------------------------------------ |
| `ownership` is `own` or `mortgage`              | +2     | `owns property`                      |
| `ownership` is `rent` or `social`               | −3     | `renter / social housing`            |
| `propertyType === 'flat'`                       | −2     | `flat / apartment`                   |
| `hasUprn`                                       | +1     | `confirmed address`                  |
| `roofConfidence === 'high'`                     | +2     | `high roof-model confidence`         |
| `roofConfidence === 'medium'`                   | +1     | `medium roof-model confidence`       |
| `roofConfidence` low/other                      | −2     | `low / estimated roof confidence`    |
| `maxPanelCount >= 12`                           | +2     | `strong roof capacity`               |
| `usageSource === 'bill_ocr' or 'manual_kwh'`    | +1     | `bill / kWh provided`                |
| `usageSource === 'household'`                   | −1     | `usage from household estimate only` |
| `budgetMaxGbp > 8000`                           | +2     | `budget above £8k`                   |
| `0 < budgetMaxGbp <= 6000`                      | −2     | `low budget`                         |
| `surveyRequested`                               | +3     | `requested a survey`                 |
| `hasPhone`                                      | +2     | `provided phone`                     |
| else (no phone)                                 | −1     | `no phone number`                    |
| `lifestyle` includes `ev_now` or `heatpump_now` | +1     | `has EV / heat pump`                 |

`LeadScoreInput` (verbatim — `scoreLead.ts:5-17`):

```ts
export interface LeadScoreInput {
  ownership: string;
  propertyType: string;
  hasUprn: boolean;
  roofConfidence: 'high' | 'medium' | 'low';
  maxPanelCount: number;
  usageSource: string;
  budgetMaxGbp: number;
  reportRequested: boolean;
  surveyRequested: boolean;
  hasPhone: boolean;
  lifestyle: string[];
}
```

Note: `reportRequested` is part of the input type but **is not used** in the point model
(`scoreLead.ts:37-62`). The caller in the lead route maps journey fields → this input
(`route.ts:176-188`). `budgetMaxGbp` is resolved from the installer's `budgetBandsJson` by band id,
defaulting to `30000` (`route.ts:169-170`). `usageSource` defaults to `'household'` when null
(`route.ts:182`).

---

## 4. Multi-tenancy

### 4.1 Identification

Tenants are **installers**, identified by a URL slug. Model `Installer` (`prisma/schema.prisma:11-34`):
`id`, `slug String @unique`, `name`, `status String @default("active")` (`active | suspended`),
`catalogueVersion String @default("v1")`.

Resolution: `resolveInstaller(slug)` in `src/lib/tenant/resolveInstaller.ts:18-33` — looks up by
`slug`, `include: { config, branding }`, returns `null` if not found **or `status !== 'active'`**;
the result is cached in-memory for 5 minutes (`CACHE_TTL_MS`, `resolveInstaller.ts:10`).
`invalidateInstallerCache(slug?)` clears it (`resolveInstaller.ts:36-39`).

### 4.2 URL structure

- Public journey: `/[installerSlug]/` (landing), `/[installerSlug]/start` (wizard; `?intent=survey`
  or default `estimate` — `src/app/[installerSlug]/start/page.tsx:16-17`).
- Chromeless embed: `/embed/[installerSlug]`.
- Tenant layout resolves the installer and 404s (`notFound()`) when unknown; injects branding CSS
  variables `--brand-primary` / `--brand-accent` (`src/app/[installerSlug]/layout.tsx:11-24`).
- Tenant API surface: `/api/[installerSlug]/journey/derive-roof`, `/api/[installerSlug]/journey/results`,
  `/api/[installerSlug]/lead` (each resolves the slug itself).

### 4.3 Isolation + auth

- Public endpoints are unauthenticated but slug-scoped; config/branding come from the resolved
  `Installer` row, so one tenant cannot read another's config through these routes.
- The installer admin dashboard is gated by **Supabase Auth (magic link)**. `src/middleware.ts`
  refreshes the session and redirects unauthenticated users away from `/admin/*` to `/admin/login`
  (`middleware.ts:8-41`; matcher `['/admin/:path*']`, `middleware.ts:43-45`).
- Login uses `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: '.../auth/callback?next=/admin' } })`
  (`src/app/admin/login/page.tsx:17-20`); `GET /auth/callback` exchanges the code for a session.
- Admin API authorisation: `getInstallerSession()` resolves the Supabase user's email → `InstallerUser`
  (`src/lib/auth/session.ts`); `POST /api/admin/settings` returns `401 { error: 'unauthorized' }`
  when absent (`src/app/api/admin/settings/route.ts:29-31`). The config/branding update is scoped to
  `session.installerId` (`settings/route.ts:46-68`).
- `InstallerUser` (`prisma/schema.prisma:36-46`): `email @unique`, `role String @default("owner")`
  (`owner | staff`), `authUserId String? @unique` (Supabase `auth.uid()`).

### 4.4 Per-installer config

`InstallerConfig` (one-to-one with installer; `prisma/schema.prisma:48-81`) — assumptions
(`shadingLoss` 0.05, `inverterLoss` 0.03, `systemLoss` 0.10, `energyInflationRate` 0.03,
`panelDegradationPerYear` 0.005), sizing (`minPanels` 6, `maxPanels` 50, `marginPercent` 0),
sentinel (`sentinelEnabled` true, `sentinelConfigJson`), journey/presentation JSON
(`budgetBandsJson`, `surveyOptionsJson`, `coverageAreasJson`, `financeOptionsJson`, `warrantyJson`),
and lead routing (`notificationEmail`, `crmWebhookUrl?`, `crmWebhookSecret?`).
`InstallerBranding` (`prisma/schema.prisma:83-94`): `primaryColor` `#1d4ed8`, `accentColor`
`#f59e0b`, `logoUrl`, `companyTagline`, `contactPhone`, `contactEmail`, `privacyUrl`.

### 4.5 Coverage gating

`isInCoverage(postcode, coverageAreas)` in `src/lib/coverage.ts` — outward-code prefix match against
the installer's `coverageAreasJson`; empty list = serves everywhere. Used at lead time to set
`outsideCoverage` (`route.ts:171`).

---

## 5. API surface

All handlers live under `src/app/api/**/route.ts` (plus `src/app/auth/callback/route.ts`). Next.js
App Router conventions: each file exports `GET`/`POST`/`PUT`. Dynamic segments use `Promise<{...}>`
params.

| Method | Path                                       | Purpose                                                                                                                             | File                                                              |
| ------ | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| GET    | `/api/os/address?q=<query>`                | OS Places address autocomplete → `{ results: OsAddress[] }`; 500 `{ results: [], error: 'Address lookup failed' }`                  | `src/app/api/os/address/route.ts:4,16`                            |
| GET    | `/api/os/building?uprn=&lat=&lng=`         | OS NGD building footprint/geometry → `{ building }`; 400 `{ error: 'uprn is required' }`; 500 `{ error: 'Building lookup failed' }` | `src/app/api/os/building/route.ts:4,10,22`                        |
| GET    | `/api/solar/building?lat=&lng=`            | Google Solar building insights; 400 `lat and lng are required`; 404 `No Solar API data available for this location`; 500            | `src/app/api/solar/building/route.ts:4,9,15,20`                   |
| GET    | `/api/solar/datalayers?lat=&lng=&radius=`  | Google Solar data layers; 400 `lat and lng are required`; 500                                                                       | `src/app/api/solar/datalayers/route.ts:4,10,21`                   |
| POST   | `/api/bill/parse`                          | OCR a bill upload (multipart field `bill`, PDF/JPEG/PNG/WebP/HEIC, max 10 MB)                                                       | `src/app/api/bill/parse/route.ts:14`                              |
| POST   | `/api/[installerSlug]/journey/derive-roof` | Model roof from address → `{ roof: {source,confidence,maxPanelCount,kwpPotential,pitchDeg,mcsOrientationDeg,roofType,insights} }`   | `src/app/api/[installerSlug]/journey/derive-roof/route.ts:31`     |
| POST   | `/api/[installerSlug]/journey/results`     | Build the `OptionSet` from journey answers → returns the `OptionSet` JSON                                                           | `src/app/api/[installerSlug]/journey/results/route.ts:72,154-155` |
| POST   | `/api/[installerSlug]/lead`                | Persist + deliver a lead (see §2)                                                                                                   | `src/app/api/[installerSlug]/lead/route.ts:147`                   |
| POST   | `/api/quote/preview`                       | `{ config, reportId?, roofMaxPanels?, annualKwh?, roofType? }` → `{ quote }`                                                        | `src/app/api/quote/preview/route.ts:39,78`                        |
| POST   | `/api/quote/tiers`                         | `{ annualKwh, roofMaxPanels, roofType }` → `{ presets: TierPresetSummary[] }`                                                       | `src/app/api/quote/tiers/route.ts:14,44`                          |
| GET    | `/api/pricing/catalogue`                   | `{ catalogue }` (`dynamic = 'force-dynamic'`)                                                                                       | `src/app/api/pricing/catalogue/route.ts:6-8`                      |
| POST   | `/api/admin/settings`                      | Update installer config/branding (auth required → 401)                                                                              | `src/app/api/admin/settings/route.ts:28-30`                       |
| POST   | `/api/report/generate`                     | Full report generation → `{ reportId, pdfUrl, quoteNumber }`; 422 reject with `{ error, reason }`                                   | `src/app/api/report/generate/route.ts:89-90,109`                  |
| PUT    | `/api/report/[id]/configuration`           | Save a system config for a report; recompute quote + re-render PDF → `{ quote, pdfUrl }`                                            | `src/app/api/report/[id]/configuration/route.ts:45,153`           |
| GET    | `/api/report/[id]/pdf`                     | Stream/generate the report PDF; 404 `Not found`                                                                                     | `src/app/api/report/[id]/pdf/route.ts:6,15`                       |
| GET    | `/auth/callback?code=`                     | Supabase auth code → session exchange                                                                                               | `src/app/auth/callback/route.ts`                                  |

Page routes (for reference): `/` (marketing), `/[installerSlug]`, `/[installerSlug]/start`,
`/embed/[installerSlug]`, `/admin`, `/admin/login`, `/admin/settings`, `/report/[id]`, `/survey`
(legacy shim redirecting to `/hsenergy/start` — `src/app/survey/page.tsx:6-8`).

### 5.1 Rate limiting

`src/lib/rateLimit.ts` — in-memory fixed-window per IP. Returns `429 { error: 'rate-limited' }` with
a `Retry-After` header when exceeded. Applied to: lead (`limit 10`, `60_000` ms — `lead/route.ts:151`),
results (`20`, `60_000` — `results/route.ts:76`), derive-roof (`30`, `60_000` — `derive-roof/route.ts:35`).

### 5.2 Error envelope shapes (observed)

- Validation: `400 { error: 'bad-request' | 'Invalid body' | 'Invalid request', issues|details: <Zod> }`.
- Not-found/unknown: `404 { error: 'unknown-installer' | 'Not found' | 'Report not found' }`.
- Auth: `401 { error: 'unauthorized' }`.
- Rate limit: `429 { error: 'rate-limited' }`.
- Report generation rejects: `422 { error: <message>, reason: 'no-footprint' | 'no-roof-data' |
'low-ocr-confidence' | 'no-tariff' }` (`report/generate/route.ts:83-91`).
- Server errors: `500 { error: <message> }`.

There is **no single unified error envelope** — shapes differ per route (e.g. lead uses
`error`/`issues`, report/generate uses `error`/`reason`/`details`). The bill-parse route is the
notable exception, returning a `{ success: false, ... }` shape (see §5.3).

### 5.3 Bill parse responses

- `400 { success:false, error:'No file provided' }` (`bill/parse/route.ts:20`)
- `413 { success:false, error:'File too large (max 10MB)' }` (`:24`)
- `415 { success:false, error:'Unsupported file type...' }` (`:28-31`)
- `503 { success:false, requiresManualEntry:true, error:'Bill OCR is not configured...' }` (`:41-48`)
- Not-extracted: `{ success:false, requiresManualEntry:true, error:"We couldn't extract..." }` (`:54-58`)
- Success: `{ success:true, data: ParsedBill }` (`:61`); `ParsedBill` = `{ annualKwh,
tariffPencePerKwh, standingChargePencePerDay, exportTariffPencePerKwh, confidence }`
  (`src/lib/types.ts:58-64`).
- `500 { success:false, error:'Bill parsing failed...' }` (`:64-66`).

### 5.4 derive-roof response

`{ roof: { source, confidence, maxPanelCount, kwpPotential, pitchDeg, mcsOrientationDeg, roofType,
insights } }` (`derive-roof/route.ts:67-78`); `confidence` mapped from geometry source via
`CONFIDENCE = { google_solar: 'high', os_ngd: 'medium', estimated: 'low' }` (`:19-23`). Errors:
`404 { error:'unknown-installer' }` (`:40`), `400 { error:'bad-request' }` (`:44`).

### 5.5 CRM webhook delivery

`src/lib/lead/webhook.ts`: `deliverWebhook()` POSTs JSON with headers `X-Sunscan-Signature`
(HMAC-SHA256 of the raw body, hex — `signPayload`, `webhook.ts:19-22`) and `X-Sunscan-Event:
lead.created` (`webhook.ts:41-44`). Up to `maxAttempts = 3` with linear backoff `300 * attempt` ms
(`webhook.ts:31,61-63`). Returns per-attempt `{ attempt, status, httpStatus, responseBody, signature }`
(`webhook.ts:11-17`). Never throws; each attempt is persisted as a `WebhookDelivery` row
(`deliver.ts:48-62`).

---

## 6. Pricing / finance

### 6.1 What exists

A **deterministic, catalogue-driven pricing engine** (line-item quote builder) plus a **budget
ladder** and a **"Sentinel" optimisation layer** (indicative uplift). There is **no APR / interest /
finance-repayment calculator** and **no subsidy (e.g. grant) constant** — see §6.7.

### 6.2 Quote engine

`computeQuote(config, ctx)` in `src/lib/pricing/computeQuote.ts`. Output `QuoteBreakdown`
(`src/lib/pricing/types.ts:52-59`): `{ lineItems, subtotalsByCategory, totalPounds, vatRatePercent,
warnings, catalogueVersion }`. Line-item categories (`pricing/types.ts:32-41`): `pv`,
`panel_uplift`, `mounting`, `battery`, `scaffold`, `electrical`, `optional`, `trenching`, `admin`.

Quote sections (per `src/lib/pricing/computeQuote.ts`): PV base price by panel count; panel uplift;
inverter; mounting; battery (+ expansion + multi-unit discount, solar vs retrofit price); scaffold;
electrical (+ auto `STRUCT-FLATROOF-SURVEY` when `roofType === 'flat'`); optional extras (Tigo
optimisers, bird mesh — flat £600 up to 20 panels then +£30/panel over); trenching; mandatory admin
fee. Panel count is clamped to **1–50**.

Inputs (`PricingContext`, `pricing/types.ts:169-177`): `catalogue`, `roofMaxPanels`, `annualKwh`,
`roofType`. `SystemConfig` (`pricing/types.ts:8-30`) carries `tier` (`essential|standard|premium|custom`),
`panelSku`, `panelCount`, `mountingSku`, `inverterSku?`, `battery` (nullable), `scaffoldingExtras`,
`electricalExtras`, `optionalExtras`, `trenching`, `birdMesh`, `optimiserScope`, `optimiserPanelCount?`.

**VAT: `vatRatePercent` is 0** (no VAT applied) — the catalogue/quote sets VAT to zero.

### 6.3 Tier presets + sizing constants

`src/lib/pricing/tiers.ts`:

- `KWH_PER_KWP_UK = 950` (typical UK annual yield) — `tiers.ts:4`.
- `TIER_DEMAND_FACTOR` — `{ essential: 0.45, standard: 0.8, premium: 1.15 }` — `tiers.ts:11`.
- `targetPanelCountForTier` sizes from `annualKwh * demandFactor / KWH_PER_KWP_UK`, clamped to
  `minPanels..roofMaxPanels` — `tiers.ts:24-26`.
- `buildTierPresets`, `buildInclusions` also exported here.

Catalogue loader `src/lib/pricing/catalogueLoader.ts`: `CATALOGUE_VERSION = '2026-01'`, per-installer
load with 5-minute cache.

### 6.4 Solar physics / savings model

`src/lib/solarCalculations.ts`:

- `DEFAULT_PANEL` (`:5-11`): width 1134 mm, height 1722 mm, depth 30 mm, `wattPeak 430`,
  model `Generic 430W Monocrystalline`.
- `DEFAULT_ASSUMPTIONS` (`:13-25`): `roofPitchDeg 35`, `roofOrientationDeg 0` (0 = South, MCS),
  `shadingLoss 0.05`, `inverterLoss 0.03`, `systemLoss 0.10`, `systemCostPounds 8500`,
  `hasBattery false`, `batteryKwh 5.2`, `exportTariffPencePerKwh 15`, `energyInflationRate 0.03`,
  `panelDegradationPerYear 0.005`.
- `UK_GRID_CARBON_KG_PER_KWH = 0.233` (`:28`).
- `MONTHLY_GEN_WEIGHTS` (sum 1.0, `:32-45`), `MONTHLY_CONSUMPTION_WEIGHTS` (`:49-62`),
  `DAYS_IN_MONTH` (`:64`), `DAY_USE_RATIO = 0.25` (`:68`).
- Functions: `calcSystemSizeKw`, `calcAnnualGeneration` (systemKwp × irradianceKwhPerM2 ×
  performanceRatio; PR = (1−shading)(1−inverter)(1−system) — `:81-90`), `calcSelfConsumption`,
  `calcAnnualSavings`, `calcPayback` (returns 99 when savings ≤ 0), `calcCo2Saved`,
  `calcMonthlyGenProfile`, `calc25YearSavings`, `runSolarCalculationsFromGoogleData`,
  `runSolarCalculations`.

`SolarResults` (`src/lib/types.ts:133-145`): `annualGenerationKwh`, `selfConsumptionKwh`, `exportKwh`,
`selfConsumptionRate`, `annualSavingsPounds`, `paybackYears`, `co2SavedTonnesPerYear`,
`monthlyGenKwh[]`, `twentyFiveYearSavings[]` (`{ year, saving, cumulative }`).

### 6.5 Option set / budget ladder

`buildOptionSet(input: OptionSetInput): OptionSet` — `src/lib/recommend/buildOptionSet.ts:114`.

- `PV_MAX_PANELS = 50` (`:8`), `MIN_PANEL_GAP = 2` (`:13`), `COUNT_BAND = 0.25` (`:15`).
- `OptionKind = 'budget_fit' | 'better_value' | 'recommended'` (`src/lib/recommend/optionTypes.ts:7`).
  `KINDS_BY_PRICE = ['budget_fit','better_value','recommended']` (`buildOptionSet.ts:54`).
- `OptionSet` (`optionTypes.ts:47-59`): `options` (exactly 3, price-ascending), `recommendedId`,
  `context`, `warnings`, optional `ladder`.
- `OptionResult` (`optionTypes.ts:10-37`) incl. `priceGbp`, `systemKwp`, `paybackYears` (via nested
  `results`), `sentinel`, `inclusions`, `headline`, `bestSuitedTo`, `nextStep`, `score`, `warnings`,
  `aboveBudget`, `roofLimited`.

Budget ladder `src/lib/recommend/buildBudgetLadder.ts`: `MIN_PRICE_GAP = 400`,
`MAX_STEPS = 12`, `BATTERY_AFFINITY_FACTOR = 0.18`, plus
`TARIFF_AFFINITY` / `LIFESTYLE_AFFINITY` / `MOTIVATION_AFFINITY` / `EXISTING_AFFINITY` maps;
exports `buildBudgetLadder`, `activeStep`. Types `BudgetStep`, `TierStop`, `BudgetLadder` in
`src/lib/recommend/ladderTypes.ts`.

Option scoring `src/lib/recommend/evaluateConfig.ts`: `PAYBACK_TARGET_YEARS = 12`,
`PAYBACK_PENALTY_PER_YEAR = 150`, `EXPORT_PENALTY_PER_KWH = 0.04` (`:16-18`); functions
`net25YearValue`, `scoreOf`, `evaluateConfig`.

### 6.6 Sentinel "optimisation layer"

`src/lib/recommend/sentinel.ts`. `SentinelConfig` interface (`:5-20`): `enabled`,
`baseUpliftPercent`, `tariffModifiers`, `batteryRequiredForFullUplift`, `noBatteryUpliftFactor`,
`lifestyleBonus`, `capUpliftPercent`, `addedCostGbp`. `computeSentinelUplift` (`:43-56`):
`uplift = base + tariffModifier + Σ lifestyleBonus`, ×`noBatteryUpliftFactor` when no battery and
required, clamped to `capUpliftPercent`. `computeSentinel` (`:75-112`) returns
`{ enabled, withoutSentinel, withSentinel, upliftPercent, addedCostGbp, indicative: true }`;
`SentinelResult.indicative` is always `true`. Seeded config (`prisma/seed.ts`):
`baseUpliftPercent 0.12`, `noBatteryUpliftFactor 0.4`, `capUpliftPercent 0.3`, `addedCostGbp 0`.

### 6.7 Finance / subsidy — NOT PRESENT

- **No APR / interest rate / finance repayment / loan calculator exists.** The only finance-related
  artefacts are: the journey question `financeInterest` (union `'yes' | 'no' | 'maybe' | 'learn_more'`,
  §1.4), the `Lead.financeInterest Boolean` flag, and `InstallerConfig.financeOptionsJson Json`
  (`prisma/schema.prisma:74`) which is seeded as `{ available: true, providers: [] }` with no
  providers and is not used in any pricing calculation found. → **APR/finance module: NOT PRESENT.**
- **No subsidy / grant / SEG-bonus constant exists** beyond the SEG export rate. → **Subsidy
  constants: NOT PRESENT.** (Export rate is modelled via `exportTariffPencePerKwh`, default 15 p/kWh.)

### 6.8 Regional tariff + consumption constants

`src/lib/tariff.ts`: `DEFAULT_TARIFF` (`:38-44`) = `{ importPencePerKwh: 24.5,
standingChargePencePerDay: 53, segExportPencePerKwh: 15, regionName: 'National average',
source: 'default' }`; `getTariffForPostcode` does longest-prefix lookup over `data/regional_tariffs.csv`
(`tariff.ts:75-86`). NOTE: the CSV itself was **not read** (excluded — see Provenance).

`src/lib/consumption.ts`: `TDCV_ELECTRICITY_KWH = { low: 1800, medium: 2700, high: 4100 }`
(`:12-16`), `DEFAULT_ANNUAL_KWH = TDCV_ELECTRICITY_KWH.medium` (`:19`), `MIN_ANNUAL_KWH = 100`,
`MAX_ANNUAL_KWH = 100000` (`:22-23`).

`src/lib/mcs.ts`: `getZoneForPostcode` (defaults zone `'1'`), `getIrradianceKwhPerM2` (defaults
`900` kWh/m²).

### 6.9 Fallback roof → system mappings (results route)

`src/app/api/[installerSlug]/journey/results/route.ts:50-56`:

```ts
const SIZE_BAND_PANELS = { small: 8, medium: 14, large: 22 };
const DIRECTION_MCS = {
  south: 0,
  south_east: 45,
  south_west: 45,
  east: 90,
  west: 90,
  east_west: 90,
  north: 180,
};
const SHADING_LOSS = { none: 0.03, trees: 0.1, buildings: 0.12, heavy: 0.25 };
```

`resolveAnnualKwh` (`:58-70`): annual kWh → monthly-cost/unit-rate → TDCV band → `DEFAULT_ANNUAL_KWH`.

### 6.10 Catalogue seed (HSEnergy) — hard-coded product data

`prisma/seed.ts` seeds `INSTALLER_SLUG = 'hsenergy'`, name `'HSEnergy Residential'`. Catalogue:
PV base price table for panel counts 1–50 (e.g. 1 → £3985 … 50 → £19673); panels
`DMEGC-DM430` (base), `DMEGC-DM455` (+7.5%), `REA-HD96-460` (+8%), `REA-HD108-450-ENPHASE`
(+£150/panel); inverters `FOX-H1-3.7`, `SE-SE5000H` (default), `FOX-H3-8.0`; batteries `FOX-EC2900`,
`FOX-EQ4800`, `FOX-EVO-1024`, `TESLA-PW3`; extras including `ELEC-ADMIN-FEE` £350 (mandatory),
`STRUCT-FLATROOF-SURVEY` £261, `OPT-BIRDMESH`, Tigo optimiser SKUs, EV, EPS; trenching tiers.
Seeded sentinel config and budget bands (`under_6k`, `6k_8k`, `8k_10k`, `10k_12k`, `12k_15k`,
`15k_plus`, `unsure`), `COVERAGE_AREAS: []`, `FINANCE_OPTIONS: { available: true, providers: [] }`.
(Exact numeric product rows live in `prisma/seed.ts`; the values above are indicative of the seed and
should be read from that file for a pricing adapter — the seed is the instance data, not the
catalogue contract.)

### 6.11 Environment variables

`.env.example`: `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_SERVICE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
`OS_API_KEY`, `OPENAI_API_KEY`, `FAL_KEY`, `NEXT_PUBLIC_APP_URL`. Note `src/middleware.ts:13` reads
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — that name is **not** listed in `.env.example` (possibly
added later). (`OPENAI_API_KEY`/`FAL_KEY` are for report imagery; bill OCR uses Mistral via
`src/lib/billParser.ts`, model names `mistral-ocr-latest` + `mistral-small-latest`.)

---

## 7. Provenance and limits

### 7.1 Directories read

- `C:\Work\Arkalith\SunScan\sunscan` — the web app (the ONLY source tree read). Specifically:
  - `sunscan\src\` — `app/` (all `route.ts` handlers and `page.tsx` pages), `components/`
    (journey wizard + steps, results view, admin), `lib/` (journey, lead, tenant, pricing, recommend,
    auth, solar, mcs, tariff, consumption, types), `middleware.ts`.
  - `sunscan\prisma\` — `schema.prisma`, `seed.ts` (and migration presence noted, but migration `.sql`
    files were not individually opened).
  - `sunscan\.env.example`, `sunscan\package.json` listing, directory listings.
- Output written to `C:\Work\Arkalith\sunny-ai\docs\discovery-sunscan.md` (this file). That is the
  only file created or modified anywhere.

### 7.2 Explicitly NOT read (excluded by the task scope, and honoured)

- `C:\Work\Arkalith\SunScan\roof-yolo` — **not read**.
- `C:\Work\Arkalith\SunScan\house3d` — **not read**.
- The nested `C:\Work\Arkalith\SunScan\sunscan\house3d` — **not read** (avoided to stay conservative).
- All PDFs and CSVs under the parent folder — **not opened**. This includes
  `docs/**/*.pdf` and `data/*.csv` (e.g. `data/regional_tariffs.csv`). Consequently the concrete
  contents of `regional_tariffs.csv` are not reproduced here; only the loader and its fallback
  constants (`src/lib/tariff.ts`) are documented.

### 7.3 Method / correctness caveats

- Read-only throughout. No build, tests, or dev server were run; no file under
  `C:\Work\Arkalith\SunScan` was created, modified, or deleted.
- Where a numeric constant is cited from `prisma/seed.ts` (product price rows and seeded catalogue
  values), those values are indicative and should be read directly from `prisma/seed.ts` before being
  hard-coded into an adapter (the seed is instance data, not the catalogue contract). Constants quoted
  from `src/lib/**` (solar defaults, pricing, consumption, tariff fallback, scoring) were verified
  against source. The type/identifier contract (field names, unions, route shapes, Zod schemas) is
  quoted verbatim from source and is authoritative.
- Identifier strings (field names, union members, error codes, header names, endpoint paths) are the
  load-bearing part of this report and are quoted exactly as they appear in the cited files. If any
  quoted string disagrees with the source, the source wins — cite the file:line above.
- "NOT PRESENT" is used only where the cited search was performed and found nothing (notably APR /
  finance calculations and subsidy constants in §6.7).
