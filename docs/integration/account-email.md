# Account emails

Verify your email, reset your password, sign-in links and email changes are
sent by the API from the company's Google Workspace mailbox, with links to
`https://heysunny.co.uk/auth/action`. Firebase's own emails link to
`<project>.firebaseapp.com`, and this project may not change that link
(`EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED`).

## How it works

1. The website calls `POST /v1/auth/email` through its `/api/portal` proxy
   (`apps/marketing/lib/auth-client.ts`).
2. The API asks Firebase Auth for the action link only (`accounts:sendOobCode`
   with `returnOobLink: true`; Firebase sends nothing) and moves it onto
   `/auth/action`, keeping `mode`, `oobCode`, `apiKey`, `continueUrl` and
   `lang`.
3. It sends a branded text-and-HTML email through the Gmail API as the
   Workspace mailbox, by domain-wide delegation. The delegation JWT is signed
   with the API's own identity through the IAM Credentials API, so there is no
   key.

When the API answers `not_enabled` (unconfigured, as on staging and local
runs), the website falls back to Firebase's own email.

Reset and sign-in requests for an unknown address answer exactly like known
ones. Limits: 5 emails per address per hour, 300 per hour in total.

## Setup per environment

- Terraform `account-email.tf`: IAM Credentials API, Firebase Authentication
  Admin for the API's service account, and Token Creator on itself.
- Workspace Admin console, Security, API controls, Domain-wide delegation:
  add the API service account's client ID (its numeric unique ID) with scope
  `https://www.googleapis.com/auth/gmail.send`.
- API environment (`api_env`):
  - `SUNNY_ACCOUNT_MAIL_SERVICE_ACCOUNT`: the API's service account email
  - `SUNNY_ACCOUNT_MAIL_MAILBOX`: the Workspace user to send as
  - `SUNNY_ACCOUNT_MAIL_FROM`: the From header, a verified send-as address of
    that user, e.g. `HeySunny <support@heysunny.co.uk>`

Production: service account `sunny-api-prod@heysunny-prod.iam.gserviceaccount.com`,
mailbox `hummd@heysunny.co.uk`, from `HeySunny <support@heysunny.co.uk>`.
