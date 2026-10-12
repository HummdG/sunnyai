# The quote journey

Address → 3D roof (SunScanV2, `@sunny/sunscan-adapter`) → questionnaire →
three priced options (SunScan v1's engine, `@sunny/quote-engine`) → consent →
lead. Owner requirement, 2026-10-12.

## Who decides what

The server decides everything: what to ask next (`journey/journey.ts`, a pure
state machine over the session's standing answers), whether an answer is valid
(`questionnaire.ts`), and every figure (`journey/quote.ts`). The model only
words the question and proposes answers. Prices come from the tenant's
published price list on the server, never from a request.

## The questions

Sunny's questionnaire mirrors SunScan v1's wizard (`docs/discovery-sunscan.md`
§1), reconciled on 2026-10-12 so every answer v1 prices from is asked:

- **Roof.** `roof_confidence` is set from the assessment: `high`/`medium` when
  the LiDAR fit is reliable, `low` when it is not, there is no assessment, or the
  visitor says the mapped roof is wrong. With a trusted roof the visitor confirms
  a sentence ("Your main roof faces south-west at about 35°, with room for roughly
  11 panels… does that look right?", `roof_confirmed`); with `low`, v1's fallback
  questions (`roof_size`, `roof_direction`) are asked. `roof_shading` is always
  asked — the assessment does not simulate shading.
- **Property** (type, ownership), **usage** (source → annual kWh / monthly cost /
  household size), **lifestyle** (new: v1's "select all that apply" step, which
  feeds the Sentinel uplift and battery sizing), **tariff**, **existing system**,
  **motivation**, **budget**, **finance**.
- Several answers in one message are taken (`journey/extract.ts`, deterministic,
  every proposal validated); corrections replace and drop what they ruled out;
  journey state (`journey_*` keys) persists with the answers so a session resumes.

## Roof → engine

`journey/roof.ts`: main plane pitch and azimuth (→ MCS orientation); capacity is
v1's packing rule (`panelLayout.ts`: landscape, 300 mm margin, 20 mm gaps) for
the installer's base panel over each suitable S/E/W plane's measured width ×
slope length × fill ratio, **capped at the assessment's own estimate** so the
conversation, the roof card and the options never disagree.

## Pricing

`journey/catalogue-pricing.ts` maps a tenant's published price list (WS7,
`catalogue/price-list.ts`, SunScan v1 SKUs as keys, integer pence, `priceFor`)
back onto the engine's catalogue — the reverse of `docs/integration/
catalogue.md` "SunScan v1 mapping". A test publishes WS7's HSEnergy example and
checks the three option prices equal those from SunScan's own seed.

- No published list → sizes, generation and savings without prices; "a
  specialist will price it".
- A mandatory item the list prices `bespoke` or not at all → left out of the
  total and shown on every option as "priced by your installer".
- VAT: the list's `vatRatePercent`; null (the HSEnergy sheet states none) →
  "VAT as quoted by your installer". Never assumed.
- Each option is flagged when it costs more than the visitor's stated budget.

## API and tools

Session-authenticated, tenant-scoped: `GET /v1/quote/journey`,
`POST /v1/quote/journey/answers`, `POST /v1/quote/options`, `GET /v1/quote/:id`,
`POST /v1/quote/:id/lead` (attaches only to an existing lead of the same session
— a lead exists only with consent). Chat tools: `get_quote_journey`,
`save_answers`, `get_quote_options`; `start_sunscan_assessment` links its
assessment to the journey. The widget renders the `quote` stream event as option
cards with the disclaimer, plus **Download your quote (PDF)** and, when outbound
email is configured, **Email it to me** (see `docs/integration/proposal.md`).

**Sentinel:** when the installer's price list offers it (`catalogue.md` §
Sentinel), each option carries `sentinel { upliftPercent, annualSavingsGbp,
paybackYears, addedCostGbp }` (indicative, never a price change), shown on the
cards and in the proposal.

## Not yet

- Bill upload (`bill_ocr`) is answered as a typed kWh figure; there is no OCR.
