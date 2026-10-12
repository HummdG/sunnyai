# Customer proposal PDF and "email me my quote"

A stored quote (the quote journey's three options) renders as a PDF proposal,
branded as the **installer** — their name, colour and contact details; Sunny.ai
appears only as "Prepared with Sunny.ai" in the footer.

Modelled on a real installer proposal (`SunScan/Proposal_164_Norwich_Drive.pdf`,
read-only). Sections we have data for are mirrored; sections we have no data for
(a validity date, finance, signature/acceptance, product datasheets, trees and
flights equivalents) are left out rather than invented.

| Page | Contents                                                                                                                                                                                                                        |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Prepared by / for, quote reference, date; title band; introduction; recommended system (kWp, yearly savings, price, payback); the roof from the 3D assessment (facing, pitch, usable area, panels, confidence)                  |
| 2    | Your solution (panels, inverter, battery, generation, inclusions); all three options side by side (incl. Sentinel when offered); above-budget marks                                                                             |
| 3    | System performance: monthly generation chart; MCS method — A. installation data (kWp, orientation from south, inclination, zone), B. Kk from the MCS zone table, shade factor, output; C. self-consumption and self-sufficiency |
| 4    | Savings and payback: 25-year bill savings, net savings, cumulative chart; environmental benefits (CO2 a year and over 25 years, share of use generated); assumptions (import/export prices, inflation, degradation, region)     |
| 5    | Quotation: line items, total and the installer's VAT position; Sentinel note; next steps; the full non-binding / survey disclaimer                                                                                              |

Every figure comes from the stored quote and the ported SunScan engine
(`calcMonthlyGenProfile`, `calc25YearSavings`). The PDF says on page 1 and page 5
that it is indicative and subject to a survey.

## Routes

| Route                                                               | Who                                                |
| ------------------------------------------------------------------- | -------------------------------------------------- |
| `GET /v1/quote/:id/proposal.pdf`                                    | The visitor whose session made the quote           |
| `POST /v1/quote/:id/proposal/email` `{ email, consent: true }`      | The same visitor; max 3 emails per session per day |
| `GET /v1/portal/tenants/:tenantId/leads/:leadId/quote/proposal.pdf` | The installer's members (viewer and above)         |

Any other session, installer or id gets the same `not_found`. Code:
`apps/api/src/proposal/{pdf,index,mailer}.ts`, `apps/api/src/routes/proposal.ts`.
The widget shows **Download your quote (PDF)** under the quote cards and, when
email is configured, **Email it to me** (an address plus a consent tick).

## Outbound email

Postmark's HTTP API (`proposal/mailer.ts`):

- `SUNNY_POSTMARK_SERVER_TOKEN` — the Postmark server token
- `SUNNY_PROPOSAL_FROM` — the sender, a verified Postmark sender signature

Sent as "<Installer> via Sunny.ai", reply-to the installer's support email, the
PDF attached. Unconfigured: the option is hidden in the widget and the route
answers `not_enabled`. Tested with a fake mailer only; a real send needs a
Postmark account (owner action).

## Fonts

`apps/api/assets/fonts/PlusJakartaSans-{Regular,SemiBold,ExtraBold}.ttf` are
static instances of the brand's variable font (`packages/ui/fonts`), made with
fontTools `instancer` (SIL OFL 1.1, licence alongside).
