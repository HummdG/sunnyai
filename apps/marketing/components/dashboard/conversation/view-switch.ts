'use client';

import { useCallback, useEffect, useState } from 'react';

/** The conversation tab shows the flow canvas or the compact question list. */
export type FlowView = 'flow' | 'list';

const STORAGE_KEY = 'sunny:flow-view';
/** Narrower than this, the list is the better default (the canvas still works). */
const PHONE = 700;

/** Flow or list, remembered per browser (a convenience, never required). */
export function useFlowView(): [FlowView, (next: FlowView) => void] {
  const [view, setView] = useState<FlowView>('flow');

  // Read after mount: the server render has no storage or width, and the two must match.
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      // Storage blocked or unreadable: the default applies.
    }
    if (stored === 'flow' || stored === 'list') setView(stored);
    else if (window.innerWidth < PHONE) setView('list');
  }, []);

  const choose = useCallback((next: FlowView) => {
    setView(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not remembered this time; the view still changes.
    }
  }, []);

  return [view, choose];
}
