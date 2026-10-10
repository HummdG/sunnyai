# Google Cloud / Firebase capabilities — verified discovery

**Date of research:** 2026-10-10
**Purpose:** Fact-check current official Google documentation for a solar-installer SaaS platform.
**Project rule applied:** _never invent Google product capabilities._ Anything not confirmable from an official Google source is marked **UNVERIFIED** rather than guessed. GA vs Preview is called out explicitly; anything the docs label **Preview** is written in bold.

Accepted external exception: **Stripe — not researched** (item 9, skipped by instruction).

---

## Summary table

| #   | Service                   | Status                         | Key finding                                                                                                                                         | Source                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Firebase App Hosting      | **GA**                         | Supports Next.js 13.5.x–15.2.x (15.2.x active); Git-push deploy + Firebase CLI; 6 regions                                                           | [frameworks-tooling](https://firebase.google.com/docs/app-hosting/frameworks-tooling), [Firebase blog GA](https://firebase.blog/posts/2025/04/apphosting-general-availability), [Developer Connect locations](https://docs.cloud.google.com/developer-connect/docs/locations)                                                                                                            |
| 2   | Google ADK for TypeScript | **GA (v2.x)**                  | Official npm `@google/adk` @ 2.2.1; deployable to Cloud Run; managed runtime now called **Agent Runtime**                                           | [github.com/google/adk-js](https://github.com/google/adk-js), [releases](https://github.com/google/adk-js/releases), [Agent Runtime](https://docs.cloud.google.com/agent-builder/agent-runtime/overview)                                                                                                                                                                                 |
| 3   | Gemini on Vertex AI       | **GA + Preview**               | Flash `gemini-3.8-flash` (GA); Pro `gemini-3.1-pro-preview` (**Preview**) / `gemini-2.5-pro` (GA, retiring 2026-10-20); Live `gemini-3.8-live` (GA) | [3.8 Flash](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-8-flash), [3.1 Pro](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-1-pro), [2.5 Pro](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-pro), [3.8 Live](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-8-live) |
| 4   | Vertex AI Search ACLs     | **Preview**                    | `acl_info` document ACLs exist but are **Preview**; allow-only (no deny); external customer Drive OAuth **UNVERIFIED**                              | [data-source-access-control](https://docs.cloud.google.com/generative-ai-app-builder/docs/data-source-access-control)                                                                                                                                                                                                                                                                    |
| 5   | Model Armor               | **GA (some features Preview)** | Stateless per-request prompt/response screening; API + gateway surfaces; fail-open/closed **not documented**                                        | [overview](https://docs.cloud.google.com/security-command-center/docs/model-armor-overview), [release notes](https://docs.cloud.google.com/model-armor/release-notes)                                                                                                                                                                                                                    |
| 6   | Firebase App Check        | **GA**                         | Web via reCAPTCHA Enterprise; **no support for web apps on >250 domains**; no cap on reCAPTCHA keys                                                 | [App Check](https://firebase.google.com/docs/app-check), [reCAPTCHA keys](https://firebase.google.com/docs/app-check/recaptcha-keys)                                                                                                                                                                                                                                                     |
| 7   | Firestore limits          | **GA**                         | Doc 1 MiB; nesting depth 20; composite indexes 200/1000 per database; avoid unbounded arrays (use subcollections)                                   | [quotas](https://firebase.google.com/docs/firestore/quotas), [structure data](https://docs.cloud.google.com/firestore/native/docs/concepts/structure-data)                                                                                                                                                                                                                               |
| 8   | Cloud Run streaming       | **GA**                         | SSE / server streaming supported; request timeout default 5 min, max 60 min                                                                         | [Server streaming blog](https://cloud.google.com/blog/products/serverless/cloud-run-now-supports-http-grpc-server-streaming), [request timeout](https://docs.cloud.google.com/run/docs/configuring/request-timeout)                                                                                                                                                                      |
| 9   | Stripe                    | —                              | Out of scope (accepted exception)                                                                                                                   | —                                                                                                                                                                                                                                                                                                                                                                                        |

---

## 1. Firebase App Hosting

**STATUS: GA.**

- **Product/API name:** Firebase App Hosting (`firebaseapphosting.googleapis.com`).
- **Capability (one line):** Fully managed Git-connected hosting for SSR/Next.js/Angular web apps, built on Cloud Build, served on Cloud Run, cached in Cloud CDN.
- **Next.js support — version range:** Next.js **13.5.x and higher** are supported. The published support schedule (as read on 2026-10-10) is:

  | Version | Status | Deprecation           |
  | ------- | ------ | --------------------- |
  | 13.5.x  | lts    | 2026-10-09            |
  | 14.2.x  | lts    | 2026-10-09            |
  | 15.0.x  | lts    | 2027-10-09            |
  | 15.1.x  | lts    | 2027-10-09            |
  | 15.2.x  | active | not before 2026-10-09 |

  So the current **actively supported Next.js major/minor is 15.2.x**. Anything outside the documented range "might work, but isn't officially supported." Google maintains the framework adapters for Next.js and Angular; the build uses `next build` / `npm run build`. No Next.js 16 is documented as supported.

- **Deployment mechanism:**
  - Git push: connect a GitHub repo + live branch; a commit to the live branch triggers a build/rollout automatically (via Cloud Developer Connect → Cloud Build → Artifact Registry → Cloud Run revision). Default rollout policy sends a change to 100% of traffic at once.
  - Firebase CLI: the get-started docs note you can deploy local code "using the Firebase CLI … without a GitHub connection." (All backends in one project must share a single GitHub org/account.)
- **Regions (exact identifiers):** `asia-east1`, `asia-southeast1`, `europe-west4`, `us-central1`, `us-east4`, `us-east5`. There is **no default location** — you must set a location per backend (console, REST, or CLI), and each backend can be in a different location. Source: Google Cloud Developer Connect "Locations" page, which lists the Firebase App Hosting integration regions.
- **GA evidence:** The Firebase blog "Deploy Angular & Next.js apps with App Hosting, now GA!" (2025-04-09) announces GA. Note: the `firebase.google.com/docs` pages themselves do **not** carry a launch-stage banner; the GA statement comes from the official Firebase blog (an official Google source, though `firebase.blog` is not one of the four domains named in the brief).

**Sources:**

- https://firebase.google.com/docs/app-hosting/frameworks-tooling
- https://firebase.google.com/docs/app-hosting
- https://firebase.google.com/docs/projects/locations
- https://firebase.google.com/docs/app-hosting/troubleshooting
- https://docs.cloud.google.com/developer-connect/docs/locations
- https://firebase.blog/posts/2025/04/apphosting-general-availability

---

## 2. Google ADK (Agent Development Kit) for TypeScript

**STATUS: GA (v2.x).**

- **Official TypeScript/JS ADK?** Yes — the official repo is `github.com/google/adk-js`. It is described as an "open-source, code-first Typescript toolkit for building, evaluating, and deploying sophisticated AI agents," built for Node.js and the browser, with Zod schema validation and ESM/CJS support, requiring **Node.js 20.19+**.
- **npm package names:**
  - `@google/adk` — core SDK.
  - `@google/adk-devtools` — the `adk` CLI and dev UI (dev dependency).
- **Current version:** `@google/adk` **v2.2.1**, published 2026-10-06 (GitHub release `adk-v2.2.1`). The ADK deployment docs reference "**ADK TypeScript 2.0 GA**," i.e. the TypeScript ADK is GA at major version 2.
- **Deployment:**
  - **Cloud Run:** explicitly supported — `adk deploy cloud_run` per the repo README.
  - **Agent Runtime (formerly Vertex AI Agent Engine):** the ADK Agent Runtime deployment page states support is "**Supported in ADK Python, Go v1.2.0**" — **TypeScript is _not_ listed** as supported for Agent Runtime deployment. Treat "deploy the TypeScript ADK to Agent Runtime" as **UNVERIFIED** (see final section).
- **Managed runtime — current name:** it is now called **Agent Runtime** (described as "a high-performance, stateful runtime environment … with sub-second cold starts and long-running agents"). The older name "Vertex AI Agent Engine" does not appear on the current Agent Runtime overview page; the platform notes it is "an evolution of Vertex AI." The docs also refer to it once as "Agent Platform Runtime."
- **Agent Runtime launch stage:** **not stated** anywhere in the pages read (no GA/Preview label). **UNVERIFIED.**
- **Custom tools:** ADK itself supports custom tools (typed functions / MCP / OpenAPI). Whether the _Agent Runtime managed service_ documents first-class custom-tool support was **not confirmable** from the pages read — **UNVERIFIED**.

**Sources:**

- https://github.com/google/adk-js
- https://github.com/google/adk-js/releases
- https://adk.dev/deploy/
- https://adk.dev/deploy/agent-runtime/
- https://docs.cloud.google.com/agent-builder/agent-runtime/overview

---

## 3. Gemini models on Vertex AI

Exact model ID strings and launch stages as documented on the Vertex AI model pages (now under the "Gemini Enterprise Agent Platform" branding). None of these were inferred from URL slugs — each was read from the model page's Versions/availability section.

| Class                              | Exact model ID                       | Launch stage                                                       | Regions                                |
| ---------------------------------- | ------------------------------------ | ------------------------------------------------------------------ | -------------------------------------- |
| Flash-class (default/fast)         | `gemini-3.8-flash`                   | **GA** (released 2026-09-02)                                       | `global`, multi-region `us`, `eu`      |
| Pro-class (strong)                 | `gemini-3.1-pro-preview`             | **Preview** (Pre-GA banner; released 2026-02-19)                   | `global` only                          |
| Pro-class (strong, alternative)    | `gemini-3.1-pro-preview-customtools` | **Preview**                                                        | `global` only                          |
| Pro-class (older, still GA)        | `gemini-2.5-pro`                     | **GA** (released 2025-06-17) — **retirement date 2026-10-20**      | many US/EU/CA/APAC regions + `global`  |
| Live API (real-time bidirectional) | `gemini-3.8-live`                    | **GA** (released 2026-09-24); "Gemini Live API" marked _Supported_ | multi-region `us`, `eu`; `us-central1` |

**Key caution for this project:** the strongest current **Pro-class GA** model is `gemini-2.5-pro`, and it is scheduled to **retire 2026-10-20** (imminent). The successor Pro, `gemini-3.1-pro-preview`, is **Preview** and global-only. So a production integration pinned to a GA Pro-class model is currently on a retiring model; a Preview model would be required to stay current — this is exactly the kind of GA/Preview gap the project's acceptance rule targets.

**Sources:**

- https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-8-flash
- https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-1-pro
- https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-pro
- https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-8-live

---

## 4. Vertex AI Search (Gemini Enterprise / Discovery Engine) — ACLs and tenant isolation

**STATUS of document-level ACLs: PREVIEW.**

- **`acl_info` exists.** The "Use data source access control" page documents document-level ACLs via an `acl_info` field (structure: `readers` → `principals` → `user_id` / `group_id`), applied to Cloud Storage unstructured data and BigQuery structured data (BigQuery requires a predefined schema with an `acl_info` column — "Don't use a custom schema"). The data store must be created with access control enabled — it "can't turn this setting on or off for an existing data store."
- **Launch stage — PREVIEW.** The page carries a **Preview** banner stating the feature is "a Preview offering, subject to the 'Pre-GA Offerings Terms'." So **document-level ACLs / per-tenant isolation via `acl_info` is Preview, not GA.**
- **Can tenant A ever retrieve tenant B's documents?** Not provably from the docs. The native model is **allow-only** — `acl_info.readers` is an allow list and the documented model has **no deny list**; a search is filtered to the caller's authenticated identity (Google Identity or Workforce Identity Federation). The docs do not make an absolute "never retrieve another tenant's documents" guarantee, so a strict isolation claim must be **UNVERIFIED** (see final section). Community analysis also notes engine/data-store separation vs. shared-engine filtering trade-offs, but that is not official Google documentation.
- **Limits noted on the ACL page:** max **3000 readers per document** (each principal counts as one); one identity provider per supported location.
- **Connecting an end customer's own Google Drive (external third-party OAuth, customer not in your org):**
  - The "prepare data" page states Google Drive sync is **supported only for custom search**, and requires **Google Identity** to be configured as the identity provider.
  - A separate `projects.locations.authorizations` REST resource with a **`ServerSideOAuth2`** authorization type (fields: `clientId`, `clientSecret`, `tokenUri`, `authorizationUri`, `scopes`, `pkceVerificationEnabled`) exists for external OAuth, but it is published under the **`v1alpha`** API namespace — i.e. **alpha/preview**.
  - **Conclusion: connecting an end customer's own Drive via third-party OAuth is UNVERIFIED as GA.** The mechanism appears to be alpha/preview.
- **Folder scoping:** **not documented** for the Drive connector. Only Cloud Storage documents explicit "Folder/File" selection (recursive import). Drive folder-level scoping could **not** be confirmed — **UNVERIFIED**.
- **Incremental sync:** documented reconciliation modes are **`INCREMENTAL`** (upsert-style incremental refresh) and **`FULL`**. Connector ingestion runs on a periodic cadence: "Data updates automatically every 1, 3, or 5 days" (first sync ~1 hour; later runs near 24/72/120-hour marks). This is batch/periodic, not real-time, for the connectors described.
- **Document deletion:** documented. `FULL` reconciliation removes "documents that are not in [the source] … from your data store." There is also a purge API (`documents:purge` / `purgeDocuments`, with a `force` flag and long-running operation) and purge-from-source paths. So deletion _is_ supported by documented mechanisms.

**Sources:**

- https://docs.cloud.google.com/generative-ai-app-builder/docs/data-source-access-control
- https://docs.cloud.google.com/generative-ai-app-builder/docs/prepare-data
- https://docs.cloud.google.com/generative-ai-app-builder/docs/delete-datastores
- https://docs.cloud.google.com/generative-ai-app-builder/docs/reference/rest/v1alpha/projects.locations.authorizations

---

## 5. Model Armor

**STATUS: GA for the core service and most integrations; some features are PREVIEW.**

- **What it covers (surfaces):** Model Armor screens **LLM prompts and responses**, model-agnostically (on Google Cloud or elsewhere). Programmatic surface: the **`SanitizeUserPrompt`** and **`SanitizeModelResponse`** methods (plus `SanitizeOperationLogEntry` log records). Documented integrations: **Agent Gateway, Apigee, Gemini Enterprise, Google/Google Cloud MCP servers, Google Cloud networking services, Agent Platform (Vertex), and LangChain.** It does **not** support text + image in one request, nor audio/video.
- **Per-request / stateless — YES.** The docs state it "operates as a **stateless** service, processing all prompts and model responses entirely in memory," "inspects each prompt and response independently as a single-turn request," and "**doesn't track conversation history.**" So it holds **no conversation state**.
- **Failure behaviour (fail open vs. fail closed): NOT DOCUMENTED.** The overview does not state what happens if Model Armor itself fails/errors/timeouts. What _is_ documented is enforcement mode (a configured action, not an error posture): "Inspect only" (logs, does not block) vs. "Inspect and block" (returns a block verdict, and the calling service applies it). Edge cases noted: oversized documents are **skipped** (not scanned), and image screening in an unsupported region returns `invocation_result = FAILURE`. Because the failure posture is not documented, **any fail-open/fail-closed assumption is UNVERIFIED.**
- **Launch stage:** The Model Armor **overview page does not print an overall launch-stage banner**; **image screening is explicitly labeled **Preview**.** The Model Armor **release notes** record multiple "**generally available**" milestones (e.g. GKE integration GA 2025-09-15, Gemini Enterprise integration GA 2025-09-16, MCP server integration GA 2026-04-22, Agent Gateway GA 2026-06-24, streaming text sanitization GA 2026-07-10), which indicates the core service is GA. **Preview** entries include streaming sanitization (initially), image screening, template modality choice, and template-specific exclusion rules.

**Sources:**

- https://docs.cloud.google.com/security-command-center/docs/model-armor-overview
- https://docs.cloud.google.com/model-armor/release-notes

---

## 6. Firebase App Check

**STATUS: GA.**

- **Attesting traffic from a script embedded on arbitrary third-party customer domains — constrained.** App Check authorizes per **registered app / platform**, using a provider (web = **reCAPTCHA Enterprise**; the sidebar also lists a reCAPTCHA v3 page). Once enforcement is on, "requests from clients without a valid attestation will be rejected," including "any request originating from an app or platform you haven't authorized." The pages do **not** describe or endorse an arbitrary third-party-domain embed scenario; the closest explicit statement is a hard limit:
- **Domain limit:** "**App Check does not support web apps that serve on more than 250 domains.**" This is the key constraint for a multi-tenant design where each end customer's website embeds your script.
- **Limit on registered apps / keys:** "**There's no limit on the number of reCAPTCHA keys that you can create for a Firebase project.**" Recommended (not enforced): one key per registered Firebase app; separate keys per environment. "For App Check, each package name (Android) or bundle ID (Apple) can only correspond to a single reCAPTCHA key."
- **Enforcement mechanisms:** enable enforcement per protected service; providers per platform (Apple: DeviceCheck / App Attest / reCAPTCHA Enterprise; Android: Play Integrity / reCAPTCHA Enterprise; Web: reCAPTCHA Enterprise); custom providers allow third-party attestation services; debug providers for local/CI. Backend verification via "Verify tokens on the backend." Provider quotas: reCAPTCHA Enterprise 10,000 no-cost assessments/month; Play Integrity Standard tier 10,000 calls/day.

**Caution for the embed-on-customer-domains design:** the **>250-domains** ceiling is documented and is the binding constraint; anything beyond that (e.g. thousands of customer domains) is **UNVERIFIED** as supported.

**Sources:**

- https://firebase.google.com/docs/app-check
- https://firebase.google.com/docs/app-check/recaptcha-keys

---

## 7. Firestore limits

**STATUS: GA.**

- **Maximum document size:** **1 MiB (1,048,576 bytes).** Related: max field value = 1 MiB − 89 bytes (1,048,487 bytes); max request = 10 MiB.
- **Maximum nested field depth:** **20** (nested maps/arrays each add a level). (Separately, max subcollection depth = 100; max fields in a composite index = 100.)
- **Composite index limit:** **per database** — **200** if billing is not enabled, **1000** once billing is enabled; you can request an increase via support. **No per-project composite-index limit is documented** (the only project-level figure given is max 100 databases per project).
- **Unbounded arrays — documented best practice:** the "Choose a data structure" doc warns that nested arrays/maps "**isn't as scalable as other options, especially if your data expands over time**," and as the list grows the whole document enlarges, which "can lead to slower document retrieval times." Recommendation: put growing lists in **subcollections**, where "the size of the parent document doesn't change." The best-practices page adds that "Large array or map fields can approach the limit of **40,000 index entries per document**," so such fields should be excluded from indexing if not queried. There is **no** single literal "never use unbounded arrays" sentence, but the guidance is unambiguous: growing lists → subcollections, not unbounded in-document arrays.

**Sources:**

- https://firebase.google.com/docs/firestore/quotas
- https://docs.cloud.google.com/firestore/native/docs/concepts/structure-data
- https://firebase.google.com/docs/firestore/best-practices

---

## 8. Cloud Run — streaming and timeouts

**STATUS: GA.**

- **Streaming / SSE — YES.** Cloud Run (fully managed) supports **server-side HTTP streaming**, including **server-sent events (SSE)**. The official announcement states SSE responses "you can consume from your frontend using the HTML5 EventSource API" are supported, and that streaming also lifts the previous ~32 MB response cap. No special configuration is required; keep the connection open and set `Content-Type: text/event-stream`. (Caveat noted in community sources, not official docs: an API Gateway in front of Cloud Run may buffer responses unless its own streaming support is used.)
- **Request timeout:** **default 5 minutes (300 seconds)**; **maximum 60 minutes (3600 seconds)**. Returns HTTP 504 on timeout; the instance is not shut down and may continue the abandoned request. Console accepts 1–3600 seconds; `--timeout` / `timeoutSeconds` must be under 60 minutes. For long-lived SSE, configure the timeout explicitly and use heartbeats.

**Sources:**

- https://cloud.google.com/blog/products/serverless/cloud-run-now-supports-http-grpc-server-streaming
- https://docs.cloud.google.com/run/docs/configuring/request-timeout

---

## 9. Stripe

Skipped by instruction — accepted external exception, not researched.

---

## Could not verify

The following could not be confirmed from an official Google source and must be treated as **UNVERIFIED**:

1. **"Agent Runtime" GA/Preview status.** No launch-stage label on the Agent Runtime overview or deploy pages. (https://docs.cloud.google.com/agent-builder/agent-runtime/overview)
2. **Deploying the TypeScript ADK to Agent Runtime.** The ADK Agent Runtime deploy page lists only Python and Go v1.2.0 as supported — TypeScript is absent. (https://adk.dev/deploy/agent-runtime/)
3. **Agent Runtime first-class "custom tools" support.** Not documented on the pages read; the ADK framework supports custom tools, but the managed runtime's support is unconfirmed.
4. **Absolute per-tenant isolation guarantee in Vertex AI Search.** `acl_info` ACLs are documented as **Preview** and allow-only (no deny list); no official statement guarantees "tenant A can never retrieve tenant B's documents." (https://docs.cloud.google.com/generative-ai-app-builder/docs/data-source-access-control)
5. **Connecting an end customer's own Google Drive via external third-party OAuth (customer outside your org), as GA.** The mechanism appears to be the `ServerSideOAuth2` authorizations resource under the **`v1alpha`** API namespace (alpha/preview). (https://docs.cloud.google.com/generative-ai-app-builder/docs/reference/rest/v1alpha/projects.locations.authorizations)
6. **Folder-level scoping for the Vertex AI Search Google Drive connector.** Not documented for Drive; only Cloud Storage documents explicit folder/file selection. Any "scope search to one customer folder" claim is UNVERIFIED.
7. **Model Armor fail-open vs fail-closed behaviour.** Not documented on the overview page. (https://docs.cloud.google.com/security-command-center/docs/model-armor-overview)
8. **A current GA, non-retiring Pro-class Gemini model on Vertex AI.** `gemini-3.1-pro-preview` is **Preview** (global only); `gemini-2.5-pro` is GA but retires **2026-10-20**. A GA Pro-class model that is current and not retiring could not be confirmed.
9. **App Check on arbitrary/unbounded third-party customer domains.** The docs state a hard limit of "not more than 250 domains" for web apps; support for more than 250 customer domains is UNVERIFIED. (https://firebase.google.com/docs/app-check/recaptcha-keys)
10. **App Hosting GA via the four named official domains.** The GA statement comes from the official Firebase **blog** (`firebase.blog`, an official Google source but not one of the four domains named in the brief); the `firebase.google.com/docs` pages carry no launch-stage banner.

### Domain-caveat note

Sources used span `firebase.google.com`, `docs.cloud.google.com` / `cloud.google.com`, `github.com/google/adk-js` (the official Google org, not a `googleapis/google-cloud-*` org), `adk.dev` (the official ADK docs site), and `firebase.blog` (the official Firebase blog). Where a fact relied only on the last three, it is flagged above.
