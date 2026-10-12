# Knowledge pipeline (base package)

**Blueprint:** §3 High-Accuracy Knowledge Pipeline, §4.2 tenant isolation, §4.5 Drive DLP.
**Code:** `packages/knowledge` (pure: chunking, BM25, hybrid fusion, HTML→Markdown,
PII, placeholders) and `apps/api/src/ingest/*` + `apps/api/src/routes/knowledge-ingest.ts`
(network: crawler, Drive, embeddings, sync, routes).

## What it does

| Stage         | Implementation                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Status                                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Website crawl | Sitemap (and sitemap indexes) first, then same-site breadth-first links; robots.txt honoured; page cap 200, depth 4, 3 workers; HTML → Markdown keeping headings, lists, tables and absolute links, dropping nav/footer/scripts. Optional Jina Reader (`SUNNY_CRAWL_JINA=1`).                                                                                                                                                                                                    | Works (tests with a fake site)                                                                               |
| SSRF guard    | http(s) only; host must resolve to public addresses; redirects re-checked per hop; 3 MB cap; 15 s timeout.                                                                                                                                                                                                                                                                                                                                                                       | Works                                                                                                        |
| Google Drive  | Share-with-service-account (`GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON`) or OAuth refresh token (`GOOGLE_OAUTH_CLIENT_ID/SECRET`); `drive.readonly` only. Recursive `files.list`; Docs → `text/markdown` export (HTML fallback); Sheets → CSV → Markdown table; Slides → text; `.md`/`.txt`/`.html` downloaded. Incremental via `changes.list` with a stored page token, scoped to the folder tree; deletions and trash removed from the index; a new subfolder triggers a full re-list. | Written to the REST v3 docs, tested with a fake client. **Real-provider acceptance blocked on credentials.** |
| PDFs          | Recorded as `needs-extraction` with a reason; never guessed at. Interim path: convert to a Google Doc, or run `scripts/pdf-to-markdown.py` and upload the Markdown.                                                                                                                                                                                                                                                                                                              | Blocked on an extractor dependency (see below)                                                               |
| Chunking      | Split on H1–H6, heading trail (`section`) kept on every chunk; tables never cut — an over-long table is split by rows with its header repeated; prose cut at word boundaries.                                                                                                                                                                                                                                                                                                    | Works                                                                                                        |
| PII / DLP     | Quarantine (not indexed, reason shown): card numbers (scheme prefix + Luhn), IBAN (mod-97), UK sort code + account, NI number, US SSN, or a document that reads like one customer's bill/contract. Redact: private emails, UK mobiles (the installer's own domains and role mailboxes like `info@` are kept). Applied to uploads, pages and Drive files alike.                                                                                                                   | Works                                                                                                        |
| Placeholders  | `XXXXX`, `[insert …]`, `{{…}}`, TBC/TBD, "replace all placeholders", checklist rows still "To do": reported on the source as warnings with their section; chunks marked; retrieval masks them so they are never quoted.                                                                                                                                                                                                                                                          | Works                                                                                                        |
| Hybrid search | BM25 top 15 + Gemini embeddings top 15 (`gemini-embedding-001`, 768 dims, cached per passage hash, tenant-scoped) → reciprocal rank fusion → optional Vertex AI ranking (`SUNNY_RERANK=vertex`) → top 5. No key → BM25 only, reported in `/v1/knowledge/capabilities`.                                                                                                                                                                                                           | Works with a fake embedder; real Gemini embeddings need a key                                                |
| Sync jobs     | `queued → running → succeeded/failed`, with counts (seen, unchanged, deleted, quarantined, skipped, failed) and issues; unchanged pages/files are not rewritten.                                                                                                                                                                                                                                                                                                                 | Works                                                                                                        |
| Scheduling    | `POST /v1/knowledge/sync-due` runs websites weekly and Drive folders every 15 minutes; call it from Cloud Scheduler.                                                                                                                                                                                                                                                                                                                                                             | Works; the Cloud Scheduler job itself is an infra task                                                       |

## Tenant isolation

- Every source, connection and embedding is stored under its tenant (a path
  segment in Firestore).
- The chat core receives an index loaded by the server for the tenant in the
  signed session; the hybrid search learns the tenant only from that loader
  (`tenantOfIndex`), never from a tool argument.
- Tests cover: another tenant's sources, connections, jobs and retrieval all
  come back empty or 404.

## Routes (admin token for now; the portal reaches the same pipeline via `connector`)

| Route                                               | Purpose                                                                                                                                        |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/knowledge/connections`                    | Connect a website (`{kind:'website', url}`) or Drive folder (`{kind:'drive', folderId, mode}`); starts the first sync; 202 with the queued job |
| `GET /v1/knowledge/connections?tenantId=`           | Connections with status and last error (credentials never returned)                                                                            |
| `POST /v1/knowledge/connections/:id/sync?tenantId=` | Sync now (`{full:true}` to re-list a Drive folder)                                                                                             |
| `DELETE /v1/knowledge/connections/:id?tenantId=`    | Disconnect and remove what it indexed                                                                                                          |
| `POST /v1/knowledge/sync-due`                       | Run due syncs (Cloud Scheduler)                                                                                                                |
| `GET /v1/knowledge/sources?tenantId=`               | Sources with kind, size, passages and placeholder warnings                                                                                     |
| `GET /v1/knowledge/jobs/:id?tenantId=`              | A job's latest state                                                                                                                           |
| `GET /v1/knowledge/capabilities`                    | What this deployment can do (Drive share address, semantic search, rerank, PDFs)                                                               |

## For the assistant

`createKnowledgeRetriever(...)` (in `apps/api/src/knowledge.ts`) returns:

- `passageSearch(index, query, limit)` — the chat core's `PassageSearch`, wired as
  the server's default. Hits carry the chunk (id, title, URL or Drive link,
  version, heading, `section` trail) with placeholders masked.
- `retrieveKnowledge(tenantId, query)` — passages with a ready-made `citation`
  (`title`, `url`, `version`, `kind`, `section`) and `hasPlaceholder`.

## Owner actions

- **Drive:** create a service account, store its key JSON as
  `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` (Secret Manager), and/or an OAuth client.
  Until then Drive connections fail with a clear message.
- **Semantic search:** `GEMINI_API_KEY`.
- **PDF extraction:** add a dependency (recommended: `unpdf`, a small, maintained
  wrapper around pdf.js with no native build) and implement the `needs-extraction`
  branch in `drive.ts` and the crawler.
- **Cloud Scheduler:** a job calling `POST /v1/knowledge/sync-due` every 15 minutes.
