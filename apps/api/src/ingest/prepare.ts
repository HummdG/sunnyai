import { createHash } from 'node:crypto';

import type { KnowledgeIssue } from '@sunny/contracts';
import {
  chunkWithReport,
  findPlaceholders,
  scanForPii,
  type PlaceholderFinding,
} from '@sunny/knowledge';

/**
 * The checks every document passes before it may be indexed, wherever it came
 * from: an upload, a crawled page or a Drive file. One function, so the three
 * paths cannot drift apart on what "safe to quote" means.
 *
 *   1. PII (Blueprint §4.5): quarantine anything holding a person's financial or
 *      identity data, or that reads like one customer's bill or contract; mask
 *      low-risk details (a private email, a mobile number).
 *   2. Placeholders: report unfilled template text to the installer, with the
 *      section it sits in. The chunks carry the marks and retrieval masks them.
 *   3. Chunking: a document that yields no passages is refused, not stored.
 */

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export type PrepareOutcome =
  | {
      verdict: 'index';
      /** The text to store: the original, or with low-risk personal details masked. */
      text: string;
      contentHash: string;
      chunks: number;
      issues: KnowledgeIssue[];
      warnings: PlaceholderFinding[];
    }
  | {
      verdict: 'quarantine' | 'empty';
      issues: KnowledgeIssue[];
    };

export interface PrepareOptions {
  id: string;
  title: string;
  url: string | null;
  version: string;
  /** The installer's own domains, whose email addresses are not personal data. */
  businessDomains?: readonly string[];
}

export function prepareDocument(raw: string, options: PrepareOptions): PrepareOutcome {
  const issues: KnowledgeIssue[] = [];
  const pii = scanForPii(raw, { businessDomains: options.businessDomains ?? [] });
  if (pii.verdict === 'quarantine') {
    return {
      verdict: 'quarantine',
      issues: [
        {
          code: 'quarantined-pii',
          severity: 'error',
          message: `"${options.title}" was not indexed.`,
          detail: pii.reason,
        },
      ],
    };
  }
  const text = pii.redacted;
  if (pii.verdict === 'redact') {
    issues.push({
      code: 'pii-redacted',
      severity: 'warning',
      message: `"${options.title}": personal details were masked before indexing.`,
      detail: pii.reason,
    });
  }

  const { chunks, emptySections } = chunkWithReport({
    id: options.id,
    title: options.title,
    url: options.url,
    version: options.version,
    text,
  });
  if (chunks.length === 0) {
    return {
      verdict: 'empty',
      issues: [
        {
          code: 'empty-document',
          severity: 'error',
          message: `"${options.title}" contained no text that could be indexed.`,
          detail: 'Nothing was stored. The assistant would have nothing to quote from.',
        },
      ],
    };
  }
  if (emptySections > 0) {
    issues.push({
      code: 'empty-section',
      severity: 'warning',
      message: `${emptySections} heading(s) in "${options.title}" had no text directly under them.`,
      detail:
        'Headings with no body are kept out of the index. Check the conversion if that is unexpected.',
    });
  }

  const warnings = findPlaceholders(text);
  if (warnings.length > 0) {
    const sample = [...new Set(warnings.map((w) => w.text))].slice(0, 3).join('", "');
    issues.push({
      code: 'placeholder',
      severity: 'warning',
      message: `"${options.title}" has ${warnings.length} unfilled placeholder(s), e.g. "${sample}".`,
      detail:
        'The assistant will never quote these; it says the detail has not been provided instead. Fill them in and sync again.',
    });
  }

  return {
    verdict: 'index',
    text,
    contentHash: sha256(text),
    chunks: chunks.length,
    issues,
    warnings,
  };
}
