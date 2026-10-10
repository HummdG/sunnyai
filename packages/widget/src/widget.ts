import { SunnyAnimator, machineEventForStreamEvent } from '@sunny/animation-engine';
import { defaultRig, renderSunny, SUNNY_THEME, type SunnyTheme } from '@sunny/character';
import {
  PAGE_ACTIONS,
  type ChatStreamEvent,
  type PageAction,
  type WidgetConfig,
} from '@sunny/contracts';

import { ChatClient } from './chat.js';
import { el, setSvg } from './dom.js';
import { styles } from './styles.js';

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

const FRAME_MS = 1000 / 30;

export interface MountOptions {
  apiUrl: string;
  publicId: string;
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
  #frameHandle: number | null = null;
  #lastMarkup = '';
  #lastFrameAt = 0;
  #open = false;
  #pending = false;
  #currentTurn: HTMLElement | null = null;
  #clientMessageId = '';

  // DOM
  #launcher!: HTMLButtonElement;
  #launcherArt!: HTMLElement;
  #panel!: HTMLElement;
  #log!: HTMLElement;
  #composer!: HTMLTextAreaElement;
  #send!: HTMLButtonElement;
  #suggestions!: HTMLElement;
  #liveRegion!: HTMLElement;

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
    });
    this.#suggestions = el('div', { class: 'suggestions' });
    this.#liveRegion = el('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });

    this.#composer = el('textarea', {
      class: 'composer-input',
      rows: 1,
      placeholder: 'Ask about solar for your home…',
      'aria-label': 'Your message',
      maxlength: 4000,
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

    const composer = el('div', { class: 'composer' }, [this.#composer, this.#send]);

    const closeButton = el('button', { type: 'button', 'aria-label': 'Close the assistant' }, [
      '×',
    ]);
    closeButton.addEventListener('click', () => this.close());

    const header = el('div', { class: 'header' }, [
      el('span', { class: 'avatar' }),
      el('div', { class: 'titles' }, [
        el('div', { class: 'name', text: 'Sunny' }),
        el('div', { class: 'tagline', text: 'Solar assistant' }),
      ]),
      closeButton,
    ]);

    this.#panel = el(
      'div',
      { class: 'panel', role: 'dialog', 'aria-label': 'Solar assistant', hidden: true },
      [header, this.#log, this.#suggestions, composer, this.#liveRegion],
    );
    this.#panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.close();
    });

    this.#root.append(style, el('div', { class: 'sunny-root' }, [this.#panel, this.#launcher]));
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

  #applyConfig(config: WidgetConfig): void {
    this.#host.setAttribute('data-position', config.position);
    this.#host.style.setProperty('--sunny-primary-color', config.primaryColor);

    const name = this.#root.querySelector('.header .name');
    const tagline = this.#root.querySelector('.header .tagline');
    if (name) name.textContent = config.companyName;
    if (tagline) tagline.textContent = config.tagline;

    this.#animator = new SunnyAnimator(defaultRig(), {
      intensity: config.intensity,
      reducedMotion: prefersReducedMotion(),
    });
    this.#animator.setBase({ ...defaultRig(), theme: themeFrom(config.primaryColor) });

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
    } catch {
      /* offline; the launcher still animates and the panel still opens */
    }
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
    const result = this.#animator.frame(time, {
      hidden,
      reducedMotion: prefersReducedMotion(),
      paused: !this.#open && hidden,
    });

    // Skip identical frames. An idle character holds some frames exactly, and
    // rewriting the SVG for them is pure garbage.
    const markup = renderSunny(result.rig, { decorative: true, uniqueIds: true });
    if (markup === this.#lastMarkup) return;
    this.#lastMarkup = markup;
    setSvg(this.#launcherArt, markup);

    const avatar = this.#root.querySelector('.header .avatar');
    if (avatar && this.#open) setSvg(avatar, markup);

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
    this.#panel.hidden = false;
    this.#panel.classList.remove('closing');
    this.#panel.classList.add('opening');
    this.#launcher.setAttribute('aria-expanded', 'true');

    // The character compresses and springs as the panel lands. Both halves of
    // that are short; the pair is tuned to finish inside 650 ms.
    this.#animator.dispatch({ type: 'attention' }, performance.now());
    this.#composer.focus();

    if (this.#log.childElementCount === 0) this.#greet();
  }

  close(): void {
    if (!this.#open) return;
    this.#open = false;
    this.#chat?.cancel();
    this.#animator.dispatch({ type: 'dismissed' }, performance.now());
    this.#panel.classList.add('closing');
    this.#launcher.setAttribute('aria-expanded', 'false');
    // Let the closing animation finish before removing the panel, so the exit is
    // animated rather than a pop. `prefers-reduced-motion` zeroes the duration
    // in CSS, so this is not a delay for those visitors.
    setTimeout(() => {
      if (!this.#open) {
        this.#panel.hidden = true;
        this.#panel.classList.remove('closing', 'opening');
      }
    }, 180);
    this.#launcher.focus();
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
      case 'page_action_suggested':
        this.#applyPageAction(event.action, event.target);
        break;
      case 'lead_saved':
        this.#appendTurn('system', 'Your details have been passed to the installer.');
        break;
      case 'handoff_requested':
        this.#appendTurn('system', 'A person from the team will pick this up.');
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
    if (this.#frameHandle !== null) cancelAnimationFrame(this.#frameHandle);
    this.#chat?.cancel();
    this.#root.replaceChildren();
  }
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
