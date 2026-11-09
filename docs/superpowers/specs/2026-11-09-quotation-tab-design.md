# Quotation tab and the redesigned quotation PDF

Status: for owner review, 2026-11-09

## Why

The quotation PDF is the document a visitor actually takes away and decides on.
Today every installer's PDF is the same five-page document
(`apps/api/src/proposal/pdf.ts`), branded only by name, colour and contact
details, and the owner says it looks "a bit AI generated": a big rounded colour
banner, rows of pale rounded "stat cards", heavy headings with a short coloured
underline, the same pale-header table on every page, template phrases ("Your
solution", "Your options") and a generic "Thank you for asking..." opening. It
also has two visible bugs: the quote number prints as "Q-Q_TEST_1", and a chart
label ("£-12,348") overlaps the axis.

Installers want the PDF to be **theirs** (owner): their logo, which sections
show, and their own terms, deposit and validity. And the document itself has
to look like a confident, professional installer's proposal, **and be unique**
(owner), not a copy of the OpenSolar template most installers use.

Success: an installer opens Sunny Studio, goes to "Your quotation", sets their
logo, signer, accreditations, deposit, validity and pastes their T&Cs, turns off
a section they never send, sees the real PDF update beside them, saves, and
every quotation PDF from then on is theirs. A homeowner who receives it sees a
short, precise, personal document that reads as written by the installer about
their house.

## Reference (read for layout, never copied)

Three real installer proposals (owner's, in their Downloads; customer data,
not committed) were read: two from HSEnergy and one from Smartly Energy, all made
with OpenSolar. What they have that ours lacks: a personal "Dear <name>" letter
signed by a named salesperson with phone and email; the logo top-left and an
accreditation strip (MCS, NICEIC, HIES, TrustMark) on every page; an aerial roof
image with the panels drawn on, straight after the headline figures; quiet light
typography with thin rules, no boxes; equipment shown as product cards with
warranties; money laid out like a contract (total, deposit, remaining balance
and when it is due, validity date), disclaimers and a T&Cs link. Their
weaknesses: 15 to 16 pages, half-empty pages, boilerplate "about us" text, raw
data tables. Sunny can do what they cannot: draw the **real** roof from its own
3D measurement, explain every item from the **visitor's own answers**, and say
more in fewer pages.

## Goals

### 1. The redesigned PDF ("style B: the survey drawing", owner's pick)

Chosen from three mockups (letter, survey drawing, brochure). The approved
mockup is kept at `.superpowers/brainstorm/57124-1794264688/content/pdf-styles.html`
(git-ignored; the builder reads it there).

Character: technical, precise, engineered. A dark side rail (installer's brand
colour family, deepened for contrast; the mockup uses deep navy #0f2a3d with
light text) carrying the key figures; the main column carries a light, large
headline with a bold second half, small uppercase monospace labels, and the
roof as an architect's plan with measurements. Thin rules, no rounded boxes, no
stat cards.

Pages, in order (each a section the installer can turn off, except where
noted):

1. **Cover** (always on). Rail: "Prepared for" name and address, recommended
   system (kWp, panels + battery), generation a year, year-one saving, total,
   quote reference and valid-until date. Main: a monospace line
   ("Solar proposal · <date>"), a headline describing the system in plain
   words ("Ten panels, one battery, your south-facing roof."), the **roof
   plan**, and the **letter**.
2. **Your system**: the equipment, one entry per main component (panels,
   inverter, battery, charger, other notable items) with its warranty where the
   price list or catalogue carries one; a short line per item; the roof facts
   (best-facing side, pitch, usable area, panels that fit).
3. **Performance** (MCS method): monthly generation chart and the MCS
   installation data and calculation, laid out in the new style. MCS-required
   wording kept.
4. **Savings and payback**: the cumulative savings chart (fixed label), year-one
   and 25-year figures, payback, environmental figures, and the assumptions.
5. **Quotation** (always on): numbered line items, each with its price from
   the stored quote, and, where it exists, a one-line **reason** from the
   conversation ("You told us you drive an electric car"); total with VAT basis;
   **deposit** (amount and basis), **balance** and when it is due, **valid
   until** date; an **acceptance** block (signature and date lines) and how to
   go ahead (signer's phone/email); the indicative-and-subject-to-survey line;
   "Terms and conditions follow" when the T&Cs section is on.
6. **Terms and conditions**: the installer's pasted text, headings and
   paragraphs kept, flowing over as many pages as it needs.

On every page: header with the installer's logo; footer with company name,
**accreditations** (MCS number and uploaded accreditation logos, small), contact
details, page "01 / 06", and a small "Prepared with Sunny".

**The roof plan** is drawn from Sunny's stored 3D roof assessment for the quote
(the main roof plane outline and the panel positions, with dimensions and
pitch, north marker). If the real outline is not available for that quote, the
plan is left out: never a schematic pretending to be their roof (owner: real
roof; my call on the fallback).

**The letter** is assembled from fixed sentences chosen by the visitor's
answers and the quote (my call: never free-written by the model, so it can never
state something untrue). It addresses the customer by first name when known,
says what is recommended and why in plain words (e.g. battery because they are
home in the evenings; charger because they drive an electric car), and says the
figures are estimates until a free survey. The installer can edit an **opening
line** and a **closing line** in Studio. It is signed by the installer's
**signer**.

**Reasons on line items** come only from the flow effects that added or swapped
an item (the stored quote knows which answer caused each effect) and from
preset answers with a known meaning. An item with no reason gets no note.

### 2. The "Your quotation" Studio tab

A fourth Studio tab, beside "Your brand", "Your conversation", "Assistant
settings", in the same look. Left column: settings; right: a live preview of the
real PDF (rendered by the API from a sample quote for that installer, shown page
by page with page chips), plus "Download a sample PDF". Save and an "Unsaved
changes" note as on the other tabs.

Settings:

- **Logo**: uses the logo from Your brand by default; "Use a different logo for
  the PDF" uploads one just for the PDF (same upload rules and storage as
  branding).
- **Signed by**: name, role, phone, email of the person the letter is from.
- **Accreditations**: MCS certificate number (text) and up to 8 small logos
  they upload (NICEIC, HIES, TrustMark, etc.), shown in the footer.
- **What the PDF includes**: an on/off switch per section (system, performance,
  savings, terms); cover and quotation always on, shown locked with "Always
  shown".
- **Deposit**: percentage, fixed amount, or none. The PDF computes the deposit
  from the quote's own total (percentage) and the balance as total minus
  deposit.
- **Balance due**: short text, default "within 7 days of completion".
- **Quote valid for**: days (default 30), printed as a date.
- **Letter**: optional opening line and closing line.
- **Terms and conditions**: a large paste box; headings and paragraphs are
  kept (blank lines separate paragraphs; a short line in capitals or ending
  without a full stop is a heading; numbered lines stay numbered).

Viewers see the tab read-only. Admins and owners edit. Every plan.

## Non-goals

- A free-form PDF designer (moving blocks, fonts, colours per element).
- Multiple PDF templates to choose from: one excellent design.
- E-signature or online acceptance and payment links (the acceptance block is a
  printed signature line).
- Finance options, QR codes, tariff tables, daily energy flow charts.
- Changing how prices or figures are calculated.

## Anti-goals (a failure even if it works)

- **A figure in the PDF that the stored quote and price list do not produce**,
  including the deposit and balance (computed only from the stored total).
- **A PDF that overstates the offer**: the indicative-and-subject-to-survey
  wording can never be removed, whatever sections are off.
- A roof drawing that is not their roof.
- A letter that claims something the visitor did not say.
- Looking AI-made again: rounded stat cards, coloured banner blocks, underline
  bars, boilerplate.
- One installer's PDF settings, logos or T&Cs reaching another installer.

## Constraints

- Rendering stays server-side with pdfkit (existing). New fonts: Inter Tight
  (sans) and IBM Plex Mono (labels), OFL, bundled in `apps/api/assets/fonts`
  with their licences, fetched once from Google Fonts.
- Settings are tenant-scoped, saved with the atomic `tenants.update(id, mutate)`
  (never a whole-tenant save from a cached copy), validated server-side (zod),
  with limits (T&Cs up to 40,000 characters; lines up to 200; logos within the
  existing branding upload limits).
- New portal routes join the cross-tenant sweep in
  `tests/security/tenant-isolation.test.ts`.
- The preview and sample PDF use a synthetic sample quote priced from the
  installer's published list when there is one (demo pricing otherwise), never
  a real customer's data.
- No em dashes in any user-facing text, PDF included. British English.
- A PDF made before the installer saves keeps today's defaults: logo from
  branding, all sections on, no deposit block, validity 30 days, no T&Cs
  section, letter with default lines, signer = company name and contact.
- The assistant's name rules from Studio apply in the tab; the PDF itself says
  "Prepared with Sunny" (product).

## What exists today

- PDF: `apps/api/src/proposal/pdf.ts` (pdfkit, ~700 lines), `proposal/index.ts`
  (gathers quote, installer, customer, roof), routes in
  `apps/api/src/routes/proposal.ts` (visitor's own PDF, email it, portal lead
  PDF). Tests: `apps/api/test/proposal.test.ts`.
- Quote record: `apps/api/src/journey/quote.ts` (`QuoteRecord`, options, line
  items, warnings, `estimatedFrom`); flow effects in `apps/api/src/flow/effects.ts`.
- Roof: `store.getSunScanAssessment`, `toRoofAssessmentSummary` from
  `@sunny/sunscan-adapter`; geometry packages `sunscan-core`, `sunscan-engine`.
- Branding uploads and storage: `apps/api/src/branding/*`, `routes/branding.ts`.
- Studio tabs: `apps/marketing/app/dashboard/studio/page.tsx`.

## The estimate must be unmistakable (owner)

The quotation must make it very clear that every figure is an **estimate** and
**will change once a proper survey has been done**. Not small print:

- The Quotation page is titled **"Estimated quotation"** and the total is
  labelled **"Estimated total"**; the cover rail's price is "Estimated total".
- Directly under the page title, before the line items, a clearly set notice
  (full-width, ruled above and below, normal reading size, not muted grey):
  "This is an estimate, not a final price. It is based on a 3D model of your
  roof and the answers you gave us. Your final price will be confirmed after
  a survey of your property, and it may go up or down."
- The cover carries a short version of the same notice beside the figures
  ("Estimate. Final price confirmed after a survey.").
- Deposit and balance are framed after the survey (writer's call, following
  from the above): "Deposit, payable once your survey has confirmed the final
  price" rather than "on acceptance".
- The letter's fixed wording says the figures are estimates until the survey.
- None of this can be switched off or edited away in Studio; the installer's
  own T&Cs and letter lines are added to it, never replace it.

## Decisions after the builder check

Owner's answers:

- **Other options stay**: the PDF quotes the visitor's chosen option, or
  Sunny's recommended one when they chose none (worded "your chosen system" or
  "the system we recommend" accordingly), and keeps a compact "Other options we
  looked at" comparison (size, battery, price, generation, savings, payback)
  on the Your system page (or the Quotation page if Your system is off).
- **Fixed at quote time**: when a quote is created, the installer's PDF
  settings in force (deposit rule, balance-due text, validity days, T&Cs text,
  letter lines, signer, accreditations, section switches, logo reference) are
  snapshotted onto the quote record. Every later render of that quote (visitor
  re-download, email, portal) uses the snapshot, so a homeowner's document
  never changes after they receive it. "Valid until" is counted from the
  quote's creation date, never the render date. Quotes made before this ships
  have no snapshot and render with the defaults in Constraints.

Writer's calls (owner to check):

- **Unpriced quotes** (`priced: false` or items priced by the installer): the
  Quotation page still shows, items without a figure read "Priced by your
  installer", and the money block (total, deposit, balance) shows only when
  the total is complete. No figure is ever invented.
- **Deposit and VAT**: the deposit percentage applies to the total the page
  shows (the inc-VAT figure when VAT is known, otherwise the stored price with
  the same VAT wording the total carries); the balance is that total minus the
  deposit; both carry the same VAT wording as the total.
- **Roof plan**: drawn from the stored assessment's `spec.json` rebuilt with
  `synthesizeHouse`, with panels placed by the same layout logic the widget
  uses (extracted into a dependency-free module the API can use, not by adding
  `three` to the API). Every roof face that holds panels is drawn. The plan is
  left out when the assessment is not reliable, or when the layout cannot place
  every quoted panel.
- **MCS**: when Performance is switched off, a minimum MCS block (estimated
  annual generation with the MCS-required wording) moves onto the Quotation
  page, which can never lose it.
- **Extras kept**: the Sentinel optional uplift (with its price, clearly
  optional), quote warnings, the "typical values used" note (`estimatedFrom`),
  the roof-limited note and the above-budget note all appear in a short
  "Notes" block on the Quotation page.
- **Preview roof**: the Studio preview and sample PDF use a bundled sample
  house (a stored `spec.json` with a fixed sample address), marked "Sample" on
  the plan, so installers see the roof plan while setting up.

## Left to the builder

Where the per-tenant PDF settings live in the tenant config and their schema;
how the stored quote records which answer caused each effect (if it does not
yet, record it); extracting the roof outline and panel positions from the stored
assessment and projecting it to a plan view; chart drawing in the new style;
the T&Cs text-to-PDF layout rules beyond those above; preview rendering
(PDF to images or an embedded PDF viewer) and caching; tests including PDF text
extraction checks and visual checks against the mockup.

## Calls made by the writer, for the owner to check

- If the real roof outline is not available, the roof plan is left out.
- The letter is assembled from fixed sentences, with editable opening and
  closing lines; never free-written by the model.
- The quotation page and the indicative wording can never be turned off.
- Deposit computed from the stored total; balance-due text is the installer's.
- Fonts: Inter Tight and IBM Plex Mono, fetched once and bundled.
- One design, no template choice; no e-signature, QR codes or finance.
- PDFs made before the installer saves keep sensible defaults.
