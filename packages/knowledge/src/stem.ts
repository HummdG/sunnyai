/**
 * A word's root, for matching only: "accountant", "accounts" and "accounting"
 * all become "account", so a visitor who asks for the accountant reaches the
 * page that lists the Accounts team.
 *
 * Deliberately small and conservative rather than a full stemmer. One suffix
 * is removed at most, only from words of five letters or more, and only when at
 * least four letters remain, so short words ("plant", "power", "string") are
 * left alone. Anything with a digit is a part number and is never touched. It
 * is English-only; other languages pass through mostly unchanged, which costs
 * nothing.
 */

/** Longest first: the first that fits wins. `to` replaces the suffix. */
const SUFFIXES: ReadonlyArray<{ from: string; to: string }> = [
  { from: 'ations', to: '' },
  { from: 'ation', to: '' },
  { from: 'ements', to: '' },
  { from: 'ement', to: '' },
  { from: 'ments', to: '' },
  { from: 'ment', to: '' },
  { from: 'ances', to: '' },
  { from: 'ance', to: '' },
  { from: 'ings', to: '' },
  { from: 'ing', to: '' },
  { from: 'ants', to: '' },
  { from: 'ant', to: '' },
  { from: 'ers', to: '' },
  { from: 'er', to: '' },
  { from: 'ies', to: 'y' },
  { from: 'sses', to: 'ss' },
  { from: 'shes', to: 'sh' },
  { from: 'ches', to: 'ch' },
  { from: 'xes', to: 'x' },
  { from: 'ed', to: '' },
  { from: 's', to: '' },
];

/** Endings where a final "s" is part of the word, not a plural. */
const KEEPS_S = /(ss|us|is)$/;
/** Doubled letters a suffix can leave behind ("plann" from "planning"). */
const DOUBLED = /([bdgmnprt])\1$/;

export function stem(word: string): string {
  if (word.length < 5 || !/^[a-z]+$/.test(word)) return word;
  let root = word;
  for (const { from, to } of SUFFIXES) {
    if (!word.endsWith(from)) continue;
    if (from === 's' && KEEPS_S.test(word)) break;
    const candidate = word.slice(0, word.length - from.length) + to;
    if (candidate.length < 4) continue;
    root = candidate;
    break;
  }
  root = root.replace(DOUBLED, '$1');
  // A silent final "e": "price", "priced" and "pricing" share "pric".
  if (root.length > 4 && root.endsWith('e')) root = root.slice(0, -1);
  return root;
}
