# ADR-004: Knowledge retrieval and tenant isolation — do not depend on a Preview ACL as the tenant boundary

- **Status:** Proposed (the retrieval mechanism is not built; the isolation
  principle is stated but not yet exercised by a test)
- **Date:** 2026-10-10
- **Related:** ADR-003 (agent runtime), ADR-006 (data and consent)

## Context

The plan (§7.2, §3.1) prefers managed **Vertex AI Search** as the retrieval layer,
"subject to verification", and requires that a strict multi-tenant isolation claim
be proven, not assumed. Acceptance scenario 4 (§11) is explicit: _"Tenant A
user/widget cannot read tenant B knowledge, leads, catalogue or analytics even by
changing IDs and prompt-injecting content."_ The plan also names a fallback: if
the managed service cannot do it, "a small Cloud Run connector with
Google-managed indexing" (§3.1), and it warns "never silently assume a managed
connector can index arbitrary customer Drive folders" (§3.1).

The verified findings (`docs/discovery-google-services.md` §4) are the reason this
ADR cannot simply adopt the managed path:

- **Document-level ACLs via `acl_info` are Preview, not GA.** The "Use data source
  access control" page carries a **Preview** banner ("a Preview offering, subject
  to the 'Pre-GA Offerings Terms'"). The mechanism (`acl_info.readers.principals.user_id`/`group_id`)
  exists, but the data store must be created with access control enabled and the
  setting **cannot be turned on for an existing data store**.
- **The native model is allow-only — there is no deny list.** A search is filtered
  to the caller's authenticated identity. The docs do **not** make an absolute
  "tenant A can never retrieve tenant B's documents" guarantee, so a strict
  isolation claim is **UNVERIFIED** (the discovery doc's own item 4).
- **Connecting an end customer's own Google Drive via external OAuth is
  UNVERIFIED as GA.** The `ServerSideOAuth2` authorizations resource is published
  under the **`v1alpha`** API namespace (alpha/preview). Google Drive sync is
  documented as supported only for **custom search** and requires Google Identity
  as the identity provider.
- **Folder-level scoping is not documented for the Drive connector.** Only Cloud
  Storage documents explicit folder/file selection (item 6).
- **Incremental sync is batch, not real-time.** Documented reconciliation modes are
  `INCREMENTAL` and `FULL`; connector ingestion runs "automatically every 1, 3, or
  5 days" (first sync ~1 hour, later runs near 24/72/120-hour marks). **Document
  deletion** _is_ supported (`FULL` reconciliation removes absent documents, plus a
  `documents:purge` API and purge-from-source paths).

## Decision

### 1. A Preview ACL is never the sole tenant boundary

The design does **not** treat `acl_info` as the thing that keeps tenants apart.
Two reasons, both from the findings above: the feature is **Preview**, and it is
**allow-only with no documented absolute guarantee**. A tenant boundary that can
be weakened by a launch-stage change or by a document that simply lacks an ACL
entry is not a boundary.

The boundary is enforced in Sunny's own layer instead:

- Every tenant-owned record carries a server-validated `tenantId`, and reads are
  scoped by it inside the store interface rather than in every caller: "A store
  that can return another tenant's transcript is a cross-tenant leak, so the
  scoping belongs in the interface" (`apps/api/src/store.ts`, header comment).
- The tenant is derived from the **public widget id**, never accepted from the
  client, and the public id is a lookup key that "grants exactly one thing, the
  ability to open a visitor session" (`packages/contracts/src/widget.ts`;
  `apps/api/src/tenants.ts`).
- Tool calls take `tenantId` from the server-side `ToolContext`, never from the
  model's arguments (`apps/api/src/agent/tools.ts`, header comment).
- Knowledge sources are already scoped per tenant in the tenant model
  (`knowledgeSourceIds`, `apps/api/src/tenants.ts`) and the count is passed into
  the tool context (`apps/api/src/agent/agent.ts`).

### 2. Retrieval stays disabled until isolation is verifiable

There is no retrieval implementation. `retrieve_knowledge` returns one of two
honest failures (`apps/api/src/agent/tools.ts`):

- with **zero** knowledge sources it returns `ok: false, { configured: false }` and
  the summary _"No knowledge sources are connected for this installer, so I cannot
  quote their documents."_;
- with sources present it returns `ok: false, { configured: true, pending: 'ingestion-not-implemented' }`
  and the summary _"Knowledge retrieval is not implemented in this build yet."_

The system instruction tells the model the same thing, so it does not narrate a
retrieval it did not perform (`apps/api/src/agent/agent.ts`).

The consequence of the two decisions together: **a cross-tenant retrieval leak
cannot happen yet, because there is no retrieval.** What is missing is the
capability, not the safety.

### 3. When retrieval is built, the fallback is preferred over the Preview path

If the managed path cannot demonstrate verified isolation, the plan's fallback
applies: a **Cloud Run connector** (OAuth, change/watch renewal, retries,
permission reconciliation) feeding an appropriately isolated index — with the
caveats above recorded up front: external Drive OAuth is **v1alpha**, Drive folder
scoping is **undocumented**, and sync is **1/3/5-day batch**, so any UI that
claims "live" Drive knowledge is wrong today.

## Consequences

- The product is missing a core capability (grounded answers from the installer's
  own documents) until retrieval is built. This is recorded as a gap, not hidden.
- The isolation that _does_ exist is worth keeping honest: the file store's tenant
  boundary is the file boundary, and the reader defensively drops any line whose
  `tenantId` does not match the file it is in (`apps/api/src/store.ts`,
  `#readConversations`). This is a per-tenant _store_ isolation, not yet a
  per-tenant _retrieval_ isolation.
- The plan asks for `scripts/verify-isolation` (§13) and for acceptance scenario 4
  to be "automated where feasible" (§11). **Neither exists.** The closest thing is
  one test that a tenant's leads are invisible to another tenant id
  (`apps/api/test/pipeline.test.ts`, "scopes a tenant's leads to that tenant"),
  and the smoke script's check that the public config never contains the SunScan
  slug or an internal tenant id (`scripts/smoke-api.mjs`). No cross-tenant
  _knowledge_ test could exist yet, since there is no knowledge layer.

## Alternatives considered

- **Adopt Vertex AI Search with `acl_info` now.** Rejected as the primary
  boundary: Preview, allow-only, no documented absolute guarantee, and the ACL
  setting cannot be enabled after the data store is created — so getting it wrong
  early is expensive to undo.
- **Shared engine, filtered per query.** Not chosen. The findings do not settle
  whether filtering is enforced by the service or by the caller; without a
  guaranteed guarantee it would repeat the same mistake.
- **External customer Drive OAuth on the managed connector.** Not relied upon: the
  mechanism is `v1alpha` and **UNVERIFIED as GA**, and Drive folder scoping is
  **not documented**.
- **Index everything into one store and filter in application code.** Rejected for
  the retrieval layer specifically: filtering after the search returns the wrong
  documents is one bug away from a leak; the isolation has to be structural.

## Open questions

- **Unknown — needs verification:** when, if ever, `acl_info` reaches GA, and
  whether a documented **absolute** isolation guarantee follows it
  (`docs/discovery-google-services.md` §4 and item 4).
- **Unknown — needs verification:** whether connecting an end customer's own Google
  Drive via external third-party OAuth is GA or remains `v1alpha` (item 5), and
  whether folder-level scoping exists for the Drive connector (item 6).
- What is the isolated-index strategy concretely — one data store per tenant, or
  one store with per-tenant collections? The discovery doc mentions
  engine/data-store separation trade-offs only as _community_ analysis, not
  official documentation, so it cannot settle this.
- What freshness does the product promise, given a 1/3/5-day connector cadence and
  a purge API? A retention-and-deletion guarantee has to be written against the
  slower of those.
- Where does the "treat retrieved text as untrusted" rule (§7.2) get enforced? No
  prompt-injection defence exists in the tool layer yet; today the tools simply do
  not return retrieved text.
