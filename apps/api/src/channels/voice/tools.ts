import { registerAddonTool } from '../../agent/tools.js';
import { activeVoiceSessions } from './session.js';

/**
 * The voice add-on's tools (Blueprint §5 matrix: `transfer_to_human`,
 * `send_sms_link`). The core declares them and refuses them until this module
 * registers; the runners find the live call through the session registry, so a
 * tool can only ever act on the session it was called from.
 */
let registered = false;

export function registerVoiceTools(): void {
  if (registered) return;
  registered = true;

  registerAddonTool('transfer_to_human', async (args, ctx) => {
    const session = activeVoiceSessions.get(ctx.sessionId);
    if (!session || session.tenantId !== ctx.tenant.id) {
      return {
        ok: false,
        data: { error: 'There is no live call to transfer.' },
        summary: 'There was no call to transfer.',
      };
    }
    const reason = typeof args.reason === 'string' ? args.reason.slice(0, 200) : 'caller request';
    const result = await session.transfer(reason);
    return {
      ok: result.ok,
      data: { note: result.note },
      summary: result.ok ? 'I transferred the call.' : 'I could not transfer the call.',
    };
  });

  registerAddonTool('send_sms_link', async (args, ctx) => {
    const session = activeVoiceSessions.get(ctx.sessionId);
    if (!session || session.tenantId !== ctx.tenant.id) {
      return {
        ok: false,
        data: { error: 'Texting is only available on a live phone call.' },
        summary: 'I could not send a text.',
      };
    }
    const purpose = args.purpose === 'quote_request' ? 'quote_request' : 'book_survey';
    const result = await session.sendSms(purpose);
    return {
      ok: result.ok,
      data: { note: result.note },
      summary: result.ok ? 'I sent the caller a link by text.' : 'I could not send a text.',
    };
  });
}

/** For tests: allow registration again after `resetAddonTools()`. */
export function resetVoiceToolRegistration(): void {
  registered = false;
}
