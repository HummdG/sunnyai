# Quote conversation editor

Status: for owner review, 2026-11-09 (builder check done)

## Why

Every installer runs their sales conversation differently. Today every
installer's Sunny asks the same preset questions, in the same order, in
the same words (SunScan's questionnaire, `apps/api/src/questionnaire.ts`)
before it gives a quote. Installers want Sunny's route to a quote to be
**theirs**: their questions, their order, their wording, and answers that
change the quote using **their** prices.

Success: an installer opens Sunny Studio, shapes the conversation in a few
minutes without help (removes a question they never ask, rewords another,
adds "Do you have an electric car?" so a "yes" adds their EV charger),
watches the preview show exactly how Sunny will ask it and what it does to
the price, saves, and from then on every visitor gets that conversation and
a quote that reflects their answers.

## Goals

- Per installer, in Sunny Studio, the installer can:
  - **remove** any of Sunny's preset questions;
  - **reword** any preset question;
  - **add** their own questions **anywhere** in the flow;
  - **reorder** everything (within the fixed start and end, below);
  - add **follow-up questions** that only appear after a particular answer.
- **Answers change quotes** (owner: "no quote should be hardcoded"). An
  answer, to an added question **or to one of Sunny's preset questions**
  (owner agreed), can, using the installer's own published price list:
  - **add** an item (owner's example: "yes" to an electric car adds their
    EV charger from the price list);
  - **remove** an item;
  - **swap** one item for another.

  Any price-list item may be added, removed or swapped, including the core
  kit (panels, inverter, battery), **except items the installer marked
  mandatory**, which answers cannot remove or swap (owner agreed). When an
  answer changes the core kit, the package is **recalculated**, so its
  generation, savings and payback always match the kit the visitor is
  quoted for (owner agreed). A swap whose item is not in a given package
  does nothing to that package (my call).

- **Follow-ups** can hang off any answer, preset or added (owner agreed).
  The owner's own example: an installer links Sunny's existing "I have an
  electric car" lifestyle answer straight to their EV charger, so the
  visitor is never asked about their car twice.
- Installers can also add **lead-only questions** whose answers do not
  touch the quote and are passed on with the lead (for example "How did you
  hear about us?").
- **Warnings** on the preset questions the price depends on, shown in
  Studio before the installer removes one, saying what the quote loses
  (owner: "add a disclaimer to these questions warning on what happens if
  you remove").
- The editor is **very easy and intuitive** (owner). Layout chosen by the
  owner from mockups: three panels side by side, the **question list**, a
  **flow diagram**, and a **live chat preview**, and any panel can be
  **minimised** so it never gets overwhelming.

## Non-goals

- An answer ruling out whole quote options, or adding a fixed or
  percentage price adjustment. Not asked for; add, remove and swap only.
- Changing how the price list itself is edited or published.
- Changing the roof assessment (SunScan) or the address step.
- A free-form flowchart builder. The diagram mirrors the list; it is not a
  separate way to build flows (see Studio, below).

## Anti-goals (a failure even if it works)

- **Wrong prices in a quote** (owner). Every amount still comes from the
  installer's published price list through the same pricing the quote uses
  today (`priceFor`, in pence, never interpolated). A visitor must never
  see a price that the installer's list and their answers do not produce.
  If an answer points at something that cannot be priced, Sunny says a
  specialist will price it, as it does today for bespoke items; it never
  guesses.
- **A confusing editor** (owner). If an installer cannot tell, from the
  editor alone, what Sunny will ask and what each answer does to the quote,
  this has failed.
- A visitor being asked a question the installer removed, or not being
  asked one they added.
- One installer's flow or answers reaching another installer.

## The conversation

The flow has a fixed start and a fixed end, and everything between is the
installer's (my call):

1. **Fixed start:** address, then the roof check (SunScan maps the roof),
   including "Does the roof I found look right?", so a visitor can always
   correct a wrong roof (my call). These cannot be removed or moved: the
   quote cannot exist without them. "Is the roof shaded?" is not part of
   the fixed start: it is a normal preset question with a removal warning.
2. **The installer's questions:** Sunny's preset questions that are kept,
   in the installer's order and wording, mixed with their added questions
   and follow-ups.
3. **Fixed end:** the quote, then consent and contact details (the lead).

Today's preset roof fallback questions only appear when the roof mapping
is uncertain. That condition stays: an installer can reword or reorder
them, but they still only appear when needed.

Sunny keeps asking conversationally, as it does today: it words each
question naturally from the installer's text rather than reading it out
verbatim, offers the answers as chips to tap, and maps a typed reply
("yes we've got a Tesla") onto the installer's answer choices. If a typed
reply matches no choice, Sunny asks again rather than guessing.

## Added questions

Each added question has:

- the question text;
- a kind: **changes the quote** or **lead only**;
- for a quote question, a fixed list of **answer choices**, each with zero
  or more **effects** on the price list: add item, remove item, swap item A
  for item B, or "no change";
- for a lead-only question, either answer choices or a short free-text
  answer (my call);
- optional **follow-ups**, attached to one or more answer choices, each of
  which is itself a question of either kind.

Effects apply to every quote option Sunny shows (each package gets the EV
charger), and the totals update. An effect names an item **from the
installer's published price list**, chosen in the editor from that list; it
cannot name anything else.

**Quantities** (my call): an item priced per panel, per kWp or per battery
kWh takes its quantity from each package, as the quote does today. An item
priced per anything else (per metre, per side, per storey) gets a fixed
quantity the installer sets in the editor when they link it. Sunny never
guesses a quantity; an item with no quantity cannot be saved as an effect.

If an item an effect uses is later removed from the price list, Studio
flags that question as needing attention, and Sunny skips that one effect
rather than quoting without saying so (exact visitor wording is builder's
call, but it must be honest that something is priced separately).

## Sunny's preset questions

- **Remove:** allowed for every preset question. The ones the quote
  depends on carry a warning written for what that question feeds, shown
  before removal. Example (electricity use): "Sunny uses this to work out
  savings. Without it, quotes use a typical UK household's usage, so the
  savings figures will be rougher." When one is removed, Sunny uses the
  same typical default the quote engine would use, and the quote marks
  which figures are estimates.
- **Reword:** any preset question's text, and the labels of its answers.
  The **meaning** of each preset answer is fixed (my call): "Heavy
  shading" can be relabelled "Lots of trees nearby", but it still counts as
  heavy shading in the calculation, so rewording can never break a price.
  Preset answers cannot be added or deleted.
- **Reorder:** anywhere in the middle section, with one rule: a follow-up
  stays after the question it depends on (today: the usage follow-ups after
  "How would you like to tell me about your electricity use?").

## Sunny Studio

A new "Your conversation" section, owner-chosen layout:

- **Question list** (left): the flow top to bottom. Fixed start and end are
  shown locked. Drag to reorder. Each question carries a tag: Sunny's,
  changes the quote, or lead only. Clicking a question opens it in place:
  its text, its answers, and for each answer a plain-English effect picked
  from the price list ("Adds 7kW EV charger, £899"). Follow-ups sit indented
  under the answer that triggers them. "+ Add a question" and "+ Add a
  follow-up" do what they say.
- **Flow diagram** (middle): the same flow drawn as boxes and lines, with
  branches for follow-ups and each answer's effect on its line ("Yes
  +£899"). Selecting a question in the list highlights it in the diagram and
  the reverse. It mirrors the list; it is not edited separately (my call,
  to keep one way of doing each thing).
- **Chat preview** (right): the selected question as the installer wrote
  it, with a note that Sunny may phrase it more naturally in chat; a sample
  answer tapped from the choices; and exactly what that answer does to the
  quote, priced from the published list. It does not run a real chat (no
  LLM cost, quota, analytics or leads), the same rule as the logo preview
  (my call: the wording is shown honestly as the installer's, the price
  effect is exact).
- **Minimise:** each panel collapses so the installer can focus on one or
  two. On a phone the panels become tabs.
- **Save** validates the whole flow (no dangling follow-ups, every effect
  names a live price-list item) and says plainly what to fix.
- Admins and owners edit; viewers see it read-only. Same as the rest of
  Studio.
- Available on **every plan** (my call, matching the logo feature).

A **"Reset to Sunny's questions"** action restores the preset flow (my
call), so an installer who gets lost can start again.

## What exists today

- Questionnaire: `apps/api/src/questionnaire.ts`. A versioned constant
  (`QUESTIONNAIRE_VERSION = 'sunscan-2026-01'`), SunScan's question set,
  with conditional appearance declared as data (`AppearsWhen`) and numeric
  rules. One source used by the model's tool, the host-page route and the
  lead summary. This becomes per installer.
- Journey: `apps/api/src/journey/` (address, roof, questions, quote,
  consent, lead). `journeyStatus` walks the outstanding questions.
- Quote: `apps/api/src/journey/quote.ts` runs the ported SunScan engine
  (`@sunny/quote-engine`, `QuoteAnswers`) over the answers, the roof and the
  installer's pricing. `catalogue-pricing.ts` turns the published price
  list (`apps/api/src/catalogue/price-list.ts`) into the engine's catalogue;
  items have categories (pv, mounting, inverter, battery, scaffold,
  electrical, optional, trenching, admin, other), pricing kinds (flat, per
  unit such as per panel, percent uplift, table, tiered, install context,
  quote only) and a `mandatory` flag.
- Studio: `apps/marketing/components/dashboard/studio-form.tsx`, saved
  through `POST /v1/portal/tenants/:id/settings`. Tenant config lives in
  Firestore.
- Widget: renders a question's options as chips (`cards.ts` options panel).
- The questionnaire is SunScan's so that Sunny asks what the host site's
  own wizard asks. A customised flow intentionally diverges from that for
  the installer who customises it; an untouched flow stays exactly
  SunScan's.

## Constraints

- Prices only ever from the published price list via the existing pricing
  (`priceFor`). Effects on a per-panel or tiered item are priced by the
  same rules as any other item of that kind.
- The installer's flow is validated on the server on save and again when
  used; the model never decides the flow, it asks what the flow says next.
- An installer's flow and answers are tenant-scoped like every other
  setting; new routes join the cross-tenant sweep in `tests/security`.
- Leads carry every answer, including lead-only questions, with the
  question text as the installer wrote it, **and** a stable record of each
  question underneath (preset questions keep their SunScan ids and option
  values; added ones get stable ids), so exports and CRM links keep
  working when an installer rewords something (my call).
- The host-page route (`POST /v1/qualification/answer`), used by an
  installer's own website quote form, keeps working on Sunny's standard
  question set and the SunScan contract. The custom flow governs Sunny's
  chat (my call).
- House style: no em dashes in any user-facing text.

## Left to the builder

Data model and storage for a flow, versioning of saved flows (so a lead
records which flow it was asked with), how the engine applies add, remove
and swap (inside the engine's catalogue or as line items after it), the
default values used when a preset question is removed (from the engine's
own defaults), how typed replies are matched to choices, the editor's
drag and drop and diagram drawing, limits (number of questions, depth of
follow-ups), and tests, including visual baselines for the editor.

## Calls made by the writer, for the owner to check

- Address and roof check are a fixed start; quote and contact a fixed end.
- Rewording a preset question changes its words, never what its answers
  mean in the calculation; preset answers cannot be added or deleted.
- When a preset question is removed, Sunny uses the engine's typical
  default and the quote says which figures are estimates.
- The diagram mirrors the list rather than being edited on its own.
- Lead-only questions may take free text; quote questions are choices.
- A broken effect (its item left the price list) is flagged in Studio and
  skipped honestly in the chat.
- "Does the roof I found look right?" is locked with the address; roof
  shading is a normal preset question.
- Quantities: from the package where the unit allows, otherwise a fixed
  quantity set in the editor.
- The preview shows the installer's wording with a note, and the exact
  price effect.
- An installer's own website quote form stays on the standard question
  set.
- Leads keep stable question ids under the installer's wording.
- A swap does nothing to a package that lacks the swapped item.
- A "Reset to Sunny's questions" action.
- Every plan.
