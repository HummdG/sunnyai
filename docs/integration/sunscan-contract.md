# SunScan integration contract

**Project:** Sunny.ai — `C:\Work\Arkalith\sunny-ai`
**Updated:** 12 October 2026 (owner decision: use SunScanV2, vendored, not hosted)

This document has two parts. **Part A** is the current, working integration:
SunScanV2's address-to-3D-house engine, copied into this repository and called
in-process. **Part B** is the original discovery-era contract for the separate
SunScan web application (its questionnaire "journey" and pricing), kept because
the quote journey still draws on that discovery.

---

# Part A — The vendored SunScanV2 engine (current)

## A.1 Provenance

- **Source:** `C:\Work\Arkalith\SunScanV2` (no git; read-only — nothing there was modified).
- **Copied:** 12 October 2026. **Content hash** of the 214 copied source files
  (sha256 over the sorted list of `path NUL bytes NUL`, first 16 hex digits):
  **`5d6ecd873787aa38`**, over `packages/core/{src,test}`,
  `apps/server/src/{buildings,elevation,geocode,http,imagery,pipeline,providers}`,
  `apps/server/src/contracts.ts`, `apps/server/{data,test}`,
  `apps/web/src/three` and `apps/web/src/lib/{format,time}.ts`.

| Sunny package                                         | From SunScanV2                                                            | What changed                                                                                                                                                                                                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/sunscan-core` (`@sunny/sunscan-core`)       | `packages/core`                                                           | Import names only. Raw-fixture paths point at `fixtures/sunscan/raw`; one outline-count test narrowed to the vendored addresses.                                                                                                                              |
| `packages/sunscan-engine` (`@sunny/sunscan-engine`)   | `apps/server/src` minus `app.ts`, `main.ts`, `cli.ts`, `routes/`          | Now a library: the Fastify app, routes and CLI are dropped and `src/index.ts` (Sunny) exports the pipeline. Fixture dir default is `fixtures/sunscan/http`. Tests that went through the dropped HTTP app are removed; the rest run on the vendored addresses. |
| `packages/sunscan-viewer` (`@sunny/sunscan-viewer`)   | `apps/web/src/three`, `lib/format.ts`, `lib/time.ts`, four DOM-free tests | `Viewer.highlightRoofFaces()` added; `src/index.ts` (Sunny) wraps the viewer as `mountRoofViewer()`. No React, no Leaflet.                                                                                                                                    |
| `packages/sunscan-adapter` (`@sunny/sunscan-adapter`) | —                                                                         | Sunny's typed adapter.                                                                                                                                                                                                                                        |

- **Fixtures:** `fixtures/sunscan/raw/` (research data for 20 Forthlin Road,
  Mendips and the Dylan Thomas birthplace, plus Carnegie's birthplace for one
  COG test) and `fixtures/sunscan/http/` (5.4 MB of recorded provider
  responses — exactly the entries those suites read, found by tracing a run
  against SunScanV2's full 17 MB set). The other addresses' coverage stays in
  SunScanV2's own suite.
- **Compiler settings:** the vendored packages compile under
  `tsconfig.sunscan.json` (SunScanV2's strict settings, without
  `noUncheckedIndexedAccess`, which its geometry was not written against — 3,297
  errors under the root config). The strict root project sees the adapter and
  the viewer only through hand-written declarations (`src/public.d.ts`, selected
  by the `sunny-facade` export condition); `src/facade-check.ts` fails the
  SunScan typecheck if an implementation stops matching its declaration.
  `npm run typecheck` runs both projects. Vendored files are excluded from
  Sunny's lint and Prettier, so a diff against SunScanV2 shows only Sunny's
  changes; Sunny-written files in those packages are linted.

## A.2 Providers and keys

Every data source is **open UK data and needs no API key**:

| Stage                     | Providers                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| Geocoding                 | Nominatim (OSM; its 1 request/s policy is enforced), Photon, postcodes.io                        |
| Footprints                | Overpass (OSM), Overture Maps buildings (PMTiles)                                                |
| Heights (LiDAR)           | Environment Agency composite (England), Welsh Government (Wales), Scottish Remote Sensing Portal |
| Datum                     | OS OSTN15 grid, shipped in `packages/sunscan-engine/data/ostn15`                                 |
| Ground texture (optional) | Esri World Imagery tiles                                                                         |

`SUNSCAN_HTTP_MODE` is `live` (default; cached under `.cache/http`), `record`
(live plus fixture writes) or `replay` (fixtures only, no network — tests and
demos). `SUNSCAN_USER_AGENT` overrides Sunny's identifying, contact-free
User-Agent. `SUNSCAN_ENABLED=0` switches assessments off.
`SUNSCAN_ARTEFACT_DIR` sets where model files go (default
`<dataDir>/sunscan-artefacts`).

**Live mode has not been run from Sunny.** Replay mode is verified end to end;
the first live run should be watched (provider rate limits, Overpass failover).

## A.3 API (visitor surface)

All routes take the widget **session token**. An assessment belongs to the
session that started it; any other session or tenant gets `not_found`, exactly
as a missing id does. The security sweep (`tests/security`) covers every route
and credential.

| Route                                                              | Purpose                                                              |
| ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `POST /v1/sunscan/assessments` `{address?, postcode?, lat?, lon?}` | Start one (202, status `queued`). 5 per session per 10 minutes.      |
| `GET /v1/sunscan/assessments/:id`                                  | Status and summary (`sunscanAssessmentSchema`).                      |
| `GET /v1/sunscan/assessments/:id/model.glb`                        | Binary glTF of the house and its neighbours.                         |
| `GET /v1/sunscan/assessments/:id/spec.json`                        | The engine's `HouseModelSpec`; the viewer rebuilds the mesh from it. |

Statuses run `queued → running → succeeded | low-confidence | failed`.
`low-confidence` means the engine flagged the LiDAR fit as unreliable or had no
LiDAR: the roof is an estimate and is never presented as measured. Failures
carry a code: `address-not-found`, `address-ambiguous` (a postcode or a street,
not one house), `outside-uk`, `no-building`, `provider-unavailable`,
`engine-error`.

Records are tenant-scoped in the Store (`saveSunScanAssessment` and
`getSunScanAssessment`, in both FileStore and FirestoreStore); model files go to
an `ArtefactStore` (disk today). **Production gap:** Cloud Run's disk is
ephemeral, so a Cloud Storage `ArtefactStore` is needed before deploying (the
interface is in place). Jobs run on an in-process queue with concurrency 1;
`JobQueue` is the seam for Cloud Tasks.

## A.4 In chat

- `start_sunscan_assessment {address}` starts an assessment, waits up to 25 s,
  emits a `sunscan` stream event (id, status, summary) and returns the
  `RoofAssessmentSummary` to the model. A slow one is reported as running and
  the widget polls.
- `get_sunscan_result {assessmentId}` returns the `RoofAssessmentSummary`, for
  this conversation's assessments only.
- The widget shows a roof card ("about N m² usable … room for up to K panels
  (estimate)", with the indicative label) and a **See your roof in 3D** button.
  That loads `sunny-roof.js` (three.js and the house synthesis, about 198 kB
  gzipped, fetched only on that press; the main widget stays about 45 kB) and
  opens the viewer inside the panel: orbit, a sun-time slider with real shadows,
  the suitable planes highlighted, a plane list that highlights one plane on
  hover or focus, and a text summary for anyone who cannot use the canvas.

## A.5 `RoofAssessmentSummary` — the stable hand-off to the quote journey

Exported by `@sunny/sunscan-adapter`; `toRoofAssessmentSummary(record)` builds
it from a finished assessment (null while running, or when it failed). Fields
are only ever added, never renamed or removed.

- `assessmentId`, `status`, `address`, `postcode`, `builtForm`, `era`,
  `storeys`, `roofType`, `eaveHeightM`
- `roofPlanes[]`: `id`, `partId`, `pitchDeg`, `azimuthDeg` (bearing of the
  downslope, null when flat), `facing`, `areaM2`, `planAreaM2`, `widthM` (along
  the eave), `slopeLengthM`, `fillRatio`, `usableAreaM2`, `maxPanels`,
  `suitable`
- `suitableRoofAreaM2`, `usableRoofAreaM2`, `estimatedMaxPanels`,
  `mainPlaneId`, `bestFacing`
- `obstructions.chimneys`; `shadingFlags`, which always includes
  `shading-not-assessed` because shading is **not** simulated
- `confidence {geocode, footprint, heights, roof}`, `reliable`, `flags`,
  `notes`, `sources`, and `label` ("Indicative — subject to an on-site survey")

**Assumptions** (`ROOF_LAYOUT`, exported). A plane is _suitable_ when it faces
67.5°–292.5° (east through south to west) at 10°–60° pitch with at least 4 m²,
or is flat. _Usable_ area keeps 0.4 m clear of every edge and is scaled by how
much of its bounding rectangle the plane fills. _maxPanels_ packs a
1.722 × 1.134 m module, in the better orientation, into that rectangle, scaled
the same way. These are geometry estimates — not yield and not structural
suitability. A quote that uses another module, or the installer's own setback,
should recompute from `widthM`, `slopeLengthM` and `fillRatio`.

## A.6 What is left

- A Cloud Storage `ArtefactStore` and a Cloud Tasks `JobQueue` for production.
- A first live-mode run, and fixtures recorded for more addresses.
- Shading simulation: SunScanV2 has the sun model, but it is not wired into the
  summary.
- The installer's view of assessments in the dashboard. The viewer is
  React-wrappable: call `mountRoofViewer(div, { spec })` in an effect and
  `dispose()` in its cleanup.

---

# Part B — The SunScan web application (discovery-era, 10 October 2026)

**Project:** Sunny.ai — `C:\Work\Arkalith\sunny-ai`
**Counterpart:** the SunScan web application, as recorded in `docs/discovery-sunscan.md`
**Plan:** _Sunny.ai — Executable Engineering Plan_ v1.0, §7.5
**Written:** 10 October 2026
**Status:** **Proposed and unverified.**

> **Nothing in this document has been verified against a running SunScan instance.**
> Every request and response shape below that is labelled **proposed** is a design
> proposal, not an observed contract. The SunScan data model, route paths, field
> names and error shapes that _are_ stated are quoted from `docs/discovery-sunscan.md`
> (itself a read-only extraction of the SunScan source), and are cited as such.
>
> The Sunny assistant today **does not call SunScan at all**. Every tool that would
> reach it returns `ok: false` with an explicit reason, rather than pretending. See
> §7.

---

## 1. What SunScan is

As recorded in `docs/discovery-sunscan.md`:

- A Next.js App Router application (server components + `route.ts` handlers),
  TypeScript, Prisma over PostgreSQL (Supabase), Zod request validation, Supabase
  Auth (magic link) and Supabase Storage for gated PDFs, Resend for email, and
  in-memory rate limiting.
- The questionnaire/wizard is called the **journey** in code; its single source of
  truth is `src/lib/journey/types.ts`.
- Tenants are **installers**, identified by a URL slug (`Installer.slug`, unique).
  Public routes are slug-scoped and unauthenticated; the installer admin dashboard is
  gated by Supabase Auth on `/admin/*`.
- It models a roof from an address, builds a priced **option set** (exactly three
  options), scores a lead, persists it and delivers it by email and optional CRM
  webhook.

Sunny is the assistant that sits on the installer's website; SunScan is the
installer's own calculator/assessment product. The integration is Sunny asking
SunScan to derive a roof, build options and persist a lead — never Sunny re-implementing
SunScan.

---

## 2. The SunScan data model the adapter must respect

Quoted from `docs/discovery-sunscan.md`; field and union names are load-bearing and
must not be renamed by the adapter.

### 2.1 Journey steps and their order

```ts
type StepId =
  | 'address'
  | 'roof'
  | 'roofFallback'
  | 'property'
  | 'usage'
  | 'lifestyle'
  | 'tariff'
  | 'existing'
  | 'motivation';

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

`roofFallback` is shown **only when** the derived roof confidence is `'low'`:
`visibleSteps(state)` filters `roofFallback` on `state.roof?.confidence === 'low'`.

**Note:** the question set Sunny ships in `apps/api/src/questionnaire.ts`
(`QUESTIONNAIRE_VERSION = 'sunscan-2026-01'`, moved there from `agent/tools.ts` when
the branch below arrived) is a **subset** of SunScan's journey: it has no `lifestyle`
step and folds `roofFallback` into `roof`. A future adapter must reconcile that
difference; it is not reconciled today.

**Reconciled so far:** the usage branch. SunScan's `canAdvance` resolves the `usage`
step with a `switch` on `usage.source` and requires a different value per branch
(`docs/discovery-sunscan.md` §1.3); Sunny now mirrors that with three conditional
follow-ups (`annual_kwh`, `monthly_cost`, `household_size`), exactly one of which
applies per source, instead of asking every visitor for an annual kWh figure. The
branch was mirrored, the _step_ was not: SunScan keeps these as sub-fields of
`usage`, and Sunny keeps them as separate question ids, because Sunny's questionnaire
has no nested field shapes. `roofFallback` is still folded into `roof` — SunScan gates
it on a _derived_ roof's low confidence, and Sunny has no roof derivation, so the
visitor's self-reported `roof_confidence` is a different quantity and is deliberately
not used as the gate.

**Reconciled since: correctness on correction (D-31).** The branch made a correction
possible to get wrong — change the usage source and the previous branch's answer is no
longer an answer to anything — and Sunny now reconciles the standing map after every
write, dropping and reporting the answers the visitor's own later answer ruled out. This
is not read off SunScan's journey, which publishes no equivalent rule; it is the
consequence of implementing the branch, and it is recorded here because an adapter
mapping Sunny's answers onto SunScan's journey has to decide what to send for a question
the visitor changed their mind about. Sunny sends nothing for an answer it has dropped
(it is not in the map), which is the only reading consistent with the journey's own
conditionality.

### 2.2 Field unions (authoritative names)

`PropertyType`, `Ownership`, `RoofConfidence`, `RoofSizeBand`, `RoofDirection`,
`ShadingLevel`, `UsageSource`, `TariffType`, `ExistingSystem`, `LifestyleTag`,
`Motivation`, `FinanceInterest` — all defined in `src/lib/journey/types.ts`, verbatim
in `docs/discovery-sunscan.md` §1.4. Sunny's `QUESTIONS` reuses these option strings
for the fields it collects.

### 2.3 Lead submission (the one route Sunny must call)

`POST /api/[installerSlug]/lead` — validated by a Zod `Body`, verbatim in
`docs/discovery-sunscan.md` §2.4. The body's shape:

```
{
  outcome: 'report' | 'survey',
  surveyType?: 'remote' | 'onsite' | 'installer_choice' | null,
  contact: {
    firstName, lastName, email, phone?, addressRaw, postcode,
    preferredContact?, bestTime?, comments?, consent: boolean
  },
  journey: {
    uprn?, lat?, lng?,
    roof: { confidence, maxPanelCount, kwpPotential, pitchDeg?, mcsOrientationDeg?, roofType? },
    propertyType, ownership,
    usage: { source, annualKwh, monthlyCostGbp },
    tariffType, existing, lifestyle[], motivation, budgetBandId, financeInterest
  },
  optionSet: { recommendedId, options: OptionSchema[] },
  selectedStep?: { priceGbp } | null
}
```

Documented success response (`route.ts:360-370`):

```json
{
  "ok": true,
  "leadId": "<cuid>",
  "band": "hot|warm|nurture",
  "reportUrl": "<signed PDF url | null>",
  "delivery": { "emailSent": true, "emailSkipped": false, "webhookAttempts": 0 }
}
```

`reportUrl` is populated only when `outcome === 'report'` and `lat`/`lng` are present.

### 2.4 Lead scoring (recorded, not proposed)

`scoreLead()` is deterministic. Band: `score >= 8 ? 'hot' : score >= 4 ? 'warm' : 'nurture'`.
The full point model is in `docs/discovery-sunscan.md` §3. Sunny does **not** reproduce
this; it must read `band` from the response, never compute it.

### 2.5 Pricing, options and the "Sentinel" layer

- `POST /api/[installerSlug]/journey/results` builds the `OptionSet` (exactly three
  `OptionResult`s, `OptionKind = 'budget_fit' | 'better_value' | 'recommended'`).
- `POST /api/quote/preview` returns `{ quote }`; `POST /api/quote/tiers` returns
  `{ presets }`; `GET /api/pricing/catalogue` returns `{ catalogue }`.
- **There is no APR / interest / finance-repayment calculator and no subsidy/grant
  constant** (`docs/discovery-sunscan.md` §6.7). Sunny must never present finance rates
  or subsidies as fact.

### 2.6 Multi-tenancy

- Tenant = installer, keyed by slug. Sunny's `Tenant` already carries `sunscanSlug` and
  `sunscanUrl` (`apps/api/src/tenants.ts`), and `resolveSunscanUrl` reads
  `SUNSCAN_URL_<SLUG>` or `SUNSCAN_BASE_URL`. That is the correct join key.
- `resolveInstaller(slug)` returns `null` (→ 404) for unknown **or suspended**
  installers.
- Public routes are unauthenticated, slug-scoped. **No server-to-server credential for
  a third party is documented.**

---

## 3. Tool-to-SunScan mapping

Which of the assistant's approved tools (§7.1) correspond to a real SunScan surface and
which do not.

| Sunny tool                    | SunScan surface (recorded)                                                               | Correspondence                 | Adapter note                                                                                                                                                                                                                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `retrieve_knowledge`          | none                                                                                     | **No API**                     | SunScan has no knowledge/document/RAG route. Sunny's own retrieval is separate.                                                                                                                                                                                                   |
| `get_questionnaire`           | journey step machine in `src/lib/journey/types.ts`                                       | **Code, not an API**           | The question set is a client-side library and reductions; there is no HTTP endpoint to fetch it. The adapter cannot "ask SunScan" for questions.                                                                                                                                  |
| `save_answer`                 | journey is a pure reducer (`createInitialJourneyState` + actions)                        | **No API**                     | SunScan persists no individual answer mid-journey; answers are submitted wholesale at lead time. Mid-journey persistence would have to be a new SunScan feature — **blocked on a human decision**.                                                                                |
| `search_catalogue`            | `GET /api/pricing/catalogue` → `{ catalogue }`                                           | **Candidate API (unverified)** | The route is **not slug-scoped** (it is `/api/pricing/catalogue`, not `/api/[installerSlug]/...`), so it is unclear whether it returns a per-installer catalogue. **Unknown — needs verification.** Seeded product rows live in `prisma/seed.ts` (instance data, not a contract). |
| `validate_compatibility`      | quote engine + option scoring                                                            | **No dedicated API**           | Nearest is `POST /api/quote/preview`. There is no standalone compatibility-check endpoint.                                                                                                                                                                                        |
| `recommend_packages`          | `POST /api/[installerSlug]/journey/results` → `OptionSet`                                | **Candidate API (unverified)** | Returns exactly three priced options; the right surface for recommendations, but the exact request body is not recorded.                                                                                                                                                          |
| `calculate_approved_estimate` | `POST /api/quote/preview` → `{ quote }`; `POST /api/quote/tiers` → `{ presets }`         | **Candidate API (unverified)** | `computeQuote` is deterministic and catalogue-driven; VAT is 0 (`vatRatePercent = 0`).                                                                                                                                                                                            |
| `start_sunscan_assessment`    | `POST /api/[installerSlug]/journey/derive-roof` → `{ roof: {...} }`                      | **Candidate API (unverified)** | Synchronous: it models and returns the roof immediately. Confidence maps from geometry source: `google_solar→high`, `os_ngd→medium`, `estimated→low`.                                                                                                                             |
| `get_sunscan_result`          | none                                                                                     | **No API**                     | SunScan has **no async assessment resource** with an id/status to poll — `derive-roof` returns the roof in one call. The plan's "assessment creation/status → real result" flow has no counterpart.                                                                               |
| `create_lead`                 | `POST /api/[installerSlug]/lead`                                                         | **Real API**                   | The one endpoint with a recorded request/response contract (§2.3). Shape mismatch: Sunny's `create_lead` collects `{name, email, phone, postcode, consent, summary}`, while SunScan requires `firstName`/`lastName`, an `optionSet`, and a full `journey`.                        |
| `request_callback`            | folded into the lead (`outcome: 'survey'`, `surveyType`, `preferredContact`, `bestTime`) | **No dedicated API**           | A callback is a lead with survey intent, not a separate route.                                                                                                                                                                                                                    |
| `handoff_to_human`            | `InstallerConfig.notificationEmail`, `crmWebhookUrl`                                     | **No API**                     | No handoff route; notification is by email/webhook at lead time.                                                                                                                                                                                                                  |
| `suggest_page_action`         | not a SunScan concern                                                                    | **Not applicable**             | Host-page behaviour; unrelated to SunScan.                                                                                                                                                                                                                                        |

**Summary:** one tool (`create_lead`) maps to a documented SunScan API; four map to
_candidate_ APIs that look right but whose exact contracts are unrecorded
(`search_catalogue`, `recommend_packages`, `calculate_approved_estimate`,
`start_sunscan_assessment`); eight have **no** SunScan surface at all.

---

## 4. Proposed request/response shapes

All shapes in this section are **PROPOSED** by Sunny. They are not SunScan's contract.
Any field not quoted from `docs/discovery-sunscan.md` is invented by this document and
must be verified before use.

### 4.1 Proposed adapter interface (Sunny side)

Proposed to live in `packages/sunscan-adapter` (currently empty):

```ts
// PROPOSED — none of this exists yet.
export interface SunscanAdapter {
  deriveRoof(input: {
    slug: string;
    address: { raw: string; lat: number; lng: number; uprn?: string };
  }): Promise<{
    confidence: 'high' | 'medium' | 'low';
    maxPanelCount: number;
    kwpPotential: number;
  }>;

  buildOptions(input: {
    slug: string;
    journey: SunscanJourney;
  }): Promise<{ recommendedId: string; options: unknown[] }>; // OptionSchema not recorded

  createLead(
    input: { slug: string; body: LeadBody }, // LeadBody as recorded in §2.3
  ): Promise<{ leadId: string; band: 'hot' | 'warm' | 'nurture'; reportUrl: string | null }>;
}
```

### 4.2 PROPOSED: derive a roof

**Proposed request** — `POST {sunscanUrl}/api/{slug}/journey/derive-roof`
(the path is recorded; the body is **proposed**):

```jsonc
{
  "address": { "raw": "…", "lat": 51.5, "lng": -0.1, "uprn": "…", "postcode": "…" },
}
```

**Proposed response** (the `roof` object's field names _are_ recorded; the wrapper is not):

```jsonc
{
  "roof": {
    "source": "google_solar|os_ngd|estimated",
    "confidence": "high|medium|low",
    "maxPanelCount": 0,
    "kwpPotential": 0,
    "pitchDeg": 0,
    "mcsOrientationDeg": 0,
    "roofType": "pitched|flat|ground",
    "insights": null,
  },
}
```

### 4.3 PROPOSED: build the option set

**Proposed request** — `POST {sunscanUrl}/api/{slug}/journey/results` (path recorded; body
**proposed**): the assembled `JourneyState` (address, roof, roofFallback, propertyType,
ownership, usage, lifestyle, tariffType, existing, motivation, budgetBandId,
financeInterest) plus `intent` (`'estimate' | 'survey'`).

**Proposed response** (the `OptionSet` shape is partially recorded):

```jsonc
{
  "options": [/* exactly 3 OptionResult, price-ascending */],
  "recommendedId": "budget_fit|better_value|recommended",
  "context": {},
  "warnings": [],
}
```

### 4.4 PROPOSED: create a lead

**Proposed request** — `POST {sunscanUrl}/api/{slug}/lead`. This one **has a recorded
contract** (`docs/discovery-sunscan.md` §2.4); Sunny must build exactly the recorded
`Body`, filling it from the conversation:

| Sunny has                    | SunScan `Body` path                                  | Mapping note                                                                |
| ---------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------- |
| visitor name (single string) | `contact.firstName`, `contact.lastName`              | Must be split; Sunny's `create_lead` takes one `name`.                      |
| `email`, `phone`, `postcode` | `contact.email`, `contact.phone`, `contact.postcode` | Direct.                                                                     |
| consent flag                 | `contact.consent`                                    | Required; server-enforced on both sides.                                    |
| collected answers            | `journey.*`                                          | Requires `roof`, `optionSet` — which Sunny does not have without §4.2/§4.3. |
| —                            | `outcome` (`'report'                                 | 'survey'`), `optionSet`                                                     | **Mandatory and not derivable from Sunny's current tools.** |

This is the central gap: SunScan's lead body requires an `optionSet` and a `roof`,
neither of which Sunny can produce today. **Blocked on access to `journey/results` and
`journey/derive-roof`.**

### 4.5 PROPOSED inbound: receiving leads by webhook

SunScan can POST a signed webhook to `InstallerConfig.crmWebhookUrl`
(`event: 'lead.created'`, header `X-Sunscan-Signature`, HMAC-SHA256 hex, up to 3 attempts
with linear backoff). A proposed inbound path for Sunny would be to receive that webhook
instead of writing leads itself — but the event shape is a CRM payload, not a Sunny
lead, and the payload's field names are recorded in `docs/discovery-sunscan.md` §2.7.
**Proposed; unverified.**

---

## 5. Error handling — the adapter must not assume one shape

**SunScan has no unified error envelope.** `docs/discovery-sunscan.md` §5.2 records that
error shapes differ per route. The adapter therefore must **not** model SunScan errors as
a single type; it must map each route's observed shape.

Recorded error shapes:

| Surface                | Status              | Body                                                                                                    |
| ---------------------- | ------------------- | ------------------------------------------------------------------------------------------------------- |
| Lead validation        | 400                 | `{ error: 'bad-request', issues: <Zod issues> }`                                                        |
| Lead consent           | 400                 | `{ error: 'consent-required' }`                                                                         |
| Lead unknown installer | 404                 | `{ error: 'unknown-installer' }`                                                                        |
| Any rate limit         | 429                 | `{ error: 'rate-limited', … }` + `Retry-After` header                                                   |
| Admin auth             | 401                 | `{ error: 'unauthorized' }`                                                                             |
| `derive-roof`          | 400/404             | `{ error: 'bad-request' }` / `{ error: 'unknown-installer' }`                                           |
| `report/generate`      | 422                 | `{ error: <message>, reason: 'no-footprint' \| 'no-roof-data' \| 'low-ocr-confidence' \| 'no-tariff' }` |
| `bill/parse`           | 400/413/415/503/500 | `{ success: false, … }` — a different shape again                                                       |
| Server errors          | 500                 | `{ error: <message> }`                                                                                  |
| Other routes           | 404/400             | `{ error: 'Not found' }`, `{ error: 'Invalid body' }`, `{ error: 'Invalid request' }`                   |

Consequence for Sunny: the internal unified envelope
(`packages/contracts/src/errors.ts`, 9 codes) is fine for Sunny's **own** APIs but
**must not be presented as describing SunScan**. Note that `errors.ts` contains a
comment claiming it "mirrors the convention already used by SunScan" — that comment is
wrong; see `docs/discovery.md` §4.6.

Rate limits the adapter must respect (recorded): lead 10 / 60 s, results 20 / 60 s,
derive-roof 30 / 60 s, in-memory per IP. Sunny must handle `429` with backoff, not
retry immediately.

---

## 6. Tenancy

- The adapter must send the installer **slug** (`Tenant.sunscanSlug`), never a Sunny
  `tenantId`, and must resolve the base URL from `resolveSunscanUrl`
  (`SUNSCAN_URL_<SLUG>` or `SUNSCAN_BASE_URL`), which returns `null` when unset.
- A `null` SunScan URL means the deployment is not connected for that tenant; the tools
  already treat that as "not connected" and refuse (`tools.ts`,
  `ctx.sunscanConnected`).
- When no SunScan URL is configured for **any** tenant, `SunscanAdapter` must remain
  unconstructed and every dependent tool must keep returning `ok: false`. This is
  already how the current code behaves.

---

## 7. What the assistant does today (it reports these as unavailable)

The assistant does **not** claim any SunScan capability it does not have. From
`apps/api/src/agent/tools.ts`:

- `search_catalogue` → `{ ok: false, products: [], connected: false }` ("I cannot reach
  this installer's catalogue in this environment, so I will not quote specific products
  or prices"), or, when "connected", `pending: 'catalogue-sync-not-implemented'`.
- `start_sunscan_assessment` → `{ ok: false, connected: false }` ("The roof assessment
  service is not connected…"), or `pending: 'assessment-not-implemented'`.
- `get_sunscan_result` → always `{ ok: false }` ("I have no assessment to look up").
- `recommend_packages` → always `{ ok: false }`.
- `calculate_approved_estimate` → always `{ ok: false }`.
- `retrieve_knowledge` → `configured: false` or `pending: 'ingestion-not-implemented'`.

`ctx.sunscanConnected` is derived in `apps/api/src/main.ts` / `tenants.ts` from whether
a SunScan URL is configured. Even when it is `true`, the tools return
`pending: '…-not-implemented'` — because **no adapter code exists**
(`packages/sunscan-adapter/src` is empty) and no HTTP call to SunScan is made anywhere
in the codebase.

---

## 8. Unverified — needs verification

To be resolved before any of this can be called a contract:

- **Unknown — needs verification:** whether the candidate routes
  (`journey/results`, `journey/derive-roof`, `quote/preview`, `quote/tiers`,
  `pricing/catalogue`) accept a request from a third-party server at all, and their exact
  request bodies.
- **Unknown — needs verification:** whether `GET /api/pricing/catalogue` returns a
  per-installer catalogue or a single global one (it is not slug-scoped).
- **Unknown — needs verification:** the `OptionSchema` / `OptionResult` fields required
  in the lead `optionSet` (partially recorded in `docs/discovery-sunscan.md` §2.4 and §6.5).
- **Unknown — needs verification:** whether any server-to-server authentication exists,
  or whether Sunny must call the unauthenticated slug-scoped public routes.
- **Unknown — needs verification:** SunScan's CORS policy for a browser call from the
  widget (assumed: server-to-server only from Sunny's API).
- **Unknown — needs verification:** whether SunScan exposes an assessment resource with
  an id and status, or only the synchronous `derive-roof`.
- **Unknown — needs verification:** whether there is a non-production SunScan instance
  (staging/sandbox) safe to test against, and its base URL.
- **Unknown — needs verification:** the exact lead `journey.lifestyle` values SunScan
  expects when the conversation collected none.

---

## 9. Blocked on a human decision or on access

| Item                                                | Blocked on                                                                                                                       |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Any live call to SunScan                            | **Access** — a reachable SunScan base URL and, if it exists, a credential.                                                       |
| Verifying the candidate routes' request bodies      | **Access** — a running instance or the route source (the source is off-limits; only `docs/discovery-sunscan.md` may be read).    |
| Server-to-server auth model                         | **Human decision** — whether Sunny is allowed to call SunScan's public routes, or whether SunScan must add a service credential. |
| Mid-journey answer persistence (`save_answer`)      | **Human decision / SunScan change** — SunScan has no such endpoint; adding one modifies SunScan, which requires permission.      |
| Building the `optionSet` for a lead                 | **Access** — depends on `journey/results`, which is unverified.                                                                  |
| Assessment id/status polling (`get_sunscan_result`) | **Human decision / SunScan change** — no such resource exists today.                                                             |
| Production integration acceptance                   | **Blocked** until verified integration tests pass (plan §7.5).                                                                   |
| Receiving leads by inbound webhook                  | **Human decision** — CRM-webhook direction and signature handling; the payload is a CRM event, not a Sunny lead.                 |
| Testing the integration in CI                       | **Access** — no sandbox instance is known.                                                                                       |

Until these are resolved, the assistant continues to report these capabilities as
unavailable rather than pretending — which is the documented product decision, not a
placeholder.
