# Email Assistant add-on

**Package:** + Email Assistant (£99/mo, Blueprint §5 Add-On 2, §6).
**Entitlement:** `email_assistant` (`hasEntitlement`, toggled by Stripe).
**Code:** `apps/api/src/channels/email/**`, `apps/api/src/routes/email.ts`.
**Tests:** `apps/api/test/email-*.test.ts`.

## What it does

An email to the installer's `info@` / `sales@` inbox becomes one turn of the
shared core with `channel: 'email'`. Sunny answers from the installer's
knowledge base (the same retrieval, guardrail sandwich and safety triage as
web chat) and the answer becomes a **draft reply in the installer's mailbox**
for a person to approve. The conversation appears in the unified inbox with
`channel: 'email'` and its intent (sales / support).

```
inbound email ─▶ webhook / Gmail push ─▶ tenant (from route, never content)
             ─▶ sanitise (HTML→text, invisible chars, cap) ─▶ runTurn(channel:'email')
             ─▶ formal reply + sources + disclaimer footer (+ Drive PDF spec sheets)
             ─▶ policy: draft (default) or auto-send ─▶ Gmail / Outlook / held in Sunny
```

## Inbound paths

| Path                                                                  | Route                                              | Authentication                                                                                            | Tenant from                                                                                        |
| --------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Postmark inbound (JSON)                                               | `POST /v1/webhooks/inbound-email`                  | HTTP Basic (`SUNNY_EMAIL_INBOUND_USER` / `_PASSWORD`)                                                     | Receiving address: the tenant's `email.inboundAddress`, or `<tenantId>@SUNNY_EMAIL_INBOUND_DOMAIN` |
| SendGrid Inbound Parse (multipart)                                    | same                                               | same                                                                                                      | same                                                                                               |
| Per-tenant URL (any provider, or the installer's own forwarding rule) | `POST /v1/webhooks/inbound-email/:tenantId/:token` | Secret token in the path, HMAC of the tenant id under `SUNNY_EMAIL_WEBHOOK_SECRET`, constant-time compare | The path                                                                                           |
| Gmail push                                                            | `POST /v1/webhooks/gmail-push?token=…`             | Pub/Sub push with a secret token in the endpoint URL (`SUNNY_GMAIL_PUSH_TOKEN`)                           | The watched mailbox                                                                                |

SendGrid's multipart body is parsed for its **text fields only**; file parts
(attachments) are ignored — the assistant never opens customers' attachments.

Redelivered messages are recognised (provider id, then `Message-ID`, then a
content hash) and processed once. Automated mail (auto-replies, bounces,
lists, `no-reply@`), the installer's own address, and senders over the daily
ceiling (`SUNNY_EMAIL_DAILY_SENDER_LIMIT`, default 20) are skipped.

## Zero inbox read-back

The assistant receives only the current email and the thread it quotes, plus
the tenant's knowledge base. There is no tool or client method to list or
search a mailbox: the email channel's tools are `retrieve_knowledge`,
`create_lead` and `create_gmail_draft` (which only tells the model the system
will file its answer as a draft). The Gmail push path reads exactly the
messages `history.list` reports as newly added to the INBOX. Tested in
`email-units.test.ts` ("zero inbox read-back").

## Prompt-injection defence

- The email is untrusted `<user_query>` text inside the core's guardrail
  sandwich; `<`/`>` are escaped so it cannot close the tag.
- HTML is reduced to text; scripts, styles, comments and invisibly-styled
  elements are dropped; zero-width and bidi-override characters removed;
  new text capped at 3,000 characters and the quoted thread at 1,500.
- Emails that look like instructions ("ignore previous instructions", "system
  prompt", tag injection, "forward all emails") are never auto-sent and the
  draft carries a reviewer note.

## Drafts and auto-send

**Default: draft for approval.** The reply is a formal email: greeting, the
grounded answer (citation markers removed), "Further information" links for
cited sources, a sign-off from the installer's team, and the legal footer,
which the system appends so it cannot be omitted. Cited knowledge passages
that come from a **PDF in the installer's Drive** are attached (max 3, 15 MB).

**Auto-send** happens only when all of these hold:

1. the installer turned it on (`tenant.config.email.autoSend`);
2. grounding confidence ≥ 0.95 on a **standard FAQ** — the customer's question
   matches a cited "Customer question: …" passage of the knowledge base, the
   answer cites it, uses no tool but retrieval, and contains no figure that the
   cited passage does not;
3. the sender has had fewer than 3 automatic replies today -- claimed
   atomically before sending (`claimAutoReply`, a Firestore transaction in
   production), so two instances answering one sender at once cannot both take
   the last one; a failed send gives the claim back;
4. no safety escalation, no "I don't have that exact information" fallback,
   no injection suspicion, and a connected mailbox that can send.

Safety reports (smoke, fire, burning smell, exposed wiring) get the core's
fixed safety reply with the installer's phone number, are flagged for the
inbox, and are **never** auto-sent.

Without a connected mailbox (forwarding only), the draft is kept in Sunny and
shown in the inbox (`GET /v1/portal/tenants/:tenantId/email/threads/:sessionId`
returns it with reviewer notes) for the installer to copy.

## Mailbox connection (OAuth)

| Provider                  | Scopes                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Gmail                     | `gmail.compose` (drafts; send only if auto-send), `gmail.readonly` (only to read the one new message a push names) |
| Outlook (Microsoft Graph) | `offline_access`, `Mail.ReadWrite`, `Mail.Send`                                                                    |

`POST /v1/portal/tenants/:tenantId/email/connect` (admin) returns the consent
URL; the `state` is HMAC-signed with the tenant id and a 10-minute expiry.
`GET /v1/email/oauth/callback` exchanges the code, encrypts the refresh token
with **AES-256-GCM** under `SUNNY_EMAIL_TOKEN_KEY` (32 bytes, base64) and stores
the ciphertext in the add-on's state; the tenant record holds only a reference
(`tokenRef: email-state:<tenantId>`). This is the interim for Secret Manager:
production should keep `SUNNY_EMAIL_TOKEN_KEY` in Secret Manager. Without a key
no mailbox can be connected.

## Other routes (installer portal, member auth)

| Route                                   | Role   | Purpose                                                                 |
| --------------------------------------- | ------ | ----------------------------------------------------------------------- |
| `GET /v1/portal/tenants/:id/email`      | viewer | Status, mailbox, inbound address, secret webhook URL, month's usage     |
| `POST …/email/settings`                 | admin  | `autoSend`, `provider`                                                  |
| `POST …/email/connect` / `…/disconnect` | admin  | OAuth                                                                   |
| `POST …/email/watch`                    | admin  | Start the Gmail watch (renew weekly; Gmail watches expire after 7 days) |
| `GET …/email/threads/:sessionId`        | viewer | The draft for an inbox conversation                                     |

All refuse with `403 not_enabled` unless the tenant has `email_assistant`.

## State

Per-tenant bookkeeping (processed message ids, per-sender daily counters,
monthly usage `{processed, drafts, autoSends, skipped}`, encrypted token,
Gmail watch cursor, thread → draft links): `FirestoreEmailState` (collection
`emailState`, transactional) when the deployment's store is Firestore,
`FileEmailState` (`<dataDir>/email/<tenant>.json`) locally.

## Configuration

`SUNNY_EMAIL_TOKEN_KEY`, `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET`,
`MICROSOFT_OAUTH_CLIENT_ID` / `_SECRET`, `SUNNY_EMAIL_OAUTH_REDIRECT`
(default `<SUNNY_PUBLIC_API_URL>/v1/email/oauth/callback`),
`SUNNY_EMAIL_WEBHOOK_SECRET`, `SUNNY_EMAIL_INBOUND_USER` / `_PASSWORD`,
`SUNNY_EMAIL_INBOUND_DOMAIN`, `SUNNY_GMAIL_PUSH_TOPIC`, `SUNNY_GMAIL_PUSH_TOKEN`,
`SUNNY_EMAIL_AUTO_REPLY_CAP` (3), `SUNNY_EMAIL_DAILY_SENDER_LIMIT` (20),
`SUNNY_EMAIL_AUTO_SEND_THRESHOLD` (0.95), `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON`
(spec-sheet attachments, shared with the knowledge connector).

## Blocked on owner accounts — not yet run against a real provider

- **Gmail:** a Google Cloud OAuth client (consent screen; `gmail.compose` and
  `gmail.readonly` are restricted scopes and need Google's verification before
  public use), a Pub/Sub topic with `gmail-api-push@system.gserviceaccount.com`
  as publisher, and a push subscription to `/v1/webhooks/gmail-push?token=…`.
- **Postmark** (or SendGrid) inbound server and domain MX records.
- **Microsoft 365:** an Azure app registration and a test mailbox.
- **Drive attachments:** the knowledge connector's service account.

Everything above is exercised against fakes in the tests; none of it has been
run against the real providers.
