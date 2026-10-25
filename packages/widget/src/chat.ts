import type { ChatStreamEvent } from '@sunny/contracts';

/**
 * The page actions the stream may suggest -- the contracts' `PAGE_ACTIONS`,
 * repeated here so the widget imports nothing from `@sunny/contracts` at
 * runtime (any runtime import pulls in zod and every schema, about a sixth of
 * the bundle). A unit test pins the two lists together.
 */
export const PAGE_ACTIONS = ['highlight', 'scroll', 'navigate', 'focus', 'open_panel'] as const;

/** The contracts' `SUNSCAN_STATUSES`, repeated for the same reason; pinned by a test. */
export const SUNSCAN_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'low-confidence',
  'failed',
] as const;

const isStr = (v: unknown): v is string => typeof v === 'string';

/**
 * A structural check of one stream event, standing in for the contract's zod
 * schema. It checks every field the widget reads; anything else is dropped.
 * The widget renders all text with `textContent`, so this guards shape, not
 * markup.
 */
export function parseStreamEvent(value: unknown): ChatStreamEvent | null {
  if (typeof value !== 'object' || value === null) return null;
  const e = value as Record<string, unknown>;
  if (!isStr(e['type']) || !isStr(e['messageId'])) return null;
  switch (e['type']) {
    case 'message_started':
    case 'done':
      break;
    case 'text_delta':
      if (!isStr(e['text'])) return null;
      break;
    case 'tool_started':
    case 'tool_finished':
      if (!isStr(e['tool'])) return null;
      break;
    case 'recommendation_ready':
      if (!isStr(e['recommendationId'])) return null;
      break;
    case 'lead_saved':
      if (!isStr(e['leadId'])) return null;
      break;
    case 'handoff_requested':
      if (!isStr(e['reason'])) return null;
      break;
    case 'page_action_suggested':
      if (!(PAGE_ACTIONS as readonly unknown[]).includes(e['action']) || !isStr(e['target'])) {
        return null;
      }
      break;
    case 'sources': {
      const list = e['sources'];
      if (
        !Array.isArray(list) ||
        !list.every(
          (s: Record<string, unknown>) =>
            typeof s === 'object' &&
            s !== null &&
            isStr(s['ref']) &&
            isStr(s['title']) &&
            (s['url'] === null || isStr(s['url'])),
        )
      ) {
        return null;
      }
      break;
    }
    case 'disclaimer':
      if (!isStr(e['text'])) return null;
      break;
    case 'escalation':
      if (e['kind'] !== 'safety') return null;
      break;
    case 'quick_replies': {
      const replies = e['replies'];
      if (
        typeof e['multi'] !== 'boolean' ||
        !Array.isArray(replies) ||
        replies.length > 12 ||
        !replies.every(
          (r: Record<string, unknown>) =>
            typeof r === 'object' && r !== null && isStr(r['value']) && isStr(r['label']),
        )
      ) {
        return null;
      }
      break;
    }
    case 'sunscan': {
      const summary = e['summary'];
      if (
        !isStr(e['assessmentId']) ||
        !(SUNSCAN_STATUSES as readonly unknown[]).includes(e['status']) ||
        (summary !== null &&
          (typeof summary !== 'object' ||
            !isStr((summary as Record<string, unknown>)['address']) ||
            !Array.isArray((summary as Record<string, unknown>)['roofPlanes'])))
      ) {
        return null;
      }
      break;
    }
    case 'quote': {
      const q = e['quote'] as Record<string, unknown> | null;
      const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
      const numOrNull = (v: unknown) => v === null || isNum(v);
      if (
        typeof q !== 'object' ||
        q === null ||
        !isStr(q['quoteId']) ||
        !isStr(q['disclaimer']) ||
        typeof q['priced'] !== 'boolean' ||
        !Array.isArray(q['options']) ||
        q['options'].length > 3 ||
        !q['options'].every(
          (o: Record<string, unknown>) =>
            typeof o === 'object' &&
            o !== null &&
            isStr(o['id']) &&
            isStr(o['label']) &&
            isStr(o['headline']) &&
            isStr(o['priceLabel']) &&
            typeof o['isRecommended'] === 'boolean' &&
            isNum(o['panelCount']) &&
            isNum(o['systemKwp']) &&
            isNum(o['annualGenerationKwh']) &&
            isNum(o['annualSavingsGbp']) &&
            numOrNull(o['priceGbp']) &&
            numOrNull(o['paybackYears']) &&
            (o['batteryType'] === null || isStr(o['batteryType'])) &&
            (o['aboveBudget'] === undefined || typeof o['aboveBudget'] === 'boolean') &&
            (o['roofLimited'] === undefined || typeof o['roofLimited'] === 'boolean') &&
            (o['installerPriced'] === undefined ||
              (Array.isArray(o['installerPriced']) && o['installerPriced'].every(isStr))),
        )
      ) {
        return null;
      }
      break;
    }
    case 'message_finished':
      break;
    case 'error':
      if (!isStr(e['code']) || !isStr(e['message'])) return null;
      break;
    default:
      return null;
  }
  return e as unknown as ChatStreamEvent;
}

/**
 * The client half of the streaming contract.
 *
 * Two things this deliberately does not do:
 *
 *   - It never trusts the shape of a frame. Every parsed event goes through the
 *     contract schema, and an unrecognised frame is dropped. The stream crosses
 *     a network and is assembled from many small chunks; treating it as trusted
 *     input is how a malformed frame becomes an unhandled exception inside a
 *     customer's page.
 *   - It never reads a script, selector or URL out of the stream. The only
 *     server-supplied value that reaches the DOM is a page-action *target name*,
 *     which the widget resolves against its own allow-list.
 */

export interface ChatClientOptions {
  apiUrl: string;
  sessionToken: string;
  sessionId: string;
  onEvent: (event: ChatStreamEvent) => void;
  onError: (error: Error) => void;
  onFinish: () => void;
}

export class ChatClient {
  #options: ChatClientOptions;
  #controller: AbortController | null = null;

  constructor(options: ChatClientOptions) {
    this.#options = options;
  }

  get busy(): boolean {
    return this.#controller !== null;
  }

  /** Stop an in-flight turn. Called when the visitor closes the panel. */
  cancel(): void {
    this.#controller?.abort();
    this.#controller = null;
  }

  /**
   * Send a message and stream the reply.
   *
   * `clientMessageId` is the idempotency key: a retry after a dropped
   * connection reuses it, so the server does not record the visitor's question
   * twice.
   */
  async send(text: string, clientMessageId: string): Promise<void> {
    this.cancel();
    const controller = new AbortController();
    this.#controller = controller;

    try {
      const response = await fetch(`${this.#options.apiUrl}/v1/chat/stream`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.#options.sessionToken}`,
        },
        body: JSON.stringify({
          sessionId: this.#options.sessionId,
          clientMessageId,
          text,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        // The error envelope is the only thing we can rely on here, and even
        // that may be missing if something upstream answered instead of us.
        let message = `The assistant is unavailable (${response.status}).`;
        try {
          const body = (await response.json()) as { error?: { message?: string } };
          if (body.error?.message) message = body.error.message;
        } catch {
          /* keep the status-based message */
        }
        throw new Error(message);
      }
      if (!response.body) throw new Error('The assistant returned an empty response.');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by a blank line. Whatever follows the last
        // separator is an incomplete frame and stays in the buffer.
        let boundary = buffer.indexOf('\n\n');
        while (boundary !== -1) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          this.#handleFrame(frame);
          boundary = buffer.indexOf('\n\n');
        }
      }
      this.#options.onFinish();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      this.#options.onError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      if (this.#controller === controller) this.#controller = null;
    }
  }

  #handleFrame(frame: string): void {
    for (const line of frame.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '') continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch {
        // A frame we cannot parse is dropped, not thrown: one bad frame must
        // not take down a conversation that is otherwise working.
        continue;
      }
      const event = parseStreamEvent(parsed);
      if (event) this.#options.onEvent(event);
    }
  }
}
