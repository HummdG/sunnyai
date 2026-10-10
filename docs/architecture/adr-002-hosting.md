# ADR-002: Hosting and deployment — App Hosting for web, Cloud Run for the API, secrets by environment

- **Status:** Accepted (the hosting choice is made; the deployment itself is not
  yet built — see Consequences)
- **Date:** 2026-10-10
- **Related:** ADR-001 (platform), ADR-003 (agent runtime), ADR-004 (retrieval)

## Context

The plan's default hosting table (`SUNNY_AI_IMPLEMENTATION_PLAN.md` §3.1) puts the
Next.js web apps on **Firebase App Hosting**, the APIs and business logic on
**Cloud Run**, the operational database on **Firestore**, and object storage on
Cloud Storage, with the whole thing provisioned by Terraform (§13). It also
requires that streaming be supported for the chat transport (§4).

This ADR records the hosting decision **against the verified capability findings
in `docs/discovery-google-services.md`**, because at the time of writing the
choice is only partly exercised by code: the API exists and is written for Cloud
Run; the web apps do not exist yet.

### What the discovery doc verifies (and how strongly)

- **Firebase App Hosting — GA.** Fully managed Git-connected hosting for
  SSR/Next.js/Angular, built on Cloud Build, served on Cloud Run, cached in Cloud
  CDN. The currently _active_ supported Next.js minor is **15.2.x**; 13.5.x and
  14.2.x are `lts` with a documented deprecation of 2026-10-09; **no Next.js 16 is
  documented as supported**. Regions are `asia-east1`, `asia-southeast1`,
  `europe-west4`, `us-central1`, `us-east4`, `us-east5`, with **no default
  location** (one is set per backend).
  - **Caveat recorded in the discovery doc, and repeated here:** the GA statement
    comes from the official Firebase **blog** (`firebase.blog`), not from the four
    named official domains; the `firebase.google.com/docs` pages carry no
    launch-stage banner.
- **Cloud Run streaming — GA.** Server-side HTTP streaming, including **SSE**, is
  supported with no special configuration (keep the connection open, set
  `Content-Type: text/event-stream`). **Request timeout: default 5 minutes (300 s),
  maximum 60 minutes (3600 s)**; the instance still accepts new requests while an
  abandoned request is running, and the doc recommends **heartbeats** for
  long-lived SSE.

### What the discovery doc does not settle

- Whether an **API Gateway in front of Cloud Run buffers responses** is noted as a
  _community_ caveat, not official documentation. Treated as **unverified**.
- Firestore limits are verified (ADR-006) but Firestore is not used by the code
  yet, so nothing here depends on them.

## Decision

### Web apps: Firebase App Hosting

The marketing site and the (not-yet-built) dashboard are to be served by Firebase
App Hosting as Next.js apps. Constraint taken from the discovery doc: **target a
supported Next.js version — 15.2.x today** — and set an explicit backend location
from the six supported regions. Because App Hosting is Git-connected and builds
with the framework adapter, the intent is that a merge to the live branch is the
deploy.

**This is a plan-level decision that no code exercises yet.** `apps/marketing` is
a `package.json` with no source; `apps/dashboard` does not exist. There is no
`firebase.json` and no App Hosting backend.

### The API: Cloud Run, with the SSE ceiling understood

The API is a plain Fastify HTTP server (`apps/api/src/main.ts`, listens on
`PORT`/`HOST`, defaults `8787`/`127.0.0.1`) and is written to be Cloud-Run-safe
rather than Cloud-Run-specific:

- The streaming response sets **`x-accel-buffering: no`** so a proxied response is
  not buffered into one delivery at the end (`apps/api/src/server.ts`,
  `SSE_HEADERS`).
- Sessions are **signed, not stored**: an in-memory session table "would work
  perfectly in development and drop every other request in production"
  (`apps/api/src/sessions.ts`). Token lifetime is **`SESSION_TTL_MS = 2 hours`**.

**The Cloud Run timeout ceiling in context.** A chat turn is a _bounded_ stream:
the generator always emits a `done` frame when it finishes or fails
(`apps/api/src/server.ts`, `frames()`), so a normal request is far inside the
60-minute maximum. The ceiling would only bind a stream deliberately held open,
which the product does not do. What the code _does_ do today to avoid burning a
request budget on an abandoned visitor is abort on **response close** rather than
request close — an abandoned stream "keeps costing tokens and holds a Cloud Run
request open to its timeout" (`apps/api/src/server.ts`; the abort is wired to
`reply.raw.on('close')`). If a long-lived stream is ever added, the discovery
doc's **heartbeat** guidance applies.

### Configuration and secrets: supplied through the environment

Configuration is read once at boot (`apps/api/src/config.ts`) from the environment,
with these variables:

| Variable                                 | Default              | Purpose                                                  |
| ---------------------------------------- | -------------------- | -------------------------------------------------------- |
| `GEMINI_API_KEY`                         | unset                | presence of this key is what makes chat available at all |
| `GEMINI_MODEL`                           | `gemini-3.8-flash`   | the default model                                        |
| `GEMINI_ESCALATION_MODEL`                | unset                | the escalation model (ADR-003)                           |
| `GOOGLE_CLOUD_LOCATION`                  | `global`             | stored on the Gemini config                              |
| `PORT` / `HOST`                          | `8787` / `127.0.0.1` | listener                                                 |
| `NODE_ENV`                               | `development`        | tightens CORS, logging, error detail                     |
| `SUNNY_DATA_DIR`                         | `.data`              | where conversations and leads are written (ADR-006)      |
| `WIDGET_ALLOWED_ORIGINS`                 | empty                | comma list of origins allowed to open a session          |
| `SESSION_SECRET`                         | dev constant         | HMAC key for session tokens                              |
| `LOG_LEVEL`                              | `info`               | Fastify log level                                        |
| `SUNSCAN_BASE_URL`, `SUNSCAN_URL_<SLUG>` | unset                | SunScan base URL (ADR-003, ADR-006)                      |

Secret handling is explicit rather than assumed:

- `SESSION_SECRET` defaults to a **published development constant**, and
  `assertProductionReady()` **refuses to boot in production** while that constant
  is in use, and also refuses to boot with an empty `WIDGET_ALLOWED_ORIGINS`
  (`apps/api/src/config.ts`). `main.ts` calls it and `process.exit(1)` on any
  problem (`apps/api/src/main.ts`).
- The code names **Secret Manager** as the production source for `SESSION_SECRET`
  (`apps/api/src/config.ts` comment: "A development default, replaced by Secret
  Manager in Cloud Run"), but **there is no Secret Manager wiring in the
  repository yet** — see Consequences.
- The API key is a **Gemini API key**, not a Vertex service account; see ADR-003
  for what that means.

## Consequences

- **Nothing here is deployed.** The `infrastructure/` directory is **empty**: no
  Terraform, no `firebase.json`, no bootstrap script. The plan (§13) asks for
  `scripts/bootstrap-google-cloud.sh`, `deploy-staging`, `deploy-production`,
  `smoke-test`, `rollback`, `seed-demo` and `verify-isolation`; none exist. What
  exists is `scripts/smoke-api.mjs` (a dependency-free assertion script with an
  exit code) and `scripts/static-server.ts` (a local static server for the demo).
  This ADR therefore records an intended deployment, not a performed one.
- There is **no CI configuration** in the repository (no `.github/`). The plan's
  "one-command reproducible staging deploy" (P1 exit gate) is not met.
- Because web apps are absent, the App Hosting choice is currently
  unfalsifiable; it should be re-opened if the first Next.js app cannot be pinned
  to a supported minor.
- The CORS behaviour is written by hand so the wildcard case is visible: an empty
  allow-list echoes any origin, which is a **development convenience only**, and
  production cannot boot with it (`apps/api/src/server.ts`, `config.ts`).

## Alternatives considered

- **Cloud Run for everything, including the web apps.** Rejected: App Hosting's
  Git-connected build and CDN caching are the managed path the plan prefers, at
  the cost of a bounded Next.js version window.
- **A long-lived WebSocket / streaming transport instead of SSE.** Rejected: SSE
  is verified GA on Cloud Run and needs no extra connection handling; the
  client already parses SSE frames into contract-validated events
  (`packages/widget/src/chat.ts`).
- **In-memory sessions.** Rejected explicitly in `sessions.ts`; signed tokens are
  the multi-instance-safe choice.
- **App Check as the origin gate.** Not adopted; its domain ceiling is recorded in
  ADR-005.

## Open questions

- **Unknown — needs verification:** whether an API Gateway between the browser and
  Cloud Run buffers the SSE response. The discovery doc records the buffering
  concern as a community caveat, not official documentation.
- **Unknown — needs verification:** the App Hosting GA statement rests on the
  official Firebase blog rather than on a launch-stage banner on the product
  docs pages (`docs/discovery-google-services.md` §1, §10).
- Where does the free-form `origin` field in a widget session request finally get
  enforced? Today it is compared to `WIDGET_ALLOWED_ORIGINS`, but the contract
  calls it **advisory** — "a browser can be told to lie" — and the real control is
  that the token grants only visitor-scoped reads
  (`packages/contracts/src/widget.ts`).
- Data residency: the API is pinned to no region in code; App Hosting has no
  default location. A customer-facing residency commitment needs an explicit
  region per backend.
