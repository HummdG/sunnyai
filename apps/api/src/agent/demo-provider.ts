import type { ChatChunk, ChatProvider, ChatToolCall, ChatTurnRequest } from './provider.js';

/**
 * A scripted assistant for demos and local walk-throughs, used only when no
 * Gemini key is configured and `SUNNY_DEMO_ASSISTANT=1` is set (refused in
 * production by `main.ts`).
 *
 * It is not a language model. It drives the REAL quote journey through the
 * same tools the model would call -- the SunScan roof engine, the versioned
 * questionnaire with its deterministic answer extraction, and the installer's
 * price list -- and phrases each step from fixed templates. Everything it
 * shows (roof figures, questions, prices) comes from those tools, so the demo
 * exercises the product rather than imitating it.
 */
export class DemoProvider implements ChatProvider {
  readonly kind = 'demo-scripted';
  readonly model = 'scripted-demo';

  async *stream(request: ChatTurnRequest): AsyncIterable<ChatChunk> {
    const available = new Set(request.tools.map((t) => t.name));
    const results: Record<string, unknown>[] = [];

    async function* call(
      name: string,
      args: Record<string, unknown>,
    ): AsyncGenerator<ChatChunk, Record<string, unknown> | null> {
      if (!available.has(name)) return null;
      const chatCall: ChatToolCall = { name, args };
      yield { type: 'tool_started', call: chatCall };
      try {
        const result = (await request.execute(chatCall)) as Record<string, unknown>;
        results.push(result);
        yield { type: 'tool_finished', call: chatCall, ok: true, result };
        return result;
      } catch {
        yield { type: 'tool_finished', call: chatCall, ok: false };
        return null;
      }
    }

    // The core engine hands the model the guardrail sandwich; the visitor's own
    // words are the escaped text inside <user_query>.
    const message = visitorText(request.message);
    const journey = yield* call('get_quote_journey', {});
    if (!journey) {
      yield text("I'm running in demo mode, which only covers the roof check and quote.");
      return;
    }

    const needsAddress = journey['nextQuestionId'] === 'address' || journey['stage'] === 'address';

    if (needsAddress) {
      if (!looksLikeAddress(message)) {
        yield text(
          "Hi! I can measure your roof in 3D and put together a quote. What's the address, " +
            'including the postcode?',
        );
        return;
      }
      yield* call('save_answers', {
        answers: [{ questionId: 'address', value: message }],
        visitorMessage: message,
      });
      const started = yield* call('start_sunscan_assessment', { address: message });
      if (!started || started['ok'] === false) {
        yield text(
          `I couldn't measure that roof just now (${str(started?.['note']) || 'no result'}). ` +
            'Could you check the address and postcode?',
        );
        return;
      }
      const next = yield* call('get_quote_journey', {});
      yield text(`Lovely, I've measured your roof in 3D. ${ask(next)}`);
      return;
    }

    if (journey['readyForQuote'] === true) {
      yield* quote(call);
      return;
    }

    const saved = yield* call('save_answers', { answers: [], visitorMessage: message });
    if (!saved) {
      yield text(`Sorry, something went wrong saving that. ${ask(journey)}`);
      return;
    }
    if (saved['readyForQuote'] === true) {
      yield* quote(call);
      return;
    }
    const got =
      Array.isArray(saved['saved']) &&
      saved['saved'].length > 0 &&
      saved['nextQuestionId'] !== journey['nextQuestionId'];
    yield text(got ? `Got it. ${ask(saved)}` : `Sorry, I didn't quite catch that. ${ask(saved)}`);

    async function* quote(run: typeof call): AsyncGenerator<ChatChunk, void> {
      const q = yield* run('get_quote_options', {});
      if (!q || q['ok'] === false) {
        yield text(`I need a little more first. ${ask(q ?? journey ?? {})}`);
        return;
      }
      const options = Array.isArray(q['options'])
        ? (q['options'] as Record<string, unknown>[])
        : [];
      const best = options.find((o) => o['recommended'] === true) ?? options[options.length - 1];
      const label = (best && str(best['label'])) || 'the recommended option';
      yield text(
        `Here are three options for your home. I'd suggest ${label}. The details are on the ` +
          'cards. All figures are indicative and subject to an on-site survey. Would you like ' +
          'someone from the team to get in touch to book one?',
      );
    }
  }
}

/** The visitor's words from the guardrail sandwich, unescaped. */
function visitorText(message: string): string {
  const match = /<user_query>([\s\S]*?)<\/user_query>/.exec(message);
  const raw = match ? (match[1] ?? '') : message;
  return raw.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
}

/** A string or number as text; anything else as empty. */
function str(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function text(value: string): ChatChunk {
  return { type: 'text', text: value };
}

/** The next question, with its options when the questionnaire has them. */
function ask(view: Record<string, unknown> | null): string {
  if (!view) return 'What else can I help with?';
  const prompt = typeof view['ask'] === 'string' ? view['ask'] : null;
  if (!prompt) return 'What else can I help with?';
  const options = Array.isArray(view['options']) ? (view['options'] as unknown[]) : [];
  const names =
    typeof view['optionLabels'] === 'object' && view['optionLabels'] !== null
      ? (view['optionLabels'] as Record<string, unknown>)
      : {};
  const labels = options
    .map((o) => str(names[str(o)]) || str(o).replace(/_/g, ' '))
    .filter((l) => l !== '');
  return labels.length > 0 && labels.length <= 8 ? `${prompt} (${labels.join(', ')})` : prompt;
}

/** A UK postcode, or a house number followed by a street name. */
function looksLikeAddress(message: string): boolean {
  return (
    /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i.test(message) ||
    /\b\d+[a-z]?\s+[A-Za-z]+\s+(road|street|st|avenue|ave|lane|drive|close|way|crescent|grove|place|walk|terrace)\b/i.test(
      message,
    )
  );
}
