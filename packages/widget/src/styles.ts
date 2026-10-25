/**
 * The widget's stylesheet, as a string.
 *
 * Inlined into a `<style>` inside the shadow root rather than shipped as a
 * separate file: the widget is embedded on other people's sites, and a
 * stylesheet fetched from somewhere else is a render-blocking dependency on
 * whatever host serves it. It also means the widget's *appearance* arrives with
 * the bundle, which is the promise the embed snippet makes.
 *
 * One thing is deliberately not inlined, and the exception is worth stating
 * because it is the only network request the widget makes that is not the API:
 * the typeface (D-48). A `woff2` cannot be a `<style>`'s worth of text without
 * costing every visitor a third of the launcher's own transfer, so it stays a
 * file, fetched from beside the script and resolved against the *script's*
 * directory rather than the page's base. It is also the one request whose
 * failure is designed for: if it 404s, is blocked, or arrives late, the panel
 * renders in the system stack.
 *
 * The face itself is not declared here, and that is the one thing in this file
 * that is not a style rule. Chromium does not use an `@font-face` declared in a
 * shadow tree — measured, and the failure is silent — so the family is
 * registered with the document through the Font Loading API instead. See
 * `fonts.ts` for the measurement and for why the stack still names the family
 * whether or not a face was registered.
 *
 * Every selector is scoped by the shadow boundary, so nothing here can reach the
 * host page and nothing on the host page can reach in. The one thing that does
 * cross is a CSS custom property, which is deliberate: it is the supported way
 * for a host to theme the widget.
 */
import { FONT_STACK } from '@sunny/ui';

/**
 * The ink for a price the installer's own records back.
 *
 * Named rather than inlined because it is a claim about contrast, and a claim
 * that lives only inside a template string cannot be checked: the unit tests
 * read this constant and measure it against white. About 6:1, comfortably past
 * the 4.5:1 AA wants for body text.
 */
export const VERIFIED_PRICE_INK = '#0f6b3f';

export function styles(): string {
  return `
:host {
  --sunny-orange: #FF7900;
  --sunny-orange-deep: #FF6500;
  --sunny-orange-soft: #FFB066;
  --sunny-pale: #FFF1E5;
  --sunny-warm-white: #FFFCF8;
  --sunny-ink: #171717;
  --sunny-muted: #727272;
  --sunny-radius: 18px;
  --sunny-shadow: 0 12px 32px rgba(23, 23, 23, 0.18);

  /* The host may override the accent, and only the accent. */
  --sunny-accent: var(--sunny-primary-color, var(--sunny-orange));

  /* The legible tone of the accent, for anywhere the accent carries text: the
     visitor's own bubbles, the send button, the suggestion chips. Computed in the
     shadow root at mount, because the accent is the tenant's choice and the
     readable version of it cannot be known until then. The fallback here is the
     raw accent, so a stylesheet that somehow ran without the script still renders
     -- just with the contrast the tenant's colour actually has, which is the
     honest failure rather than an invisible one. */
  --sunny-accent-ink: var(--sunny-accent);

  /* ── the device cutout ───────────────────────────────────────────────────
     A phone with a home indicator, a notch or rounded corners eats a strip of
     the viewport, and a control placed under it is a control the visitor cannot
     hit. \`env()\` is the platform's answer for that strip, and it is 0 on
     everything without one -- which is why the gutters below *add* it rather
     than replacing the fixed gutter with it, and why every fallback is \`0px\`
     and not a guess. The widget cannot ask for the insets on its own: they are
     nonzero only on a page whose own \`<meta name="viewport">\` says
     \`viewport-fit=cover\`, and that markup is the host's, not ours. Reading them
     faithfully and adding nothing when they are absent is the whole of what the
     widget can honestly do.

     They are declared as custom properties, and that is not only tidiness. The
     host element is the one part of the widget in the page's own tree, custom
     properties are the one thing \`all: initial\` does not reset, and so a page
     that knows its own chrome better than the browser reports it -- an in-app
     webview, a native shell with its own toolbar -- can set one on the host and
     be believed. It is also how the behaviour is checkable: a browser test can
     set \`--sunny-safe-bottom\` on the host and measure the resulting gap, which
     pins the arithmetic without a notched device in CI (D-41). */
  --sunny-safe-top: env(safe-area-inset-top, 0px);
  --sunny-safe-right: env(safe-area-inset-right, 0px);
  --sunny-safe-bottom: env(safe-area-inset-bottom, 0px);
  --sunny-safe-left: env(safe-area-inset-left, 0px);

  /* The gutter between the launcher and the viewport edge, before the cutout.
     A custom property so the small-screen breakpoint changes one number rather
     than four \`inset\` shorthands -- and so every corner, not just the default
     one, gets that change. */
  --sunny-gutter-x: 20px;
  --sunny-gutter-y: 20px;

  /* Every declaration below carries \`!important\`, and that is not belt-and-
     braces: it is the only thing that makes the widget's isolation claim true
     for the host element.

     The host is the one part of the widget that lives in the *page's* tree, so
     it is the one part a page's selectors can match. And for the host element
     the cascade puts the outer tree first: a page's normal declarations beat
     this shadow root's normal ones, and a page's \`!important\` beats them
     outright. The first version of this block had no \`!important\` at all, which
     was fine on our own demo page and broken on an ordinary WordPress one --
     a page builder's \`body > div { position: relative !important ... }\`
     reached the host, took it out of the viewport corner and painted a grey
     card behind the launcher. Measured, not guessed: see the WordPress host
     fixture in \`apps/widget-demo/public/wordpress.html\` and the test that
     pins this (D-36).

     \`all: initial !important\` is the deliberate "the page may not style this
     element" rule -- it is what the non-important \`all: initial\` was always
     meant to be. Custom properties survive it, so a tenant's
     \`--sunny-primary-color\` still themes the widget: that is the supported
     channel, and the only one. The geometry declarations follow it because
     \`initial\` for \`position\` is \`static\`, and one longhand later in the same
     rule overrides the shorthand's value for that property. */
  all: initial !important;
  font-family: ${FONT_STACK} !important;
  color: var(--sunny-ink) !important;
  line-height: 1.45 !important;
  display: block !important;
  position: fixed !important;
  z-index: 2147483000 !important;
  /* One anchored edge = one gutter + that edge's cutout. Written out per corner
     rather than folded into one value, because which edge is anchored is what
     the four positions differ by. Every \`inset\` in this file has both terms;
     a fifth corner added without them is the defect the widget's style test
     looks for. */
  inset:
    auto calc(var(--sunny-gutter-x) + var(--sunny-safe-right))
    calc(var(--sunny-gutter-y) + var(--sunny-safe-bottom))
    auto !important;
}

:host([data-position="bottom-left"]) {
  inset:
    auto auto calc(var(--sunny-gutter-y) + var(--sunny-safe-bottom))
    calc(var(--sunny-gutter-x) + var(--sunny-safe-left)) !important;
}
:host([data-position="top-right"]) {
  inset:
    calc(var(--sunny-gutter-y) + var(--sunny-safe-top))
    calc(var(--sunny-gutter-x) + var(--sunny-safe-right)) auto auto !important;
}
:host([data-position="top-left"]) {
  inset:
    calc(var(--sunny-gutter-y) + var(--sunny-safe-top)) auto auto
    calc(var(--sunny-gutter-x) + var(--sunny-safe-left)) !important;
}

* { box-sizing: border-box; }

.sunny-root { display: flex; flex-direction: column; align-items: flex-end; gap: 14px; }
:host([data-position="bottom-left"]) .sunny-root,
:host([data-position="top-left"]) .sunny-root { align-items: flex-start; }

/* ── the launcher ───────────────────────────────────────────────────────── */

.launcher {
  width: 72px; height: 72px; border: 0; padding: 0; cursor: pointer;
  border-radius: 50%; background: transparent;
  transition: transform 180ms cubic-bezier(.2,.9,.3,1.2);
  /* Blocked until we know whether to animate; without this the character
     flashes at its base pose before the first frame lands. */
  visibility: hidden;
}
.launcher.ready { visibility: visible; }
.launcher[hidden] { display: none; }
.launcher:hover { transform: scale(1.06); }
.launcher:focus-visible { outline: 3px solid var(--sunny-accent); outline-offset: 4px; }
.launcher svg { width: 100%; height: 100%; display: block; }

/* The rig is redrawn with innerHTML on every frame whose markup differs, so the
   node under the pointer is destroyed mid-press -- and a click whose two halves
   land on different, removed nodes is never dispatched at all, which made the
   launcher inert. The art is decoration on a button that is the real control,
   so it does not need to be a hit target; the button is, and no frame replaces
   it. Measured, and D-53. */
.launcher .svg-host { pointer-events: none; }

.launcher .badge {
  position: absolute; top: 2px; right: 2px; width: 12px; height: 12px;
  border-radius: 50%; background: var(--sunny-accent);
  border: 2px solid var(--sunny-warm-white);
}

/* ── the panel ──────────────────────────────────────────────────────────── */

.panel {
  width: min(440px, calc(100vw - 40px - var(--sunny-safe-left) - var(--sunny-safe-right)));
  /* Taller than the conversation-only panel was. The options are a second
     surface inside the same frame, so the panel has to hold a transcript and a
     card list at once -- and a card that cannot be read without scrolling is a
     card the visitor does not read.

     The cutout is subtracted here as well as added to the gutters: a panel sized
     only against the viewport would put its last card under the home indicator
     on the one kind of screen that has one. */
  height: min(760px, calc(100vh - 140px - var(--sunny-safe-top) - var(--sunny-safe-bottom)));
  background: var(--sunny-warm-white);
  border-radius: var(--sunny-radius);
  box-shadow: var(--sunny-shadow);
  display: flex; flex-direction: column; overflow: hidden;
  border: 1px solid rgba(23, 23, 23, 0.08);
  transform-origin: bottom right;
  /* Roof mode (below) grows the panel; the change answers the visitor's own
     address, so it eases rather than jumps. */
  transition: width 340ms cubic-bezier(.2, .8, .2, 1), height 340ms cubic-bezier(.2, .8, .2, 1);
}
/* Roof mode: the 3D roof docks at the top of the conversation and the panel
   grows to give it room, so the visitor answers the survey looking at their
   own roof. Collapsed, the roof is a strip and the panel is its usual size. */
.panel.roof-open:not(.roof-collapsed) {
  width: min(720px, calc(100vw - 40px - var(--sunny-safe-left) - var(--sunny-safe-right)));
  height: min(880px, calc(100vh - 140px - var(--sunny-safe-top) - var(--sunny-safe-bottom)));
}
:host([data-position="bottom-left"]) .panel { transform-origin: bottom left; }
:host([data-position="top-right"]) .panel { transform-origin: top right; }
:host([data-position="top-left"]) .panel { transform-origin: top left; }

/* The opening (plan §6.2), about 560 ms end to end, staged by widget.ts:
     0 ms    Sunny reacts on the launcher (.launcher.pop) and bubbles fizz up
             out of it (.fizz.rising);
   120 ms    a bubble swells from the launcher corner into the panel
             (.panel.opening -- a circular clip growing from the corner);
   380 ms    Sunny settles into the header (.panel.settled).
   Reduced motion collapses all of it to an immediate open (below). */
.panel.opening {
  animation: sunny-bubble 440ms cubic-bezier(.22,1,.36,1) 120ms both;
}
.panel.closing { animation: sunny-close 160ms ease-in both; }
/* Opacity is deliberately not animated: text that is even briefly translucent
   fails a contrast audit taken mid-opening, and the growing clip already reads
   as a bubble swelling. */
@keyframes sunny-bubble {
  0%   { clip-path: circle(28px at var(--sunny-origin-x) var(--sunny-origin-y));
         transform: scale(.94); }
  100% { clip-path: circle(150% at var(--sunny-origin-x) var(--sunny-origin-y));
         transform: scale(1); }
}
@keyframes sunny-close {
  from { opacity: 1; transform: scale(1); }
  to { opacity: 0; transform: scale(.9) translateY(8px); }
}
.panel { --sunny-origin-x: calc(100% - 36px); --sunny-origin-y: calc(100% + 40px); }
:host([data-position="bottom-left"]) .panel { --sunny-origin-x: 36px; }
:host([data-position="top-right"]) .panel { --sunny-origin-y: -40px; }
:host([data-position="top-left"]) .panel { --sunny-origin-x: 36px; --sunny-origin-y: -40px; }

/* Sunny in the header: hidden while the bubble swells, then drops in with a
   small overshoot, as if the character rode the bubble up and landed there. */
.panel.opening .header .avatar { opacity: 0; transform: translateY(14px) scale(.4); }
.panel.opening.settled .header .avatar {
  opacity: 1; transform: none;
  transition: opacity 120ms ease-out, transform 260ms cubic-bezier(.34,1.56,.64,1);
}

/* The launcher's reaction to the click: squash, then spring. */
.launcher.pop { animation: sunny-pop 300ms cubic-bezier(.34,1.56,.64,1); }
@keyframes sunny-pop {
  0% { transform: scale(1); }
  30% { transform: scale(1.12, .86); }
  65% { transform: scale(.94, 1.08); }
  100% { transform: scale(1); }
}

/* Fizzy bubbles rising out of the launcher. */
.fizz {
  position: absolute; width: 72px; height: 0; pointer-events: none;
  bottom: 36px; right: 0; z-index: 1;
}
:host([data-position="bottom-left"]) .fizz,
:host([data-position="top-left"]) .fizz { right: auto; left: 0; }
.fizz i {
  position: absolute; bottom: 0; left: var(--x);
  width: var(--s); height: var(--s); border-radius: 50%;
  background: var(--sunny-accent); opacity: 0;
  border: 1.5px solid rgba(255,255,255,.75);
}
.fizz.rising i {
  animation: sunny-fizz 480ms cubic-bezier(.3,.7,.4,1) var(--d) both;
}
@keyframes sunny-fizz {
  0% { opacity: 0; transform: translate(0, 0) scale(.4); }
  20% { opacity: .95; }
  100% { opacity: 0; transform: translate(var(--dx), var(--dy)) scale(1); }
}

.panel[hidden] { display: none; }

.header {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px; background: var(--sunny-pale);
  border-bottom: 1px solid rgba(23,23,23,.07); flex: 0 0 auto;
}
.header .avatar { display: block; width: 40px; height: 40px; flex: 0 0 40px; }
/* Without this the SVG renders at its own 200 px size and spills over the
   header text and the first message. */
.header .avatar svg { display: block; width: 100%; height: 100%; }
.header .titles { flex: 1 1 auto; min-width: 0; }
.header .name { font-weight: 650; font-size: 14px; }
/* Darker than --sunny-muted: the muted grey is 4.34:1 on the pale header,
   under the 4.5:1 AA minimum for 12 px text. */
.header .tagline { font-size: 12px; color: #5c5c5c;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.header button {
  border: 0; background: transparent; cursor: pointer; color: var(--sunny-muted);
  width: 30px; height: 30px; border-radius: 8px; font-size: 17px; line-height: 1;
}
.header button:hover { background: rgba(23,23,23,.06); color: var(--sunny-ink); }
.header button:focus-visible { outline: 2px solid var(--sunny-accent); }

/* ── the transcript ─────────────────────────────────────────────────────── */

.log {
  flex: 1 1 auto; overflow-y: auto; overscroll-behavior: contain;
  /* Never squeezed to a sliver by the options below it: a transcript has to stay
     readable for the visitor to follow what they were told and why. */
  min-height: 108px;
  padding: 16px 14px; display: flex; flex-direction: column; gap: 10px;
  scrollbar-width: thin;
}
.log:focus-visible { outline: 2px solid var(--sunny-accent); outline-offset: -4px; }

.turn { max-width: 86%; padding: 9px 12px; border-radius: 14px; font-size: 14px;
  white-space: pre-wrap; overflow-wrap: anywhere; }
.turn.user { align-self: flex-end; background: var(--sunny-accent-ink); color: #fff;
  border-bottom-right-radius: 5px; }
.turn.assistant { align-self: flex-start; background: #fff;
  border: 1px solid rgba(23,23,23,.08); border-bottom-left-radius: 5px; }
.turn.system { align-self: center; font-size: 12.5px; color: var(--sunny-muted);
  background: transparent; text-align: center; max-width: 100%; }
.turn.error { align-self: stretch; max-width: 100%; font-size: 13px;
  color: #8a1c1c; background: #fff2f0; border: 1px solid #ffd9d2; }

.typing { display: inline-flex; gap: 3px; align-items: center; height: 1em; }
.typing i { width: 5px; height: 5px; border-radius: 50%; background: var(--sunny-muted);
  animation: sunny-typing 1.1s infinite ease-in-out; display: block; }
.typing i:nth-child(2) { animation-delay: .16s; }
.typing i:nth-child(3) { animation-delay: .32s; }
@keyframes sunny-typing { 0%,60%,100% { opacity:.3; transform: translateY(0); }
  30% { opacity:1; transform: translateY(-3px); } }

/* ── suggestions and composer ───────────────────────────────────────────── */

.sources { font-size: 11.5px; color: #5c5c5c; margin: -4px 0 8px 4px; }
/* SunScan roof card, and the 3D view it docks at the top of the panel (roof.ts). */
.roof { margin: 4px 0 10px; padding: 10px 12px; border-radius: 14px; background: var(--sunny-pale);
  border: 1px solid var(--sunny-orange-soft); font-size: 13px; }
.roof p { margin: 0 0 6px; }
.roof .roof-label { font-size: 11.5px; color: #5c5c5c; }
.roof button { font: inherit; font-size: 12.5px; cursor: pointer; border-radius: 999px; padding: 6px 12px;
  border: 0; background: var(--sunny-accent-ink); color: #fff; }
.panel { position: relative; }
/* Quote journey: three option cards and the quote's own disclaimer. */
.quote { margin: 4px 0 10px; }
.quote-options { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.quote-option { position: relative; padding: 10px 12px; border-radius: 14px; background: #fff;
  border: 1px solid rgba(23,23,23,.1); font-size: 13px; display: flex; flex-direction: column; gap: 2px; }
.quote-option.recommended { border: 2px solid var(--sunny-accent-ink); background: var(--sunny-pale); }
.quote-badge { align-self: flex-start; font-size: 11px; font-weight: 650; color: #fff;
  background: var(--sunny-accent-ink); border-radius: 999px; padding: 2px 8px; margin-bottom: 2px; }
.quote-name { font-size: 14px; }
.quote-price { font-size: 18px; font-weight: 700; }
.quote-price-label { font-size: 11px; color: #5c5c5c; }
.quote-headline { margin: 4px 0 2px; color: #3a3a3a; }
.quote-facts { margin: 0; padding-left: 16px; color: #3a3a3a; }
.quote-note { margin: 4px 0 0; font-size: 11.5px; color: #8a3b00; }
.quote-disclaimer { font-size: 11px; color: #5c5c5c; margin: 6px 4px 0; }
.quote-choose { align-self: flex-start; margin-top: 6px; font: inherit; font-size: 12.5px; font-weight: 650;
  cursor: pointer; border-radius: 999px; padding: 6px 12px; min-height: 32px;
  border: 1px solid var(--sunny-accent-ink); background: #fff; color: var(--sunny-accent-ink); }
.quote-choose:hover { background: var(--sunny-pale); }
.quote-choose:focus-visible { outline: 3px solid var(--sunny-accent); outline-offset: 2px; }
.quote-option.chosen { border: 2px solid var(--sunny-accent-ink); box-shadow: 0 0 0 3px var(--sunny-pale); }
.quote-option.chosen .quote-choose { background: var(--sunny-accent-ink); color: #fff; }
.quote-actions { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 4px 0; }
.quote-actions button { font: inherit; font-size: 12.5px; cursor: pointer; border-radius: 999px;
  padding: 7px 12px; min-height: 32px; border: 1px solid var(--sunny-accent-ink);
  background: #fff; color: var(--sunny-accent-ink); }
.quote-actions > button:first-child { background: var(--sunny-accent-ink); color: #fff; }
.quote-email { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; width: 100%; }
.quote-email[hidden] { display: none; }
.quote-email input[type="email"] { flex: 1 1 160px; font: inherit; font-size: 13px; padding: 6px 10px;
  border-radius: 10px; border: 1px solid rgba(23,23,23,.2); }
.quote-email label { font-size: 12px; color: #3a3a3a; }
.quote-status { font-size: 11.5px; color: #3a3a3a; margin: 4px 4px 0; min-height: 1em; }
.roof-dock { flex: 0 0 auto; border-bottom: 1px solid rgba(23,23,23,.08); background: var(--sunny-warm-white); }
.roof-dock[hidden] { display: none; }
.roof-view { display: flex; flex-direction: column; font-size: 12.5px; }
.roof-bar { display: flex; align-items: center; gap: 8px; padding: 6px 8px 6px 14px; background: var(--sunny-pale); }
.roof-bar strong { flex: 1 1 auto; font-size: 13px; font-weight: 650; }
.roof-bar button { border: 0; background: transparent; cursor: pointer; color: #3a3a3a; font: inherit;
  border-radius: 999px; padding: 4px 10px; }
.roof-bar button:hover { background: rgba(23,23,23,.06); }
.roof-bar button:focus-visible { outline: 2px solid var(--sunny-accent); }
.roof-close { font-size: 20px !important; line-height: 1; padding: 2px 8px !important; color: #5c5c5c !important; }
.roof-stage { position: relative; height: clamp(200px, 38vh, 380px); }
.roof-stage canvas { display: block; width: 100%; height: 100%; }
.roof-status { padding: 14px; }
/* sun and roof faces share one row under the model, so the conversation keeps the room */
.roof-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; padding: 6px 14px 0; }
.roof-time { display: flex; gap: 8px; align-items: center; flex: 1 1 200px; min-width: 0; }
.roof-time input { flex: 1; min-width: 80px; accent-color: var(--sunny-accent-ink); }
.roof-planes { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px; }
.roof-planes button { font: inherit; font-size: 11.5px; border: 1px solid var(--sunny-orange-soft);
  background: #fff; border-radius: 999px; padding: 3px 8px; cursor: pointer; }
.roof-note { margin: 4px 14px 8px; font-size: 11px; color: #5c5c5c; }
.roof-view.collapsed .roof-stage, .roof-view.collapsed .roof-controls, .roof-view.collapsed .roof-note { display: none; }
/* while the roof is docked above, the card's own way to open it is not needed */
.panel.roof-open .roof > button { display: none; }
/* Quick replies: the answers to the question Sunny just asked, as buttons. */
.suggestions.replies button[aria-pressed="true"] { background: var(--sunny-accent-ink); color: #fff; }
.suggestions.replies .send-replies { background: var(--sunny-accent-ink); color: #fff; border-color: transparent; }
.suggestions.replies .send-replies:disabled { opacity: .45; cursor: default; }
.sources a { color: var(--sunny-accent-ink); }
.composer .count { align-self: center; font-size: 11px; color: #5c5c5c; min-width: 0; }
.suggestions { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 14px 10px; }
.suggestions button {
  font: inherit; font-size: 12.5px; cursor: pointer;
  border: 1px solid var(--sunny-orange-soft); background: var(--sunny-pale);
  color: var(--sunny-accent-ink); border-radius: 999px; padding: 5px 11px;
}
.suggestions button:hover { background: var(--sunny-accent-ink); color: #fff; }
.suggestions button:focus-visible { outline: 2px solid var(--sunny-accent); }

.composer { display: flex; gap: 8px; padding: 10px 12px 12px;
  border-top: 1px solid rgba(23,23,23,.07); background: var(--sunny-warm-white); }
.composer textarea {
  flex: 1 1 auto; resize: none; font: inherit; font-size: 14px;
  border: 1px solid rgba(23,23,23,.16); border-radius: 12px;
  padding: 9px 11px; max-height: 108px; background: #fff; color: inherit;
}
.composer textarea:focus { outline: 2px solid var(--sunny-accent); outline-offset: -1px;
  border-color: transparent; }
.composer button {
  flex: 0 0 auto; width: 40px; height: 40px; border-radius: 12px; border: 0;
  background: var(--sunny-accent-ink); color: #fff; cursor: pointer; font-size: 16px;
  align-self: flex-end;
}
.composer button:disabled { opacity: .45; cursor: not-allowed; }
.composer button:focus-visible { outline: 2px solid var(--sunny-ink); outline-offset: 2px; }

/* ── the options panel ──────────────────────────────────────────────────── */
/* The options are a place to go and read, not a transcript, so they get their
   own scrolling region under the conversation: a long list of cards shrinks
   the log rather than pushing the composer off the bottom of the panel. */

.options-host {
  flex: 0 1 auto; max-height: 60%; overflow-y: auto; overscroll-behavior: contain;
  scrollbar-width: thin; border-top: 1px solid rgba(23,23,23,.07);
  background: var(--sunny-warm-white);
}
.options-host[hidden] { display: none; }

.options { padding: 12px 14px 14px; }
.options-title {
  margin: 0 0 10px; font-size: 11.5px; font-weight: 700; letter-spacing: .07em;
  text-transform: uppercase; color: var(--sunny-muted);
}

.options-list { list-style: none; margin: 0; padding: 0;
  display: flex; flex-direction: column; gap: 10px; }

.option-card {
  background: #fff; border: 1px solid rgba(23,23,23,.08); border-radius: 14px;
  box-shadow: 0 2px 10px rgba(23,23,23,.06); padding: 11px 12px;
  display: flex; flex-direction: column; gap: 6px;
}
.option-rank {
  align-self: flex-start; font-size: 10.5px; font-weight: 700;
  letter-spacing: .07em; text-transform: uppercase; color: var(--sunny-muted);
}
/* The first card is the one the engine ranked highest. It is marked in the
   accent rather than in the raw brand colour: the accent carrying text is what
   the derived ink exists for, and the raw orange is 2.95:1 on white, which axe
   catches the moment a card is on screen. */
.option-card:first-child .option-rank { color: var(--sunny-accent-ink); }
.option-title { margin: 0; font-size: 14px; font-weight: 650; }

.option-total { display: flex; flex-direction: column; gap: 1px; }
.option-total .total-amount { font-size: 19px; font-weight: 700; letter-spacing: -.01em; }
.option-total .total-label { font-size: 11.5px; color: var(--sunny-muted); }
.option-total.status-unknown .total-amount { font-size: 14px; color: var(--sunny-ink); }

/* A verified figure is the one thing on the card worth shouting about, and the
   only case where the number is a quote rather than a note the installer typed.
   The colour carries that, so it has to clear contrast on white: this green is
   about 6:1, and the label underneath says the same thing in words for anyone
   who cannot see it. */
.status-verified .total-amount,
.status-verified .price-amount { color: ${VERIFIED_PRICE_INK}; }

.option-summary { margin: 0; font-size: 13px; color: #4a4a4a; }

.option-items { list-style: none; margin: 0; padding: 0; }
.option-item {
  display: grid; grid-template-columns: 1fr auto; gap: 2px 10px;
  padding: 7px 0; border-top: 1px solid rgba(23,23,23,.06);
}
.option-item .item-label { display: block; font-size: 13px; font-weight: 600; }
.option-item .item-detail { display: block; font-size: 11.5px; color: var(--sunny-muted); }
.option-item .item-price { display: flex; flex-direction: column; gap: 1px;
  text-align: right; align-self: start; }
.option-item .price-amount { font-size: 13px; font-weight: 650; }
.option-item .price-status { font-size: 10.5px; color: var(--sunny-muted); }
.option-item .item-source { grid-column: 1 / -1; font-size: 10.5px;
  color: var(--sunny-muted); overflow-wrap: anywhere; }

.option-reasons summary, .option-limits summary {
  cursor: pointer; font-size: 12px; font-weight: 600; color: var(--sunny-ink);
}
.option-reasons summary:hover, .option-limits summary:hover { color: var(--sunny-accent-ink); }
.option-reasons summary:focus-visible, .option-limits summary:focus-visible {
  outline: 2px solid var(--sunny-accent); border-radius: 4px;
}
.option-reasons ul, .option-limits ul {
  margin: 6px 0 0; padding-left: 16px; font-size: 12.5px; color: #4a4a4a;
  display: flex; flex-direction: column; gap: 4px;
}

.option-next { margin: 0; font-size: 12.5px; background: var(--sunny-pale);
  border-radius: 10px; padding: 8px 10px; }

.options-note { margin: 0; font-size: 13px; color: #4a4a4a; }
.options-exclusions { margin-top: 12px; }
.options-exclusions-title {
  margin: 0 0 6px; font-size: 11.5px; font-weight: 700; letter-spacing: .07em;
  text-transform: uppercase; color: var(--sunny-muted);
}
.options-exclusions ul { margin: 0; padding-left: 16px; font-size: 12.5px;
  color: var(--sunny-muted); display: flex; flex-direction: column; gap: 4px; }

.footnote { font-size: 11px; color: var(--sunny-muted); text-align: center;
  padding: 0 12px 10px; background: var(--sunny-warm-white); }
.footnote a { color: inherit; }

.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}

/* Page actions get a transient outline on the host element the assistant
   pointed at. Applied by the widget adding an attribute, styled by the host's
   own stylesheet if it wants to; this is the fallback. */
@media (prefers-reduced-motion: reduce) {
  .launcher, .panel, .panel.opening, .panel.closing, .launcher.pop,
  .panel.opening .header .avatar { animation: none !important;
    transition: none !important; }
  .panel.opening .header .avatar { opacity: 1; transform: none; }
  .fizz { display: none; }
  .typing i { animation: none; opacity: .6; }
}

@media (max-width: 420px) {
  /* Only the gutter narrows here. The \`inset\` declarations above keep their
     cutout terms untouched, because a small screen is exactly where a cutout
     is -- so this breakpoint must not restate the shorthands without them. */
  :host {
    --sunny-gutter-x: 12px;
    --sunny-gutter-y: 12px;
  }
  .panel, .panel.roof-open:not(.roof-collapsed) {
    width: calc(100vw - 24px - var(--sunny-safe-left) - var(--sunny-safe-right));
    height: min(70vh, 520px);
  }
  /* a phone has no room to grow into: the roof takes a third and the chat keeps the rest */
  .panel.roof-open:not(.roof-collapsed) { height: min(86vh, 760px); }
  .roof-stage { height: 30vh; }
  .launcher { width: 60px; height: 60px; }
}
`;
}

/** Styles for the highlight the widget applies to a host-page element. */
export function pageActionStyleAttribute(): string {
  return 'data-sunny-highlight';
}
