import { describe, expect, it } from 'vitest';

import { richBlocks, richRuns } from '../lib/rich-text.js';

describe('inbox reply formatting', () => {
  it('shows a Markdown link as a link and drops source markers', () => {
    const blocks = richBlocks(
      'Read the [FoxESS Battery Reset Guide](https://hsenergy.co.uk/g.pdf) for steps [S6, S7].',
    );
    expect(blocks).toEqual([
      {
        kind: 'p',
        runs: [
          { kind: 'text', text: 'Read the ' },
          {
            kind: 'link',
            text: 'FoxESS Battery Reset Guide',
            href: 'https://hsenergy.co.uk/g.pdf',
          },
          { kind: 'text', text: ' for steps.' },
        ],
      },
    ]);
  });

  it('keeps lists and paragraphs', () => {
    const blocks = richBlocks(
      'Try this:\n\n1. Open the app\n2. Check the **mode**\n\nThanks [S1].',
    );
    expect(blocks.map((b) => b.kind)).toEqual(['p', 'ol', 'p']);
    const list = blocks[1] as Extract<(typeof blocks)[number], { kind: 'ol' }>;
    expect(list.items[1]).toContainEqual({ kind: 'bold', text: 'mode' });
  });

  it('never makes a link out of anything but http and https', () => {
    expect(richRuns('[x](javascript:alert(1))').every((run) => run.kind !== 'link')).toBe(true);
  });
});
