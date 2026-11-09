'use client';

import type { KeyboardEvent } from 'react';

import type { FlowStep } from '../../../lib/portal-api.js';
import { choicesOf, effectShort, membersOf, nameOf, type Context, type Draft } from './model.js';

/**
 * The conversation drawn as boxes and lines, from the same draft as the list:
 * follow-ups branch off under the answer that opens them, and each answer's
 * price change sits on the line below its question ("Yes +£899"). Selecting a
 * box selects the question in the list. It mirrors the list; nothing is edited
 * here.
 */

const WIDTH = 240;
const PAD = 10;
const INDENT = 26;
const BOX = 40;
const BOX_WITH_NOTE = 54;
const GAP = 16;
const LINE = 15;
const CHAR = 6.4;

interface Node {
  id: string | null;
  label: string;
  note: string | null;
  depth: number;
  /** The answers that open this follow-up ("if Yes"). */
  when: string | null;
  /** Each answer's price changes, drawn on the line below the box. */
  effects: string[];
  y: number;
  height: number;
}

function clip(text: string, width: number): string {
  const max = Math.max(8, Math.floor(width / CHAR));
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function layout(draft: Draft, ctx: Context): { nodes: Node[]; height: number } {
  const nodes: Node[] = [];
  let y = PAD;
  const push = (node: Omit<Node, 'y' | 'height'>) => {
    const height = node.note ? BOX_WITH_NOTE : BOX;
    const top = y + (node.when ? LINE : 0);
    nodes.push({ ...node, y: top, height });
    y = top + height + GAP + node.effects.length * LINE;
  };

  // As Sunny asks them: a question, its group members, then its follow-ups.
  const visit = (step: FlowStep, depth: number, when: string | null) => {
    const choices = choicesOf(step, ctx);
    push({
      id: step.id,
      label: nameOf(step, ctx),
      note: null,
      depth,
      when,
      effects: choices.flatMap((c) =>
        c.effects.length > 0
          ? [`${c.label} ${c.effects.map((e) => effectShort(e, ctx)).join(', ')}`]
          : [],
      ),
    });
    for (const member of membersOf(step, draft, ctx)) visit(member, depth + 1, 'when it applies');
    for (const f of step.followUps ?? []) {
      const labels = f.when.map((w) => choices.find((c) => c.value === w)?.label ?? w);
      visit(f.step, depth + 1, `if ${labels.join(' or ')}`);
    }
  };

  push({
    id: null,
    label: 'Address and roof check',
    note: 'Always first',
    depth: 0,
    when: null,
    effects: [],
  });
  for (const step of draft.steps) visit(step, 0, null);
  push({
    id: null,
    label: 'Quote, consent and contact',
    note: 'Always last',
    depth: 0,
    when: null,
    effects: [],
  });
  return { nodes, height: y - GAP + PAD };
}

export function FlowDiagram({
  draft,
  ctx,
  selectedId,
  onSelect,
}: {
  draft: Draft;
  ctx: Context;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { nodes, height } = layout(draft, ctx);
  const spine = PAD + 14;
  const top = nodes[0]!;
  const last = nodes[nodes.length - 1]!;

  return (
    <svg
      className="flow-diagram"
      viewBox={`0 0 ${WIDTH} ${height}`}
      width={WIDTH}
      height={height}
      role="group"
      aria-label="The conversation, top to bottom"
    >
      <line className="flow-line" x1={spine} x2={spine} y1={top.y + top.height} y2={last.y} />
      {nodes.map((node, i) => {
        const x = PAD + node.depth * INDENT;
        const width = WIDTH - x - PAD;
        const selected = node.id !== null && node.id === selectedId;
        const parentX = PAD + (node.depth - 1) * INDENT + 14;
        const select = () => node.id && onSelect(node.id);
        const onKey = (event: KeyboardEvent) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            select();
          }
        };
        return (
          <g key={node.id ?? `fixed-${i}`}>
            {node.when ? (
              <>
                <path
                  className="flow-line"
                  d={`M ${parentX} ${node.y - LINE - GAP / 2} V ${node.y + node.height / 2} H ${x}`}
                />
                <text className="flow-when" x={x + 4} y={node.y - 4}>
                  {clip(node.when, width)}
                </text>
              </>
            ) : null}
            <g
              className="flow-box"
              data-fixed={node.id === null ? 'true' : undefined}
              data-selected={selected ? 'true' : undefined}
              {...(node.id
                ? {
                    'data-step-id': node.id,
                    role: 'button',
                    tabIndex: 0,
                    'aria-label': node.label,
                    'aria-pressed': selected,
                    onClick: select,
                    onKeyDown: onKey,
                  }
                : { 'aria-label': node.label, role: 'img' })}
            >
              <title>{node.label}</title>
              <rect x={x} y={node.y} width={width} height={node.height} rx={10} />
              <text className="flow-box-label" x={x + 12} y={node.y + 24}>
                {clip(node.label, width - 24)}
              </text>
              {node.note ? (
                <text className="flow-box-note" x={x + 12} y={node.y + 41}>
                  {node.note}
                </text>
              ) : null}
            </g>
            {node.effects.map((effect, j) => (
              <text
                key={j}
                className="flow-effect"
                x={x + 22}
                y={node.y + node.height + 12 + j * LINE}
              >
                {clip(effect, width - 22)}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}
