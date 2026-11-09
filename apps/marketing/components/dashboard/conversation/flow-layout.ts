/**
 * Where the flow canvas draws everything, computed from the draft alone (no
 * diagram library, nothing measured but the boxes' heights, which the canvas
 * may pass in once it has drawn them).
 *
 * The listed questions sit on a vertical spine between the locked start and
 * end. Group members and follow-ups branch to the right, one column per
 * level, each on a curved line that ends at a pill naming the answer that
 * opens it (and what that answer does to the price). An answer that changes
 * the price but opens nothing shows its pill on a short stub under its box.
 *
 * Boxes never overlap: a level's column starts right of the widest box (or
 * stub pill) of the level before plus room for the widest pill, and in a
 * column every box starts below the whole block (box, stubs, branches) above it.
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
  dashed: boolean;
}

export interface FlowPill {
  key: string;
  text: string;
  price: boolean;
  x: number;
  y: number;
  width: number;
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

// Sizes in canvas pixels, matched to the CSS in dashboard.css (.flow-node, .flow-pill).
export const LEFT = 28;
export const TOP = 24;
const PAD_RIGHT = 40;
const PAD_BOTTOM = 40;
const SPINE_GAP = 30;
const CHILD_GAP = 16;
const BRANCH_MIN = 110;
const PILL_ROOM = 46;
const PILL_HEIGHT = 22;
const PILL_ROW = 28;
const STUB_INDENT = 40;
const SPINE_INSET = 24;
const BOX_MAX = 280;
const SINGLE_MAX = 340;
const BOX_MIN = 150;
const CHAR = 7.1;
const TAG_CHAR = 6.2;
const PILL_CHAR = 6.3;
const LINE = 18;

export const FIXED_START = 'Address and roof check';
export const FIXED_END = 'Quote, then contact details';

/** A box's width and estimated height: one line when it fits, else wrapped at BOX_MAX. */
export function boxSize(label: string, tag: string | null, fixed: boolean): [number, number] {
  const text = label.length * CHAR + (fixed ? 22 : 0);
  const tagWidth = tag ? tag.length * TAG_CHAR + 18 : 0;
  const single = 26 + text + (tag ? 8 + tagWidth : 0);
  if (single <= SINGLE_MAX) return [Math.max(fixed ? 0 : BOX_MIN, Math.ceil(single)), 38];
  const lines = Math.ceil(text / (BOX_MAX - 26));
  return [BOX_MAX, 18 + lines * LINE + (tag ? 26 : 0)];
}

export function pillWidth(text: string): number {
  return Math.ceil(text.length * PILL_CHAR + 22);
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

interface Tree {
  step: FlowStep;
  node: FlowNode;
  /** Pills under the box, for priced answers that open nothing. */
  stubs: Array<{ text: string }>;
  children: Array<{ tree: Tree; pill: string; price: boolean }>;
}

export function layoutFlow(
  draft: Draft,
  ctx: Context,
  heights: ReadonlyMap<string, number> = new Map(),
): FlowLayout {
  const sized = (node: Omit<FlowNode, 'x' | 'y' | 'width' | 'height'>): FlowNode => {
    const [width, estimate] = boxSize(node.label, node.tag, node.kind === 'fixed');
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
      const [pill, price] =
        opening.length > 0
          ? branchText(
              opening.map((c) => c.label),
              opening,
              ctx,
            )
          : ['When it applies', false];
      children.push({ tree: build(member, depth + 1, null), pill, price });
    }
    for (const f of step.followUps ?? []) {
      const opening = choices.filter((c) => f.when.includes(c.value));
      f.when.forEach((w) => opened.add(w));
      const [pill, price] = branchText(
        f.when.map((w) => choices.find((c) => c.value === w)?.label ?? w),
        opening,
        ctx,
      );
      children.push({ tree: build(f.step, depth + 1, null), pill, price });
    }
    const stubs = choices
      .filter((c) => c.effects.length > 0 && !opened.has(c.value))
      .map((c) => ({ text: `${c.label} · ${effectsShort(c.effects, ctx)}` }));
    const node = sized({
      key: step.id,
      stepId: step.id,
      kind: depth === 0 ? 'top' : 'branch',
      label: nameOf(step, ctx),
      tag: tagOf(step),
      tone: toneOf(step),
      index,
      depth,
    });
    return { step, node, stubs, children };
  };

  const trees = draft.steps.map((step, i) => build(step, 0, i));
  const start = sized({
    key: 'start',
    stepId: null,
    kind: 'fixed',
    label: FIXED_START,
    tag: null,
    tone: null,
    index: null,
    depth: 0,
  });
  const end = sized({ ...start, key: 'end', label: FIXED_END });

  // Column widths (boxes and their stub pills) and the widest pill entering each column.
  const colWidth: number[] = [Math.max(start.width, end.width)];
  const pillMax: number[] = [0];
  const measure = (tree: Tree) => {
    const d = tree.node.depth;
    const stubWidth = Math.max(0, ...tree.stubs.map((s) => STUB_INDENT + pillWidth(s.text)));
    colWidth[d] = Math.max(colWidth[d] ?? 0, tree.node.width, stubWidth);
    for (const child of tree.children) {
      pillMax[d + 1] = Math.max(pillMax[d + 1] ?? 0, pillWidth(child.pill));
      measure(child.tree);
    }
  };
  trees.forEach(measure);
  const colX: number[] = [LEFT];
  for (let d = 1; d < colWidth.length; d++) {
    colX[d] = colX[d - 1]! + colWidth[d - 1]! + Math.max(BRANCH_MIN, (pillMax[d] ?? 0) + PILL_ROOM);
  }

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
      const mid = bottom + 6 + i * PILL_ROW + PILL_HEIGHT / 2 + 3;
      const x = node.x + STUB_INDENT;
      const lineX = node.x + SPINE_INSET;
      edges.push({
        key: `stub-${node.key}-${i}`,
        d: `M ${lineX} ${y + node.height} V ${mid} H ${x}`,
        price: true,
        dashed: false,
      });
      pills.push({
        key: `stub-${node.key}-${i}`,
        text: stub.text,
        price: true,
        x,
        y: mid - PILL_HEIGHT / 2,
        width: pillWidth(stub.text),
      });
    });
    if (tree.stubs.length > 0) bottom += 6 + tree.stubs.length * PILL_ROW;
    let childY = y;
    for (const child of tree.children) {
      const childBottom = place(child.tree, childY);
      const c = child.tree.node;
      const fromX = node.x + node.width;
      const fromY = node.y + Math.min(node.height / 2, 19);
      const toY = c.y + Math.min(c.height / 2, 19);
      const width = pillWidth(child.pill);
      const bend = Math.max(30, (c.x - fromX - width) / 2);
      edges.push({
        key: `branch-${c.key}`,
        d: `M ${fromX} ${fromY} C ${fromX + bend} ${fromY}, ${c.x - width - 20} ${toY}, ${c.x - width - 10} ${toY} H ${c.x}`,
        price: child.price,
        dashed: false,
      });
      pills.push({
        key: `branch-${c.key}`,
        text: child.pill,
        price: child.price,
        x: c.x - width - 10,
        y: toY - PILL_HEIGHT / 2,
        width,
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

  let y = TOP;
  let previousBottom = placeSpine(start, y);
  y = previousBottom + SPINE_GAP;
  let returning: { from: FlowNode } | null = null;
  const link = (nextTop: number) => {
    edges.push({
      key: `spine-${nextTop}`,
      d: `M ${spineX} ${previousBottom} V ${nextTop}`,
      price: false,
      dashed: false,
    });
    if (returning) {
      // The branch rejoins the spine just above the next question.
      const from = returning.from;
      const fx = from.x + Math.min(from.width / 2, 60);
      const fy = from.y + from.height;
      edges.push({
        key: `return-${from.key}`,
        d: `M ${fx} ${fy} C ${fx} ${nextTop - 6}, ${spineX + 60} ${nextTop - 10}, ${spineX} ${nextTop - 8}`,
        price: false,
        dashed: true,
      });
      returning = null;
    }
  };
  for (const tree of trees) {
    link(y);
    const blockBottom = place(tree, y);
    previousBottom = tree.node.y + tree.node.height;
    const last = tree.children[tree.children.length - 1];
    returning = last ? { from: last.tree.node } : null;
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
