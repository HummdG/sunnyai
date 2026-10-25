# Deploying Sunny.ai

The runbook for §13 of `SUNNY_AI_IMPLEMENTATION_PLAN.md`: what the scripts in
`scripts/` do, what they refuse to do, and what has to exist before any of this
can be run against a real project.

**Read this first, because it is the one thing that would be dishonest to bury:
nothing has been deployed, and no script in `scripts/` has been run against a
live Google Cloud project — nor has Terraform.** The Terraform configuration in
`infrastructure/terraform` exists, compiles and is validated in CI, but `init`,
`plan` and `apply` have never been run against a project, so it describes an
intended deployment rather than a performed one. `infrastructure/terraform/README.md`
is its own account of what it does.

The one thing that _has_ been measured against a real service is the isolation
sweep (`scripts/verify-isolation.ts`), which ran against a live local API and
against a deliberately reverted fix, and `scripts/seed-demo.ts`, which seeded a
real store through the real admin routes. Both are described below.

**How far the rest has been run.** Every script's argument handling and its
refusal paths were executed and their exit codes checked: `--help` exits 0, an
unknown argument exits 2, `--apply` without a project exits 2, a bad base URL
exits 2, `rollback.sh` exits 3. The deploy scripts' build step was exercised for
real — `npm run build:marketing` compiles the site and copies the widget bundle
into it. `bootstrap-google-cloud.sh`'s check-only path was exercised up to its
toolchain check, where it stops with exit 2 because **neither `gcloud` nor
`terraform` is installed on the machine this was written on** — so its project,
billing, plan and apply steps have never run, and no live project has been
touched by any script here.

**What has been run since (2026-10-20, D-54).** Both production images build and
run here: the API image refuses to start unconfigured in production, serves
`/healthz` with Terraform's settings, and passes **34/34** smoke checks while
storing everything in the Firestore emulator; the website image serves every
page and the widget. Terraform 1.16.5 formats, initialises without a backend and
validates with the new database, website and monitoring resources. None of it
has been pushed to or applied against a real project.

## The scripts

| Script                              | What it does                                                                                                                                                                             | Exits         |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `scripts/bootstrap-google-cloud.sh` | Checks the toolchain, account, project and billing; with `--apply`, runs `terraform init` / `plan` / `apply`; with `--set-gemini-key`, adds the one secret value Terraform must not hold | 0 / 1 / 2     |
| `scripts/deploy-staging.sh`         | Clean tree, `npm run verify`, builds the widget and the marketing site, then stops at the boundary                                                                                       | 0 / 1 / 2 / 3 |
| `scripts/deploy-production.sh`      | The same, plus the browser suite and a named confirmation before anything reaching a visitor changes                                                                                     | 0 / 1 / 2 / 3 |
| `scripts/smoke-test.sh`             | `/healthz` must answer `ok: true`; runs `scripts/smoke-api.mjs`; with `SUNNY_WIDGET_URL`, fetches the bundle and asserts it is JavaScript that attaches a shadow root                    | 0 / 1 / 2     |
| `scripts/rollback.sh`               | Checks whether a service exists and prints the rollback runbook and its three irreducible limits                                                                                         | 0 / 2 / 3     |
| `scripts/seed-demo.ts`              | Loads the demo catalogue and the demo knowledge document into the demo tenant through the admin routes                                                                                   | 0 / 1 / 2     |
| `scripts/verify-isolation.ts`       | Eight checks that one installer cannot read another's data, each denial paired with a control                                                                                            | 0 / 1 / 2     |
| `scripts/smoke-api.mjs`             | The dependency-free API assertions, pre-existing                                                                                                                                         | 0 / 1         |

`scripts/deploy-lib.sh` is sourced by the shell scripts and is never executed on
its own. Provisioning itself is `infrastructure/terraform`'s job, not a shell
script's: `bootstrap` drives Terraform rather than creating the resources
Terraform declares, because doing both is how two tools come to fight over the
same secret — `google_secret_manager_secret` with an id that already exists is an
error, not an adoption.

Every script is idempotent: re-running `bootstrap` converges on the same
Terraform state (and adding the model key adds a _version_, not a second secret),
`smoke-test.sh` reads and writes nothing, `seed-demo.ts` replaces rather than
appends (with one documented exception, below), and the isolation sweep only adds
a single lead whose idempotency key it controls.

### The exit codes mean one thing each

- **0** — it did what it says.
- **1** — a step failed. The message says which.
- **2** — it did not run: a tool is missing, an argument is missing, a tfvars file
  is missing, there is no token, or a confirmation was declined. Nothing was
  changed. This is not an error; it is a script refusing to guess.
- **3** — it stopped at the infrastructure boundary. See below.

## What is left

The repository side is done (D-54):

- **Images.** `apps/api/Dockerfile` compiles the API and the workspace packages
  it uses to JavaScript (`scripts/build-api.mjs`, which says why it does not
  bundle) and runs it on plain `node`. `apps/marketing/Dockerfile` builds the
  website and dashboard as a standalone Next server. Both run on Node 24, the
  version every test runs on; CI builds both on every change.
- **The store.** The API stores everything in Firestore (D-52), and Terraform
  now creates the database (`infrastructure/terraform/firestore.tf`) and
  configures the API for it.
- **Website hosting.** Cloud Run, as its own service (`web.tf`), because Firebase
  App Hosting documents no support for the Next 16 the app uses (ADR-002's own
  condition for reopening the choice).
- **Monitoring.** Uptime checks and alerts for the API, for chat being
  available (the dead-model-key alarm) and for the website (`monitoring.tf`).

What is left is outside the repository, and it is in this order:

1. **A project and a first apply.** A GCP project with billing, a state bucket,
   and `env/<env>.tfvars` (see `example.tfvars.example`). `plan` and `apply` have
   never run, so the first one is a rehearsal: read the plan.
2. **The secrets.** The Gemini key (`--set-gemini-key`), and for billing the two
   Stripe secrets, then `stripe_enabled = true` and the four GBP price ids.
3. **The images pushed** to the Artifact Registry repository Terraform creates,
   and `api_image` / `web_image` naming them. `scripts/deploy-staging.sh` builds
   them and prints the push and deploy commands.
4. **The domain.** Mapping sunny.ai (and an API host) to the two services is not
   in Terraform yet; until it is, `site_url` and `api_base_url` are the Cloud Run
   URLs from the first apply.

## First run

### 1. Look before you provision

```sh
scripts/bootstrap-google-cloud.sh                            # check-only, changes nothing
scripts/bootstrap-google-cloud.sh --project my-project
```

It prints the Node, npm, `gcloud` and Terraform versions it found (and refuses if
Terraform is older than the `>= 1.9` that `versions.tf` requires), the active
account, the project, the region and environment, and the billing account it can
read. It reports whether `infrastructure/terraform/env/<env>.tfvars` exists — that
file names a real project and a real image and is therefore **not committed**;
only `env/example.tfvars.example` is. Then it prints the three commands it would
run and exits 0 having changed nothing.

### 2. Provision, deliberately

```sh
TF_STATE_BUCKET=my-tf-state scripts/bootstrap-google-cloud.sh \
  --project my-project --region europe-west2 --env staging --apply
```

`--apply` requires `--project`, prints the project, region, environment and
tfvars together with the list of resources Terraform will create, and asks for a
confirmation. Terraform then runs `init` (with the state bucket if
`TF_STATE_BUCKET` is set, and a warning about local state if it is not), `plan`,
and — after a second confirmation naming the project — `apply`. `--env` is
`staging` or `prod`, which is what `variables.tf` validates.

The state bucket is made by hand once per environment: Terraform cannot create
the bucket that holds its own state. Losing local state is not a disaster on a
first experiment and is one on a deployment somebody else has to operate, because
the next apply proposes creating everything that already exists.

What it creates (`infrastructure/terraform/main.tf`): the Cloud Run v2 service
`sunny-api-<env>`, an Artifact Registry repository, a service account, the two
Secret Manager secrets, and a `random_password` for the session secret. The
identity it creates can read two secrets and nothing else — least privilege as
far as it goes today, and when Firestore becomes the store, `roles/datastore.user`
will have to be added to Terraform rather than granted by hand, so that it stays
reviewable as code.

### 3. The one value Terraform must not hold

```sh
scripts/bootstrap-google-cloud.sh \
  --project my-project --apply --set-gemini-key
```

Terraform state is readable by anyone with access to the state bucket, so a
credential that passes through it has leaked. The model key's secret is created
**empty** and its value is added out of band: the script prompts on the terminal,
pipes it to `gcloud secrets versions add --data-file=-` (so it never appears in
the process arguments either), and unsets it. **No secret value is ever echoed,
logged or written to a file**, and `--set-gemini-key` refuses when stdin is not a
terminal so it cannot be fed from a pipeline by accident.

Without it, `/healthz` reports chat as unavailable and the assistant refuses
rather than pretending — which is the behaviour the whole capability-report
design exists to produce.

The session secret is the exception, and deliberately: Terraform **generates** it
per environment (`random_password`), because a value nobody typed is a value that
was not reused, and because the same secret in staging and production is a secret
that lets staging forge a production session. Rotating it invalidates every
session already issued.

### 4. Firestore — created by Terraform

`firestore.tf` creates one named database per environment (`sunny-staging`,
`sunny-prod`), so the two can share a project without sharing data, in
`firestore_location` (London, `europe-west2`, by default). **A database's
location is permanent**: set `firestore_location` before the first apply, not
after. Production gets delete protection, `deletion_policy = "ABANDON"` and
point-in-time recovery. No composite indexes are needed (docs/firestore.md).

## Configuration and secrets

Read once at boot from the environment (`apps/api/src/config.ts`; the table is
ADR-002's):

| Variable                                                                 | Default              | Purpose                                                                           |
| ------------------------------------------------------------------------ | -------------------- | --------------------------------------------------------------------------------- |
| `GEMINI_API_KEY`                                                         | unset                | its presence is what makes chat available at all                                  |
| `GEMINI_MODEL`                                                           | `gemini-3.8-flash`   | the default model                                                                 |
| `GEMINI_SURFACE`                                                         | inferred             | `developer-api` (Gemini API key) or `vertex`; Terraform sets it                   |
| `GEMINI_ESCALATION_MODEL`                                                | unset                | the escalation model (ADR-003)                                                    |
| `GOOGLE_CLOUD_LOCATION`                                                  | `global`             | stored on the Gemini config                                                       |
| `PORT` / `HOST`                                                          | `8787` / `127.0.0.1` | listener (Cloud Run sets `PORT` from the container port, 8080)                    |
| `NODE_ENV`                                                               | `development`        | tightens CORS, logging, error detail (Terraform sets `production`)                |
| `SUNNY_DATA_DIR`                                                         | `.data`              | where conversations, leads and catalogues are written                             |
| `WIDGET_ALLOWED_ORIGINS`                                                 | empty                | comma list of origins allowed to open a session                                   |
| `SESSION_SECRET`                                                         | dev constant         | HMAC key for session tokens                                                       |
| `SUNNY_ADMIN_TOKEN`                                                      | unset                | `Authorization: Bearer` token for the admin routes                                |
| `SUNNY_SANDBOX_TENANT`                                                   | unset                | serves the fictional sandbox installer; **refused in production**                 |
| `SUNNY_TRUST_PROXY`                                                      | unset                | hop count for the rate limiter (D-10)                                             |
| `SUNNY_RATE_LIMIT`, `SUNNY_RL_*`                                         | on, per-route limits | the rate limiter                                                                  |
| `LOG_LEVEL`                                                              | `info`               | Fastify log level                                                                 |
| `SUNSCAN_BASE_URL`, `SUNSCAN_URL_<SLUG>`                                 | unset                | SunScan base URL (ADR-003, ADR-006)                                               |
| `SUNNY_STORE`                                                            | unset                | `firestore` in production (Terraform sets it); required there                     |
| `GOOGLE_CLOUD_PROJECT`                                                   | unset                | the Firestore project (Terraform sets it)                                         |
| `SUNNY_FIRESTORE_DATABASE`                                               | `(default)`          | the named database (Terraform sets `sunny-<env>`)                                 |
| `FIREBASE_PROJECT_ID`                                                    | the GCP project      | whose ID tokens installer sign-in accepts                                         |
| `SUNNY_DASHBOARD_URL`, `SUNNY_PUBLIC_API_URL`, `SUNNY_WIDGET_SCRIPT_URL` | development URLs     | links and install snippets (Terraform sets them from `site_url` / `api_base_url`) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`                             | unset                | billing secrets (Secret Manager, once `stripe_enabled`)                           |
| `STRIPE_PRICE_BASE` / `_EMAIL` / `_VOICE` / `_SUITE`                     | unset                | GBP price ids (`stripe_price_ids`)                                                |

Two of these are gates rather than settings, and the API refuses to boot if they
are wrong: `assertProductionReady()` **will not start in production** while
`SESSION_SECRET` is the published development constant, nor with an empty
`WIDGET_ALLOWED_ORIGINS`, nor with `SUNNY_SANDBOX_TENANT` set. That refusal is the
mechanism that keeps a development accident out of production, so do not paper
over it — the failure is the feature. `allowed_origins` in `variables.tf` has no
permissive default for the same reason.

**Which values are secrets.** `SESSION_SECRET` (generated by Terraform) and the
model key (added by `--set-gemini-key`) are Secret Manager secrets, mounted into
Cloud Run by reference. `SUNNY_ADMIN_TOKEN` is a third secret the deployment will
need and Terraform does not create yet. `WIDGET_ALLOWED_ORIGINS`,
`SUNSCAN_BASE_URL`, `SUNSCAN_URL_<SLUG>` and `SUNNY_TRUST_PROXY` are
installer-specific configuration and belong to the deployment, not to this
repository. Nothing in this repository's history contains a real credential, and
CI greps for credential-looking strings on every push so that the one failure a
later commit cannot fix is caught at the commit that made it.

`WIDGET_ALLOWED_ORIGINS` deserves one sentence of its own: an empty allow-list
echoes any origin. That is a development convenience, production cannot boot with
it, and a customer's domain has to be named in it explicitly. CORS is not the
access control, though — the real control is that a session token grants only
visitor-scoped reads (ADR-005).

## Runbook

### Staging

```sh
scripts/deploy-staging.sh                 # refuses a dirty tree
scripts/deploy-staging.sh --allow-dirty   # for a deliberate hotfix
```

It requires a clean tree (a deploy ships a commit, and a tree that differs from
its commit cannot be rolled back to), runs `npm run verify`, builds the widget
bundle, builds both images tagged with the commit (`sunny-api:<sha>`,
`sunny-web:<sha>`; the website's `NEXT_PUBLIC_*` values come from the shell's
environment), and then stops with exit 3, printing the push and
`gcloud run deploy` commands for a provisioned project. Terraform sets
`ignore_changes` on both container images precisely so a deploy moves them and
an apply does not move them back. Then `scripts/smoke-test.sh` against the new
revision. The smoke
test runs _after_ a deploy, not before one, because it tests a deployment and this
script has not made one.

```sh
SUNNY_API_URL=https://<staging-api-url> \
SUNNY_WIDGET_URL=https://<staging-web-url>/widget/sunny-widget.js \
  scripts/smoke-test.sh
```

`SUNNY_WIDGET_URL` is the honest shape of §13's "widget script URL": the
marketing build copies the bundle to `apps/marketing/public/widget/sunny-widget.js`,
so it is served from the web host at `/widget/sunny-widget.js`. The smoke test
checks the response is 200, is JavaScript, and contains both `attachShadow` and
`data-sunny-widget` — a 200 that returns an HTML error page is not a bundle.

### Production

```sh
scripts/deploy-production.sh --yes
```

The difference from staging is not the build. It is two extra gates before
anything reaching a visitor changes:

1. the **full browser suite** (`npx playwright test`, or `npm run test:e2e` in
   CI), because the point of a staging deploy is that production is not where a
   rendering bug is found. It needs ports 4173–4176, 4180 and 8787 free. Nothing
   it starts is reused: an occupied port is a `http://127.0.0.1:8787/healthz is
already used` failure before a browser opens, which is what a stale dev API on
   8787 should be. It used to be reused instead, and a server started with the
   _shipped_ rate limits (30 widget sessions a minute) then starved a late test
   of its session, so the run failed with a card count of 0 for a reason outside
   the code — measured and recorded in D-40. `PW_REUSE_API=1` takes that
   behaviour back deliberately, for iterating on the API itself. `--skip-e2e`
   exists and says loudly what was skipped.
2. a confirmation **naming the project, the region and the commit being
   replaced**. Production is the one place where a script must not act merely
   because it was invoked, so `--yes` is the way to say it should, and the
   default answer to the prompt is no.

### Seeding the demo tenant

```sh
SUNNY_API_URL=http://127.0.0.1:8787 SUNNY_ADMIN_TOKEN=... npm run seed:demo
```

This loads `fixtures/demo-catalogue.csv` (`mode: 'replace'`, so re-running it is
idempotent) and `fixtures/demo-knowledge.md` — a fictional Northwind Solar page
carrying a DEMO DATA banner — through the real admin routes, asserting each
response against the contract schema. It refuses to run against a non-loopback
`SUNNY_API_URL` without `--force`, and exits 2 with no token. Re-running without
`SUNNY_SOURCE_ID` adds a second copy of the document rather than replacing it,
which the script says when it finishes.

### The waitlist

The home page's waitlist form posts to `POST /v1/waitlist`, which in production
accepts only the origins in `WIDGET_ALLOWED_ORIGINS`, so the website's own URL
must be on that list. Entries are an email, an optional company name, the date
and the consent wording's version. Read them, or remove someone who asks, with
the admin token (both are recorded in the audit trail):

```sh
curl -H "Authorization: Bearer $SUNNY_ADMIN_TOKEN" https://<api-host>/v1/waitlist
curl -X DELETE -H "Authorization: Bearer $SUNNY_ADMIN_TOKEN"   -H 'content-type: application/json' -d '{"email":"jo@example.com"}'   https://<api-host>/v1/waitlist
```

The privacy policy says entries are kept until the person is invited or asks to
be removed, so remove people once they have been invited.

### The isolation sweep

```sh
SUNNY_ORIGIN=https://<the installer's site> \
SUNNY_ADMIN_TOKEN=... \
  npm run verify:isolation
```

Eight checks, each a denial paired with a control so that a broad 500 cannot be
mistaken for a pass, against two installers that must be told apart first — if
they cannot be, the script exits 2 rather than reporting a green sweep that
proved nothing. It looks for the internal `t_...` tenant id in every response
body. The one that found a real defect: the visitor-facing catalogue response
used to carry `products[].tenantId`, the store key, and now serves
`publicProductSchema` with it stripped — `apps/api/test/catalogue.test.ts` proves
the stored row still has the field, so the strip is what is being tested rather
than the absence of the data.

## Test fixtures and demo data

§12 requires that the demo data be clearly separate from production, and it is,
in three layers:

1. **The demo tenant** is `t_demo0001` / `w_demo000001` ("Northwind Solar"), a
   fictional installer. Its catalogue and knowledge are `fixtures/demo-catalogue.csv`
   and `fixtures/demo-knowledge.md`, both marked DEMO DATA.
2. **The sandbox tenant** `t_sandbox001` / `w_sandbox0001` ("Southgate Solar") is
   served **only** when `SUNNY_SANDBOX_TENANT=1`, and `assertProductionReady()`
   refuses to boot in production with it set. It exists so the isolation sweep has
   two installers to tell apart, and it cannot follow the deployment into
   production.
3. Nothing seeded reaches a customer, because `seed:demo` requires an admin
   token and says which URL it is about to write to. The demo tenant is not
   privileged in the store; it is a tenant like any other, distinguishable by its
   id.

## Backup and restore

**Today's store** is files under `SUNNY_DATA_DIR`, one per tenant:

```
.data/catalogue/<tenantId>.json          one document, replaced on upload
.data/conversations/<tenantId>.jsonl     append-only, one JSON object per line
.data/leads/<tenantId>.jsonl             append-only
.data/knowledge/<tenantId>.json          one document
.data/knowledge-jobs/<tenantId>.jsonl    append-only
```

A backup is a copy of that directory taken while the API is stopped — the
`.jsonl` files are append-only, so a copy taken mid-write can end in a partial
line, and a restore that silently drops the visitor whose line was cut is worse
than one that fails. For a live copy, take the directory twice and diff the file
sizes; for anything that matters, stop the process.

A restore is: stop the API, replace the directory, start the API. It is not a
rollback of code — see below. Note that this never applies to a deployed Cloud
Run service: the filesystem there is per-instance and ephemeral, which is
precisely why the store has to change before anything is deployed.

**The intended store** (once ADR-006's Firestore swap lands) is backed up with
Firestore's own exports to Cloud Storage:

```sh
gcloud firestore export gs://<bucket>/exports/$(date +%Y%m%dT%H%M%S) \
  --project my-project

# restore (this overwrites documents the export contains):
gcloud firestore import gs://<bucket>/exports/<stamp> --project my-project
```

**An export is not a backup schedule.** A dated export sitting in a bucket is a
file; §13's requirement is an operator who has restored from one and knows how
long it takes. **No backup or restore has been performed in this repository,
because there is no deployment to back up.** The procedure above is the shape of
the drill, not a rehearsal of it, and it should be rehearsed against staging
before it is needed.

**What a restore does not do.** It does not revert a schema change that the older
documents are not shaped for, and it does not un-send a lead. Restoring
yesterday's data into today's code is a data decision, not a code decision.

## Rollback

```sh
SUNNY_GCP_PROJECT=my-project SUNNY_REGION=europe-west2 scripts/rollback.sh
```

Today this finds no `sunny-api-<env>` service, prints the runbook below and exits 3.
Images are tagged with the commit they were built from, so a previous
revision's image is the previous commit's tag; the website (`sunny-web-<env>`)
rolls back the same way as the API.

Once the API is deployed, a rollback is a traffic move, not a rebuild:

```sh
gcloud run services update-traffic sunny-api-staging \
  --to-revisions <revision>=100 --region <region> --project <project>
```

Three things it cannot do, which belong in the runbook now rather than being
discovered during an incident:

1. **It does not undo data.** A revision that wrote to the store keeps having
   written to it. A schema change, a backfill or a bad catalogue upload is not
   reverted by serving older code — that is what the backup/restore procedure is
   for.
2. **It does not undo a secret rotation.** If the session secret was rotated — by
   tainting `random_password.session_secret` and re-applying — every session
   issued under the old key is already invalid whichever revision answers.
3. **It does not undo a widget bundle a customer's page has cached.** The bundle
   is served from the web host; a browser holding the previous one keeps running
   it until it revalidates.

Before rolling back: record the current revision, decide whether the store needs
restoring as well, and say which of the three applies. A rollback nobody wrote
down is an incident that happens twice.

## What an operator will have to check, and what is printed

§13 step 7 asks a deploy to print actual URLs, the widget script URL, the admin
route, the test instructions, the cost position and the unresolved steps. Here is
where each of those stands today, so the gap is visible rather than implied:

| §13 step 7 item           | Today                                                                                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actual URLs               | None exist yet. Terraform's `api_url` and `web_url` outputs are the Cloud Run URLs once applied                                                                                                         |
| Widget script URL         | `https://<web-host>/widget/sunny-widget.js` once hosted; `apps/marketing/public/widget/` locally                                                                                                        |
| Admin login route         | Installers sign in at `https://<web-host>/sign-in` (the dashboard is `/dashboard`). Operator admin is `Authorization: Bearer <SUNNY_ADMIN_TOKEN>` on the admin routes                                   |
| Test instructions         | `npm run verify`, `npm run test:e2e`, `scripts/smoke-test.sh`, `npm run verify:isolation` (above)                                                                                                       |
| Costs and alerts          | Uptime alerts are in Terraform (`monitoring.tf`, to `alert_email`). Budget alerts are still unset on purpose: §11 asks for thresholds measured from the first staging build. Billing → Budgets & alerts |
| Unresolved external steps | The four in [What is left](#what-is-left): a project and first apply, the secrets, the images pushed, the domain                                                                                        |

### The two headers the widget's typeface needs

The widget serves its own typeface — one `.woff2` per subset, 47.9 kB together — from the
`fonts/` directory beside `sunny-widget.js`, and it requests it from the **visitor's** page. That
fetch is cross-origin by construction, so whichever host serves `widget/fonts/*` has to send:

```
Access-Control-Allow-Origin: *
Cache-Control: public, max-age=86400, stale-while-revalidate=604800
```

The first is not optional: a browser refuses a font response without it, the widget falls back to the
system stack, and **nothing on the page reports a problem** (D-48). The second is not correctness but
cost — the files change only when the typeface does, and a day of caching is what a versioned asset
wants.

Both are already set for the two hosts in this repository that ship the widget:
`apps/marketing/next.config.mjs` sends them for `/widget/fonts/:path*`, and
`scripts/static-server.ts` sends the CORS header for any `font/*` response the fixtures serve. An
integrator's CDN, or any other host you put the bundle on, has to set them itself — copying
`sunny-widget.js` without the `fonts/` directory beside it produces a widget that mounts, renders and
looks fine in the system stack, which is why there is no way to notice this from the outside.

## Costs, honestly

Nothing in this repository has cost anything, because nothing has been
provisioned: no script here has been run with `--apply` and Terraform has never
been applied. What will cost money once it is: Cloud Run request and instance
time for the API and the website, Artifact Registry image storage, Firestore
reads/writes and storage, uptime checks beyond the free allowance, model calls,
and Cloud Build minutes if images are built there. What
will not, materially: Secret Manager's first few versions.

`api_max_instances` and `web_max_instances` default to 4 and the minimums to 0 — the ceiling that
protects the budget and the scale-to-zero that keeps an idle environment cheap,
both stated in `variables.tf` rather than discovered from a bill.

No figure is quoted here on purpose. Pricing changes, per-region rates differ, and
a number written into a repository is a number nobody re-checks. The plan's own
instruction is to derive thresholds from the first staging build's measurements;
that build has not happened, so that step is open rather than answered.

## Doing this for the first time

1. `scripts/bootstrap-google-cloud.sh` — read the output, change nothing.
2. Create the Terraform state bucket by hand, and write
   `infrastructure/terraform/env/<env>.tfvars` from `example.tfvars.example`.
   Decide `firestore_location` now: it cannot change later.
3. `scripts/deploy-staging.sh` to build both images, then push them to the
   Artifact Registry repository and name them in `api_image` / `web_image`.
4. `TF_STATE_BUCKET=... scripts/bootstrap-google-cloud.sh --project <id> --apply`,
   then re-run with `--set-gemini-key`. Set `site_url` and `api_base_url` to the
   Cloud Run URLs it prints (or your domain), and `alert_email`, and apply again.
5. For billing: put the two Stripe secrets in Secret Manager, set
   `stripe_enabled = true` and `stripe_price_ids`, and apply.
6. `scripts/smoke-test.sh` against the API, and sign up an installer on the
   website to check sign-in end to end.
7. `npm run verify:isolation` against staging, with two installers you can tell
   apart.
8. `scripts/deploy-production.sh --yes`, and then a real restore drill on staging
   before you need one on production.
