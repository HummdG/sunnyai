'use client';

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import { ESTIMATE, layoutFlow, type FlowNode, type Measure } from './flow-layout.js';
import { placeAt, subtreeIds, type Context, type Draft, type EditorIssue } from './model.js';

/**
 * The conversation drawn as a flow: the listed questions on a spine between
 * the locked start and end, follow-ups and linked questions branching right
 * under the answer that opens them. Click a box to edit it in the side column;
 * drag a listed question up or down the spine to reorder it. The canvas zooms
 * (buttons, Ctrl or Cmd with the wheel) and pans by dragging empty space.
 */

const MIN_SCALE = 0.4;
const MAX_SCALE = 2;
const STEP = 1.2;
/** How far a box moves before a press becomes a drag rather than a click. */
const DRAG_START = 5;
/** The smallest scale the flow opens at when it is wider than the view (14px text stays over 12.5px). */
const OPEN_MIN = 0.9;

/** Text widths from the page's own font, so boxes and pills fit their words exactly. */
function fontMeasure(): Measure {
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return ESTIMATE;
  const family = getComputedStyle(document.body).fontFamily;
  const cache = new Map<string, number>();
  const make = (font: string) => (text: string) => {
    const key = `${font}|${text}`;
    let width = cache.get(key);
    if (width === undefined) {
      context.font = `${font} ${family}`;
      width = Math.ceil(context.measureText(text).width) + 1;
      cache.set(key, width);
    }
    return width;
  };
  return { text: make('600 14px'), tag: make('650 10.5px'), pill: make('650 11px') };
}

const clampScale = (value: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));

interface Dragging {
  id: string;
  pointerId: number;
  startY: number;
  dy: number;
  moved: boolean;
  insertAt: number;
}

export function FlowCanvas({
  draft,
  ctx,
  readOnly,
  selectedId,
  issues,
  onSelect,
  onDraft,
}: {
  draft: Draft;
  ctx: Context;
  readOnly: boolean;
  selectedId: string | null;
  issues: EditorIssue[];
  onSelect: (id: string) => void;
  onDraft: (change: (draft: Draft) => Draft) => void;
}) {
  const [scale, setScale] = useState(1);
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(new Map());
  const [dragging, setDragging] = useState<Dragging | null>(null);
  const view = useRef<HTMLDivElement>(null);
  const boxes = useRef(new Map<string, HTMLElement>());
  const suppressClick = useRef(false);
  const pendingScroll = useRef<{ left: number; top: number } | null>(null);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  const [measure, setMeasure] = useState<Measure>(ESTIMATE);
  // Measured once the page's font has loaded (its widths are the ones drawn).
  useEffect(() => {
    let live = true;
    const ready = document.fonts?.ready ?? Promise.resolve();
    void ready.then(() => live && setMeasure(fontMeasure()));
    return () => {
      live = false;
    };
  }, []);

  const layout = useMemo(
    () => layoutFlow(draft, ctx, heights, measure),
    [draft, ctx, heights, measure],
  );

  // Boxes wrap their full question: once drawn, their real heights feed the layout.
  useLayoutEffect(() => {
    let changed = false;
    const next = new Map(heights);
    for (const [key, el] of boxes.current) {
      const h = el.offsetHeight;
      if (h > 0 && Math.abs((heights.get(key) ?? 0) - h) > 1) {
        next.set(key, h);
        changed = true;
      }
    }
    if (changed) setHeights(next);
  });

  // Fitted to the flow's width until the owner zooms (never so small it cannot be read).
  const zoomed = useRef(false);
  useLayoutEffect(() => {
    const el = view.current;
    if (zoomed.current || !el || el.clientWidth === 0) return;
    setScale(Math.min(1, Math.max(OPEN_MIN, (el.clientWidth - 4) / layout.width)));
  }, [layout.width]);

  // Zooming keeps the point under the pointer (or the view's centre) where it was.
  function zoomTo(target: number, anchor?: { x: number; y: number }): void {
    const el = view.current;
    const next = clampScale(target);
    if (!el || next === scaleRef.current) return;
    zoomed.current = true;
    const ax = anchor?.x ?? el.clientWidth / 2;
    const ay = anchor?.y ?? el.clientHeight / 2;
    const cx = (el.scrollLeft + ax) / scaleRef.current;
    const cy = (el.scrollTop + ay) / scaleRef.current;
    pendingScroll.current = { left: cx * next - ax, top: cy * next - ay };
    setScale(next);
  }

  useLayoutEffect(() => {
    const el = view.current;
    if (!el || !pendingScroll.current) return;
    el.scrollLeft = pendingScroll.current.left;
    el.scrollTop = pendingScroll.current.top;
    pendingScroll.current = null;
  }, [scale]);

  // A wheel listener of our own: React's is passive, and Ctrl+wheel must not zoom the page.
  useEffect(() => {
    const el = view.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomTo(scaleRef.current * Math.exp(-event.deltaY * 0.0015), {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // A question picked elsewhere (the list, a failed save) is brought into view.
  useEffect(() => {
    const el = view.current;
    const node = layout.nodes.find((n) => n.stepId === selectedId);
    if (!el || !node) return;
    const s = scaleRef.current;
    const left = node.x * s;
    const top = node.y * s;
    const right = (node.x + node.width) * s;
    const bottom = (node.y + node.height) * s;
    if (left < el.scrollLeft || right > el.scrollLeft + el.clientWidth) {
      el.scrollLeft = Math.max(0, left - 40);
    }
    if (top < el.scrollTop || bottom > el.scrollTop + el.clientHeight) {
      el.scrollTop = Math.max(0, (top + bottom) / 2 - el.clientHeight / 2);
    }
    // Only when the selection changes, not on every edit.
  }, [selectedId]);

  function fit(): void {
    const el = view.current;
    if (!el) return;
    const fitted = Math.min(
      (el.clientWidth - 16) / layout.width,
      (el.clientHeight - 16) / layout.height,
      1,
    );
    pendingScroll.current = { left: 0, top: 0 };
    zoomed.current = true;
    setScale(clampScale(fitted));
  }

  const tops = layout.nodes
    .filter((n) => n.kind === 'top')
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const end = layout.nodes.find((n) => n.key === 'end')!;

  function insertIndex(id: string, dy: number): number {
    const moving = tops.find((n) => n.stepId === id);
    if (!moving) return 0;
    const centre = moving.y + moving.height / 2 + dy;
    return tops.filter((n) => n.stepId !== id && n.y + n.height / 2 < centre).length;
  }

  function onBoxDown(event: ReactPointerEvent<HTMLButtonElement>, node: FlowNode): void {
    if (readOnly || node.kind !== 'top' || event.button !== 0 || !node.stepId) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging({
      id: node.stepId,
      pointerId: event.pointerId,
      startY: event.clientY,
      dy: 0,
      moved: false,
      insertAt: node.index ?? 0,
    });
  }

  function onBoxMove(event: ReactPointerEvent<HTMLButtonElement>): void {
    if (!dragging || dragging.pointerId !== event.pointerId) return;
    const dy = (event.clientY - dragging.startY) / scale;
    if (!dragging.moved && Math.abs(dy) < DRAG_START) return;
    setDragging({ ...dragging, dy, moved: true, insertAt: insertIndex(dragging.id, dy) });
  }

  function onBoxUp(event: ReactPointerEvent<HTMLButtonElement>): void {
    if (!dragging || dragging.pointerId !== event.pointerId) return;
    if (dragging.moved) {
      const { id, insertAt } = dragging;
      suppressClick.current = true;
      onDraft((d) => ({ ...d, steps: placeAt(d.steps, id, insertAt) }));
    }
    setDragging(null);
  }

  // Others keep their place while one is dragged; the line shows where it lands.
  const others = dragging?.moved ? tops.filter((n) => n.stepId !== dragging.id) : [];
  const insertY = dragging?.moved ? (others[dragging.insertAt]?.y ?? end.y) - 15 : null;

  function onViewDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    if ((event.target as Element).closest('.flow-node, .flow-canvas-tools')) return;
    const el = view.current!;
    pan.current = { x: event.clientX, y: event.clientY, left: el.scrollLeft, top: el.scrollTop };
    el.setPointerCapture(event.pointerId);
  }

  function onViewMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const start = pan.current;
    if (!start) return;
    const el = view.current!;
    el.scrollLeft = start.left - (event.clientX - start.x);
    el.scrollTop = start.top - (event.clientY - start.y);
  }

  const attention = (id: string): boolean => {
    const step = draft.steps.find((s) => s.id === id);
    if (!step) return issues.some((i) => i.stepId === id);
    const below = subtreeIds(step, draft, ctx);
    return issues.some((i) => below.has(i.stepId));
  };

  return (
    <section className="flow-canvas" aria-label="Flow">
      {/* Above the sheet, so no box can ever sit under the controls. */}
      <div className="flow-canvas-bar">
        <p className="flow-canvas-hint">
          {readOnly
            ? 'Click a box to see it · Ctrl + scroll to zoom'
            : 'Drag a box to reorder · click to edit · Ctrl + scroll to zoom'}
        </p>
        <div className="flow-canvas-tools" role="group" aria-label="Zoom">
          <button type="button" aria-label="Zoom in" onClick={() => zoomTo(scale * STEP)}>
            +
          </button>
          <button type="button" aria-label="Zoom out" onClick={() => zoomTo(scale / STEP)}>
            −
          </button>
          <button type="button" aria-label="Fit the flow in view" onClick={fit}>
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path
                d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              />
            </svg>
          </button>
        </div>
      </div>
      <div
        ref={view}
        className="flow-canvas-view"
        onPointerDown={onViewDown}
        onPointerMove={onViewMove}
        onPointerUp={() => (pan.current = null)}
        onPointerCancel={() => (pan.current = null)}
      >
        <div style={{ width: layout.width * scale, height: layout.height * scale }}>
          <div
            className="flow-stage"
            data-scale={scale.toFixed(2)}
            style={{ width: layout.width, height: layout.height, transform: `scale(${scale})` }}
          >
            <svg
              className="flow-lines"
              width={layout.width}
              height={layout.height}
              aria-hidden="true"
            >
              {layout.edges.map((edge) => (
                <path key={edge.key} d={edge.d} data-price={edge.price ? 'true' : undefined} />
              ))}
            </svg>
            {layout.pills.map((pill) => (
              <span
                key={pill.key}
                className="flow-pill"
                data-price={pill.price ? 'true' : undefined}
                style={{ left: pill.x, top: pill.y, width: pill.width, minHeight: pill.height }}
              >
                {pill.text}
              </span>
            ))}
            {layout.nodes.map((node) => {
              const ref = (el: HTMLElement | null) => {
                if (el) boxes.current.set(node.key, el);
                else boxes.current.delete(node.key);
              };
              const style = { left: node.x, top: node.y, width: node.width };
              if (node.kind === 'fixed' || !node.stepId) {
                return (
                  <div
                    key={node.key}
                    ref={ref}
                    className="flow-node"
                    data-kind="fixed"
                    style={style}
                    aria-label={node.label}
                  >
                    <Lock />
                    <span className="flow-node-text">{node.label}</span>
                  </div>
                );
              }
              const id = node.stepId;
              const moving = dragging?.moved && dragging.id === id;
              return (
                <button
                  key={node.key}
                  ref={ref}
                  type="button"
                  className="flow-node"
                  data-kind={node.kind}
                  data-step-id={id}
                  data-dragging={moving ? 'true' : undefined}
                  data-draggable={!readOnly && node.kind === 'top' ? 'true' : undefined}
                  aria-label={node.label}
                  aria-pressed={selectedId === id}
                  style={moving ? { ...style, transform: `translateY(${dragging.dy}px)` } : style}
                  onPointerDown={(event) => onBoxDown(event, node)}
                  onPointerMove={onBoxMove}
                  onPointerUp={onBoxUp}
                  onPointerCancel={() => setDragging(null)}
                  onClick={() => {
                    if (suppressClick.current) {
                      suppressClick.current = false;
                      return;
                    }
                    onSelect(id);
                  }}
                >
                  <span className="flow-node-text">{node.label}</span>
                  {node.tag ? (
                    <span className="flow-tag" data-tone={node.tone ?? undefined}>
                      {node.tag}
                    </span>
                  ) : null}
                  {attention(id) ? (
                    <span className="flow-tag" data-tone="warn">
                      Needs attention
                    </span>
                  ) : null}
                </button>
              );
            })}
            {insertY !== null ? (
              <div
                className="flow-insert"
                aria-hidden="true"
                style={{ top: insertY, left: layout.spineX - 30, width: 260 }}
              />
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

export function Lock() {
  return (
    <span className="flow-lock" aria-hidden="true">
      <svg viewBox="0 0 16 16" width="13" height="13">
        <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />
        <path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    </span>
  );
}
