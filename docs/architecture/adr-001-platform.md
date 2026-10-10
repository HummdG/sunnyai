# ADR-001: Platform shape — npm-workspaces monorepo, one widget bundle, Zod contracts, posed character

- **Status:** Accepted
- **Date:** 2026-10-10
- **Supersedes:** none
- **Related:** ADR-002 (hosting), ADR-005 (widget isolation)

## Context

Sunny.ai is a multi-tenant assistant for solar installers. It has to produce three
kinds of artefact that ship on different clocks:

1. a **script an installer pastes into their own website**, which must load
   asynchronously, work on any host stack, and not be re-built per customer;
2. a **server** that owns the model boundary, tenancy, persistence and (later)
   retrieval and integrations;
3. a **character** that animates in the browser and must be reproducible enough to
   screenshot-test.

These share data shapes — a chat event, a tool name, a widget config — that must
not drift between the two processes that exchange them. The build plan
(`SUNNY_AI_IMPLEMENTATION_PLAN.md` §3.2) prescribes a monorepo with a separate
embeddable widget package, a separate API app, and a `packages/contracts`
package, and (§3.1) describes the animation layer as "Rive interactive rig +
GSAP/Motion/SVG as needed".

What actually exists in the repository is a narrower thing than the plan's layout:
of the apps and packages the plan lists, `apps/marketing`, `packages/ui`,
`packages/solar-rules` and `packages/sunscan-adapter` are **stubs** — a
`package.json` and no `src/` — and `apps/dashboard` does not exist. The pieces
that do exist are the API, the widget, the character renderer, the animation
engine and the contracts. This ADR records the shape those pieces were built to.

## Decision

### 1. One TypeScript monorepo on npm workspaces

The root `package.json` declares `"workspaces": ["packages/*", "apps/*"]`,
`"private": true`, `"type": "module"`, and `engines.node >= 22`. There is a single
lockfile (`package-lock.json`) and **no monorepo tool** — no Turborepo, no Nx, no
Lerna. npm workspaces resolve inter-package imports directly.

- Toolchain: TypeScript 6 with `strict`, `moduleResolution: "Bundler"`,
  `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, ESM only (`tsconfig.json`).
- Package-to-package imports use bare specifiers (`@sunny/contracts`,
  `@sunny/character`, `@sunny/animation-engine`), mapped both in `tsconfig.json`
  `paths` and in `vitest.config.ts` `resolve.alias`. The two are kept in sync on
  purpose so a test cannot pass through an import that would not resolve in a
  real build (`vitest.config.ts` comment).
- Tests run with Vitest over `packages/*/test/**` and `apps/*/test/**`
  (`vitest.config.ts`).

### 2. One embeddable widget, built as a single file

`packages/widget` is built by an esbuild script into **one self-contained IIFE**
(`packages/widget/scripts/build.mjs`): `format: 'iife'`, `bundle: true`, no
external requests, no framework. The bundle is what the embed snippet promises —
two attributes and a script tag (`apps/widget-demo/public/index.html`).

The build enforces a **hard size budget of 60 kB gzipped** and exits non-zero
above it (`packages/widget/scripts/build.mjs`, `SIZE_BUDGET_BYTES`). The budget is
deliberately load-bearing: the bundle inlines Zod because the browser must
validate the stream it receives, and that is the single largest dependency.

The widget mounts one instance per `script[data-widget-id]` tag, idempotently and
multi-instance by design (`packages/widget/src/index.ts`).

### 3. A separate API process

`apps/api` is a Fastify server (`apps/api/src/server.ts`) with its own entry
point (`apps/api/src/main.ts`) and its own dependency set: `fastify` and
`@google/genai` (`apps/api/package.json`). It is shaped for Cloud Run — the SSE
response headers include `x-accel-buffering: no` specifically so a proxied
response is not buffered into a single delivery at the end
(`apps/api/src/server.ts`), and session tokens are HMAC-signed rather than held
in memory because Cloud Run runs more than one instance
(`apps/api/src/sessions.ts`).

### 4. Contracts are shared Zod schemas, not generated code

`@sunny/contracts` is the single source of truth for every shape that crosses a
process boundary, and both the API and the widget import from it
(`packages/contracts/src/index.ts` header comment). It is built from Zod:

- `widget.ts` — widget ids, tenant ids, widget config, session request/response.
- `chat.ts` — chat request and the discriminated-union streaming events.
- `events.ts` — the closed vocabularies: `APPLICATION_EVENTS`, `TOOL_NAMES`,
  `PAGE_ACTIONS`.
- `errors.ts` — the stable error codes, the single error envelope, and the
  code→HTTP-status map.

TypeScript types are derived with `z.infer`, so there is **no code generation
step and no drift window**: a schema change breaks the other side's typecheck in
the same commit. The plan (§4) allowed "OpenAPI/JSON Schema/Zod or equivalent,
with generated client types"; the code chose the Zod-direct option and emits no
client codegen.

### 5. Character animation is a pure function of a serialisable pose

This is the decision that most departs from the plan. Rather than adopt a runtime
animation library, the character is:

- **a rig** — a plain, serialisable structure of numbers (`SunnyRig` in
  `packages/character/src/rig.ts`), including a closed `PROP_IDS` list and the
  measured `defaultRig()` pose that reproduces the reference artwork;
- **a pure renderer** — `renderSunny(rig) → string`, deterministic and
  side-effect-free, so the same rig always produces byte-identical SVG
  (`packages/character/src/render.ts`);
- **sequences** — each a pure `pose: (base: SunnyRig, t: number) => SunnyRig`,
  with no mutation of the base (`packages/animation-engine/src/types.ts`);
- **a state machine and a scheduler** with no DOM and no clock of their own
  (`packages/animation-engine/src/machine.ts`, `scheduler.ts`), driven by
  `SunnyAnimator.frame(now)`, which takes the time as an argument
  (`packages/animation-engine/src/engine.ts`).

Determinism is deliberate and enforced: the blink cadence uses a seeded xorshift
instead of `Math.random` so replays match, and the scheduler is documented as
returning the same rig for the same `now` (`engine.ts`, `scheduler.ts`). The
consequence is that props cannot outlive their sequence: a sequence derives its
output from the caller's base rig and never mutates it, so "cleaned up" holds by
construction rather than by a cleanup callback
(`packages/character/src/rig.ts`, `packages/animation-engine/src/types.ts`).

## Consequences

- A change to a contract is a compile error on the other side, not a runtime
  surprise. This is the main reason the Zod-direct approach was chosen over an
  IDL with generated clients.
- The widget carries Zod. That is accepted and constrained by the 60 kB budget,
  but it means the budget is the thing to watch when adding validation.
- Because the animation engine imports nothing from the DOM, it can be replayed
  frame-by-frame in a test, and every flagship sequence can be pinned with a
  screenshot rather than a video harness. The same property means **animation is
  authored in TypeScript**, not in a visual tool — a real cost the plan's "Rive
  interactive rig" default would not have.
- The engine is `intensity`-aware by design: intensity is a floor, not a hint, so
  a sequence below the tenant's setting is never chosen, and each behavioural
  moment (a "group") has at least one member for every setting
  (`packages/animation-engine/src/sequences.ts`, `scheduler.ts`).
- Stubs are stubs. `packages/ui`, `packages/solar-rules`,
  `packages/sunscan-adapter` and `apps/marketing` have no source, and
  `apps/dashboard` is absent. Anything that imports them cannot build yet. The
  `validate_compatibility` tool implements its rules inline in
  `apps/api/src/agent/tools.ts` rather than in `@sunny/solar-rules`.

## Alternatives considered

- **Rive (plan default) plus GSAP/Motion.** Rejected in practice. A runtime
  library would make the character a black box to the test suite and to the
  replay harness, and would add a third-party runtime to a script loaded on
  arbitrary customer pages. The plan lists Rive as an "external exception" to the
  Google-first rule (§15); the code instead keeps the character in-repo and pure.
  The cost — authoring animation as code — is accepted above.
- **An iframe instead of a Shadow DOM widget.** The plan (§3.1) offered both. The
  widget uses Shadow DOM; the comparison and the isolation argument are in
  ADR-005.
- **An IDL with generated client types** (OpenAPI/JSON Schema). Rejected: a
  generation step is another thing to run and to drift.
- **A monorepo tool (Turborepo/Nx).** Not adopted. With this many packages the
  build graph does not yet justify it; npm workspaces plus two scripts (`vitest`,
  `tsc`) cover it.
- **Separate repositories.** Rejected: the contract-drift risk that the whole
  contracts package exists to remove would return.

## Open questions

- When `apps/marketing` and `apps/dashboard` gain source, do they share
  `@sunny/ui` tokens with the widget, or does the widget's in-shadow styling stay
  independent? Today `@sunny/ui` has no `src/` and the widget ships its own
  styles (`packages/widget/src/styles.ts`).
- Does the character remain pure-function-as-code as the animation backlog grows
  to games (A06, A08, A09) with real collision and scoring, or does the state
  machine gain a `playing` subsystem? Today `playing` is a state with a single
  ambient layer and no game loop (`packages/animation-engine/src/types.ts`,
  `scheduler.ts`).
