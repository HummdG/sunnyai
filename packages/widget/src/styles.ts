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
.launcher:hover { transform: scale(1.06); }
.launcher:focus-visible { outline: 3px solid var(--sunny-accent); outline-offset: 4px; }
.launcher svg { width: 100%; height: 100%; display: block; }

.launcher .badge {
  position: absolute; top: 2px; right: 2px; width: 12px; height: 12px;
  border-radius: 50%; background: var(--sunny-accent);
  border: 2px solid var(--sunny-warm-white);
}

/* ── the panel ──────────────────────────────────────────────────────────── */

.panel {
  width: min(384px, calc(100vw - 40px - var(--sunny-safe-left) - var(--sunny-safe-right)));
  /* Taller than the conversation-only panel was. The options are a second
     surface inside the same frame, so the panel has to hold a transcript and a
     card list at once -- and a card that cannot be read without scrolling is a
     card the visitor does not read.

     The cutout is subtracted here as well as added to the gutters: a panel sized
     only against the viewport would put its last card under the home indicator
     on the one kind of screen that has one. */
  height: min(640px, calc(100vh - 140px - var(--sunny-safe-top) - var(--sunny-safe-bottom)));
  background: var(--sunny-warm-white);
  border-radius: var(--sunny-radius);
  box-shadow: var(--sunny-shadow);
  display: flex; flex-direction: column; overflow: hidden;
  border: 1px solid rgba(23, 23, 23, 0.08);
  transform-origin: bottom right;
}
:host([data-position="bottom-left"]) .panel { transform-origin: bottom left; }
:host([data-position="top-right"]) .panel { transform-origin: top right; }
:host([data-position="top-left"]) .panel { transform-origin: top left; }

/* The opening animation is a scale from the launcher with a brief overshoot.
   The character's own compression plays inside it; the two are deliberately
   short (240 ms here, 420 ms in the rig) so the pair lands under 650 ms. */
.panel.opening { animation: sunny-open 240ms cubic-bezier(.2,.9,.3,1.15) both; }
.panel.closing { animation: sunny-open 160ms ease-in reverse both; }
@keyframes sunny-open {
  from { opacity: 0; transform: scale(.72) translateY(10px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}

.panel[hidden] { display: none; }

.header {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px; background: var(--sunny-pale);
  border-bottom: 1px solid rgba(23,23,23,.07); flex: 0 0 auto;
}
.header .avatar { width: 38px; height: 38px; flex: 0 0 38px; }
.header .titles { flex: 1 1 auto; min-width: 0; }
.header .name { font-weight: 650; font-size: 14px; }
.header .tagline { font-size: 12px; color: var(--sunny-muted);
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
  .launcher, .panel, .panel.opening, .panel.closing { animation: none !important;
    transition: none !important; }
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
  .panel {
    width: calc(100vw - 24px - var(--sunny-safe-left) - var(--sunny-safe-right));
    height: min(70vh, 520px);
  }
  .launcher { width: 60px; height: 60px; }
}
`;
}

/** Styles for the highlight the widget applies to a host-page element. */
export function pageActionStyleAttribute(): string {
  return 'data-sunny-highlight';
}
