/**
 * In-widget web voice (Voice & Phone add-on, Blueprint §5 Add-On 1).
 *
 * Built as its own file, `sunny-voice.js`, and fetched only when a visitor
 * presses the microphone on a tenant that has the add-on -- so the main widget
 * carries none of this (see scripts/build.mjs). It speaks the `/v1/voice`
 * protocol (docs/integration/voice.md):
 *
 *   client -> server: {type:'start', token}, binary PCM16 LE 16 kHz mono,
 *                     {type:'mute', muted}, {type:'interrupt'}, {type:'stop'}
 *   server -> client: {type:'ready'|'state'|'caption'|'clear'|'safety'|
 *                      'lead_saved'|'handoff'|'ending'|'error'}, binary PCM16 24 kHz
 *
 * The Gemini key never reaches the browser: the API holds the Live session.
 */

export type VoiceUiState = 'consent' | 'connecting' | 'listening' | 'speaking' | 'ended';

export interface VoiceOptions {
  apiUrl: string;
  /** The widget's session token: voice joins the same conversation as the chat. */
  token: string;
  companyName: string;
  onState(state: VoiceUiState): void;
  onCaption(role: 'user' | 'assistant', text: string, final: boolean): void;
  onEnd(reason: string): void;
}

export interface VoiceController {
  stop(): void;
}

// ─── audio helpers (pure, tested) ────────────────────────────────────────────

/** Mono float samples at `inRate` to PCM16 at 16 kHz (linear interpolation). */
export function floatToPcm16k(input: Float32Array, inRate: number): Int16Array {
  const ratio = inRate / 16000;
  const length = Math.floor(input.length / ratio);
  const out = new Int16Array(length);
  for (let i = 0; i < length; i++) {
    const pos = i * ratio;
    const left = Math.floor(pos);
    const right = Math.min(input.length - 1, left + 1);
    const v = input[left]! + (input[right]! - input[left]!) * (pos - left);
    const s = Math.max(-1, Math.min(1, v));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

/** PCM16 little-endian bytes to float samples. */
export function pcm16ToFloat(bytes: ArrayBuffer): Float32Array<ArrayBuffer> {
  const view = new DataView(bytes);
  const out = new Float32Array(new ArrayBuffer((bytes.byteLength >> 1) * 4));
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 0x8000;
  return out;
}

/** Captions are text only: nothing from the server is ever parsed as markup. */
export function captionText(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, 600) : '';
}

// ─── UI ──────────────────────────────────────────────────────────────────────

const STYLE = `
.sunny-voice { display:flex; flex-direction:column; gap:8px; padding:10px 12px;
  border-top:1px solid rgba(23,23,23,.07); background:var(--sunny-pale,#FFF1E5); font-size:13px; }
.sunny-voice p { margin:0; color:#3a3a3a; line-height:1.4; }
.sunny-voice .row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.sunny-voice button { border:0; border-radius:999px; padding:7px 14px; cursor:pointer; font:inherit;
  background:var(--sunny-accent-ink,#B04A00); color:#fff; }
.sunny-voice button.ghost { background:#fff; color:#171717; border:1px solid rgba(23,23,23,.2); }
.sunny-voice button:focus-visible { outline:2px solid #171717; outline-offset:2px; }
.sunny-voice .live { min-height:1.4em; color:#171717; font-style:italic; }
.sunny-voice .rec { width:10px; height:10px; border-radius:50%; background:#C62828; flex:0 0 auto; }
.sunny-voice[data-state="listening"] .rec { animation:sunny-rec 1.2s ease-in-out infinite; }
@keyframes sunny-rec { 50% { opacity:.25; } }
.composer .mic[aria-pressed="true"] { background:#C62828; }
@media (prefers-reduced-motion: reduce) { .sunny-voice .rec { animation:none !important; } }
`;

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text !== undefined) el.textContent = text;
  return el;
}

const STATE_LABEL: Record<VoiceUiState, string> = {
  consent: '',
  connecting: 'Connecting…',
  listening: 'Listening…',
  speaking: 'Sunny is speaking…',
  ended: 'Voice ended.',
};

/**
 * Show the consent bar in `before`'s place; start only after the visitor
 * agrees. Returns a controller that stops everything.
 */
export function mountVoice(before: HTMLElement, options: VoiceOptions): VoiceController {
  const root = before.getRootNode() as Document | ShadowRoot;
  if (!(root as ShadowRoot).querySelector?.('style[data-sunny-voice]')) {
    const style = node('style', { 'data-sunny-voice': '' });
    style.textContent = STYLE;
    (root instanceof Document ? root.head : root).append(style);
  }

  const bar = node('div', {
    class: 'sunny-voice',
    role: 'region',
    'aria-label': 'Voice conversation',
  });
  before.before(bar);

  let session: { stop(): void; mute(m: boolean): void; interrupt(): void } | null = null;
  let stopped = false;

  const finish = (reason: string): void => {
    if (stopped) return;
    stopped = true;
    session?.stop();
    bar.remove();
    options.onState('ended');
    options.onEnd(reason);
  };

  // Consent first: nothing touches the microphone until the visitor agrees.
  const consent = node(
    'p',
    {},
    `Talk to Sunny out loud. Your microphone is used only while this bar is open; your speech is sent to our AI ` +
      `service to reply, and a transcript is kept for ${options.companyName}. Sessions last up to 5 minutes.`,
  );
  const start = node('button', { type: 'button' }, 'Start talking');
  const cancel = node('button', { type: 'button', class: 'ghost' }, 'Not now');
  bar.append(consent, node('div', { class: 'row' }));
  bar.lastElementChild!.append(start, cancel);
  options.onState('consent');
  cancel.addEventListener('click', () => finish('declined'));
  start.focus();

  start.addEventListener('click', () => {
    bar.replaceChildren();
    const status = node('div', { class: 'row' });
    const rec = node('span', { class: 'rec', 'aria-hidden': 'true' });
    const label = node('span', { role: 'status', 'aria-live': 'polite' }, STATE_LABEL.connecting);
    status.append(rec, label);
    const live = node('p', { class: 'live', 'aria-live': 'polite' });
    const controls = node('div', { class: 'row' });
    const mute = node(
      'button',
      { type: 'button', class: 'ghost', 'aria-pressed': 'false' },
      'Mute',
    );
    const interrupt = node('button', { type: 'button', class: 'ghost' }, 'Stop Sunny talking');
    const end = node('button', { type: 'button' }, 'End voice');
    controls.append(mute, interrupt, end);
    bar.append(status, live, controls);

    const setState = (state: VoiceUiState): void => {
      bar.dataset.state = state;
      label.textContent = STATE_LABEL[state];
      options.onState(state);
    };
    setState('connecting');

    let muted = false;
    mute.addEventListener('click', () => {
      muted = !muted;
      mute.setAttribute('aria-pressed', String(muted));
      mute.textContent = muted ? 'Unmute' : 'Mute';
      session?.mute(muted);
    });
    interrupt.addEventListener('click', () => session?.interrupt());
    end.addEventListener('click', () => finish('stopped'));

    connect(options, {
      state: setState,
      caption: (role, text, final) => {
        live.textContent = final ? '' : text;
        options.onCaption(role, text, final);
      },
      notice: (text) => {
        live.textContent = text;
        speak(text);
      },
      end: (reason, text) => {
        if (text) speak(text);
        finish(reason);
      },
    })
      .then((s) => {
        session = s;
        if (stopped) s.stop();
      })
      .catch(() => {
        live.textContent = 'Voice could not start. Check microphone permission, or use the chat.';
        setTimeout(() => finish('error'), 3000);
      });
  });

  return { stop: () => finish('stopped') };
}

/** Deterministic speech for the server's fixed lines (safety, goodbye). */
function speak(text: string): void {
  try {
    if (!('speechSynthesis' in window) || !text) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-GB';
    window.speechSynthesis.speak(utterance);
  } catch {
    // No synthesis: the caption carries it.
  }
}

interface Sink {
  state(state: VoiceUiState): void;
  caption(role: 'user' | 'assistant', text: string, final: boolean): void;
  notice(text: string): void;
  end(reason: string, text: string): void;
}

const WORKLET = `class P extends AudioWorkletProcessor{process(i){const c=i[0]&&i[0][0];if(c)this.port.postMessage(c.slice(0));return true}}registerProcessor('sunny-mic',P)`;

async function connect(
  options: VoiceOptions,
  sink: Sink,
): Promise<{ stop(): void; mute(m: boolean): void; interrupt(): void }> {
  // Permission prompt happens here, after consent.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  const ctx = new AudioContext();
  const workletUrl = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
  await ctx.audioWorklet.addModule(workletUrl);
  URL.revokeObjectURL(workletUrl);
  const source = ctx.createMediaStreamSource(stream);
  const mic = new AudioWorkletNode(ctx, 'sunny-mic');
  source.connect(mic);

  const ws = new WebSocket(`${options.apiUrl.replace(/^http/, 'ws')}/v1/voice`);
  ws.binaryType = 'arraybuffer';
  let muted = false;
  let pending: Int16Array[] = [];
  let pendingLength = 0;
  let playhead = 0;
  const playing = new Set<AudioBufferSourceNode>();

  const stopPlayback = (): void => {
    for (const s of playing) {
      try {
        s.stop();
      } catch {
        // already stopped
      }
    }
    playing.clear();
    playhead = 0;
  };

  mic.port.onmessage = (event: MessageEvent<Float32Array>) => {
    if (muted || ws.readyState !== WebSocket.OPEN) return;
    const pcm = floatToPcm16k(event.data, ctx.sampleRate);
    pending.push(pcm);
    pendingLength += pcm.length;
    // ~40 ms frames: small enough for barge-in, big enough to be cheap.
    if (pendingLength >= 640) {
      const frame = new Int16Array(pendingLength);
      let offset = 0;
      for (const chunk of pending) {
        frame.set(chunk, offset);
        offset += chunk.length;
      }
      pending = [];
      pendingLength = 0;
      ws.send(frame.buffer);
    }
  };

  let torn = false;
  const teardown = (): void => {
    if (torn) return;
    torn = true;
    stopPlayback();
    mic.port.onmessage = null;
    source.disconnect();
    for (const track of stream.getTracks()) track.stop();
    void ctx.close();
  };

  ws.onopen = () => ws.send(JSON.stringify({ type: 'start', token: options.token }));
  ws.onmessage = (event: MessageEvent<ArrayBuffer | string>) => {
    if (typeof event.data !== 'string') {
      const samples = pcm16ToFloat(event.data);
      const buffer = ctx.createBuffer(1, samples.length, 24000);
      buffer.copyToChannel(samples, 0);
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(ctx.destination);
      playhead = Math.max(playhead, ctx.currentTime);
      node.start(playhead);
      playhead += buffer.duration;
      playing.add(node);
      node.onended = () => playing.delete(node);
      return;
    }
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(event.data) as Record<string, unknown>;
    } catch {
      return;
    }
    switch (message.type) {
      case 'state':
        if (message.state === 'listening' || message.state === 'speaking')
          sink.state(message.state);
        break;
      case 'caption':
        sink.caption(
          message.role === 'user' ? 'user' : 'assistant',
          captionText(message.text),
          message.final === true,
        );
        break;
      case 'clear':
        stopPlayback();
        break;
      case 'safety':
        stopPlayback();
        sink.notice(captionText(message.text));
        break;
      case 'ending':
        teardown();
        sink.end(captionText(message.reason) || 'ended', captionText(message.text));
        break;
      case 'error':
        teardown();
        sink.end('error', captionText(message.message));
        break;
      default:
        break;
    }
  };
  ws.onclose = () => {
    teardown();
    sink.end('closed', '');
  };

  return {
    stop() {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'stop' }));
      ws.close();
      teardown();
    },
    mute(m) {
      muted = m;
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'mute', muted: m }));
    },
    interrupt() {
      stopPlayback();
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'interrupt' }));
    },
  };
}
