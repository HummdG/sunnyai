# Sunny.ai brand guidelines

**Version:** 2.0 · 2026-10-12
**Applies to:** the website, the installer dashboard, the chat widget, emails
and generated documents (quotes, proposals).

Sources: the implementation plan §5.1, the owner's direction (2026-10-12) and
the reference artwork `sunny.png` / `reference_poses.png`. Tokens live in
`packages/ui` (`@sunny/ui/tokens.css`) — **use tokens, never hard-coded
values.** The character lives in `@sunny/character` and
`@sunny/animation-engine`.

> **The one-line brief:** Sunny.ai should feel like a 1930s cartoon star who
> happens to be brilliant at solar sales — warm, cheeky and alive on every
> screen, and never in the way of getting work done.

---

## Part A — Identity

### A1. Name

- The product and company is **Sunny.ai** — always with the lowercase `.ai`;
  never "SunnyAI", "Sunny AI" or "sunny.ai" in running text.
- **Sunny** is the character and the assistant's persona ("Hi, I'm Sunny").
  Use "Sunny" when the assistant speaks or acts ("Sunny answered 12
  questions"), "Sunny.ai" for the business, product, website and legal text.

### A2. Logo

- The logo is the reference artwork **`sunny.png`**, used as-is. Assets in
  `packages/ui/brand/` (`sunny-logo-{32,64,128,192,256,512}.png`,
  `favicon.ico`, `apple-touch-icon.png`).
- Lock-up: logo + wordmark "Sunny.ai" in the brand typeface, weight 800,
  −0.02em tracking; logo height ≈ 1.4× the wordmark cap height; gap = ⅓ of the
  logo width.
- Clear space: ¼ of the logo's width on every side. Minimum size 24px.
- Never redraw, recolour, stretch, outline, rotate, animate or crop the
  **logo** (the animated character is a different asset — see Part C).
- On orange or busy backgrounds, sit the logo on a warm-white pill.
- Installer widgets are **white-label**: they show the installer's name; the
  Sunny character appears, the Sunny.ai logo does not ("Powered by Sunny.ai"
  is allowed only in the widget's small footer, and only if the plan allows).

### A3. Colour

| Token                        | Value     | Role                                           |
| ---------------------------- | --------- | ---------------------------------------------- |
| `--sunny-brand-orange`       | `#FF7900` | The character, illustrations, key highlights   |
| `--sunny-brand-orange-deep`  | `#FF6500` | Hover/pressed on orange surfaces               |
| `--sunny-brand-orange-soft`  | `#FFB066` | Hills, bubbles, secondary illustration fills   |
| `--sunny-brand-orange-pale`  | `#FFF1E5` | Tints, selected rows, chips, hover washes      |
| `--sunny-warm-white`         | `#FFFCF8` | Page background                                |
| `--sunny-ink`                | `#171717` | Text, outlines, the character's ink            |
| `--sunny-muted`              | `#727272` | Secondary text — on white only (4.8:1)         |
| `--sunny-accent-ink` _(new)_ | `#B04E00` | Orange that carries text and button fills (AA) |
| Cream (character)            | `#FFF3E2` | Sunny's eye whites; warm card highlights       |

Status colours — used for status only, always with a text label and an icon:

| Status  | Fill (pale) | Text/icon | Use                                           |
| ------- | ----------- | --------- | --------------------------------------------- |
| Success | `#E8F6EC`   | `#1E6B3A` | Published, connected, verified                |
| Warning | `#FFF4DB`   | `#7A5200` | Needs attention, placeholders, drafts waiting |
| Error   | `#FDE8E8`   | `#A3201C` | Failed sync, payment failed                   |
| Safety  | `#FDE8E8`   | `#A3201C` | Safety escalations — always top, always bold  |
| Info    | `#EAF2FF`   | `#1D4E9E` | Neutral notices                               |

Rules:

- Proportion ≈ **70% white/warm white · 20% orange family · 10% ink/neutral.**
  Orange is the sunshine in the room, not the walls.
- **Contrast ≥ 4.5:1 for text, 3:1 for UI shapes.** `#FF7900` never carries
  text and never sits behind white text — use `--sunny-accent-ink`.
  `--sunny-muted` on pale orange fails; use `#5C5C5C` there.
- Tenant theme colours (purple, green, blue, custom) recolour the character
  and the widget accents only, through the same contrast guard
  (`legibleInk`); the Sunny.ai website and dashboard always stay orange.

### A4. Typography

- One family: **Plus Jakarta Sans** (self-hosted, `packages/ui/fonts`).
- Scale (`--type-0…5`, ratio 1.25): body 16px; small 14px (never below 12px).
- Headlines: weight 800, `--leading-tight`, −0.02em. Body: 400–500, leading
  1.6, ~65–70ch measure. Numbers in tables/figures: `font-variant-numeric:
tabular-nums`.
- Personality in type: big, confident display headlines on the website
  (clamp to 64–72px on desktop); a single playful word may get an orange
  hand-drawn underline (SVG squiggle) — max one per page.
- Sentence case everywhere. UK English spelling.

---

## Part B — Personality

### B1. Personality traits → design behaviour

| Trait                | Means                           | In the UI                                                                   |
| -------------------- | ------------------------------- | --------------------------------------------------------------------------- |
| **Warm**             | Friendly, on your side          | Warm-white canvas, rounded shapes, first-name greetings, Sunny waving hello |
| **Cheeky**           | A wink, a light touch of humour | Witty microcopy in low-stakes places, the wink pose, small easter eggs      |
| **Confident**        | Knows solar, gets things done   | Clear hierarchy, decisive primary actions, no hedging in UI labels          |
| **Bouncy**           | 1930s rubber-hose energy        | Overshoot and settle on motion, squash on press, elastic toggles            |
| **Honest**           | Never oversells                 | "Indicative" labels, sources shown, plain errors, no fake numbers           |
| **Calm in a crisis** | Serious when it matters         | Safety, billing and errors drop the jokes entirely                          |

### B2. The personality dial

Personality is turned up or down by surface and moment. Default levels:

| Surface / moment                            | Dial  | What that allows                                                        |
| ------------------------------------------- | ----- | ----------------------------------------------------------------------- |
| Website hero, gallery, 404                  | 10/10 | Full character performances, hills rolling, bubbles, jokes              |
| Website content pages                       | 7/10  | Character spot illustrations, playful headlines, hover bounces          |
| Onboarding wizard                           | 8/10  | Sunny guides each step, celebrates go-live with a cheer + sparkle       |
| Chat widget                                 | 7/10  | Sunny reacts to the conversation; copy friendly but concise             |
| Dashboard everyday (inbox, leads, products) | 4/10  | Personality in empty states, success toasts and micro-interactions only |
| Data tables, forms, settings                | 2/10  | Clean and fast; motion only as feedback                                 |
| Errors, billing problems, legal             | 1/10  | Plain, kind, specific. A gentle pose at most; no jokes                  |
| **Safety escalations**                      | 0/10  | No character, no humour, no animation — red, bold, direct               |

Rule of thumb: **delight at the edges, speed in the middle.** Jokes never
appear in anything a customer might read when worried or out of pocket.

### B3. Personality budget per screen

- **One** animated character per view (the widget counts as its own view).
- **One** celebratory moment per completed task (not per click).
- **One** hand-drawn flourish (squiggle underline, doodle arrow) per page.
- Idle character animation must be subtle enough to work beside a form.

---

## Part C — The character in the UI

### C1. Rendering

- Always the real character from `@sunny/character` (`createSunnyView`,
  `cartoonClock`) — drawn from the traced reference with the rubber-hose body
  from `reference_poses.png`. Never a screenshot, never a redrawn clip-art.
- Motion runs at the display rate, with the ink line boiling on its own
  clock (24 fps film frames only on low-power devices). Every change of pose
  blends from what is on screen; nothing cuts. Reduced motion gets a still
  pose of the same meaning, cross-faded.
- Sizes: 24–40px **badge** (head only, `limbs: false`); 64–120px **spot**
  (full body, used in empty states/toasts); 240px+ **hero** (website,
  onboarding, 404).
- **Limbs follow the pose sheet** (changed 2026-10-14, owner direction: the
  earlier ray-morph hands and feet were rejected). All eight rays are always
  drawn. Arms are short, even rubber hoses that come out of the body's sides
  just below the side rays; legs come out of the bottom either side of the
  lowest ray. At rest the limbs are tucked away, so the resting Sunny is
  exactly the logo; a gesture brings out only what it needs.
  Hands are chunky four-finger cartoon hands with a thick ink line and inked
  creases between the fingers: open, relaxed, fist, grip, finger-gun, raised
  index, thumbs-up, peace. Shoes are big, flat-soled beans. They are built from
  shapes in `hands.ts`, not traced, so every hand has the same line weight and
  swaps cleanly. A change of hand shape passes through a one-frame smear.
  In code: `morph` on each `ArmRig`/`LegRig` (0 = tucked), `LIMB_SOCKETS`,
  `limbPose('rest' | 'stand' | 'hips' | 'read' | 'recline' | …)`,
  `scripts/render-pose-sheet.ts` to review them all against the sheet.

### C2. Pose and moment map (use these — meaning must be consistent)

| UI moment                      | Pose (`LIMB_POSES`) / sequence           | Notes                                                  |
| ------------------------------ | ---------------------------------------- | ------------------------------------------------------ |
| Welcome, sign-in, first visit  | `wave` / `listening-perk`                | Waves once, then rests on hips                         |
| Idle, at rest                  | `hips` / `idle-breathe`                  | Default stance                                         |
| Loading, thinking, syncing     | `chin` / `thinking-whirr`                | Rays tick like clockwork; never a spinner beside Sunny |
| Found it / idea / tip          | `idea` / `thinking-eureka` (lightbulb)   | Tips, "did you know" callouts                          |
| Success, saved, published      | `thumbsUp` / `cool-shades` for big wins  | Small wins: thumbs-up; go-live: shades + cheer         |
| Task complete, milestone       | `cheer` / `celebrate-bounce`             | Onboarding done, first lead, catalogue published       |
| Nothing here yet (empty state) | `shrug` (light) or `point` at the action | Point toward the primary button                        |
| Pointing the way / guidance    | `point` + wink / `guiding-point`         | Website guidance, "start here"                         |
| Not sure / no answer           | `shrug` / `confused-tilt`                | "I don't have that exact information"                  |
| Something went wrong           | `droop` / `error-deflate`                | Then a clear fix-it action                             |
| Break, offline, nothing to do  | deckchair / `relax-sunbathe`             | Maintenance pages, "you're all caught up"              |
| Play, easter eggs, 404         | `jump`, balloon, `play-dance`, arcade    | Website and 404 only                                   |
| Solar education                | `charging-panel`, `bloom-grow`           | Explaining generation, batteries                       |
| Safety escalation              | **none**                                 | Character is never shown next to a safety alert        |

### C3. Character do's and don'ts

- Do let Sunny react to what the user just did (cause → reaction, within
  ~150ms).
- Do keep Sunny out of the way of content: beside or above, never over text.
- Don't make Sunny wait for the user (no tapping foot, no nagging loops).
- Don't put words in Sunny's mouth in system UI ("Sunny says: Error 500" ✗).
- Don't distort the face, change the eyes, or recolour outside the brand
  orange or a tenant's theme.

---

## Part D — Motion system

### D1. Motion tokens (add to `packages/ui`)

| Token              | Value                                             | Use                                      |
| ------------------ | ------------------------------------------------- | ---------------------------------------- |
| `--motion-instant` | 80ms                                              | Press feedback, colour changes           |
| `--motion-quick`   | 160ms                                             | Hovers, chips, toggles                   |
| `--motion-base`    | 240ms                                             | Panels, dropdowns, toasts                |
| `--motion-slow`    | 420ms                                             | Page sections, modals, bubble open       |
| `--motion-hero`    | 650ms                                             | The widget opening, hero entrances (max) |
| `--ease-out`       | `cubic-bezier(.22,1,.36,1)`                       | Things arriving                          |
| `--ease-in`        | `cubic-bezier(.55,0,1,.45)`                       | Things leaving (shorter than arrivals)   |
| `--ease-bounce`    | `cubic-bezier(.34,1.56,.64,1)`                    | Overshoot-and-settle — the brand ease    |
| `--ease-squash`    | keyframes: scale(1) → (1.06,.92) → (.97,1.04) → 1 | Press/landing squash                     |

### D2. Cartoon motion rules

1. **Anticipate:** big moves dip slightly before they go (the widget launcher
   squashes before the panel swells).
2. **Overshoot and settle:** arrivals use `--ease-bounce`; never linear.
3. **Squash and stretch:** pressing compresses (≈6%), releasing springs back.
4. **Follow-through:** secondary elements arrive 40–80ms after their parent
   (stagger list items 30ms each, max 8 items).
5. **On twos for the character, smooth for the UI:** the character steps at
   24 fps with boiling ink; UI elements animate smoothly at 60 fps.
6. **Leave faster than you arrive** (exit ≈ 60% of entry duration).
7. **Reduced motion:** replace movement with an instant change or a 120ms
   fade; the character holds a still pose of the same meaning. Never remove
   information that motion was conveying.

### D3. Micro-interaction catalogue

| Element               | Interaction                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------------- |
| Primary button        | Hover: lift 1px + shadow; press: `--ease-squash` 120ms; success: label swaps to a ✓ with a pop        |
| Secondary button      | Hover: orange-pale wash; press: squash 3%                                                             |
| Cards (clickable)     | Hover: lift 2px, shadow raised → floating, 160ms `--ease-out`                                         |
| Toggle / switch       | Knob slides with `--ease-bounce`; on: a tiny sun-ray burst (6 rays) behind the knob, 300ms            |
| Checkbox              | Tick draws itself (stroke-dashoffset 160ms), box squashes once                                        |
| Chips / filters       | Selected: fills with orange-pale, label nudges 1px; count badges pop when they change                 |
| Tabs                  | Underline slides between tabs with `--ease-bounce`                                                    |
| Inputs                | Focus: orange focus ring grows from 0 → 3px; error: one gentle 2-cycle shake (none if reduced motion) |
| Drag-and-drop upload  | Drop zone "breathes" while dragging over; on drop Sunny catches the file (spot illustration)          |
| Progress / sync       | A sun rising along the bar; completed: sun reaches the top with a sparkle                             |
| Toasts                | Slide up + bounce; success toasts carry a 40px thumbs-up Sunny; auto-dismiss 4s, pause on hover       |
| Modals                | Scale 0.96 → 1 + fade, `--motion-slow`; backdrop warm ink at 40%                                      |
| Copy to clipboard     | Button text → "Copied!" with a sparkle, 1.5s                                                          |
| Page transitions      | Content fades/slides 8px up, 240ms; no full-page wipes                                                |
| Number changes (KPIs) | Count up over 600ms with `--ease-out`, tabular numerals                                               |
| Celebration           | Sparkles from `@sunny/character` props + `celebrate-bounce`; max one per task; never confetti rain    |

---

## Part E — Layout, shape and illustration

### E1. Grid and breakpoints

- Breakpoints: 390 (mobile), 768 (tablet), 1024 (laptop), 1440 (desktop).
- Website container 1200px max, 24px gutters (16px mobile); reading
  columns ≤ 720px.
- Dashboard: 248px sidebar (collapses to a top bar + menu < 1024px), content
  max 1280px, 32px page padding (16px mobile). 8px spacing grid
  (`--space-*`).
- Everything works at 320px width and 200% zoom.

### E2. Shape and elevation

- Radii: inputs `--radius-md` (14px), cards `--radius-lg` (22px), buttons and
  chips `--radius-pill`. Nothing sharp-cornered except data-table cells.
- Elevation: `--shadow-raised` for cards, `--shadow-floating` for popovers,
  toasts, the widget. Borders: 1px at 8% ink, only where needed.
- Bubbles: decorative circles in orange-soft/pale (8–64px) may float at the
  edges of hero sections and onboarding — never behind text.

### E3. Illustration system

- **Hills:** layered wavy hills in orange, orange-soft and orange-pale, rolling
  slowly on the website; static in the dashboard (only on onboarding and the
  sign-in page).
- **Ink style:** heavy rounded black ink (2–3px at UI scale), flat fills, no
  gradients on illustrations, no drop shadows on drawings.
- **Spot illustrations:** the character plus a single prop (book, laptop,
  magnifier, panel, battery, lightbulb) — matching `reference_poses.png`.
- No stock photography of people; real product screenshots only (the actual
  widget and dashboard). No Fanta trademarks, bottle shapes or trade dress.

### E4. Iconography

- Rounded line icons, 2px stroke, 20/24px grid, ink colour; rounded caps and
  joins to echo the rubber-hose line. Filled orange only for the active nav
  item. One icon set across all surfaces.
- Icons never stand alone for important actions — always with a label or
  `aria-label` + tooltip.

### E5. Data visualisation

- Series colours: orange (primary), ink (comparison), orange-soft, then a
  neutral grey; status colours only for status. Gridlines 6% ink.
- Solar-specific: generation charts may use a sun-arc motif; months labelled
  Jan–Dec; units always shown (kWh, kWp, £).
- Every chart has a text summary for screen readers and a clear denominator
  and date range (plan §6.4).

---

## Part F — Components

| Component         | Spec                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| Primary button    | `--sunny-accent-ink` fill, white text, pill, 44px min height, 600 weight. One per view                |
| Secondary button  | White, 1px 12% ink border, ink text; hover orange-pale                                                |
| Tertiary / link   | Accent-ink text, underline on hover; the hand-drawn squiggle is for marketing headings only           |
| Destructive       | Error-red text button; confirmation dialog names the thing being deleted                              |
| Inputs            | 48px tall, `--radius-md`, label above, helper below, error text + icon (not colour only)              |
| Select / combobox | Same as inputs; menus with `--shadow-floating`, 8px radius items, keyboard navigable                  |
| Cards             | White, `--radius-lg`, `--shadow-raised`, 24px padding (16px mobile)                                   |
| Status chips      | Pale fill + dark text + small icon, pill, 13px semibold                                               |
| Tables            | Muted 12px uppercase headers, 52px rows, hover orange-pale, sticky header, mobile → stacked cards     |
| Sidebar nav       | Icon + label, active item orange-pale pill with accent-ink text and filled icon                       |
| Tabs              | Text tabs with sliding orange underline (`--ease-bounce`)                                             |
| Toasts            | Bottom-right (bottom on mobile), white card, status icon or Sunny spot, action link, aria-live polite |
| Modals / drawers  | Title, one-sentence purpose, primary + secondary; drawers for editing a single record                 |
| Tooltips          | Ink background, white text, 8px radius, appear after 300ms                                            |
| Empty states      | Spot Sunny (pose per C2) + headline + one sentence + one primary action                               |
| Banners           | Full-width card with status colour; safety banners always first on the page                           |
| Code / snippets   | Ink background, warm-white monospace text, copy button with "Copied!" sparkle                         |

---

## Part G — States (with personality)

| State            | Visual                                            | Copy example                                                                        |
| ---------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| First run        | Hero Sunny waving, hills                          | "Hi! I'm Sunny. Let's get your assistant answering customers in about ten minutes." |
| Empty — inbox    | Spot Sunny relaxing in the deckchair              | "No conversations yet. Once Sunny's on your website, every chat lands here."        |
| Empty — leads    | Spot Sunny pointing at the button                 | "No leads yet. Add Sunny to your site and they'll start arriving."                  |
| Empty — products | Spot Sunny with a shrug                           | "No products yet. Upload a price list or start from the example."                   |
| Loading          | Sunny `chin` thinking, or skeleton rows in tables | "Fetching your conversations…" (tables use skeletons, not the character)            |
| Syncing          | Sun-rising progress bar                           | "Reading your website — 42 of 120 pages."                                           |
| Success (small)  | Toast + thumbs-up                                 | "Saved."                                                                            |
| Success (big)    | Cheer + sparkle, once                             | "You're live! Sunny is now answering on brightside.co.uk."                          |
| Warning          | Warning chip/banner                               | "2 placeholders in your knowledge base. Customers can't be told what isn't there."  |
| Error            | Droop pose (spot) + fix action                    | "We couldn't reach your website. Check the address, then try again."                |
| Offline          | Deckchair Sunny                                   | "You're offline. We'll pick up where you left off when you're back."                |
| Safety           | Red banner, no character                          | "Safety escalation: a customer reported smoke. Call them back now."                 |
| 404              | Sunny with the impossible cube, confused          | "This page has wandered off. Let's get you home."                                   |

---

## Part H — Voice and microcopy

### H1. Voice

- **Warm, plain, confident, a little cheeky.** Short sentences. Talk to one
  person ("you"). Contractions welcome. UK English.
- Lead with the benefit, then the detail. Verbs on buttons.
- Humour lives in empty states, success moments and the website — never in
  errors, billing, legal or safety.
- Honest by default: figures labelled "indicative — subject to a survey"
  unless verified; never "guaranteed", "best", "#1", or unverifiable stats.

### H2. Microcopy patterns

| Situation      | ✓ Write                                  | ✗ Avoid                                     |
| -------------- | ---------------------------------------- | ------------------------------------------- |
| Primary action | "Add Sunny to my website"                | "Submit", "OK"                              |
| Sign up        | "Get started — it's free to try"         | "Register account"                          |
| Saving         | "Saving…" → "Saved"                      | "Your changes have been successfully saved" |
| Destructive    | "Delete this product"                    | "Are you sure?" alone                       |
| Error          | What happened + what to do               | "Something went wrong" alone, codes         |
| Empty          | What will appear here + how to get it    | "No data"                                   |
| Estimates      | "About £6,500 (indicative)"              | "£6,471.32"                                 |
| Waiting        | "Measuring your roof — about 20 seconds" | "Please wait"                               |

### H3. Formatting

- Money: £6,500 (no pence unless < £100); ranges "£6,000–£7,500".
- Energy: 4.3 kWp, 3,850 kWh a year; dates "12 Oct 2026"; times 24-hour.
- Numbers ≥ 1,000 use commas; percentages without decimals unless < 10%.

---

## Part I — Surface guidance

- **Website:** one Sunny, used cleverly rather than often (owner direction,
  2026-10-14). **At most one Sunny in view, ever.** The guide
  (`components/sun/sunny-guide.tsx`) rises over a little hill in the hero,
  hops down to the corner as the visitor scrolls, and acts out each section
  it passes (`data-sunny-act`: magnifier, laptop, book, finger-gun, cheer,
  deckchair at the footer). It _is_ the chat launcher (the widget is loaded
  with `data-launcher="none"`) and steps aside while the panel is open or
  while another Sunny (the Meet Sunny gallery) is on screen. Everything else
  reacts to it instead of drawing more of it: cards cast shadows away from
  it, the page warms round it and towards dusk at the footer, section
  dividers are rows of rays leaning towards it, the header's progress dial
  is a little sun whose rays fill as you read, and the main call to action
  gets the sheet's action lines. No cameos with joke bubbles on content.
  Sections alternate warm-white and white; one dark (ink) section max per
  page for contrast.
- **Dashboard:** the workshop. Fast, calm, information-dense; personality in
  greetings ("Morning, Brightside Solar"), empty states, toasts, the onboarding
  wizard and the Studio preview. Safety and money are always serious.
- **Widget:** the shop window on an installer's site. White-label colours,
  Sunny reacts to the conversation (listening perk, thinking, eureka, speaking
  bounce), the bubble opening in ≤ 650ms, quote and roof cards in the same
  card style as the dashboard.
- **Emails and quotes:** logo top-left, warm-white background, orange
  accents, ink text, one small Sunny spot (thumbs-up) at most; disclaimers in
  full; plain-text alternative always included.

---

## Part J — Accessibility (non-negotiable)

WCAG 2.2 AA: contrast, keyboard access, visible focus (3px orange ring, 2–4px
offset), labelled controls, live regions for chat and toasts, reduced motion
honoured everywhere, 44px touch targets, works at 320px and 200% zoom, never
colour alone. Axe: zero serious violations. Personality is never a barrier —
every animated or illustrated meaning has a text equivalent.

---

## Part K — Review checklist (use on every screen)

1. Is the name right (Sunny.ai vs Sunny) and the logo lock-up correct?
2. Is orange ~20% of the screen, and does every text colour pass 4.5:1?
3. Are only tokens used for colour, type, space, radius, shadow and motion?
4. Is the personality dial right for this surface (Part B2), and within budget
   (one character, one celebration, one flourish)?
5. Does each character pose mean what Part C2 says it means?
6. Do motions anticipate, overshoot and settle — and degrade under reduced
   motion?
7. Are empty, loading, error and success states designed (Part G)?
8. Is the copy warm, plain, honest, UK English, with verbs on buttons?
9. Keyboard, focus, labels, 44px targets, 390px layout, axe clean?
