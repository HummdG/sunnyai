import type { ReactNode } from 'react';

import { richBlocks, type RichRun } from '../../lib/rich-text.js';

function runs(list: RichRun[]): ReactNode[] {
  return list.map((run, index) => {
    if (run.kind === 'bold') return <strong key={index}>{run.text}</strong>;
    if (run.kind === 'link') {
      return (
        <a key={index} href={run.href} target="_blank" rel="noopener noreferrer">
          {run.text}
        </a>
      );
    }
    return <span key={index}>{run.text}</span>;
  });
}

/** An assistant reply formatted as the visitor saw it (links, lists, bold; no source markers). */
export function RichReply({ text }: { text: string }) {
  return (
    <div className="rich-reply">
      {richBlocks(text).map((block, index) => {
        if (block.kind === 'p') return <p key={index}>{runs(block.runs)}</p>;
        const items = block.items.map((item, i) => <li key={i}>{runs(item)}</li>);
        return block.kind === 'ul' ? <ul key={index}>{items}</ul> : <ol key={index}>{items}</ol>;
      })}
    </div>
  );
}
