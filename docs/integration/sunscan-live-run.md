# SunScan — first live run

**Date:** 2026-10-13 · **Engine:** the vendored SunScanV2 pipeline
(`@sunny/sunscan-engine` via `@sunny/sunscan-adapter`) · **Mode:** `live`
(recorded with `record`) · **User-Agent:** `Sunny.ai/0.1 (roof assessment for
solar quotes; SunScan engine)` · **Keys:** none — every provider is open UK
data (Nominatim/Photon/postcodes.io, Overpass/Overture, Environment Agency,
Welsh Government and Scottish LiDAR, Esri imagery). The engine paces each host
itself (Nominatim one request a second) and caches responses.

Reproduce:

```
SUNSCAN_USER_AGENT="Sunny.ai/0.1 (…)" npx tsx scripts/sunscan-live-run.ts --mode live \
  "20 Forthlin Road, Liverpool L18 9TN" "251 Menlove Avenue, Liverpool L25 7SA" …
```

## Results

| Address                                          | Nation   | Time (cold) | Geocode | Roof confidence | Reliable            | Built form / roof      | Planes | Usable m² | Max panels | Best facing | Flags                                                      |
| ------------------------------------------------ | -------- | ----------- | ------- | --------------- | ------------------- | ---------------------- | ------ | --------- | ---------- | ----------- | ---------------------------------------------------------- |
| 20 Forthlin Road, Liverpool L18 9TN              | England  | 27.2 s      | high    | medium          | ✅                  | mid-terrace / gabled   | 2      | 29        | 11         | S           | vegetation-masked, survey-old                              |
| 251 Menlove Avenue, Liverpool L25 7SA            | England  | 23.1 s      | high    | high            | ✅                  | semi-detached / hipped | 7      | 20        | 7          | SW          | vegetation-masked, survey-old                              |
| 5 Cwmdonkin Drive, Swansea SA2 0RA               | Wales    | 17.8 s      | high    | medium          | ✅                  | semi-detached / hipped | 5      | 60        | 20         | S           | partitioned                                                |
| 48 Doughty Street, London WC1N 2LX               | England  | 25.9 s      | high    | low             | ❌ → low-confidence | mid-terrace / "flat"   | 1      | 53        | 24         | flat        | fit-unreliable, registration-ambiguous, outside-library, … |
| Hill Top, Near Sawrey LA22 0LF                   | England  | 11.2 s      | high    | low             | ❌ → low-confidence | detached / "flat"      | 2      | 200       | 89         | flat        | fit-unreliable, heritage-building, ground-mismatch, …      |
| Andrew Carnegie Birthplace, Dunfermline KY12 7PL | Scotland | 13.8 s      | high    | estimated       | ❌ → low-confidence | detached / hipped      | 27     | 273       | 108        | SE          | fit-unreliable, heritage-building, pixels-subsampled, …    |

All six ran to a result with no error; three ordinary houses fitted reliably,
and the three listed/complex buildings came back **flagged unreliable** —
which the API reports as `low-confidence`, never as a fact.

**End to end through the Sunny API (live):** a widget session started
`POST /v1/sunscan/assessments` for an arbitrary residential address the engine
had never seen (Hertfordshire; not recorded or committed) — queued → running →
`succeeded` in **45.3 s**, detached hipped roof, 77 m² usable, 28 panels, best
facing S; `GET …/model.glb` returned a valid 440 kB binary glTF
(`model/gltf-binary`, magic `glTF`).

## Live vs replay (the two fixture addresses)

For 20 Forthlin Road and 251 Menlove Avenue the live result is **identical** to
the replay result (same planes, pitches, areas, panel counts, confidence and
flags — compared field by field, excluding timing and GLB byte size). The
engine is deterministic for a given set of provider responses, and the open
data for both addresses has not changed since SunScanV2 recorded it.

## Bug found and fixed

**An unreliable roof fit still shaped the quote.** For a low-confidence
assessment the quote journey correctly _asks_ the roof-size and direction
questions instead of asking the visitor to confirm the measurement — but the
quote still took the unreliable fit's **pitch, roof type and panel limit**.
Live, Hill Top (a pitched heritage farmhouse) came back as a 200 m² flat roof
with room for 89 panels; on the old code its quote added **flat-roof mounting
and the £261 flat-roof structural survey**, and generation was computed for a
0° roof. Fixed in `apps/api/src/journey/journey.ts`: an untrusted fit's
geometry never reaches the quote; the visitor's answers stand in (as when there
is no assessment), with v1's size-band panel limits. Regression tests in
`apps/api/test/quote-journey.test.ts` ("an unreliable roof fit") fail on the
old code and pass now.

## New replay fixtures

Recorded and added to `fixtures/sunscan/http` (+0.2 MB, many responses shared
with existing fixtures), with replay tests in
`packages/sunscan-adapter/test/adapter.test.ts`:

- **5 Cwmdonkin Drive, Swansea SA2 0RA** — a reliable Welsh fit (Welsh
  Government LiDAR), usable as a second demo address.
- **48 Doughty Street, London WC1N 2LX** — an unreliable fit, exercising the
  low-confidence path end to end.

Hill Top and the Carnegie Birthplace were not kept (Scottish LiDAR tiles are
large and neither adds a path the others don't cover).

## Production storage and queue

- **Model files:** `SUNSCAN_ARTEFACT_STORE=gcs` + `SUNSCAN_ARTEFACT_BUCKET`
  store GLB/spec files in a private Cloud Storage bucket (uniform access, public
  access prevention enforced), keyed `sunscan/<tenant>/<assessment>/<file>` with
  every segment encoded. Auth: the Cloud Run runtime identity via the metadata
  server, or `SUNSCAN_GCS_SERVICE_ACCOUNT_JSON`. Files are served only through
  the existing tenant-scoped routes. (`apps/api/src/sunscan/gcs-artefacts.ts`)
- **Job queue:** `SUNSCAN_QUEUE=cloud-tasks` (+ `SUNSCAN_TASKS_PROJECT`,
  `_LOCATION`, `_QUEUE`, `_TARGET_URL`, `_SERVICE_ACCOUNT`, optional
  `_AUDIENCE`) creates one named HTTP task per assessment calling
  `POST /internal/sunscan/run` with an OIDC token; the route verifies it
  (Google-signed RS256, issuer, audience, expiry, signer email) and runs the job
  idempotently — a finished job is untouched, a running one is left alone
  unless stale (default 10 min). In-process stays the default.
  (`apps/api/src/sunscan/cloud-tasks.ts`, `apps/api/src/google/auth.ts`)
- **Terraform:** `infrastructure/terraform/sunscan.tf` (APIs, bucket, bucket
  IAM, queue with rate/retry limits, invoker service account, enqueuer and
  actAs bindings, run.invoker) and the Cloud Run env vars in `main.tf`; set
  `api_base_url` to switch the queue on. Not `terraform fmt`/`validate`d here —
  Terraform is not installed on this machine; run both before applying.

## Still open

- Shading is not simulated (the summary always says `shading-not-assessed`).
- Scotland's LiDAR coverage is partial; the Dunfermline fit was `estimated`.
- Provider outages surface as `provider-unavailable`; no circuit breaker yet.
