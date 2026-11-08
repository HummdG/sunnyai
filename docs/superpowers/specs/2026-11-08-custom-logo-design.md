# Custom logo for the chat widget

Status: draft for owner review, 2026-11-08

## Why

Many companies don't want Sunny's character as the face of the chat on
their website. They want their own brand. Sunny Studio should let an owner
upload their own logo, and the widget should bring that logo to life with
SVG-style motion while it loads, thinks and writes, the way Sunny's
character does today.

Success: an owner uploads a PNG of their logo, sees it animating in the
Studio preview within seconds, saves, and from then on visitors see that
company's logo, exactly as designed, on the chat button and in the chat
window, alive whenever Sunny is busy.

## Goals

- Owners can replace Sunny with their own **icon** (chat button and in
  the chat) and **wordmark** (chat header), chosen in Sunny Studio.
- The icon animates while the assistant is busy, using effects built from
  the icon's own shape, so every company's animation looks like theirs.
- Owners choose which effects are used.
- Owners can give the assistant **its own name** (owner's decision), so a
  company that drops Sunny's face can drop "I'm Sunny" too.
- Available on **every plan** (owner's decision). No billing or add-on
  gating.
- Sunny stays the default. Nothing changes for tenants who don't opt in.

## Non-goals

- Animating the wordmark. It stays still.
- Moving parts of a logo independently (bouncing letters, waving, limbs,
  squash and stretch). The owner rejected this.
- Morphing the logo into a different shape (a loop, an infinity sign).
  Tried in a mockup and rejected: it loses the original's shape.
- Customising the quote conversation flow. That is a separate project,
  agreed to come next.

## Anti-goals (would be a failure even if it works)

- **Any visible difference from the uploaded logo.** The owner was clear:
  it must match exactly. A hand-drawn or loosely traced approximation of
  the logo ever being shown to a visitor counts as failure.
- The logo looking cheap, jittery, or cartoonish. Motion is sleek: light,
  current, fill, outline.
- Breaking the widget's 62 kB bundle budget or slowing the host page.

## Where the logo appears

- **Chat button (launcher):** the icon, in place of Sunny.
- **Chat header:** the icon, then the wordmark beside it, in place of
  Sunny's head and the "Sunny" name. Without a wordmark: icon plus the
  company name as text. The header icon is the one that animates while the
  chat is open (today Sunny only appears in the header inside the chat;
  replies show plain typing dots, which stay as they are).
- The wordmark never animates.

## How the logo behaves

**At rest:** the uploaded image itself, pixel for pixel. No idle motion.

**When busy** the icon plays one effect from the owner's chosen set. Busy
means the assistant is working: `thinking`, `speaking`, `guiding` and
lookups. Every other machine state (`idle`, `listening`, `celebrating`,
`confused`, `relaxing`, `playing`, `error`) shows the still logo, so a
typing visitor or an error never looks like "working on it". (My call.)

| Effect | What it does | Kind |
|---|---|---|
| Comet trace | Logo solid; a bright spark runs round its outline | outline |
| Draw and undraw | Outline writes itself in one line, fills, erases, loops | outline |
| Charge up | Logo dim, fills from the bottom with a gentle wave | stencil |
| Shimmer | A band of light sweeps across, only inside the logo | stencil |
| Echo rings | Logo still; copies of its outline ripple out and fade | outline |
| Marching outline | Fill fades back; dashes chase round the outline | outline |
| Segment chase | Regions of the logo light up in turn | stencil |

(Spark burst was shown and rejected.)

Effect selection (owner said "cycle randomly"; details are builder's call
unless noted):

- A new effect is picked at random each time the assistant becomes busy,
  never the same one twice in a row (when more than one is enabled).
- On a long wait (around 4 s), hand over smoothly to another effect.
- When the reply is done, the current pass finishes and the logo settles.
  Never cut off mid-motion.

Colours: the highlight and fill colours are picked automatically from the
logo on upload and are editable in Studio.

Accessibility: with `prefers-reduced-motion`, the icon stays still or uses
only a slow shimmer (Sunny already honours this setting). The existing
`intensity` setting: `off` keeps the logo still; any other level runs the
cycle. (My call.)

## Exact match: how it's guaranteed

The owner's top requirement. Two kinds of effect, two guarantees:

- **Stencil effects** (charge up, shimmer, segment chase) use the uploaded
  image's own alpha/shape as a mask. Motion appears only on the logo's real
  pixels, so the shape is exact by construction. Always available for any
  logo with a usable transparent background.
- **Outline effects** (comet, draw and undraw, echo rings, marching
  outline) need a vector outline. On upload the server traces the PNG at
  high precision, then verifies the trace by rasterising it and comparing
  with the original. If the match is below a tight threshold, outline
  effects are disabled for that logo and only stencil effects are offered.
  The outline is drawn on top of the real image, never in place of it.

Builder decides the tracing library, the comparison metric and the
threshold, but the threshold must be strict enough that no visible
mismatch gets through. Err on the side of disabling outline effects.

Logos that can't be animated well at all (photos, no transparency, busy
gradients): the owner can still use the logo; it is shown still, and
Studio explains why. Builder may try background removal for a flat
background colour, but only if the result still matches exactly.

## Sunny Studio

A new "Your logo" section at the top of Studio (mockup was shown and
approved in principle):

- Choice: **Use Sunny** (default) or **Use my logo**.
- **Icon slot:** square PNG (SVG also accepted), with guidance on minimum
  size. Used on the chat button and in the chat header.
- **Wordmark slot:** wide PNG/SVG, shown in the chat header beside the
  icon. Optional; without one, the header shows the icon and company name.
- After upload: the trace overlaid on the logo so the owner can see the
  match, and a plain note of which effects are available.
- **Effect picker:** each available effect shown as a small live preview
  with a toggle. The random cycle uses only the ones switched on. At least
  one must stay on while "Use my logo" is active. Default: all available
  effects on.
- **Colours from the logo**, editable.
- The **live preview** (today `sunny-preview.tsx`, which renders only the
  character, not the real widget) shows the launcher and the chat header
  with their icon and wordmark, plus a "play" control that simulates a busy
  turn so they can watch the effects. It does not run a real chat turn: no
  LLM cost, quota, analytics or leads. (My call.) The effect runtime
  therefore has to be usable from both the widget and Studio.
- Edit rights: admins and owners only, same as the rest of Studio.
- The onboarding wizard reuses the Studio form, so it gets this section
  too.

## Constraints and what exists today

- No logo field, no image upload, and no public file serving exist yet.
  Branding today is `primaryColor` plus text fields
  (`packages/contracts/src/widget.ts` `widgetConfigSchema`).
- Studio: `apps/marketing/components/dashboard/studio-form.tsx`, preview
  in `sunny-preview.tsx`, save via `POST /v1/portal/tenants/:id/settings`
  (`apps/api/src/routes/portal.ts`). Tenant config lives in Firestore.
- Widget: `packages/widget/src/widget.ts`, Shadow DOM, SVG character
  driven by the state machine in `packages/animation-engine`. Config comes
  from `GET /v1/widget/config/:publicId` and is not schema-validated in the
  widget, so new fields need guards like `safePaint()`.
- **Bundle budget**: 62 kB, currently about 60.7 kB. Tracing and colour
  extraction must happen on the server at upload time. The widget only
  receives ready-made data (image URL, outline path, colours, enabled
  effects). The effect runtime itself may need to be a lazy-loaded chunk,
  as the roof viewer already is.
- Storage: GCS is used privately today (`apps/api/src/sunscan/gcs-artefacts.ts`,
  terraform in `infrastructure/terraform/sunscan.tf`). Logos must be
  readable by anonymous visitors on customer sites; builder chooses
  between a public bucket/CDN or serving through the API, in staging and
  prod terraform.
- **No flash of Sunny.** Today the launcher draws Sunny before
  `GET /v1/widget/config` returns, and falls back to Sunny if it fails.
  For a logo tenant, showing Sunny even briefly breaks the exact-match
  anti-goal. My call: the widget remembers the tenant's branding on the
  visitor's device and uses it immediately on return visits; on a first
  visit, the launcher waits for the config before showing (with a short
  timeout). If the config fails for a tenant whose branding is
  remembered, use the remembered logo, never Sunny. Builder decides the
  exact mechanism, but must not require customers to change their embed
  snippet.
- Uploaded SVGs are untrusted. They must be sanitised or rasterised; never
  injected raw into the widget's DOM.
- New routes must be added to the cross-tenant security sweep in
  `tests/security`.
- House style: no em dashes in any user-facing text.

## Assistant name

An **assistant name** field in Studio, defaulting to "Sunny". It is
independent of the logo choice (a tenant may keep Sunny's face with a new
name, or their logo with the name Sunny), but sits in the same section.

Where it replaces "Sunny" (everywhere the assistant refers to itself or is
named to a visitor):

- the system prompt (`apps/api/src/agent/prompt.ts`, "You are Sunny, ...");
- greetings, including the onboarding default in
  `apps/api/src/routes/portal.ts` and the widget fallback in
  `packages/widget/src/widget.ts`;
- the widget header text and accessible labels (`aria-label`s).

Where it does **not** (my call): platform attribution such as "Prepared
with Sunny" on the quote PDF and the "via Sunny" email sender. These credit
the product rather than name the assistant. Builder should list every
other "Sunny" string visitors can see and apply the same rule.

Validation: short, plain text (builder sets the limit), sanitised like the
other text fields, never interpolated into the prompt unescaped.

## Left to the builder

Tracing approach and library, match metric and threshold, storage and
serving, upload limits and accepted formats, data shape in the config,
how effects are implemented (CSS, SMIL, or JS), effect timings and easing,
lazy loading, how the effect runtime hooks into the existing animation
state machine, and tests (including visual baselines).

## Calls made by the writer, for the owner to check

- Which states count as busy (thinking, speaking, guiding, lookups only).
- Studio preview simulates a busy turn; it does not run a real chat.
- No flash of Sunny: remembered branding on return visits, launcher waits
  for config on first visit; no embed snippet change.
- `intensity: off` keeps the logo still; reduced motion gets still or slow
  shimmer.
- Effects default to all available ones switched on.
- PDF and email platform attribution keeps saying Sunny.
