# Product plan — aligned to the Blueprint

**Source:** `Solar Industry AI Customer Assistant & Omnichannel SaaS Blueprint.pdf`
(repo root, 2026-10-09). **Date:** 2026-10-12.

The owner's direction: the chat assistant is the **base package**; email and
voice are **higher-priced add-ons**; the animated character is the personality
layer, not the product. This plan puts the functionality first.

## Packages (entitlements)

| Package               | Contents                                                                                              | Blueprint price | Entitlement key               |
| --------------------- | ----------------------------------------------------------------------------------------------------- | --------------- | ----------------------------- |
| **Base**              | Web chat widget, website + Google Drive knowledge base, lead capture, savings estimate, unified inbox | £199 / mo       | `web_chat`                    |
| **+ Email Assistant** | Drafts grounded replies in the installer's Gmail/Outlook, attaches spec sheets, human approval        | +£99 / mo       | `email_assistant`             |
| **+ Voice & Phone**   | Mic in the widget (web voice) + AI phone receptionist (inbound/outbound)                              | +£199 / mo      | `voice_widget`, `phone_agent` |
| **Full Suite**        | All of the above                                                                                      | £449–499 / mo   | all                           |

Entitlements live in `tenant_addons` and are switched by Stripe webhooks.
Prices are configuration; the figures are the blueprint's and need owner sign-off.

## Architecture (Blueprint §1, Option A on Google Cloud)

One **headless AI core** with **pluggable channel adapters** (web chat, email,
voice). Every channel shares the tenant's knowledge base, the guardrail engine
and the action tools, and logs to one unified inbox.

- Runtime: Cloud Run (TypeScript, existing `apps/api`).
- LLM: Gemini Flash-class via the Gemini API / Vertex AI.
- Store: Firestore (existing `FirestoreStore`), tenant-scoped.
- Retrieval: hybrid — BM25 (existing `@sunny/knowledge`) + Gemini embeddings,
  merged and reranked; every chunk tagged `tenant_id`, which the server resolves
  from the session/origin and the model can never choose.

## Gap analysis (2026-10-12)

| Blueprint requirement                                              | State today                                                         |
| ------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Web chat widget, single script tag                                 | ✅ Works (chat needs a Gemini key)                                  |
| Lead capture (`create_lead`)                                       | ✅ Works                                                            |
| Website crawler (weekly re-crawl → Markdown)                       | ❌ Missing                                                          |
| Google Drive folder sync (`changes.list`, `files.export`)          | ❌ Missing                                                          |
| Structure-aware chunking (headers, intact tables)                  | 🟡 Exists for uploaded text; verify tables                          |
| Hybrid search + rerank                                             | 🟡 BM25 only                                                        |
| Starter knowledge template (service areas, catalogue, finance…)    | ❌ Missing                                                          |
| XML-sandwiched prompt, exact fallback line, non-binding disclaimer | 🟡 Similar rules, not the blueprint's structure                     |
| Source citations in answers                                        | ❌ Missing                                                          |
| Ingestion PII / DLP quarantine                                     | ❌ Missing                                                          |
| Origin lock, 20 msgs / 10 min / IP, 500-char input, Turnstile      | 🟡 Origin allow-list + limits exist, different values; no Turnstile |
| `estimate_savings` tool (non-binding)                              | 🟡 `calculate_approved_estimate` exists                             |
| Installer portal: sign-up, connect website/Drive, unified inbox    | ❌ Missing (admin token only)                                       |
| `tenant_addons` entitlements + Stripe webhooks                     | ❌ Missing                                                          |
| Email Assistant add-on                                             | ❌ Missing                                                          |
| Voice: web mic (Gemini Live) + phone receptionist (Twilio)         | ❌ Missing                                                          |

## Workstreams

1. **Knowledge pipeline (base):** crawler, Drive connector, chunking with tables,
   PII quarantine, hybrid search + rerank, starter template, sync status.
2. **Core engine + guardrails (base):** channel-aware headless core
   (`channel: 'chat' | 'email' | 'voice'`), blueprint prompt structure, citations,
   disclaimers, limits, Turnstile, `estimate_savings`, entitlement enforcement.
3. **Installer portal + billing (base):** dashboard app (sign-in, onboarding,
   connect website/Drive, unified inbox, leads, add-ons, install snippet),
   `tenant_addons`, Stripe checkout + webhooks.
4. **Email Assistant add-on:** inbound email webhook + Gmail draft creation,
   draft mode default, 3 auto-replies per sender per day, zero inbox read-back.
5. **Voice & Phone add-on:** widget mic via Gemini Live, Twilio phone bridge,
   5-minute cap, <40-word spoken answers, `transfer_to_human`, `send_sms_link`.

1–3 run in parallel; 4–5 build on the channel-aware core from 2.

## The installer's knowledge base (added 2026-10-12)

`Knowledge Base.pdf` (repo root) is a UK aftercare/support knowledge base, so
Sunny answers **existing customers' support questions** as well as sales
enquiries. Converted to structure-preserving Markdown at
`fixtures/knowledge/support-knowledge-base.md` by `scripts/pdf-to-markdown.py`
and seeded as the demo tenant's source. What it requires of the product:

- **Support mode** with the document's rules: customer-facing answer first,
  only the follow-up questions needed, route to manufacturer / installer /
  energy supplier per its routing table, no fault diagnosis, no personalised
  tariff advice.
- **Deterministic safety triage** (smoke, fire, burning smell, exposed wiring)
  answered server-side before the model, flagged in the installer's inbox.
- **Tenant support contact** for the escalation line — the document's number is
  a placeholder (`XXXXX XXXXXX`) and must never be shown to a customer.
- **Completeness warnings** in the portal: unfilled placeholders and the
  document's own "To do" checklist (manufacturer links, supplier guidance).

**Owner decisions (2026-10-12):**

1. **Share manufacturer procedures.** Once the customer's manufacturer is
   identified and the knowledge base has a procedure for it (e.g. Solis Wi-Fi
   reconfiguration), Sunny walks them through it step by step. A procedure is
   never applied to a different brand, and the safety rules always win.
2. **The escalation line uses the installer's phone number**, set in the
   portal (required at onboarding). Unset → "contact your installer directly";
   the placeholder is never shown.

## SunScan 3D (owner decision 2026-10-12)

Use **SunScanV2** (not hosted anywhere). Its code is brought into this repo —
`packages/sunscan-core`, `packages/sunscan-engine`, `packages/sunscan-viewer`,
with `packages/sunscan-adapter` as Sunny's typed interface — and run from here.
Visitors give an address in chat; Sunny runs the roof assessment, reports roof
planes and usable area as indicative (subject to survey), and offers a 3D roof
viewer in the widget; installers see each lead's roof in the dashboard.

## Owner actions (cannot be done without you)

- Gemini API key (real chat), Google Cloud project for Drive OAuth / service
  account, Stripe account (test keys), Twilio account + number, Gmail OAuth
  consent screen. Everything is built against fakes until these exist; nothing is
  reported as working with a real provider until it has been run against one.
- Confirm package prices and currency.
