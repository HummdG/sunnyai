import { describe, expect, it } from 'vitest';

import { inlineRuns, plainReply } from '../src/rich.js';

describe('reply formatting', () => {
  it('turns a Markdown link into a link, keeping the words around it', () => {
    const runs = inlineRuns(
      'See the [FoxESS Battery Reset Guide](https://hsenergy.co.uk/wp-content/uploads/2026/05/02-Battery-Reset-Guide.pdf) for steps.',
    );
    expect(runs).toEqual([
      { kind: 'text', text: 'See the ' },
      {
        kind: 'link',
        text: 'FoxESS Battery Reset Guide',
        href: 'https://hsenergy.co.uk/wp-content/uploads/2026/05/02-Battery-Reset-Guide.pdf',
      },
      { kind: 'text', text: ' for steps.' },
    ]);
  });

  it('links a bare web address and leaves the full stop after it outside', () => {
    const runs = inlineRuns('Visit https://hsenergy.co.uk/support.');
    expect(runs).toEqual([
      { kind: 'text', text: 'Visit ' },
      {
        kind: 'link',
        text: 'https://hsenergy.co.uk/support',
        href: 'https://hsenergy.co.uk/support',
      },
      { kind: 'text', text: '.' },
    ]);
  });

  it('never links anything but http and https', () => {
    const runs = inlineRuns('[click me](javascript:alert(1)) and [x](data:text/html,hi)');
    expect(runs.every((run) => run.kind !== 'link')).toBe(true);
  });

  it('keeps bold working alongside links', () => {
    const runs = inlineRuns('**Call us** or read [the guide](https://example.com/g).');
    expect(runs[0]).toEqual({ kind: 'bold', text: 'Call us' });
    expect(runs.some((run) => run.kind === 'link' && run.href === 'https://example.com/g')).toBe(
      true,
    );
  });

  it('drops single and grouped source markers from the prose', () => {
    expect(plainReply('Steps here [S6, S7]. Call us [S4].')).toBe('Steps here. Call us.');
  });
});
