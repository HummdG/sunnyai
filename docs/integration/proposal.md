# Customer proposal PDF and "email me my quote"

A stored quote (the quote journey's three options) renders as a PDF proposal,
branded as the **installer**: their name, logo, colours and contact details;
Sunny appears only as "Prepared with Sunny" in the footer.

The document (`apps/api/src/proposal/pdf.ts`, design in
`docs/superpowers/specs/2026-11-09-quotation-tab-design.md`) is rendered from the
stored quote and the snapshot of the installer's quotation settings taken when
the quote was made (`QuoteRecord.quotation`; quotes without one use the
defaults), so a re-download is the same document byte for byte. Pages, in order:

| Page                 | When                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| Cover                | Always                                                                                            |
| Your system          | Section on (default); carries Other options we looked at                                          |
| Performance (MCS)    | Section on (default)                                                                              |
| Savings and payback  | Section on (default)                                                                              |
| Estimated quotation  | Always; adds the MCS block when Performance is off, and the other options when Your system is off |
| Terms and conditions | Section on and terms text saved                                                                   |

Cover and Quotation carry the dark rail with the installer's logo or name; the
other pages carry the logo in the header. Every page has the footer (company,
MCS number, accreditation logos, contact, `NN / MM`, Prepared with Sunny). The
roof plan comes from the quote's assessment `spec.json` (`roof-plan.ts`) and is
left out when it cannot be drawn honestly. Warranty years are fixed on the quote
when it is made (`QuoteRecord.warranties`, `proposal/warranties.ts`).

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

Inter Tight and IBM Plex Mono, in `apps/api/assets/fonts` (SIL OFL 1.1, sources in its README).
