# Custom Logo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owners upload their own icon and wordmark in Sunny Studio, name the assistant, and the widget shows their logo exactly, animating the icon with the chosen effects while the assistant is busy.

**Architecture:** The API decodes each uploaded PNG once, extracts the logo's shape as a coverage mask, traces and self-verifies an outline, picks colours, and stores the normalised PNG, its mask and metadata in a private bucket served through API routes. The public widget config gains `assistantName` and a `brand` block of asset paths, outline and enabled effects. A new `@sunny/logo-effects` package renders the effects as SVG + CSS keyframes. The widget loads it lazily as `sunny-logo.js`, and Studio imports it directly for the live preview.

**Tech Stack:** TypeScript, Fastify 5, zod 4, pngjs 7 (already in the lockfile via `@sunny/sunscan-engine`), GCS JSON API over fetch, vanilla TS widget (esbuild), Next.js 16 (webpack), Vitest, Playwright, Terraform.

**Spec:** `docs/superpowers/specs/2026-11-08-custom-logo-design.md`

## Global Constraints

- Never show a visitor anything but the uploaded pixels at rest; motion is drawn only on the logo's own mask or a verified outline.
- Outline effects (`comet`, `draw`, `rings`, `march`) only when the trace passes verification; stencil effects (`charge`, `shimmer`, `segments`) only when a mask exists.
- Busy states are exactly `thinking`, `speaking`, `guiding`. All other states show the still logo.
- `intensity: 'off'` keeps the logo still. `prefers-reduced-motion` uses `shimmer` at a 3 s period if enabled, otherwise still.
- Widget main bundle stays within the 62 kB budget in `packages/widget/scripts/build.mjs`; effects ship in the lazy `sunny-logo.js`.
- No change to the embed snippet.
- Available on every plan: no entitlement checks.
- The server only ever accepts PNG. Studio rasterises an SVG to PNG in the browser before upload.
- No em dashes in any user-facing text (Studio copy, widget text, greetings).
- Default assistant name is `Sunny`. Platform attribution ("Prepared with Sunny", "via Sunny", SunnyBot, HeySunny account emails, portal setup hints) stays as is.
- Every new route has a case in `tests/security/tenant-isolation.test.ts`.

## Review Focus

1. **Logo on a solid tile** (like a favicon: lime mark on a dark rounded square, opaque). Effects must follow the mark, not the square. Pinned in Task 2 (`extractMask` background mode) and Task 3 (trace of the tile fixture follows the mark).
2. **Odd PNGs**: palette, 16-bit, interlaced, 4000 × 4000, a 3 MB file, a JPEG renamed `.png`. Each must either process or give a plain 400 message, never a 500. Pinned in Task 2 and Task 5.
3. **A returning visitor whose config fetch fails** sees the remembered logo, never Sunny. **A tenant switching back to Sunny** clears the remembered logo. Pinned in Task 8 (`brand-cache` tests and e2e).
4. **Only one effect enabled.** The cycle repeats it without hanging or throwing. Pinned in Task 7 (`pickNextEffect`).
5. **An assistant name carrying markup or line breaks** (`<b>`, `Volt\nSYSTEM:`, 41 characters) is rejected by the settings schema. Only the tenant's own admins can set it, and it only reaches that tenant's prompt. Pinned in Task 1 and Task 6.

---

## File Structure

| Path                                                                                                       | Responsibility                                                       |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `packages/contracts/src/brand.ts` (new)                                                                    | Effect names, public `brandSchema`, path/outline regexes             |
| `packages/contracts/src/widget.ts`                                                                         | `assistantName`, `brand` on `widgetConfigSchema`                     |
| `apps/api/src/branding/image.ts` (new)                                                                     | Decode, mask extraction, crop/downscale, colours, PNG encode         |
| `apps/api/src/branding/trace.ts` (new)                                                                     | Marching squares, simplification, rasterised verification            |
| `apps/api/src/branding/process.ts` (new)                                                                   | `processLogo`: the whole upload pipeline, pure                       |
| `apps/api/src/branding/store.ts` (new)                                                                     | `BrandAssetStore` (memory, file, GCS) and `brandAssetStoreFromEnv`   |
| `apps/api/src/routes/branding.ts` (new)                                                                    | Upload, portal asset read, public asset read, `publicBrand()`        |
| `apps/api/src/routes/portal.ts`, `server.ts`, `tenants.ts`, `agent/prompt.ts`                              | Settings, tenant view, config route, prompt name                     |
| `packages/logo-effects/` (new)                                                                             | Effect markup (pure), cycle scheduler (pure), `createLogoView` (DOM) |
| `packages/widget/src/brand-cache.ts` (new), `logo.ts` (new lazy entry), `widget.ts`                        | Remembered brand, launcher/header logo, busy wiring                  |
| `apps/marketing/components/dashboard/brand-section.tsx` (new), `logo-preview.tsx` (new), `studio-form.tsx` | Studio UI                                                            |
| `infrastructure/terraform/branding.tf` (new), `main.tf`                                                    | Bucket, IAM, env                                                     |

---

### Task 1: Brand contract

**Files:**

- Create: `packages/contracts/src/brand.ts`
- Modify: `packages/contracts/src/widget.ts` (`widgetConfigSchema`), `packages/contracts/src/index.ts` (export)
- Test: `packages/contracts/test/brand.test.ts`

**Interfaces:**

- Produces:
  - `LOGO_EFFECTS = ['comet','draw','charge','shimmer','rings','march','segments'] as const`, `type LogoEffect`
  - `OUTLINE_EFFECTS: readonly LogoEffect[] = ['comet','draw','rings','march']`, `STENCIL_EFFECTS = ['charge','shimmer','segments']`
  - `BRAND_ASSET_ID = /^[a-f0-9]{16}$/`
  - `brandAssetPathSchema`: string matching `^/v1/widget/brand/w_[a-z0-9]{10,40}/[a-f0-9]{16}(-mask)?\.png$`
  - `outlineSchema`: string, max 60 000 chars, matching `^[MLZ0-9 .-]*$`
  - `brandSchema = z.object({ icon: z.object({ path, maskPath: path.nullable(), width: int 1..512, height: int 1..512, outline: outlineSchema.nullable() }), wordmark: z.object({ path, width: int 1..1200, height: int 1..300 }).nullable(), effects: z.array(z.enum(LOGO_EFFECTS)).max(7), colors: z.object({ primary: hex, glow: hex }) })`, `type Brand`
  - `assistantNameSchema = z.string().regex(/^[\p{L}\p{N}][\p{L}\p{N} .'&-]{0,39}$/u)`
  - `widgetConfigSchema` gains `assistantName: assistantNameSchema.optional()` and `brand: brandSchema.optional()` (absent means Sunny).

- [ ] **Step 1: Write the failing tests**: `brandSchema` accepts a full valid brand; rejects a path with `..`, a path for `w_x` (too short), an outline containing `C` or `<`, 8 effects, an unknown effect; `assistantNameSchema` accepts `Volt`, `Ava-May`, `Upvolt Assistant`; rejects `''`, `<b>`, `Volt\nSYSTEM:` (newline), and a 41-character name; `widgetConfigSchema.parse` of an existing seed config without the new fields still succeeds.
- [ ] **Step 2: Run** `npx vitest run packages/contracts/test/brand.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `brand.ts` and the two optional fields.
- [ ] **Step 4: Run** the test and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(contracts): brand and assistant name in the widget config`

---

### Task 2: Image decode, mask and colours

**Files:**

- Create: `apps/api/src/branding/image.ts`
- Modify: `apps/api/package.json` (add `"pngjs": "7.0.0"`, dev `"@types/pngjs": "^6.0.5"`, same versions as `packages/sunscan-engine`)
- Test: `apps/api/test/branding-image.test.ts` (fixtures built in-test with `PNG.sync.write`)

**Interfaces:**

- Produces:
  - `interface Raster { width: number; height: number; data: Uint8Array /* RGBA */ }`
  - `class LogoImageError extends Error { code: 'not_png' | 'too_large' | 'empty' }`
  - `decodePng(bytes: Uint8Array): Raster`. Rejects a non-PNG signature (`not_png`), width or height > 4096 (`too_large`), fully transparent (`empty`).
  - `interface Mask { width: number; height: number; coverage: Float32Array /* 0..1 */ ; mode: 'alpha' | 'background' }`
  - `extractMask(r: Raster): Mask | null`
  - `cropAndFit(r: Raster, mask: Mask | null, maxW: number, maxH: number): { image: Raster; mask: Mask | null }`. Crops both to the mask's bounding box (or the alpha bounding box when there is no mask) plus 4 % padding, then area-averages down to fit. Never upscales.
  - `encodePng(r: Raster): Uint8Array`, `maskToPng(m: Mask): Uint8Array` (white, alpha = coverage × 255)
  - `suggestColors(r: Raster, m: Mask): { primary: string; glow: string }` (`#RRGGBB`)

`extractMask` algorithm (pin this):

1. Border ring = all pixels on the outermost row/column. If ≥ 50 % have alpha < 128, **alpha mode**: coverage = alpha / 255.
2. Otherwise take border pixels with alpha ≥ 200; bg = per-channel median. If ≥ 90 % of them are within RGB distance 24 of bg, **background mode**: coverage = clamp((d − 12) / (48 − 12), 0, 1) × alpha/255, where d = RGB distance to bg.
3. Otherwise return `null` (photo-like: shown still, no effects).
4. Return `null` also when coverage > 0.5 on fewer than 0.5 % of pixels.

`suggestColors`: histogram of pixels with coverage ≥ 0.9, quantised to 4 bits per channel, weighted by saturation + 0.1. primary = mean colour of the top bucket. glow = primary mixed 65 % towards white.

- [ ] **Step 1: Write the failing tests**:
  - transparent lime disc → `mode: 'alpha'`, centre coverage 1, corner 0;
  - opaque dark rounded square with a lime bar (the "tile" fixture) → `mode: 'background'`, bar coverage ≥ 0.99, tile coverage 0;
  - random-noise opaque image → `null`;
  - palette PNG, 16-bit PNG and interlaced PNG (pngjs options `colorType: 3`, `bitDepth: 16`, `interlace`) all decode to the same RGBA;
  - 4097 px wide → `too_large`;
  - JPEG magic bytes → `not_png`;
  - `cropAndFit` of a 2000 × 1000 image into 512 × 512 gives 512 × ≤ 256, mask the same size;
  - `suggestColors` on the tile fixture → primary within distance 20 of the lime.
- [ ] **Step 2: Run** `npx vitest run apps/api/test/branding-image.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `image.ts` with `PNG.sync.read`/`write`.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): decode logos and find their shape`

---

### Task 3: Trace and verify, and the processing pipeline

**Files:**

- Create: `apps/api/src/branding/trace.ts`, `apps/api/src/branding/process.ts`
- Test: `apps/api/test/branding-trace.test.ts`

**Interfaces:**

- Consumes: Task 2's `Raster`, `Mask`, `decodePng`, `extractMask`, `cropAndFit`, `encodePng`, `maskToPng`, `suggestColors`.
- Produces:
  - `traceMask(m: Mask): Array<Array<[number, number]>>` (closed polygons, pixel coordinates)
  - `outlinePath(polys): string` (`M x y L ... Z` per polygon, 1 decimal)
  - `verifyTrace(polys, m: Mask): { iou: number; farMismatch: number }`
  - `type LogoKind = 'icon' | 'wordmark'`
  - `interface ProcessedLogo { id: string; kind: LogoKind; width: number; height: number; png: Uint8Array; maskPng: Uint8Array | null; outline: string | null; availableEffects: LogoEffect[]; suggestedColors: { primary: string; glow: string } | null }`
  - `processLogo(bytes: Uint8Array, kind: LogoKind): ProcessedLogo`

Algorithm (pin this):

- `traceMask`: marching squares at iso 0.5 with linear interpolation on edges, saddle cases resolved by the cell's average. Drop polygons with |area| < 4 px². Douglas-Peucker with ε = 0.35 px.
- `verifyTrace`: rasterise the polygons with the even-odd rule at the mask's size, 4 × 4 supersampling. Binarise both (≥ 0.5). `iou` = |A∩B| / |A∪B|. `farMismatch` = count of XOR pixels whose distance to the nearest boundary pixel of the binarised mask is > 1.5 px.
- Pass when `iou ≥ 0.98 && farMismatch === 0 && outline.length ≤ 60000`.
- `processLogo('icon')`: fit 512 × 512. `processLogo('wordmark')`: fit 1200 × 300, no mask, no outline, no effects, no colours. `id` = first 16 hex chars of sha256 of the encoded `png`. `availableEffects` = stencil effects if a mask exists, plus outline effects if the trace passed, in `LOGO_EFFECTS` order.

- [ ] **Step 1: Write the failing tests**:
  - transparent disc: passes, all 7 effects, outline has one subpath;
  - ring (disc with hole): two subpaths, passes;
  - the Task 2 tile fixture: passes, and the outline's bounding box matches the bar, not the tile (±1 px);
  - 1-px salt-and-pepper speckle over a transparent disc: `outline === null`, effects exactly `['charge','shimmer','segments']`;
  - noise image: `maskPng === null`, `availableEffects` empty;
  - wordmark: `outline === null`, `availableEffects` empty;
  - processing the same bytes twice gives the same `id`.
- [ ] **Step 2: Run** `npx vitest run apps/api/test/branding-trace.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `trace.ts`, `process.ts`.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): trace logo outlines and prove they match`

---

### Task 4: Brand asset store

**Files:**

- Create: `apps/api/src/branding/store.ts`
- Test: `apps/api/test/branding-store.test.ts`

**Interfaces:**

- Produces:
  - `interface BrandAssetStore { put(tenantId: string, name: string, bytes: Uint8Array): Promise<void>; get(tenantId: string, name: string): Promise<Uint8Array | null> }`
  - `name` must match `^[a-f0-9]{16}(-mask\.png|\.png|\.json)$`, otherwise throw. That is the only key shape.
  - `MemoryBrandAssetStore`, `FileBrandAssetStore(dir)`, `GcsBrandAssetStore({ bucket, prefix?: 'brand', endpoint?, token, fetch? })`, mirroring `apps/api/src/sunscan/gcs-artefacts.ts` (object `brand/<encoded tenant>/<name>`, content type from extension)
  - `brandAssetStoreFromEnv(dataDir: string, env: NodeJS.ProcessEnv): BrandAssetStore`: `BRAND_ASSET_STORE=gcs` + `BRAND_ASSET_BUCKET`, `STORAGE_EMULATOR_HOST` honoured, token as in `artefactStoreFromEnv` (`apps/api/src/routes/sunscan.ts:92`); otherwise `FileBrandAssetStore(env.BRAND_ASSET_DIR ?? join(dataDir, 'brand-assets'))`.

- [ ] **Step 1: Write the failing tests**: memory and file round-trip; a name `../x.png` throws; tenant ids are percent-encoded in the GCS object name (fake fetch records the URL, as the existing SunScan GCS test does); GCS 404 → `null`; `BRAND_ASSET_STORE=gcs` without a bucket throws.
- [ ] **Step 2: Run** `npx vitest run apps/api/test/branding-store.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): private storage for brand assets`

---

### Task 5: Upload and asset routes

**Files:**

- Create: `apps/api/src/routes/branding.ts`
- Modify: `apps/api/src/server.ts` (`ServerDeps.brandAssets?: BrandAssetStore`, defaulting to `brandAssetStoreFromEnv` with the same `dataDir` the SunScan service uses; register routes), `tests/security/tenant-isolation.test.ts`
- Test: `apps/api/test/branding-routes.test.ts`

**Interfaces:**

- Consumes: `processLogo`, `BrandAssetStore`, portal `member(request, role)` auth used in `routes/portal.ts`.
- Produces:
  - `POST /v1/portal/tenants/:tenantId/brand/:kind` (`kind` = `icon` | `wordmark`), admin, `bodyLimit` 4 MB, body `{ png: string /* base64, decoded ≤ 3 MB */ }`. Stores `<id>.png`, `<id>-mask.png` (if any), `<id>.json` (`ProcessedLogo` minus bytes). Returns `{ asset: BrandAssetView }`.
  - `interface BrandAssetView { id; kind; width; height; outline: string | null; availableEffects: LogoEffect[]; suggestedColors: {primary; glow} | null; url: string; maskUrl: string | null }`. URLs are the portal read route below.
  - `GET /v1/portal/tenants/:tenantId/brand/assets/:file`, viewer: any stored asset of that tenant (Studio previews unsaved uploads).
  - `GET /v1/widget/brand/:publicId/:file`, public: only files whose id is the tenant's saved `branding.icon.id` or `branding.wordmark.id` and `branding.mode === 'logo'`, else 404. Headers: `content-type: image/png`, `cache-control: public, max-age=31536000, immutable`, `access-control-allow-origin: *`, `cross-origin-resource-policy: cross-origin`, `x-content-type-options: nosniff`.
  - `type BrandAssetMeta = Omit<ProcessedLogo, 'png' | 'maskPng'> & { hasMask: boolean }`. This is what `<id>.json` holds.
  - `loadBrandAsset(store, tenantId, id): Promise<BrandAssetMeta | null>` (reads `<id>.json`), used by Task 6.
  - Error copy (400, `ApiError('bad_request', …)`): `not_png` → "That file isn't a PNG. Upload a PNG or SVG.", `too_large` → "That image is too big. Use one under 4096 pixels on each side and 3 MB.", `empty` → "That image looks empty."

- [ ] **Step 1: Write the failing tests**: upload the transparent-disc fixture as admin → 200, 7 effects, URLs present; same as viewer → 403; JPEG bytes → 400 with the exact copy; 3.5 MB base64 payload → 400 or 413, never 500; the portal read returns the PNG bytes; the public read 404s before saving and serves with the exact headers after Task 6's settings save (write `branding` directly onto the tenant in this test); public read of another tenant's id via your own publicId → 404.
- [ ] **Step 2: Add security sweep entries** for the three routes: upload `kind: 'installer', minRole: 'admin'`; portal read `kind: 'installer', minRole: 'viewer'`; public read `kind: 'public'`.
- [ ] **Step 3: Run** `npx vitest run apps/api/test/branding-routes.test.ts tests/security`. Expected: FAIL.
- [ ] **Step 4: Implement** `routes/branding.ts` and wire it in `server.ts`.
- [ ] **Step 5: Run** both. Expected: PASS.
- [ ] **Step 6: Commit** `feat(api): logo upload and asset routes`

---

### Task 6: Settings, tenant view, public config, assistant name

**Files:**

- Modify: `apps/api/src/tenants.ts` (`Tenant.config.branding?: StoredBranding`), `apps/api/src/routes/portal.ts` (`settingsSchema`, settings handler, `tenantView`), `apps/api/src/server.ts` (config route), `apps/api/src/agent/prompt.ts:40`
- Test: `apps/api/test/branding-settings.test.ts`, extend the existing `buildSystemInstruction` test file (find with `grep -rln buildSystemInstruction apps/api/test`)

**Interfaces:**

- Consumes: `loadBrandAsset` (Task 5), `brandSchema`, `assistantNameSchema` (Task 1).
- Produces:
  - `interface StoredBranding { mode: 'sunny' | 'logo'; icon: BrandAssetMeta | null; wordmark: BrandAssetMeta | null; effects: LogoEffect[]; colors: { primary: string; glow: string } | null }`. Server-only, like `addons`: `configFor` drops it through `widgetConfigSchema`.
  - `settingsSchema` gains `assistantName: assistantNameSchema` and `branding: z.object({ mode, iconId: id.nullable(), wordmarkId: id.nullable(), effects: z.array(z.enum(LOGO_EFFECTS)).max(7), colors: {primary: hex, glow: hex}.nullable() })`.
  - The settings handler loads metadata for each id from the store (unknown id → 400 "That logo upload has expired. Upload it again."), sets `effects` to the requested effects ∩ the icon's `availableEffects`, and requires ≥ 1 effect when mode is `logo` and the icon has any available effects (else 400 "Choose at least one animation."). `mode: 'logo'` without `iconId` → 400 "Upload an icon first."
  - `publicBrand(tenant: Tenant): Brand | undefined` in `routes/branding.ts`: undefined unless mode is `logo` with an icon. Builds paths `/v1/widget/brand/<publicId>/<id>.png`. Colours fall back to `suggestedColors`, then `primaryColor` + white.
  - The config route returns `{ ...widgetConfig, assistantName: config.assistantName ?? 'Sunny', brand: publicBrand(tenant) }`, still `max-age=60`.
  - `tenantView` adds `assistantName` and `branding: StoredBranding & { icon: BrandAssetView | null; wordmark: BrandAssetView | null }`.
  - The prompt says `You are ${tenant.config.assistantName ?? 'Sunny'}, a customer assistant for ${company}.`

- [ ] **Step 1: Write the failing tests**:
  - save `mode: 'logo'` with an uploaded icon id and effects `['comet','shimmer']` → the config route returns `brand.effects` `['comet','shimmer']` and a valid `brandSchema`;
  - save effects `['comet']` for a speckle-fixture icon (no outline) → 400 "Choose at least one animation." (requested ∩ available is empty);
  - an unknown id → 400 with the exact copy;
  - `mode: 'sunny'` → config has no `brand`, and the public asset route now 404s;
  - `assistantName: 'Volt'` → the config's `assistantName` is `Volt` and `buildSystemInstruction` starts with `You are Volt, a customer assistant for`;
  - `assistantName: '<b>'` → 400;
  - an existing tenant without the fields → `assistantName: 'Sunny'`, no `brand`.
- [ ] **Step 2: Run** `npx vitest run apps/api/test/branding-settings.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it plus `npx vitest run apps/api/test/portal.test.ts apps/api/test/tenants.test.ts apps/api/test/config.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): save branding and the assistant's name`

---

### Task 7: `@sunny/logo-effects`

**Files:**

- Create: `packages/logo-effects/package.json` (shape of `packages/character/package.json`, depends on `@sunny/contracts`), `src/index.ts`, `src/markup.ts`, `src/cycle.ts`, `src/view.ts`
- Modify: `tsconfig.json` paths, `vitest.config.ts` alias
- Test: `packages/logo-effects/test/markup.test.ts`, `test/cycle.test.ts`

**Interfaces:**

- Consumes: `LogoEffect`, `OUTLINE_EFFECTS`, `Brand` (Task 1).
- Produces:
  - `interface LogoArt { src: string; maskSrc: string | null; width: number; height: number; outline: string | null; colors: { primary: string; glow: string } }`
  - `EFFECT_PERIOD_MS: Record<LogoEffect, number> = { comet: 1600, draw: 2600, charge: 4800, shimmer: 1500, rings: 1800, march: 900, segments: 1500 }`
  - `effectMarkup(effect: LogoEffect, art: LogoArt, uid: string, periodMs?: number): string`: the SVG inner markup for one effect, layered over `<image href=src>`, using `<mask mask-type="alpha"><image href=maskSrc/></mask>` for stencil effects and the outline with `pathLength="100"` for outline effects. Visual definitions are the approved mockup, effect for effect (keyframes in a `<style>` inside the SVG, ids suffixed with `uid`). Stroke widths scale as 2.5 % of `max(width, height)`. `segments` uses 5 vertical bands across the mask. Throws for an outline effect when `art.outline` is null.
  - `stillMarkup(art, uid): string`
  - `pickNextEffect(enabled: readonly LogoEffect[], last: LogoEffect | null, random: () => number): LogoEffect | null`: null for empty; never `last` when there are ≥ 2 enabled.
  - `interface LogoView { setBusy(busy: boolean): void; setMotion(m: 'full' | 'reduced' | 'off'): void; destroy(): void }`
  - `createLogoView(host: HTMLElement, art: LogoArt, effects: readonly LogoEffect[], options?: { label?: string; random?: () => number }): LogoView`.
    - On busy, pick an effect.
    - After 4000 ms busy, at the end of the current period, switch to `pickNextEffect`.
    - On `setBusy(false)`, finish the current period, then show still.
    - `reduced`: `shimmer` at 3000 ms if enabled, else still.
    - `off`: still.
    - The host gets `data-logo-effect="<effect|still>"` for tests.

- [ ] **Step 1: Write the failing tests**:
  - for every effect, `effectMarkup` contains the `uid` and no `undefined`/`NaN`;
  - outline effects contain the outline `d`;
  - stencil effects reference `maskSrc` and never the outline;
  - `effectMarkup('comet', {outline: null…})` throws;
  - an `src` with `"` is attribute-escaped;
  - `pickNextEffect([], …)` is null;
  - `pickNextEffect(['comet'], 'comet', …)` is `'comet'`;
  - over 1000 draws with 3 enabled, the result never equals `last` and covers all others.
- [ ] **Step 2: Run** `npx vitest run packages/logo-effects`. Expected: FAIL.
- [ ] **Step 3: Implement** `markup.ts`, `cycle.ts`, `view.ts` (DOM, verified in Task 8 and 9 e2e).
- [ ] **Step 4: Run** it and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(logo-effects): shape-true logo animations`

---

### Task 8: Widget

**Files:**

- Create: `packages/widget/src/brand-cache.ts`, `packages/widget/src/logo.ts` (lazy entry: re-exports `createLogoView`)
- Modify: `packages/widget/src/widget.ts`, `packages/widget/scripts/build.mjs` (second lazy build like `sunny-roof.js`), `scripts/widget-bundle.mjs` (`LAZY_PARTS` += `'sunny-logo.js'`), `packages/widget/src/styles.ts`
- Test: `packages/widget/test/brand-cache.test.ts`, `tests/e2e/widget-logo.spec.ts`

**Interfaces:**

- Consumes: `brandSchema`, `Brand` (Task 1); `createLogoView`, `LogoArt` (Task 7).
- Produces:
  - `readBrand(storage: Storage | null, publicId: string): { brand: Brand; assistantName: string } | null`
  - `writeBrand(storage, publicId, value | null): void` (key `sunny:brand:<publicId>`, `null` removes). All storage access is in try/catch.
  - `safeBrand(value: unknown): Brand | null`: `brandSchema.safeParse`, the widget's guard for the unvalidated config (like `safePaint`).
  - `toArt(brand: Brand, apiUrl: string): LogoArt`: paths resolved against `apiUrl`.

Behaviour in `widget.ts`:

- **Mount with a remembered brand:** draw the icon `<img>` on the launcher and header immediately. Never create the Sunny views.
- **Mount without one, `data-launcher` not `none`:** the launcher gets class `pending` (`visibility: hidden`) until the config resolves or 4000 ms pass.
- **After the config:** `safeBrand(config.brand)`.
  - If present: write the cache, use the icon on the launcher and in the header avatar, show the wordmark `<img alt="<companyName>">` in place of `.header .name` (or the company name when there's no wordmark), then `import(new URL('sunny-logo.js', fontDirectoryUrl))` and swap the `<img>` for `createLogoView`.
  - If absent: `writeBrand(..., null)` and carry on with Sunny as today.
  - If the fetch fails: keep whatever was remembered.
- **Each frame:** `view.setBusy(['thinking','speaking','guiding'].includes(animator.state))`, and `setMotion` from `prefersReducedMotion()` and `config.intensity === 'off'`. Skip `#launcherView`/`#avatarView` drawing while a logo is active.
- **Names:**
  - Header placeholder `'Sunny'` becomes `''`.
  - The fallback greeting becomes `Hi! Ask me about solar for your home.`
  - Panel `aria-label` and launcher label become `Open ${assistantName}` / `${assistantName}, solar assistant` once the config is known.
- **Budget:** the main bundle stays ≤ 62 kB. `brand-cache.ts` reuses the contracts' zod already in the bundle.

- [ ] **Step 1: Write the failing unit tests**:
  - `readBrand` with a throwing `Storage` → null;
  - write then read round-trips;
  - `writeBrand(null)` removes;
  - `safeBrand` rejects `{ icon: { path: 'javascript:…' } }`;
  - `toArt` joins `https://api.x` + path correctly with and without a trailing slash.
- [ ] **Step 2: Write the failing e2e** `tests/e2e/widget-logo.spec.ts`. Follow `tests/e2e/widget.spec.ts`, route-stubbing `/v1/widget/config/*` and `/v1/widget/brand/**` with the tile fixture PNGs:
  - (a) the launcher shows the logo `<img>` and never a Sunny SVG (poll from page load: no `.svg-host svg` ever appears);
  - (b) after a stubbed turn starts, the header host has `data-logo-effect` ≠ `still`, and returns to `still` after the turn finishes;
  - (c) the second visit with the config route aborted still shows the logo;
  - (d) a config without `brand` clears it, so the next visit shows Sunny;
  - (e) with `reducedMotion: 'reduce'`, the effect is `shimmer` or `still`.
- [ ] **Step 3: Run** `npx vitest run packages/widget` and `npx playwright test tests/e2e/widget-logo.spec.ts`. Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** both, plus `npm run build:widget` (budget line printed, no failure) and `npx playwright test tests/e2e/widget.spec.ts` (Sunny tenants unchanged). Expected: PASS.
- [ ] **Step 6: Commit** `feat(widget): show and animate the installer's own logo`

---

### Task 9: Sunny Studio

**Files:**

- Create: `apps/marketing/components/dashboard/brand-section.tsx`, `apps/marketing/components/dashboard/logo-preview.tsx`
- Modify: `apps/marketing/components/dashboard/studio-form.tsx`, `apps/marketing/lib/portal-api.ts` (`TenantView.assistantName`, `TenantView.branding`, `BrandAssetView`), `apps/marketing/next.config.mjs` (`transpilePackages` += `'@sunny/logo-effects'`), `apps/marketing/package.json` (dep `@sunny/logo-effects`)
- Test: extend `tests/e2e/dashboard.spec.ts`

**Interfaces:**

- Consumes: the upload and portal asset routes (Task 5), the settings `branding`/`assistantName` (Task 6), `createLogoView`/`effectMarkup` (Task 7).
- Produces:
  - `BrandSection({ tenant, value, onChange })`, where `value: BrandDraft = { mode; icon: BrandAssetView | null; wordmark: BrandAssetView | null; effects: LogoEffect[]; colors: {primary; glow} | null }`.
  - `LogoPreview({ draft, busy })`: launcher circle + header (icon + wordmark or company name) using `createLogoView`, and a "Play" button that holds `busy` true for 6 s.
  - `rasterizeToPng(file: File): Promise<string /* base64 */>`: PNG passes through. SVG is drawn into a canvas at its intrinsic size (max 1024 px on the long side) via an `<img>` from an object URL, then `toBlob('image/png')`.
  - `StudioForm` sends `assistantName` and `branding: { mode, iconId, wordmarkId, effects, colors }` with the existing fields. On a name change it replaces `I'm <oldName>` in the greeting with `I'm <newName>` (exact substring only).

Layout and copy (the approved mockup; no em dashes):

- Section heading "Your logo".
- Radio "Use Sunny" / "Use my logo".
- **Icon slot:** label "Icon", hint "For the chat button and the top of the chat. Square PNG or SVG, at least 256 × 256. A simple mark works best."
- **Wordmark slot:** label "Wordmark", hint "Shown beside your icon at the top of the chat. Optional. Wide PNG or SVG."
- Each slot shows the image with the outline overlaid in the primary colour, and Replace/Remove buttons.
- Status lines:
  - 7 effects: "Outline traced and checked. All animations are available."
  - Stencil only: "We couldn't trace the outline exactly, so only the fill animations are available."
  - None: "This image has no clear shape to animate, so it will be shown still. A PNG with a transparent or plain background works best."
- "Animations" checkboxes, each with a 64 px live `effectMarkup` tile, labelled Comet trace, Draw and undraw, Charge up, Shimmer, Echo rings, Marching outline, Segment chase. Unavailable ones are disabled with the reason.
- "Colours from your logo": two colour inputs (Highlight, Glow).
- "Assistant name" text input, default `Sunny`, `maxLength` 40.
- The live preview swaps `SunnyPreview` for `LogoPreview` when mode is `logo`.

- [ ] **Step 1: Write the failing e2e** in `tests/e2e/dashboard.spec.ts`:
  - as an admin, upload the tile fixture PNG and see "Outline traced and checked.";
  - untick all animations and Save → "Choose at least one animation.";
  - tick two, set the assistant name to `Volt`, Save → "Saved.", and `GET /v1/widget/config/<publicId>` returns `assistantName: 'Volt'` and 2 effects;
  - upload an SVG file → it becomes a PNG upload (request body `png` starts with the PNG base64 prefix `iVBORw0KGgo`);
  - switch to "Use Sunny" and Save → the config has no `brand`.
- [ ] **Step 2: Run** `npx playwright test tests/e2e/dashboard.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Check that `GET` through `app/api/portal` serves the PNG to an `<img>` (the proxy forwards the body and content type; confirm no CSRF header is required for GET).
- [ ] **Step 4: Run** the e2e and `npm run build:marketing`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(studio): upload a logo, pick animations, name the assistant`

---

### Task 10: Infrastructure

**Files:**

- Create: `infrastructure/terraform/branding.tf`
- Modify: `infrastructure/terraform/main.tf` (API env, next to the `SUNSCAN_ARTEFACT_*` envs at ~line 329)

**Interfaces:**

- Produces:
  - bucket `google_storage_bucket.brand_assets`, named `"${var.project_id}-brand-${local.name_suffix}"`. Private, uniform access, `public_access_prevention = "enforced"`, `force_destroy = false`, same labels, `depends_on` storage API (defined in `sunscan.tf`).
  - `google_storage_bucket_iam_member.api_writes_brand` (`roles/storage.objectAdmin` for the API service account).
  - envs `BRAND_ASSET_STORE=gcs` and `BRAND_ASSET_BUCKET`.

- [ ] **Step 1: Write** the resources.
- [ ] **Step 2: Run** `terraform fmt -check` and `terraform validate` (paths and `-reconfigure` per the local deploy tooling note). Expected: no diff, "Success!".
- [ ] **Step 3: Commit** `infra: private bucket for brand assets`. Do **not** apply. Applying to staging and prod is a separate step the owner approves.

---

### Final verification

- [ ] `npm run verify` passes.
- [ ] `npm run build:widget` passes the budget and lists `sunny-logo.js` as a lazy part.
- [ ] `npm run test:e2e` passes.
- [ ] Manual: `npm run dev:api` + `npm run dev:marketing`, upload a logo you made yourself (transparent PNG, and one on a solid tile), watch each effect in Studio, save, and open the marketing page's widget pointed at that tenant.
