# Recovery progress

Live tracker for the fixes in `docs/EVALUATION.md`. Updated as each item lands.
Committed on branch recovery/sunny-ai-rebuild (not pushed).

**Last updated:** 2026-10-12

## Direction (owner, 2026-10-12)

Sunny must look exactly like `sunny.png` and move like a 1930s rubber-hose
cartoon ("Cuphead vibe"), with the full body shown in `reference_poses.png`.
Redraw in-house rather than wait for an animator; Rive stays as an optional
upgrade path (ADR-007, amended).

## Product functionality (owner, 2026-10-12)

The Blueprint PDF defines what Sunny does; the character is the personality
layer. See `docs/PRODUCT_PLAN.md` for packages, gap analysis and workstreams.

| Workstream                                                                                                                                                                        | Status                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1. Knowledge pipeline — website crawler, Google Drive sync, PII quarantine, hybrid search                                                                                         | ✅ Done (Drive + embeddings await credentials)                                                  |
| 2. Core engine + guardrails — channels, blueprint prompt, citations, limits, Turnstile, support mode, safety triage                                                               | ✅ Done (419 tests)                                                                             |
| 3. Installer portal + billing — dashboard (port 4177), sign-up, onboarding, unified inbox, leads, knowledge, Studio, team, Stripe                                                 | ✅ Done (needs Firebase + Stripe accounts)                                                      |
| 4. Email Assistant add-on — inbound email, Gmail/Outlook drafts, 3 auto-replies/sender/day                                                                                        | ✅ Done with fakes (needs Google OAuth, Postmark, Azure)                                        |
| 5. Voice & Phone add-on — widget mic (Gemini Live), Twilio phone receptionist                                                                                                     | ✅ Done with fakes (needs Gemini Live + Twilio)                                                 |
| 6. SunScan 3D roof assessment — SunScanV2 brought into this repo; roof card + 3D viewer in chat; open UK data, no keys                                                            | ✅ Done (replay-tested; first live run pending)                                                 |
| 7. Installer product catalogue — Products page, CSV upload + template, price list, Google Sheet sync, website product drafts with approval, HSEnergy example                      | ✅ Done (Sheet + Gemini extraction await credentials)                                           |
| 8. Guided quote journey — address, 3D roof, full questionnaire (roof confirmed), 3 priced options from the installer price list, consent, lead                                    | ✅ Done (Sentinel uplift + emailed proposal PDF still to do)                                    |
| 9. One Next.js app — website + dashboard merged (sunny.ai, /dashboard), real sign-up/sign-in from the website (Firebase Auth, HttpOnly session cookie), brand-guidelines UI audit | ✅ Done (needs Firebase project; apps/dashboard kept until first commit)                        |
| 10. Security sweep — tenant-isolation cases for all 110 API routes                                                                                                                | ✅ Done (no isolation bugs found)                                                               |
| 11. Dashboard completeness — 3D roof on lead page, quote + proposal link, price labels, sync progress                                                                             | ✅ Done                                                                                         |
| 12. Quote gaps — Sentinel uplift (installer-configurable), proposal PDF, email my quote                                                                                           | ✅ Done (real email send needs Postmark)                                                        |
| 13. Firebase sign-in tests — project-local JRE + Auth emulator e2e                                                                                                                | ✅ Done (8/8 against the emulator; real Firebase project still needed)                          |
| 14. Character v3 — rays morph into arms/legs, new hands/feet, frame-drop fixes, sunglasses + deckchair redone                                                                     | ✅ Done (frame drops fixed: 0 dropped at 4× throttle) — polish pass running                     |
| 15. Sunny everywhere — cameo system, skiing Sunny on the hills, cameos across website + dashboard                                                                                 | ✅ Done (skier, ~20 website cameos, dashboard greetings/empty states/toasts)                    |
| 16. Savings simulation — choose a package, panels on the 3D roof, monthly £ pop-ups, year and 25-year totals                                                                      | ✅ Done (lead page: add chosen-package savings figures)                                         |
| 17. Character polish + widget size — wrist seams, point/hips/droop hands, bundle back to ≤ 52 kB                                                                                  | ✅ Done (widget 50.8 kB gz)                                                                     |
| 18. SunScan first live run + Cloud Storage for 3D models + Cloud Tasks queue                                                                                                      | ✅ Done (6 live addresses incl. Wales + Scotland; live = replay; Terraform fmt + validate pass) |
| 19. Firestore emulator tests + shared voice/email counters                                                                                                                        | ✅ Done (70/70 emulator tests; no FirestoreStore bugs)                                          |
| 20. Pointing hand redraw                                                                                                                                                          | ✅ Done (finger-gun + raised index; 1a691e8)                                                    |

## Character status

| #   | Item                                                           | Status            | Evidence / notes                                                                                                                                                                                                                                                              |
| --- | -------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Character redrawn from the reference                           | ✅ Done           | `scripts/trace-reference.py` traces `sunny.png` into layered parts (`packages/character/src/traced-art.ts`): heavy ink, detached rays, notched pupils, brows, cheek creases. Rest pose differs from the reference by 8.3% of pixels, almost all sub-pixel edge alignment.     |
| 2   | Full rubber-hose body from `reference_poses.png`               | ✅ Done           | `packages/character/src/limbs.ts`: tube arms, four-finger mitten hands (relaxed, open, fist, point, thumbs-up, peace), tube legs with big shoes planted on the ground. 12 poses: rest, hips, wave, thumbsUp, point, cheer, chin, idea, peace, shrug, jump, droop.             |
| 3   | 1930s cartoon motion                                           | ✅ Done           | Motion steps on 24 fps film frames and the ink "boils" (`cartoonClock`). Idle bounces with squash and stretch; anticipation, overshoot and wobble on every flagship move; elastic ray wave. Body acting for every sequence in `packages/animation-engine/src/limb-acting.ts`. |
| 4   | Persistent renderer (no per-frame `innerHTML`)                 | ✅ Done           | `createSunnyView` patches the SVG in place; widget, lab gallery and marketing use it.                                                                                                                                                                                         |
| 5   | Widget: Sunny covering the header text                         | ✅ Fixed          | Head-only 40 px avatar, measured clear of the name and first message. New E2E test asserts the geometry.                                                                                                                                                                      |
| 6   | Widget: bubble-open sequence                                   | ✅ Done           | ~560 ms: launcher squash, fizz bubbles, bubble swells from the launcher, Sunny waves and settles into the header. Reduced motion: instant.                                                                                                                                    |
| 7   | Widget: live re-theming                                        | ✅ Done           | Public `setTheme(colour)`; the marketing colour switcher now recolours the launcher Sunny too.                                                                                                                                                                                |
| 8   | Lab: "wrong sequence" report                                   | ✅ Checked        | Measured each Play button: every one plays the requested sequence first. The follow-ups seen (e.g. charging → shades) are the engine's own chained reactions, not overrides.                                                                                                  |
| 9   | Marketing site rebuild                                         | ✅ Done           | 11 pages, "Meet Sunny. Your brightest employee." hero with bubble emergence and layered hills, live colour switcher, lazy gallery, config-driven pricing (placeholder prices — need your numbers), customer-facing copy. 11 marketing E2E tests pass.                         |
| 10  | `@sunny/character-rive` package                                | ✅ Done (dormant) | Ready to play a `.riv` file if one is ever commissioned; contract verified against current Rive docs. 33 tests.                                                                                                                                                               |
| 11  | Chat works locally                                             | ✅ Done           | API reads a root `.env`; `.env.example` documents it; the disabled-chat message says exactly what to do. You still need a Gemini key.                                                                                                                                         |
| 12  | Verification that checks the product                           | 🔄 Running        | Unit: 1152 pass. Visual baselines re-captured only after reviewing each image. Full browser E2E run in progress.                                                                                                                                                              |
| 13  | Platform gaps: dashboard, billing, knowledge, SunScan, add-ons | ⏳ Later          | SunScan blocked on real API access; Stripe needs your account keys.                                                                                                                                                                                                           |

## How to check for yourself

Start the servers (from the repo root):

```
npm run build
npx tsx apps/character-lab/serve.ts      # http://localhost:4180
npx tsx apps/api/src/main.ts             # API for the widget
npx tsx apps/widget-demo/serve.ts        # http://localhost:4173
npm run dev:marketing                    # http://localhost:4176
```

- **Animation gallery** — http://localhost:4180/gallery.html — every sequence
  looping side by side, reference artwork next to the rest pose, pause/scrub,
  speed, and a reference overlay toggle.
- **Animation lab** — http://localhost:4180/ — drives the real engine and games.
- **Widget** — http://localhost:4173/ — click the Sunny launcher bottom-right.
- **Marketing site** — http://localhost:4176/
- **Pose sheet** — `npx tsx packages/character/scripts/render-poses.ts` writes
  `packages/character/out/poses.png` to compare with `reference_poses.png`.
- **Frame strips** — `npx tsx packages/animation-engine/scripts/render-sequences.ts`
  writes `packages/animation-engine/out/sequences.png`.

## Still to do on the character

- Props from the sheet not yet drawn: lightbulb (eureka), book, laptop,
  magnifier, and drawing tic-tac-toe on the ground.
- Wink (one eye closed) for the point pose.
- Ping-pong paddle is still held by a ray rather than a hand.

## Needs you

- **Pricing** — the marketing plans show placeholder prices.
- **A Gemini API key** in `.env` to try real chat.

## Status at hand-off (2026-10-14)

Build complete on branch `recovery/sunny-ai-rebuild` (not pushed). The owner
chose to stop here pending accounts. **Blocked on the owner:** live checks
against Gemini (chat, embeddings, Live voice), Firebase Auth, Stripe (test
mode), Google Drive/Gmail OAuth, Postmark and Twilio. Each integration is
built and tested against fakes or emulators; setup steps are in
`docs/integration/*.md`. Add keys to `.env` (never committed) and run the
checks per provider. Also open: package prices/currency and each installer's
support phone number.
