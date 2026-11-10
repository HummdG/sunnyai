/**
 * Where the flow canvas draws everything, computed from the draft alone (no
 * diagram library). The canvas may pass in text widths measured with the real
 * font and the boxes' drawn heights; without them, widths and heights are
 * estimated from the text.
 *
 * The listed questions sit on a vertical spine between the locked start (when
 * there is one) and end. Group members and follow-ups branch to the right, one column per
 * level, each on a short curve carrying a pill that names the answer that
 * opens it (and what that answer does to the price). An answer that changes
 * the price but opens nothing shows its pill on a stub under its box.
 *
 * Boxes never overlap: a level's column starts just right of the widest
 * parent-plus-pill of the level before, and in a column every box starts
 * below the whole block (box, stubs, branches) above it.
 */

import type { FlowStep } from '../../../lib/portal-api.js';
import {
  choicesOf,
  effectsShort,
  membersOf,
  nameOf,
  tagOf,
  type ChoiceView,
  type Context,
  type Draft,
} from './model.js';

export type NodeTone = 'sunny' | 'quote' | 'lead';

export interface FlowNode {
  /** The step id, or `start` / `end` for the locked boxes. */
  key: string;
  /** Null for the locked start and end. */
  stepId: string | null;
  kind: 'fixed' | 'top' | 'branch';
  label: string;
  tag: string | null;
  tone: NodeTone | null;
  /** A listed question's place in `draft.steps` (only `top` boxes). */
  index: number | null;
  /** Columns from the spine: 0 on it, 1 for its branches, and so on. */
  depth: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FlowEdge {
  key: string;
  d: string;
  /** The answer on it changes the price: drawn blue. */
  price: boolean;
}

export interface FlowPill {
  key: string;
  text: string;
  price: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FlowLayout {
  nodes: FlowNode[];
  edges: FlowEdge[];
  pills: FlowPill[];
  width: number;
  height: number;
  /** Where the spine's line runs. */
  spineX: number;
}

/** Text widths in canvas pixels, at the fonts dashboard.css gives each part. */
export interface Measure {
  /** A question, 14px semibold. */
  text: (s: string) => number;
  /** A tag, 10.5px semibold. */
  tag: (s: string) => number;
  /** A pill, 11px semibold. */
  pill: (s: string) => number;
}

/** Without a browser: rough per-character widths for the dashboard font. */
export const ESTIMATE: Measure = {
  text: (s) => s.length * 7.4,
  tag: (s) => s.length * 6.1,
  pill: (s) => s.length * 6.2,
};

// Sizes in canvas pixels, matched to the CSS in dashboard.css (.flow-node, .flow-pill).
export const LEFT = 24;
export const TOP = 20;
const PAD_RIGHT = 20;
const PAD_BOTTOM = 28;
const SPINE_GAP = 28;
const CHILD_GAP = 16;
/** Room for the curve either side of a pill. */
const CURVE = 22;
const STUB_INDENT = 40;
const SPINE_INSET = 24;
/** Box padding (12px a side) and border, across. */
const BOX_PAD = 26;
const SPINE_MAX = 280;
const BRANCH_MAX = 260;
const BOX_MIN = 120;
const ONE_LINE = 42;
const LINE = 19;
const TAG_ROW = 22;
const PILL_MAX = 180;
const PILL_PAD = 20;
const PILL_ONE = 22;
const PILL_LINE = 14;

export const FIXED_START = 'Address and roof check';
export const FIXED_END = 'Quote, then contact details';

/** The locked boxes around the listed questions: no start box when `start` is null. */
export interface FixedEnds {
  start: string | null;
  end: string;
}

/** The conversation's own: the address and roof check first, the quote last. */
export const CONVERSATION_ENDS: FixedEnds = { start: FIXED_START, end: FIXED_END };

/** A workflow's last box: the quote, or the visitor's details passed to the installer. */
export function workflowEnd(outcome: 'quote' | 'lead', assistant: string): string {
  return outcome === 'lead' ? `Then ${assistant} passes their details to you` : FIXED_END;
}

/**
 * A box's width and estimated height: text and tag on one line when they fit
 * in `max`, else the text wraps at `max` with the tag on a line of its own.
 */
export function boxSize(
  label: string,
  tag: string | null,
  fixed: boolean,
  max: number,
  m: Measure = ESTIMATE,
): [number, number] {
  const text = m.text(label);
  if (fixed) return [Math.ceil(BOX_PAD + 22 + text), ONE_LINE];
  const tagWidth = tag ? m.tag(tag) + 18 : 0;
  const single = BOX_PAD + text + (tag ? 8 + tagWidth : 0);
  if (single <= max) return [Math.max(BOX_MIN, Math.ceil(single)), ONE_LINE];
  const inner = max - BOX_PAD;
  const width = Math.min(max, Math.ceil(Math.max(text, tagWidth) + BOX_PAD));
  // A little slack: words wrap before the line is quite full.
  const lines = Math.max(1, Math.ceil(text / (inner * 0.92)));
  return [width, 22 + lines * LINE + (tag ? TAG_ROW : 0)];
}

/** A pill's size: one line, or wrapped at PILL_MAX. */
export function pillSize(text: string, m: Measure = ESTIMATE): [number, number] {
  const w = m.pill(text) + PILL_PAD;
  if (w <= PILL_MAX) return [Math.ceil(w), PILL_ONE];
  const lines = Math.ceil(m.pill(text) / ((PILL_MAX - PILL_PAD) * 0.9));
  return [PILL_MAX, 8 + lines * PILL_LINE];
}

/** The tag's colour: Sunny's own, changes the quote, lead only. */
export function toneOf(step: FlowStep): NodeTone {
  if (step.kind === 'preset') return 'sunny';
  return step.mode === 'quote' ? 'quote' : 'lead';
}

/** "Yes", "Yes or No", with " · +£899 7kW EV charger" when those answers change the price. */
function branchText(labels: string[], opening: ChoiceView[], ctx: Context): [string, boolean] {
  const effects = opening.flatMap((c) => c.effects);
  const head = labels.join(' or ');
  return effects.length > 0 ? [`${head} · ${effectsShort(effects, ctx)}`, true] : [head, false];
}

interface Pill {
  text: string;
  price: boolean;
  width: number;
  height: number;
}

interface Tree {
  node: FlowNode;
  /** Pills under the box, for priced answers that open nothing. */
  stubs: Pill[];
  /** How far right the box and its stub pills reach, from the box's left. */
  reach: number;
  children: Array<{ tree: Tree; pill: Pill }>;
}

export function layoutFlow(
  draft: Draft,
  ctx: Context,
  heights: ReadonlyMap<string, number> = new Map(),
  m: Measure = ESTIMATE,
  ends: FixedEnds = CONVERSATION_ENDS,
): FlowLayout {
  const pill = (text: string, price: boolean): Pill => {
    const [width, height] = pillSize(text, m);
    return { text, price, width, height };
  };
  const sized = (node: Omit<FlowNode, 'x' | 'y' | 'width' | 'height'>): FlowNode => {
    const max = node.depth === 0 ? SPINE_MAX : BRANCH_MAX;
    const [width, estimate] = boxSize(node.label, node.tag, node.kind === 'fixed', max, m);
    const measured = heights.get(node.key);
    return { ...node, x: 0, y: 0, width, height: measured && measured > 0 ? measured : estimate };
  };

  const build = (step: FlowStep, depth: number, index: number | null): Tree => {
    const choices = choicesOf(step, ctx);
    const opened = new Set<string>();
    const children: Tree['children'] = [];
    for (const member of membersOf(step, draft, ctx)) {
      const gate = ctx.presets.get(member.id)?.appearsWhen;
      const opening =
        gate && gate.questionId === step.id
          ? choices.filter((c) => gate.anyOf.includes(c.value))
          : [];
      opening.forEach((c) => opened.add(c.value));
      const [text, price] =
        opening.length > 0
          ? branchText(
              opening.map((c) => c.label),
              opening,
              ctx,
            )
          : ['When it applies', false];
      children.push({ tree: build(member, depth + 1, null), pill: pill(text, price) });
    }
    for (const f of step.followUps ?? []) {
      const opening = choices.filter((c) => f.when.includes(c.value));
      f.when.forEach((w) => opened.add(w));
      const [text, price] = branchText(
        f.when.map((w) => choices.find((c) => c.value === w)?.label ?? w),
        opening,
        ctx,
      );
      children.push({ tree: build(f.step, depth + 1, null), pill: pill(text, price) });
    }
    const stubs = choices
      .filter((c) => c.effects.length > 0 && !opened.has(c.value))
      .map((c) => pill(`${c.label} · ${effectsShort(c.effects, ctx)}`, true));
    const node = sized({
      key: step.id,
      stepId: step.id,
      kind: depth === 0 ? 'top' : 'branch',
      label: nameOf(step, ctx),
      tag: tagOf(step, ctx),
      tone: toneOf(step),
      index,
      depth,
    });
    const reach = Math.max(node.width, ...stubs.map((s) => STUB_INDENT + s.width + 8));
    return { node, stubs, reach, children };
  };

  const trees = draft.steps.map((step, i) => build(step, 0, i));
  const fixed = (key: string, label: string) =>
    sized({
      key,
      stepId: null,
      kind: 'fixed',
      label,
      tag: null,
      tone: null,
      index: null,
      depth: 0,
    });
  const start = ends.start === null ? null : fixed('start', ends.start);
  const end = fixed('end', ends.end);

  // How far each column starts right of the one before: the widest parent (or
  // its stub pills) plus its widest branch pill and room for the curve.
  const step: number[] = [];
  const measure = (tree: Tree) => {
    const d = tree.node.depth;
    if (tree.children.length > 0) {
      const widest = Math.max(...tree.children.map((c) => c.pill.width));
      step[d + 1] = Math.max(step[d + 1] ?? 0, tree.reach + widest + 2 * CURVE);
    }
    tree.children.forEach((c) => measure(c.tree));
  };
  trees.forEach(measure);
  const colX: number[] = [LEFT];
  for (let d = 1; d < step.length; d++) colX[d] = colX[d - 1]! + step[d]!;

  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const pills: FlowPill[] = [];
  const spineX = LEFT + SPINE_INSET;

  /** Place a box, its stubs and its branches from `y`; returns the bottom of the block. */
  const place = (tree: Tree, y: number): number => {
    const node = tree.node;
    node.x = colX[node.depth]!;
    node.y = y;
    nodes.push(node);
    let bottom = y + node.height;
    tree.stubs.forEach((stub, i) => {
      const top = bottom + 6;
      const mid = top + stub.height / 2;
      const x = node.x + STUB_INDENT;
      edges.push({
        key: `stub-${node.key}-${i}`,
        d: `M ${node.x + SPINE_INSET} ${node.y + node.height} V ${mid} H ${x}`,
        price: true,
      });
      pills.push({ key: `stub-${node.key}-${i}`, ...stub, x, y: top });
      bottom = top + stub.height;
    });
    let childY = y;
    for (const child of tree.children) {
      const childBottom = place(child.tree, childY);
      const c = child.tree.node;
      const fromX = node.x + node.width;
      const fromY = node.y + Math.min(node.height / 2, ONE_LINE / 2);
      const toY = c.y + Math.min(c.height / 2, ONE_LINE / 2);
      // The pill sits in the middle of the gap, the curve bending before it.
      const clear = node.x + tree.reach;
      const pillX = Math.round((clear + c.x - child.pill.width) / 2);
      const bend = Math.max(8, (pillX - fromX) / 2);
      edges.push({
        key: `branch-${c.key}`,
        d: `M ${fromX} ${fromY} C ${fromX + bend} ${fromY}, ${pillX - bend} ${toY}, ${pillX} ${toY} H ${c.x}`,
        price: child.pill.price,
      });
      pills.push({
        key: `branch-${c.key}`,
        ...child.pill,
        x: pillX,
        y: toY - child.pill.height / 2,
      });
      bottom = Math.max(bottom, childBottom);
      childY = childBottom + CHILD_GAP;
    }
    return bottom;
  };

  const placeSpine = (node: FlowNode, y: number): number => {
    node.x = LEFT;
    node.y = y;
    nodes.push(node);
    return y + node.height;
  };

  // Null until something sits above: no line runs down to the first box.
  let previousBottom: number | null = start ? placeSpine(start, TOP) : null;
  let y = previousBottom === null ? TOP : previousBottom + SPINE_GAP;
  const link = (nextTop: number) => {
    if (previousBottom === null) return;
    edges.push({
      key: `spine-${nextTop}`,
      d: `M ${spineX} ${previousBottom} V ${nextTop}`,
      price: false,
    });
  };
  for (const tree of trees) {
    link(y);
    const blockBottom = place(tree, y);
    previousBottom = tree.node.y + tree.node.height;
    y = blockBottom + SPINE_GAP;
  }
  link(y);
  const bottom = placeSpine(end, y);

  const width = Math.max(...nodes.map((n) => n.x + n.width), ...pills.map((p) => p.x + p.width));
  return {
    nodes,
    edges,
    pills,
    width: Math.ceil(width + PAD_RIGHT),
    height: Math.ceil(bottom + PAD_BOTTOM),
    spineX,
  };
}
