# Architecture Decision Records

These records describe the decisions that shape Sunny.ai and — where the code
does not yet match the plan — say so. They are written against the repository as
it stands on 2026-10-10, alongside the two discovery documents that ground the
Google-platform claims:

- `docs/discovery-google-services.md` — verified Google capability findings, with
  an explicit list of what could **not** be verified.
- `docs/discovery-sunscan.md` — the read-only extraction of SunScan's data
  contract (questionnaire, lead shape, scoring, multi-tenancy).

Where a decision genuinely was not made, the record says so and its status is
**Proposed** rather than **Accepted**. Where the plan and the code disagree, the
record names the conflict and states which one the code follows.

## The records

| ADR                                       | Title                          | One-line summary                                                                                                                                                                                                                       | Status              |
| ----------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| [ADR-001](adr-001-platform.md)            | Platform shape                 | One npm-workspaces TypeScript monorepo, one embeddable widget bundle, Zod contracts shared across the process boundary, and a character animated by pure functions of a serialisable pose.                                             | Accepted            |
| [ADR-002](adr-002-hosting.md)             | Hosting and deployment         | Firebase App Hosting for web apps, Cloud Run for the API (with its 60-minute SSE ceiling), configuration and secrets through the environment.                                                                                          | Accepted            |
| [ADR-003](adr-003-agent-runtime.md)       | Agent runtime                  | A provider interface whose unconfigured form refuses rather than simulates, a Flash default, and an escalation model deliberately left unset because the only GA Pro-class model retires 2026-10-20 and its successor is Preview-only. | Accepted / Proposed |
| [ADR-004](adr-004-retrieval-isolation.md) | Retrieval and tenant isolation | Do not depend on Vertex AI Search's Preview `acl_info` ACLs as the tenant boundary; enforce tenant scoping in our own layer and keep retrieval disabled until isolation is verifiable.                                                 | Proposed            |
| [ADR-005](adr-005-widget-isolation.md)    | Widget confinement             | Shadow DOM, a closed prop/event vocabulary, text-only rendering of model output, and a landmark allow-list so `suggest_page_action` cannot reach arbitrary DOM or URLs.                                                                | Accepted            |
| [ADR-006](adr-006-data-and-consent.md)    | Data and consent               | Two append-only JSONL record types behind a `Store` interface; the file boundary is the tenant boundary; consent is a hard gate but is not recorded; retention and deletion are unimplemented.                                         | Proposed            |

## Suggested reading order

1. **ADR-001** first — it fixes the vocabulary the rest use (contracts, the widget
   bundle, the posed character) and records the one place the code departs from
   the plan's animation stack.
2. **ADR-002** next — where the code runs and how it is configured.
3. **ADR-003** — the model boundary and the Pro-class model gap; read this before
   any discussion of model quality or cost.
4. **ADR-004** — why grounded answers are not shipped yet, and what "tenant
   isolation" means here.
5. **ADR-005** — the containment story for the one artefact that runs on someone
   else's site.
6. **ADR-006** — what is written down, and the privacy work still missing.

## Gaps you should know before reading

- **No deployment exists.** `infrastructure/` is empty and there is no CI config;
  ADR-002 records an intended deployment, not a performed one.
- **Several packages are stubs.** `packages/ui`, `packages/solar-rules`,
  `packages/sunscan-adapter` and `apps/marketing` have a `package.json` and no
  `src/`; `apps/dashboard` and `tests/` do not exist.
- **Retrieval is not implemented**, and several agent tools return honest
  `not implemented` failures (ADR-003, ADR-004).
- **The store is a real file store, not the production store** (ADR-006).
- **`docs/STATUS.md` is referenced by a test comment but does not exist**; the
  "unverified until a live recording is supplied" note it points at has no home
  yet.
