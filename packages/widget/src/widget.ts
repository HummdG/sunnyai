import { SunnyAnimator, machineEventForStreamEvent } from '@sunny/animation-engine';
import {
  cartoonClock,
  createSunnyView,
  defaultRig,
  safePaint,
  SUNNY_THEME,
  type SunnyTheme,
  type SunnyView,
} from '@sunny/character';
import type {
  ChatStreamEvent,
  QuoteCard,
  PageAction,
  RecommendationResponse,
  WidgetConfig,
} from '@sunny/contracts';

import { cardsElement, optionsPanel, type OptionsPanelView } from './cards.js';
import { ChatClient, PAGE_ACTIONS } from './chat.js';
import { legibleInk } from './contrast.js';
import { el } from './dom.js';
import type * as RoofModule from './roof.js';
import type * as VoiceModule from './voice.js';
import { declareFontFaces, preloadFontFaces, releaseFontFaces } from './fonts.js';
import { styles } from './styles.js';
import { turnstileToken } from './turnstile.js';

/**
 * The embeddable widget.
 *
 * Everything lives inside a shadow root, so the customer's stylesheet cannot
 * restyle it and its own styles cannot leak out. The only values that cross the
 * boundary are text nodes the widget created and the accent colour, which the
 * host sets through a CSS custom property.
 */

/**
 * Named landmarks the assistant may point at on the host page.
 *
 * A page action is resolved through this map and nothing else. The model sends a
 * name like `"quote-form"`; a selector, a URL or any other free-form target is
 * not resolvable and is ignored. That is what keeps `suggest_page_action` from
 * becoming a way to reach arbitrary DOM.
 */
const DEFAULT_LANDMARKS: Readonly<Record<string, string>> = {
  'quote-form': '[data-sunny-landmark="quote-form"], #quote-form, form[action*="quote"]',
  'savings-calculator':
    '[data-sunny-landmark="savings-calculator"], #calculator, [data-testid="calculator"]',
  'contact-details': '[data-sunny-landmark="contact-details"], #contact, footer address',
  pricing: '[data-sunny-landmark="pricing"], #pricing, [data-testid="pricing"]',
  'case-studies':
    '[data-sunny-landmark="case-studies"], #case-studies, [data-testid="case-studies"]',
};

const FRAME_MS = 1000 / 24;

export interface MountOptions {
  apiUrl: string;
  publicId: string;
  /**
   * Where the widget's script was served from, so it can find the fonts
   * published beside it.
   *
   * Optional because it is not what makes the widget work: with no directory —
   * a script tag with no readable `src`, or a caller mounting the class directly
   * — no face is registered and the panel is set in the system stack, which is
   * the same fallback as a font that fails to download.
   */
  fontDirectoryUrl?: string | null;
  /** Overrides the server's branding; used by the visual tests. */
  landmarks?: Readonly<Record<string, string>>;
  /** Set false to skip the network entirely, for a screenshot harness. */
  interactive?: boolean;
}

export class SunnyWidget {
  #options: MountOptions;
  #host: HTMLElement;
  #root: ShadowRoot;
  #animator: SunnyAnimator;
  #config: WidgetConfig | null = null;
  #sessionToken = '';
  #sessionId = '';
  #chat: ChatClient | null = null;
  /** The voice add-on's controller while a voice session is open. */
  #voice: { stop(): void } | null = null;
  #frameHandle: number | null = null;
  #launcherView!: SunnyView;
  #avatarView!: SunnyView;
  #avatar!: HTMLElement;
  #fizz!: HTMLElement;
  #openTimers: number[] = [];
  #lastFrameAt = 0;
  #open = false;
  #pending = false;
  #currentTurn: HTMLElement | null = null;
  #clientMessageId = '';

  /** The faces this instance put into the document, so `destroy` can take them out. */
  #fontFaces: FontFace[] = [];

  // DOM
  #launcher!: HTMLButtonElement;
  #launcherArt!: HTMLElement;
  #panel!: HTMLElement;
  #log!: HTMLElement;
  #optionsHost!: HTMLElement;
  #composer!: HTMLTextAreaElement;
  #count!: HTMLElement;
  #send!: HTMLButtonElement;
  #suggestions!: HTMLElement;
  #liveRegion!: HTMLElement;

  /**
   * The option set already on screen, so an unchanged answer is not re-rendered.
   *
   * The engine is deterministic and its option ids are derived from the parts,
   * so the id of the first option identifies the whole set: a refinement that
   * changes nothing produces the same id and leaves the DOM alone, which matters
   * because the renderer replaces the list rather than patching it.
   */
  #renderedOptionId = '';

  /** The last finished roof assessment, so a chosen package can be shown on it. */
  #lastRoof: { base: string; summary: RoofSummary } | null = null;

  constructor(host: HTMLElement, options: MountOptions) {
    this.#host = host;
    this.#options = options;
    this.#animator = new SunnyAnimator(defaultRig(), { intensity: 'balanced' });

    // `mode: 'open'` so the host page can drive the widget (and so an
    // accessibility audit can see into it). The isolation comes from the shadow
    // boundary, not from secrecy.
    this.#root = host.attachShadow({ mode: 'open' });
  }

  get config(): WidgetConfig | null {
    return this.#config;
  }

  async mount(): Promise<void> {
    // The faces go in with the document, not with the sheet, and before the
    // shell is built so the first frame already has the family available.
    // `preloadFontFaces` only starts the download; nothing waits on it.
    this.#fontFaces = declareFontFaces(this.#options.fontDirectoryUrl);
    preloadFontFaces();

    this.#buildShell();
    this.#startFrameLoop();

    // The launcher renders immediately from the local rig: the character is
    // never gated on a network call, so a slow API costs a greeting, not the
    // whole assistant.
    await this.#loadConfig();

    if (this.#options.interactive !== false) {
      await this.#openSession();
    }
  }

  // ── shell ────────────────────────────────────────────────────────────────

  #buildShell(): void {
    const style = el('style');
    style.textContent = styles();

    this.#launcherArt = el('span', { class: 'svg-host' });
    this.#launcher = el(
      'button',
      {
        class: 'launcher',
        type: 'button',
        'aria-label': 'Open the solar assistant',
        'aria-expanded': 'false',
        'aria-haspopup': 'dialog',
      },
      [this.#launcherArt],
    );
    this.#launcher.addEventListener('click', () => this.toggle());

    this.#log = el('div', {
      class: 'log',
      role: 'log',
      'aria-live': 'polite',
      'aria-atomic': 'false',
      // Focusable because it scrolls. A transcript longer than the panel is only
      // readable with a pointer otherwise, which is the failure axe reports as
      // "scrollable region must have keyboard access" -- and it starts happening
      // as soon as anything else on the panel takes vertical room, so an empty
      // conversation hides it rather than proving it absent.
      tabindex: '0',
    });
    this.#suggestions = el('div', { class: 'suggestions' });
    this.#optionsHost = el('div', { class: 'options-host', hidden: true });
    this.#liveRegion = el('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });

    this.#composer = el('textarea', {
      class: 'composer-input',
      rows: 1,
      placeholder: 'Ask about solar for your home…',
      'aria-label': 'Your message',
      // Blueprint §4.6; the server enforces the same and the config can change it.
      maxlength: MAX_INPUT_CHARS,
    });
    this.#composer.addEventListener('input', () => this.#autoGrow());
    this.#composer.addEventListener('keydown', (event) => {
      // Enter sends, Shift+Enter breaks the line. IME composition is respected
      // so a visitor typing in a composing script does not send mid-word.
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        void this.#submit();
      }
      if (event.key === 'Escape') this.close();
    });

    this.#send = el(
      'button',
      {
        class: 'composer-send',
        type: 'button',
        'aria-label': 'Send message',
        disabled: true,
      },
      ['↑'],
    );
    this.#send.addEventListener('click', () => void this.#submit());

    this.#count = el('span', { class: 'count', 'aria-live': 'polite' });
    const composer = el('div', { class: 'composer' }, [this.#composer, this.#count, this.#send]);

    const closeButton = el('button', { type: 'button', 'aria-label': 'Close the assistant' }, [
      '×',
    ]);
    closeButton.addEventListener('click', () => this.close());

    this.#avatar = el('span', { class: 'avatar' });
    const header = el('div', { class: 'header' }, [
      this.#avatar,
      el('div', { class: 'titles' }, [
        el('div', { class: 'name', text: 'Sunny' }),
        el('div', { class: 'tagline', text: 'Solar assistant' }),
      ]),
      closeButton,
    ]);

    this.#panel = el(
      'div',
      { class: 'panel', role: 'dialog', 'aria-label': 'Solar assistant', hidden: true },
      [header, this.#log, this.#optionsHost, this.#suggestions, composer, this.#liveRegion],
    );
    this.#panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.close();
    });

    // The bubbles that fizz up out of the launcher as the panel opens.
    this.#fizz = el(
      'div',
      { class: 'fizz', 'aria-hidden': 'true' },
      // Fixed, hand-spread offsets rather than random ones, so every opening
      // looks the same and a screenshot test can rely on it.
      FIZZ.map(([x, size, drift, rise], i) =>
        el('i', {
          style: `--x:${x}px;--s:${size}px;--dx:${drift}px;--dy:${-rise}px;--d:${i * 26}ms`,
        }),
      ),
    );

    this.#launcherView = createSunnyView(this.#launcherArt, { decorative: true });
    // Head only at avatar size, like the reference badge: a full figure at 40 px
    // leaves a face too small to read.
    this.#avatarView = createSunnyView(this.#avatar, { decorative: true, limbs: false });

    this.#root.append(
      style,
      el('div', { class: 'sunny-root' }, [this.#panel, this.#fizz, this.#launcher]),
    );
  }

  // ── loading ──────────────────────────────────────────────────────────────

  async #loadConfig(): Promise<void> {
    try {
      const response = await fetch(
        `${this.#options.apiUrl}/v1/widget/config/${encodeURIComponent(this.#options.publicId)}`,
      );
      if (response.ok) {
        this.#config = (await response.json()) as WidgetConfig;
        this.#applyConfig(this.#config);
      }
    } catch {
      // A failed config fetch is not fatal: the widget runs with its defaults and
      // the visitor still gets an assistant, just without the installer's copy.
    }
  }

  /**
   * Re-theme the widget live: the panel accents and Sunny's own colour. For a
   * host page that lets the visitor try colours (the marketing site's colour
   * demo). The value is validated exactly as a tenant's configured colour is.
   */
  setTheme(colour: string): void {
    const accent = this.#applyAccent(colour);
    this.#animator.setBase({ ...defaultRig(), theme: themeFrom(accent) });
  }

  /** Validate a colour and paint the panel with it; returns the colour used. */
  #applyAccent(colour: string): string {
    const accent = safePaint(colour, SUNNY_THEME.body);
    this.#host.style.setProperty('--sunny-primary-color', accent);
    // The accent is used in two roles that ask different things of it: as a fill
    // behind white text (the visitor's own bubbles, the send button) and as text
    // on the pale suggestion chip. One darkened tone satisfies both, and the
    // chip's background is in the list because the tone has to clear that, not
    // only white. Without this the default brand is 2.66:1 on the chip -- the
    // exact failure the browser audit found, at the colour nobody chose yet.
    this.#host.style.setProperty('--sunny-accent-ink', legibleInk(accent, ['#FFFFFF', '#FFF1E5']));
    return accent;
  }

  #applyConfig(config: WidgetConfig): void {
    if (config.maxInputChars) this.#composer.maxLength = config.maxInputChars;
    this.#host.setAttribute('data-position', config.position);
    // One guard for all three places the tenant's colour lands. The config
    // fetch casts the parsed JSON straight to `WidgetConfig` without validating
    // it, so this string is unvalidated until here -- and it reaches a CSS
    // custom property, a contrast calculation and the character's theme. A
    // colour that fails the check becomes the brand colour rather than
    // travelling on; see `safePaint`.
    const accent = this.#applyAccent(config.primaryColor);

    const name = this.#root.querySelector('.header .name');
    const tagline = this.#root.querySelector('.header .tagline');
    if (name) name.textContent = config.companyName;
    if (tagline) tagline.textContent = config.tagline;

    this.#animator = new SunnyAnimator(defaultRig(), {
      intensity: config.intensity,
      reducedMotion: prefersReducedMotion(),
    });
    this.#animator.setBase({ ...defaultRig(), theme: themeFrom(accent) });

    this.#suggestions.replaceChildren(
      ...config.suggestions.map((text) => {
        const button = el('button', { type: 'button', text });
        button.addEventListener('click', () => {
          this.#composer.value = text;
          void this.#submit();
        });
        return button;
      }),
    );

    const footnote = el('div', {
      class: 'footnote',
      text: `AI assistant. Answers are indicative; ${config.companyName} confirms details.`,
    });
    this.#panel.append(footnote);
  }

  async #openSession(): Promise<void> {
    try {
      const response = await fetch(`${this.#options.apiUrl}/v1/widget/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          publicId: this.#options.publicId,
          origin: location.origin,
          // Only when the deployment uses Turnstile; the script loads on demand.
          turnstileToken: this.#config?.turnstileSiteKey
            ? ((await turnstileToken(this.#config.turnstileSiteKey)) ?? undefined)
            : undefined,
        }),
      });
      if (!response.ok) return;
      const session = (await response.json()) as {
        sessionId: string;
        sessionToken: string;
      };
      this.#sessionId = session.sessionId;
      this.#sessionToken = session.sessionToken;
      this.#chat = new ChatClient({
        apiUrl: this.#options.apiUrl,
        sessionId: this.#sessionId,
        sessionToken: this.#sessionToken,
        onEvent: (event) => this.#onStreamEvent(event),
        onError: (error) => this.#onStreamError(error),
        onFinish: () => this.#onStreamFinish(),
      });
      this.#history();
      // The option set standing on this session is a read, not a model turn, so
      // a visitor returning to a conversation sees the options they were given
      // rather than an empty panel beside a transcript that mentions them.
      void this.#loadOptions();
      void this.#offerVoice();
    } catch {
      /* offline; the launcher still animates and the panel still opens */
    }
  }

  // ── voice (Voice & Phone add-on) ─────────────────────────────────────────

  /**
   * Show a microphone when the installer has the voice add-on. Everything else
   * lives in `sunny-voice.js`, fetched from beside this script on first press,
   * so a tenant without the add-on downloads none of it.
   */
  async #offerVoice(): Promise<void> {
    const dir = this.#options.fontDirectoryUrl;
    if (!dir || typeof AudioWorkletNode === 'undefined') return;
    const id = encodeURIComponent(this.#options.publicId);
    const caps = (await fetch(`${this.#options.apiUrl}/v1/voice/capabilities/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)) as { webVoice?: boolean } | null;
    if (!caps?.webVoice) return;
    const mic = el(
      'button',
      { class: 'mic', type: 'button', 'aria-label': 'Talk to Sunny', 'aria-pressed': 'false' },
      ['🎙'],
    );
    mic.addEventListener('click', () => void this.#toggleVoice(mic, dir));
    this.#send.before(mic);
  }

  async #toggleVoice(mic: HTMLElement, dir: string): Promise<void> {
    if (this.#voice) return this.#voice.stop();
    const url = new URL('sunny-voice.js', dir).href;
    const voice = (await import(/* @vite-ignore */ url)) as typeof VoiceModule;
    const now = (): number => performance.now();
    mic.setAttribute('aria-pressed', 'true');
    this.#voice = voice.mountVoice(this.#composer.parentElement!, {
      apiUrl: this.#options.apiUrl,
      token: this.#sessionToken,
      companyName: this.#config?.companyName ?? 'the installer',
      // The character reacts to voice exactly as it does to chat.
      onState: (state) => {
        if (state === 'connecting') this.#animator.dispatch({ type: 'attention' }, now());
        if (state === 'speaking') this.#animator.dispatch({ type: 'speaking_started' }, now());
        if (state === 'listening') this.#animator.dispatch({ type: 'turn_finished' }, now());
      },
      onCaption: (role, text, final) => {
        if (!final || !text) return;
        this.#appendTurn(role, text);
        if (role === 'user') this.#animator.dispatch({ type: 'turn_started' }, now());
      },
      onEnd: () => {
        this.#voice = null;
        mic.setAttribute('aria-pressed', 'false');
      },
    });
  }

  // ── the option cards ─────────────────────────────────────────────────────

  /**
   * Ask the API what options stand on this session, and show them.
   *
   * No session id is sent: the token *is* the session, so a widget cannot ask
   * about a conversation that is not its own even by naming one. Nothing is
   * decided here either -- the constraints in force are stored against the
   * conversation and the engine answers from the installer's own catalogue, so
   * this shows the same option set the assistant just described.
   */
  async #loadOptions(): Promise<void> {
    if (this.#sessionToken === '') return;
    try {
      const response = await fetch(`${this.#options.apiUrl}/v1/recommendations`, {
        headers: { authorization: `Bearer ${this.#sessionToken}` },
      });
      if (!response.ok) return;
      const body = (await response.json()) as RecommendationResponse;
      this.#renderOptions(optionsPanel(body));
    } catch {
      // A failed read leaves the cards already on screen alone. They did not
      // change, and clearing them would report a network fault as a change to
      // the visitor's options.
    }
  }

  #renderOptions(view: OptionsPanelView | null): void {
    if (view === null) {
      this.#optionsHost.replaceChildren();
      this.#optionsHost.hidden = true;
      this.#renderedOptionId = '';
      return;
    }

    // The engine's option ids are derived from the products and counts, so the
    // first one identifies the whole set: a refinement that changes nothing
    // leaves the DOM untouched instead of rebuilding the same three cards.
    const key = view.cards[0]?.id ?? `note:${view.note}`;
    if (key === this.#renderedOptionId) return;
    this.#renderedOptionId = key;

    this.#optionsHost.replaceChildren(cardsElement(view));
    this.#optionsHost.hidden = false;
    this.#liveRegion.textContent =
      view.cards.length > 0 ? 'Options updated.' : 'No options to show yet.';
  }

  // ── the frame loop ───────────────────────────────────────────────────────

  /**
   * One loop drives both Sunny instances: the launcher character and the one in
   * the panel header. A single `requestAnimationFrame` for the whole widget
   * keeps the cost flat regardless of how many copies are on screen.
   */
  #startFrameLoop(): void {
    const step = (time: number): void => {
      this.#frameHandle = requestAnimationFrame(step);
      if (time - this.#lastFrameAt < FRAME_MS) return;
      this.#lastFrameAt = time;
      this.#renderCharacter(time);
    };
    this.#frameHandle = requestAnimationFrame(step);
  }

  #renderCharacter(time: number): void {
    const hidden = document.visibilityState === 'hidden';
    // Film frames and a boiling ink line: the 1930s cartoon clock.
    const clock = cartoonClock(time);
    const result = this.#animator.frame(clock.time, {
      hidden,
      reducedMotion: prefersReducedMotion(),
      paused: !this.#open && hidden,
    });

    // Each view patches its SVG in place and skips identical frames, so the
    // nodes under the pointer survive from frame to frame.
    const boil = prefersReducedMotion() ? undefined : clock.boil;
    this.#launcherView.draw(result.rig, { boil });
    if (this.#open) this.#avatarView.draw(result.rig, { boil });

    if (this.#launcher.querySelector('.svg-host svg')) {
      this.#launcher.classList.add('ready');
    }
  }

  // ── opening and closing ──────────────────────────────────────────────────

  toggle(): void {
    if (this.#open) this.close();
    else this.open();
  }

  open(): void {
    if (this.#open) return;
    this.#open = true;
    this.#clearOpenTimers();
    this.#panel.hidden = false;
    this.#panel.classList.remove('closing', 'settled');
    this.#launcher.setAttribute('aria-expanded', 'true');
    this.#animator.dispatch({ type: 'attention' }, performance.now());

    // The opening, about 560 ms end to end (plan §6.2): Sunny reacts on the
    // launcher, bubbles fizz up out of it, a bubble swells from the launcher
    // into the panel, and Sunny settles into the header. Every step is CSS on
    // classes set here, so `prefers-reduced-motion` turns the whole thing into
    // an immediate open in one place (styles.ts).
    this.#launcher.classList.remove('pop');
    void this.#launcher.offsetWidth; // restart the reaction if it is mid-play
    this.#launcher.classList.add('pop');
    this.#fizz.classList.remove('rising');
    void this.#fizz.offsetWidth;
    this.#fizz.classList.add('rising');
    this.#panel.classList.add('opening');
    this.#openTimers.push(
      window.setTimeout(() => this.#panel.classList.add('settled'), 380),
      window.setTimeout(() => {
        this.#launcher.classList.remove('pop');
        this.#fizz.classList.remove('rising');
      }, 700),
    );
    this.#composer.focus();

    if (this.#log.childElementCount === 0) this.#greet();
  }

  close(): void {
    if (!this.#open) return;
    this.#open = false;
    this.#chat?.cancel();
    this.#clearOpenTimers();
    this.#fizz.classList.remove('rising');
    this.#animator.dispatch({ type: 'dismissed' }, performance.now());
    this.#panel.classList.add('closing');
    this.#launcher.setAttribute('aria-expanded', 'false');
    // Let the closing animation finish before removing the panel, so the exit is
    // animated rather than a pop. `prefers-reduced-motion` zeroes the duration
    // in CSS, so this is not a delay for those visitors.
    setTimeout(() => {
      if (!this.#open) {
        this.#panel.hidden = true;
        this.#panel.classList.remove('closing', 'opening', 'settled');
      }
    }, 180);
    this.#launcher.focus();
  }

  #clearOpenTimers(): void {
    for (const id of this.#openTimers) clearTimeout(id);
    this.#openTimers = [];
  }

  #greet(): void {
    const greeting = this.#config?.greeting ?? "Hi, I'm Sunny. Ask me about solar for your home.";
    this.#appendTurn('assistant', greeting);
  }

  #history(): void {
    if (this.#log.childElementCount > 0) return;
    this.#greet();
  }

  // ── the transcript ───────────────────────────────────────────────────────

  /**
   * Every value placed here is set as `textContent` by `el()`. A model that
   * emits markup renders as those characters, which is the whole defence against
   * injecting into the customer's page from the transcript.
   */
  // ── roof assessment (SunScan) ─────────────────────────────────────────────

  /**
   * A roof card for an assessment the assistant started: progress while it runs
   * (polled with the visitor's own session token), then the summary and, on
   * request, the 3D model -- which lives in `sunny-roof.js` beside this script,
   * so nobody downloads three.js unless they ask to see their roof.
   */
  #showRoof(id: string, status: string, summary: RoofSummary | null, polls = 0): void {
    let card = this.#log.querySelector<HTMLElement>(`.roof[data-id="${CSS.escape(id)}"]`);
    if (!card) {
      card = el('div', { class: 'roof', 'data-id': id });
      this.#log.append(card);
    }
    const base = `/v1/sunscan/assessments/${encodeURIComponent(id)}`;
    if (status === 'queued' || status === 'running') {
      card.replaceChildren(el('p', { text: 'Measuring your roof from open map and LiDAR data…' }));
      if (polls < 60 && this.#sessionToken !== '') {
        setTimeout(() => {
          void fetch(`${this.#options.apiUrl}${base}`, {
            headers: { authorization: `Bearer ${this.#sessionToken}` },
          })
            .then((r) => (r.ok ? r.json() : null))
            .then(
              (
                a: {
                  status: string;
                  summary: RoofSummary | null;
                  error: { message: string } | null;
                } | null,
              ) => {
                if (!a) return;
                if (a.status === 'failed') this.#roofFailed(card, a.error?.message);
                else this.#showRoof(id, a.status, a.summary, polls + 1);
              },
            )
            .catch(() => undefined);
        }, 2000);
      }
    } else if (status === 'failed' || !summary) {
      this.#roofFailed(card);
    } else {
      const where = summary.bestFacing ? `, best facing ${summary.bestFacing}` : '';
      const panels =
        summary.estimatedMaxPanels > 0
          ? ` — room for up to ${summary.estimatedMaxPanels} panels (estimate)`
          : '';
      this.#lastRoof = { base, summary };
      const button = el('button', { type: 'button', text: 'See your roof in 3D' });
      button.addEventListener('click', () => void this.#openRoof(base, summary));
      card.replaceChildren(
        el('p', {
          text: `${summary.reliable ? 'Your roof' : 'Your roof (low-confidence measurement)'}: about ${Math.round(summary.usableRoofAreaM2)} m² usable${where}${panels}.`,
        }),
        el('p', { class: 'roof-label', text: summary.label }),
        button,
      );
      this.#animator.dispatch({ type: 'impress' }, performance.now());
    }
    this.#scrollToEnd();
  }

  /**
   * The quote journey's three options, as cards: what the system is, what it
   * costs (or that a specialist will price it), what it should generate and
   * save -- every figure under the quote's own "indicative" disclaimer. All text
   * goes in through `el`'s textContent.
   */
  #showQuote(quote: QuoteCard): void {
    const gbp = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;
    const cards = quote.options.map((o) => {
      const facts = [
        `${o.panelCount} panels · ${o.systemKwp.toFixed(1)} kWp`,
        o.batteryType ? `Battery: ${o.batteryType}` : 'No battery',
        `About ${Math.round(o.annualGenerationKwh).toLocaleString('en-GB')} kWh a year`,
        `Saves about ${gbp(o.annualSavingsGbp)} a year`,
        ...(o.paybackYears !== null ? [`Pays back in about ${o.paybackYears} years`] : []),
        ...(o.sentinel
          ? [`With Sentinel optimisation: about ${gbp(o.sentinel.annualSavingsGbp)} a year`]
          : []),
      ];
      const notes = [
        ...(o.aboveBudget ? ['Above the budget you mentioned'] : []),
        ...(o.roofLimited ? ['Limited by the space on your roof'] : []),
        ...(o.installerPriced && o.installerPriced.length > 0
          ? [`Plus ${o.installerPriced.join(', ')} — priced by your installer`]
          : []),
      ];
      return el('li', { class: `quote-option${o.isRecommended ? ' recommended' : ''}` }, [
        ...(o.isRecommended ? [el('span', { class: 'quote-badge', text: 'Best for you' })] : []),
        el('strong', { class: 'quote-name', text: o.label }),
        el('span', {
          class: 'quote-price',
          text: o.priceGbp !== null ? gbp(o.priceGbp) : 'Price on survey',
        }),
        el('span', { class: 'quote-price-label', text: o.priceLabel }),
        el('p', { class: 'quote-headline', text: o.headline }),
        el(
          'ul',
          { class: 'quote-facts' },
          facts.map((f) => el('li', { text: f })),
        ),
        ...notes.map((n) => el('p', { class: 'quote-note', text: n })),
        this.#chooseButton(quote.quoteId, o.id, o.label),
      ]);
    });
    this.#log.append(
      el('div', { class: 'quote', 'data-id': quote.quoteId }, [
        el('ul', { class: 'quote-options', 'aria-label': 'Your quote options' }, cards),
        el('p', { class: 'quote-disclaimer', text: quote.disclaimer }),
        ...this.#quoteActions(quote),
      ]),
    );
    this.#animator.dispatch({ type: 'celebrate' }, performance.now());
    this.#liveRegion.textContent = `${quote.options.length} quote options shown.`;
    this.#scrollToEnd();
  }

  /** "Choose this package" on one option card. */
  #chooseButton(quoteId: string, optionId: string, label: string): HTMLButtonElement {
    const button = el('button', {
      type: 'button',
      class: 'quote-choose',
      'data-option': optionId,
      text: 'Choose this package',
      'aria-label': `Choose the ${label} package`,
    });
    button.addEventListener('click', () => void this.#choose(quoteId, optionId, button));
    return button;
  }

  /**
   * The visitor picked a package: record it, mark the card, have Sunny say so,
   * and play the savings simulation on their 3D roof (or give the totals in
   * words when there is no roof to play it on).
   */
  async #choose(quoteId: string, optionId: string, button: HTMLButtonElement): Promise<void> {
    const response = await fetch(
      `${this.#options.apiUrl}/v1/quote/${encodeURIComponent(quoteId)}/choose`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.#sessionToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ sessionId: this.#sessionId, optionId }),
      },
    ).catch(() => null);
    if (!response?.ok) {
      this.#appendTurn('error', "Sorry, I couldn't save that choice. Please try again.");
      return;
    }
    const chosen = (await response.json()) as ChosenPackage;
    const quoteEl = button.closest('.quote');
    for (const b of quoteEl?.querySelectorAll<HTMLButtonElement>('.quote-choose') ?? []) {
      const mine = b === button;
      b.textContent = mine ? 'Your choice ✓' : 'Choose this instead';
      b.closest('.quote-option')?.classList.toggle('chosen', mine);
      b.setAttribute('aria-pressed', String(mine));
    }
    const gbp = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;
    const t = chosen.timeline;
    this.#animator.dispatch({ type: 'celebrate' }, performance.now());
    const roof = this.#lastRoof;
    this.#appendTurn(
      'assistant',
      roof
        ? `Great choice — the ${chosen.option.label} package. Let's watch what it could save you, month by month, on your roof.`
        : `Great choice — the ${chosen.option.label} package. In its first year it could save you about ${gbp(t.year1TotalGbp)}, and about ${gbp(t.twentyFiveYearTotalGbp)} over 25 years (indicative).`,
    );
    if (chosen.sentinelNote) this.#appendTurn('system', chosen.sentinelNote);
    this.#appendTurn(
      'assistant',
      "When you're ready, I can arrange a free survey to confirm everything — just say \u201cbook a survey\u201d.",
    );
    if (roof) {
      await this.#openRoof(roof.base, roof.summary, {
        panelCount: chosen.option.panelCount,
        timeline: t,
        onComplete: () => this.#animator.dispatch({ type: 'celebrate' }, performance.now()),
      });
    }
  }

  /** "Download your quote (PDF)" and, when outbound email is set up, "Email it to me". */
  #quoteActions(quote: QuoteCard): HTMLElement[] {
    if (!quote.proposalAvailable) return [];
    const url = `${this.#options.apiUrl}/v1/quote/${encodeURIComponent(quote.quoteId)}/proposal`;
    const auth = { authorization: `Bearer ${this.#sessionToken}` };
    const status = el('p', { class: 'quote-status', role: 'status' });
    const download = el('button', { type: 'button', text: 'Download your quote (PDF)' });
    download.addEventListener('click', () => {
      status.textContent = 'Preparing your quote…';
      void fetch(`${url}.pdf`, { headers: auth })
        .then(async (r) => {
          if (!r.ok) throw new Error(String(r.status));
          const link = el('a', {
            href: URL.createObjectURL(await r.blob()),
            download: 'solar-quote.pdf',
          });
          link.click();
          setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
          status.textContent = 'Your quote has downloaded.';
        })
        .catch(() => (status.textContent = "Sorry, the quote couldn't be downloaded. Try again."));
    });
    const actions = el('div', { class: 'quote-actions' }, [download]);
    if (quote.emailAvailable) {
      const email = el('input', {
        type: 'email',
        required: true,
        autocomplete: 'email',
        'aria-label': 'Your email address',
        placeholder: 'you@example.com',
      });
      const consent = el('input', { type: 'checkbox', required: true });
      const form = el('form', { class: 'quote-email', hidden: true }, [
        email,
        el('label', {}, [consent, ' Email my quote to me']),
        el('button', { type: 'submit', text: 'Send' }),
      ]);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        status.textContent = 'Sending…';
        void fetch(`${url}/email`, {
          method: 'POST',
          headers: { ...auth, 'content-type': 'application/json' },
          body: JSON.stringify({ email: email.value, consent: consent.checked }),
        }).then((r) => {
          status.textContent = r.ok
            ? `Sent to ${email.value}.`
            : "Sorry, that didn't send. Check the address and try again.";
          if (r.ok) form.hidden = true;
        });
      });
      const open = el('button', { type: 'button', text: 'Email it to me' });
      open.addEventListener('click', () => {
        form.hidden = false;
        email.focus();
      });
      actions.append(open, form);
    }
    return [actions, status];
  }

  #roofFailed(card: HTMLElement, message?: string): void {
    card.replaceChildren(el('p', { text: message ?? 'The roof could not be measured this time.' }));
  }

  async #openRoof(
    base: string,
    summary: RoofSummary,
    simulation?: RoofModule.OpenRoofOptions['simulation'],
  ): Promise<void> {
    const dir = this.#options.fontDirectoryUrl;
    if (!dir) return;
    const roof = (await import(
      /* @vite-ignore */ new URL('sunny-roof.js', dir).href
    )) as typeof RoofModule;
    await roof.openRoofView(this.#panel, {
      apiUrl: this.#options.apiUrl,
      token: this.#sessionToken,
      specUrl: `${base}/spec.json`,
      address: summary.address,
      planes: summary.roofPlanes,
      label: summary.label,
      reliable: summary.reliable,
      ...(simulation ? { simulation } : {}),
      onClose: () => this.#composer.focus(),
    });
  }

  #appendTurn(kind: 'user' | 'assistant' | 'system' | 'error', text: string): HTMLElement {
    const turn = el('div', { class: `turn ${kind}`, text });
    this.#log.append(turn);
    this.#scrollToEnd();
    return turn;
  }

  #scrollToEnd(): void {
    // `auto` rather than `smooth`: a smooth scroll restarts on every token and
    // never catches up with a fast stream.
    this.#log.scrollTop = this.#log.scrollHeight;
  }

  // ── submitting ───────────────────────────────────────────────────────────

  async #submit(): Promise<void> {
    const text = this.#composer.value.trim();
    if (text === '' || this.#pending) return;
    if (!this.#chat) {
      this.#appendTurn(
        'error',
        'I cannot reach the assistant right now. Please try again shortly.',
      );
      return;
    }

    // A fresh idempotency key per distinct message. Reusing one for an edit
    // would make the server treat the correction as the same message.
    this.#clientMessageId = `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    this.#composer.value = '';
    this.#autoGrow();
    this.#setPending(true);
    this.#appendTurn('user', text);
    this.#animator.dispatch({ type: 'turn_started' }, performance.now());

    this.#currentTurn = this.#appendTurn('assistant', '');
    const dots = el('span', { class: 'typing' }, [el('i'), el('i'), el('i')]);
    this.#currentTurn.append(dots);

    await this.#chat.send(text, this.#clientMessageId);
  }

  #setPending(pending: boolean): void {
    this.#pending = pending;
    this.#send.disabled = pending || this.#composer.value.trim() === '';
    this.#composer.setAttribute('aria-busy', String(pending));
  }

  #autoGrow(): void {
    // A remaining-characters count, shown only near the limit.
    const max = this.#composer.maxLength;
    const left = max - this.#composer.value.length;
    this.#count.textContent = max > 0 && left <= max * 0.2 ? String(left) : '';
    this.#composer.style.height = 'auto';
    this.#composer.style.height = `${Math.min(this.#composer.scrollHeight, 108)}px`;
    this.#send.disabled = this.#pending || this.#composer.value.trim() === '';
  }

  // ── the stream ───────────────────────────────────────────────────────────

  #onStreamEvent(event: ChatStreamEvent): void {
    // Application events drive the character; the model never chooses an
    // animation, it only earns one by calling an approved tool.
    const machineEvent = machineEventForStreamEvent(event);
    if (machineEvent) this.#animator.dispatch(machineEvent, performance.now());

    switch (event.type) {
      case 'text_delta': {
        if (!this.#currentTurn) this.#currentTurn = this.#appendTurn('assistant', '');
        const dots = this.#currentTurn.querySelector('.typing');
        if (dots) dots.remove();
        this.#currentTurn.textContent += event.text;
        this.#scrollToEnd();
        break;
      }
      case 'tool_started':
        this.#liveRegion.textContent = 'Looking that up…';
        break;
      case 'recommendation_ready':
        // The event names the option set rather than carrying it: the client
        // draws what the API decided, and the id in the stream has to match the
        // one it fetches, so a mismatch is visible rather than silent.
        void this.#loadOptions();
        break;
      case 'page_action_suggested':
        this.#applyPageAction(event.action, event.target);
        break;
      case 'lead_saved':
        this.#appendTurn('system', 'Your details have been passed to the installer.');
        break;
      case 'handoff_requested':
        this.#appendTurn('system', 'A person from the team will pick this up.');
        break;
      case 'sources':
        this.#appendSources(event.sources);
        break;
      case 'disclaimer':
        this.#appendTurn('system', event.text);
        break;
      case 'sunscan':
        this.#showRoof(event.assessmentId, event.status, event.summary);
        break;
      case 'quote':
        this.#showQuote(event.quote);
        break;
      case 'escalation':
        this.#liveRegion.textContent = 'Your installer has been alerted.';
        break;
      case 'message_finished':
        this.#liveRegion.textContent = 'Reply finished.';
        break;
      case 'error':
        this.#appendTurn('error', event.message);
        break;
      default:
        break;
    }
  }

  /**
   * The documents an answer cited, as links under it. Titles go in as text and
   * links only if they are http(s), so neither can carry markup or a script URL.
   */
  #appendSources(sources: readonly { ref: string; title: string; url: string | null }[]): void {
    const list = el('div', { class: 'sources' }, ['Sources: ']);
    sources.forEach((source, i) => {
      if (i > 0) list.append(' · ');
      const label = `[${source.ref}] ${source.title}`;
      const safe = source.url !== null && /^https?:\/\//i.test(source.url);
      list.append(
        safe
          ? el('a', { href: source.url, target: '_blank', rel: 'noopener noreferrer', text: label })
          : label,
      );
    });
    this.#log.append(list);
    this.#scrollToEnd();
  }

  #onStreamError(error: Error): void {
    const dots = this.#currentTurn?.querySelector('.typing');
    if (dots) dots.remove();
    if (this.#currentTurn && this.#currentTurn.textContent === '') this.#currentTurn.remove();
    this.#appendTurn('error', error.message);
    this.#animator.dispatch({ type: 'turn_failed' }, performance.now());
    this.#setPending(false);
  }

  #onStreamFinish(): void {
    const dots = this.#currentTurn?.querySelector('.typing');
    if (dots) dots.remove();
    if (this.#currentTurn && this.#currentTurn.textContent?.trim() === '') {
      this.#appendTurn('error', 'I did not get a reply. Please try asking again.');
    }
    this.#setPending(false);
    this.#suggestions.hidden = this.#log.childElementCount > 6;
  }

  /**
   * Point at something on the host page.
   *
   * The target is looked up in the landmark map; anything not in it is dropped.
   * The highlight is applied by setting an attribute, so the host page keeps
   * control of what highlighting looks like -- and so nothing here injects a
   * style or a class of its own into the customer's DOM.
   */
  #applyPageAction(action: PageAction, target: string): void {
    if (!(PAGE_ACTIONS as readonly string[]).includes(action)) return;
    const selector = (this.#options.landmarks ?? DEFAULT_LANDMARKS)[target];
    if (!selector) return;

    let element: Element | null = null;
    try {
      element = document.querySelector(selector);
    } catch {
      return;
    }
    if (!element) return;

    switch (action) {
      case 'highlight':
      case 'focus':
        element.setAttribute('data-sunny-highlight', '');
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => element?.removeAttribute('data-sunny-highlight'), 4000);
        break;
      case 'scroll':
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        break;
      case 'open_panel':
        this.open();
        break;
      case 'navigate': {
        // The only URL the widget will ever follow is one the host page itself
        // exposes through the landmark, read from the page rather than from the
        // stream. A URL from the model is not accepted, so a page action can
        // never become a redirect to an attacker's site.
        const href = element.getAttribute('href');
        if (href && (href.startsWith('/') || href.startsWith(location.origin))) {
          location.href = href;
        }
        break;
      }
      default:
        break;
    }
  }

  destroy(): void {
    this.#voice?.stop();
    if (this.#frameHandle !== null) cancelAnimationFrame(this.#frameHandle);
    this.#chat?.cancel();
    this.#clearOpenTimers();
    this.#root.replaceChildren();
    // The faces went into the *document's* font set, so clearing the shadow root
    // is not enough: without this a page that mounts and unmounts the widget
    // leaves a copy of the typeface behind on every pass.
    releaseFontFaces(this.#fontFaces);
    this.#fontFaces = [];
  }
}

/** The longest message the composer accepts (Blueprint §4.6), unless the config says otherwise. */
const MAX_INPUT_CHARS = 500;

/** Fizz bubbles: start x within the launcher, diameter, sideways drift, rise. */
const FIZZ: readonly (readonly [number, number, number, number])[] = [
  [28, 14, -12, 100],
  [44, 9, 10, 126],
  [18, 11, -26, 86],
  [48, 16, 16, 108],
  [34, 8, -4, 144],
  [24, 12, -18, 120],
  [42, 10, 24, 92],
  [32, 15, 2, 132],
  [38, 8, -14, 156],
];

/** POST /v1/quote/:id/choose (apps/api/src/journey/choose.ts). */
interface ChosenPackage {
  chosenOptionId: string;
  option: { id: string; label: string; panelCount: number };
  timeline: RoofModule.SavingsTimelineLike;
  sentinelNote: string | null;
}

/** The parts of a SunScan summary the roof card reads (see @sunny/contracts' sunscan schemas). */
interface RoofSummary {
  address: string;
  roofPlanes: readonly {
    id: number;
    facing: string;
    pitchDeg: number;
    areaM2: number;
    suitable: boolean;
  }[];
  usableRoofAreaM2: number;
  estimatedMaxPanels: number;
  bestFacing: string | null;
  reliable: boolean;
  label: string;
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Derive a theme from the tenant's single accent colour. */
function themeFrom(primaryColor: string): SunnyTheme {
  return {
    ...SUNNY_THEME,
    body: primaryColor,
    ray: primaryColor,
  };
}
