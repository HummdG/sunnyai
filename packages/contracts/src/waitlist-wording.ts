/**
 * What a person agrees to when they join the waitlist (`waitlist.ts`).
 *
 * Versioned exactly as lead consent is (`consent.ts`): a new wording is a new
 * key, never an edit under an old one, so an entry's version can always be
 * turned back into the sentence they saw. No imports, so the website's form can
 * use it directly (`@sunny/contracts/waitlist-wording`).
 */
export const WAITLIST_CONSENT_WORDINGS = {
  '2026-10-21':
    'Email me when Sunny is ready for my business. I can ask to be removed at any time.',
} as const;

export type WaitlistConsentVersion = keyof typeof WAITLIST_CONSENT_WORDINGS;

export const WAITLIST_CONSENT_VERSION: WaitlistConsentVersion = '2026-10-21';
