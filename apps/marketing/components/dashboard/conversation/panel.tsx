'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';

export type PanelId = 'list' | 'diagram' | 'preview';

export const PANELS: Array<{ id: PanelId; title: string }> = [
  { id: 'list', title: 'Questions' },
  { id: 'diagram', title: 'Flow diagram' },
  { id: 'preview', title: 'Chat preview' },
];

const STORAGE_KEY = 'sunny:flow-panels';
const OPEN: Record<PanelId, boolean> = { list: false, diagram: false, preview: false };

/** Which panels are minimised, remembered per browser (a convenience, never required). */
export function usePanelState(): [Record<PanelId, boolean>, (id: PanelId) => void] {
  const [collapsed, setCollapsed] = useState(OPEN);

  // Read after mount: the server render has no storage, and the two must match.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const stored = raw ? (JSON.parse(raw) as Partial<Record<PanelId, unknown>>) : {};
      setCollapsed({
        list: stored.list === true,
        diagram: stored.diagram === true,
        preview: stored.preview === true,
      });
    } catch {
      // Storage blocked or unreadable: every panel stays open.
    }
  }, []);

  const toggle = useCallback((id: PanelId) => {
    setCollapsed((current) => {
      const next = { ...current, [id]: !current[id] };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Not remembered this time; the panel still collapses.
      }
      return next;
    });
  }, []);

  return [collapsed, toggle];
}

/**
 * One of the editor's three panels. Side by side on a wide screen, where it can
 * be minimised to its title; one at a time (tabs) on a narrower one.
 */
export function Panel({
  id,
  title,
  collapsed,
  onToggle,
  children,
}: {
  id: PanelId;
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const bodyId = `flow-panel-${id}`;
  return (
    <section
      className="flow-panel"
      id={`${bodyId}-panel`}
      data-panel={id}
      data-collapsed={collapsed}
      aria-label={title}
    >
      <header className="flow-panel-head">
        <h3>{title}</h3>
        <button
          type="button"
          className="link-button flow-panel-toggle"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          aria-label={`${collapsed ? 'Show' : 'Minimise'} ${title}`}
          onClick={onToggle}
        >
          {collapsed ? 'Show' : 'Minimise'}
        </button>
      </header>
      <div className="flow-panel-body" id={bodyId}>
        {children}
      </div>
    </section>
  );
}
