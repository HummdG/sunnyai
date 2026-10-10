import { chatStreamEventSchema, type ChatStreamEvent } from '@sunny/contracts';

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
      const event = chatStreamEventSchema.safeParse(parsed);
      if (!event.success) continue;
      this.#options.onEvent(event.data);
    }
  }
}
