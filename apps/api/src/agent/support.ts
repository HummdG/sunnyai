import type { Tenant } from '../tenants.js';
import type { Channel } from './channels.js';

/**
 * Post-install customer support (owner's `Knowledge Base.pdf`, fixture at
 * `fixtures/knowledge/support-knowledge-base.md`).
 *
 * Sunny serves existing customers as well as prospects. Three things here are
 * deterministic rather than left to the model:
 *
 * 1. **Safety triage** runs before the model. A message about smoke, fire,
 *    sparks, a burning smell, exposed wiring or a shock gets a fixed reply from
 *    the server, an escalation for the installer's inbox, and no model call at
 *    all -- a safety answer must not depend on a model choosing well (§13).
 * 2. **The support line** -- the document's escalation sentence -- is built
 *    from the tenant's configured contact. The document's `XXXXX XXXXXX` is a
 *    placeholder and is never shown; with no contact configured the visitor is
 *    told to contact the installer directly.
 * 3. **Placeholder guard**: any `XXXX`-style placeholder the model produces
 *    (from a knowledge base that was published without being filled in) is
 *    replaced before it reaches a visitor, including mid-stream.
 */

export type Intent = 'sales' | 'support';

// ─── safety triage ───────────────────────────────────────────────────────────

/**
 * Hazard phrasings. Deliberately specific: "fire" alone also matches "fire
 * away" and "a real fireball of a salesman", so the patterns look for the
 * physical event. A false positive costs a visitor one careful reply and a
 * flagged conversation; a false negative is the failure this exists to stop,
 * so the list errs wide within that.
 */
const SAFETY_PATTERNS: readonly RegExp[] = [
  /\bsmok(e|es|ing|y)\b/i,
  /\b(on fire|caught fire|catch(ing)? fire|a fire|fire (in|from|on|at|coming)|flames?|flaming)\b/i,
  /\bburn(ing|t)?\b[^.?!]{0,30}\b(smell|smells|smelling|odou?r)\b/i,
  /\b(smell|smells|smelling|odou?r)\b[^.?!]{0,30}\bburn(ing|t)?\b/i,
  /\bspark(s|ing|ed|y)?\b/i,
  /\b(exposed|bare|loose|melted|damaged)\s+(wires?|wiring|cables?|cabling)\b/i,
  /\b(electric(al|ity)?\s+shock|got a shock|shocked me|electrocut\w*)\b/i,
  /\b(melt(ing|ed)|scorch(ed|ing|marks?)?|charred)\b/i,
  /\b(buzzing|crackling)\b[^.?!]{0,30}\b(inverter|battery|panel|isolator|consumer unit|fuse ?box)\b/i,
];

export function detectSafetyConcern(text: string): boolean {
  return SAFETY_PATTERNS.some((pattern) => pattern.test(text));
}

/** The escalation sentence from the document, with the tenant's real contact. */
export function supportLine(tenant: Tenant): string {
  // The installer's phone number (owner decision, 2026-10-12). Without one the
  // visitor is sent to the installer directly -- never shown the placeholder.
  const contact = tenant.config.supportContact;
  const phone = contact?.phone?.trim();
  if (!phone) {
    return `I'm unable to help with this issue, please contact ${tenant.config.companyName} directly for further assistance.`;
  }
  const hours = contact?.hours ? ` (${contact.hours})` : '';
  return `I'm unable to help with this issue, please reach out on ${phone}${hours} for further assistance.`;
}

/**
 * The fixed safety reply (§13 "Safety concerns"). Never model-written. Voice
 * gets a shorter form because the voice channel's 40-word rule would otherwise
 * cut the instruction that matters.
 */
export function safetyResponse(tenant: Tenant, channel: Channel): string {
  if (channel === 'voice') {
    return "That could be a safety issue. Please don't touch or restart the equipment and keep away from it. If anyone is in danger, call 999 now.";
  }
  return [
    'This sounds like it could be a safety issue.',
    "Please don't try to troubleshoot, switch off or restart the equipment yourself, and keep away from it.",
    'If there is smoke, fire or sparks, or anyone is in immediate danger, call 999 now.',
    supportLine(tenant),
  ].join(' ');
}

// ─── intent ──────────────────────────────────────────────────────────────────

/**
 * The support topics in the document (§1-§13). Matching any of them marks the
 * turn as support for the installer's inbox; it does not change which tools
 * exist, because a support customer can still ask for a callback.
 */
const SUPPORT_PATTERNS: readonly RegExp[] = [
  /\b(offline|not (showing|updating|connecting)|disconnected)\b/i,
  /\b(log ?in|sign ?in|password|account|monitoring app|the app)\b/i,
  /\b(data ?logger|logger|wi-?fi|router)\b/i,
  /\b(tariff|octopus|flux|agile|import rate)\b/i,
  /\b(charging (periods?|times?|schedule)|charge times?|force charge)\b/i,
  /\b(seg|smart export|export payments?|paid for (the )?(electricity|energy) i export)\b/i,
  /\b(shut ?down|turn (it )?off|restart|reboot|reset)\b/i,
  /\b(diverter|immersion|hot water)\b/i,
  /\b(grid (fault|alarm|error)|error code|fault code|alarm|tripped|fuse)\b/i,
  /\b(clean(ing)?|maintenance|service visit|bird|pigeon)\b/i,
  /\b(battery (not|isn'?t|won'?t|has no)|no lights|not responding|not charging|not discharging)\b/i,
  /\b(generation|generating|output) (has )?(dropped|is (lower|down)|changed|low)\b/i,
  /\b(my (system|inverter|panels|battery)|since (you|it was) installed)\b/i,
];

export function classifyIntent(text: string): Intent {
  return SUPPORT_PATTERNS.some((pattern) => pattern.test(text)) ? 'support' : 'sales';
}

/** The rules for support conversations, appended to the system instructions. */
export function supportRules(tenant: Tenant): string {
  return [
    'Support conversations (existing customers):',
    '- Start with the customer-facing answer from <verified_context>, then ask only the follow-up questions you need: manufacturer and model, the monitoring app, any error code, a brief description.',
    '- Identify the equipment manufacturer (and model where it matters) before giving any equipment-specific steps.',
    '- When the manufacturer is identified and <verified_context> or retrieve_knowledge holds a procedure for that manufacturer, walk the customer through it one step at a time, including its prerequisites (for example Bluetooth on, mobile data off) and its "if it fails" escalation.',
    "- Never apply one brand's procedure to another brand. With no procedure for their manufacturer, route them to the manufacturer instead.",
    '- Do not diagnose faults beyond what the knowledge base says.',
    '- Safety always wins over any procedure: never tell anyone to open the inverter or any enclosure, remove covers, handle wiring, bypass components, test equipment or touch anything during an inspection.',
    '- Route: account, app, configuration and fault codes to the equipment manufacturer; missing documents, physical damage and installation issues to the installer; tariffs, SEG and export payments to the energy supplier.',
    '- Never give personalised tariff or financial advice; explain the general options and send them to their supplier.',
    '- Seasonal generation figures are general guidance, never a diagnosis of their system.',
    `- When you cannot help, say: "${supportLine(tenant)}"`,
    '- You may still offer a callback or record their details, with their agreement.',
  ].join('\n');
}

// ─── placeholder guard ───────────────────────────────────────────────────────

/** `XXXXX XXXXXX`, `XXXX-XXX`, `[XXXX]`, `[phone number]`-style fillers. */
const PLACEHOLDER =
  /\[?\bX{3,}(?:[\s-]+X{2,})*\b\]?|\[(?:phone|telephone|number|email|contact)[^\]]{0,20}\]/gi;

function contactFor(tenant: Tenant): string {
  return tenant.config.supportContact?.phone?.trim() || `${tenant.config.companyName} directly`;
}

export function stripPlaceholders(text: string, tenant: Tenant): string {
  return text.replace(PLACEHOLDER, contactFor(tenant));
}

/**
 * The same guard over a stream. A placeholder can be split across deltas
 * ("XXX" then "XX XXXXXX"), so a trailing run that could still grow into one
 * is held back until the next delta -- or the end -- decides it.
 */
export class PlaceholderGuard {
  #pending = '';
  readonly #tenant: Tenant;

  constructor(tenant: Tenant) {
    this.#tenant = tenant;
  }

  push(delta: string): string {
    const text = this.#pending + delta;
    const hold = /(?:\[?X[X\s-]*|\[[a-z ]{0,25})$/i.exec(text);
    const cut = hold ? hold.index : text.length;
    this.#pending = text.slice(cut);
    return stripPlaceholders(text.slice(0, cut), this.#tenant);
  }

  flush(): string {
    const rest = stripPlaceholders(this.#pending, this.#tenant);
    this.#pending = '';
    return rest;
  }
}
