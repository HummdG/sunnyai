import { StrictMode, useEffect, useRef, useState, type JSX } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * A React host for the widget, because most installers' sites are not plain HTML.
 *
 * The demo page next door proves the snippet works when a page author pastes it
 * into markup. This proves something the plain page cannot: that the widget
 * survives a framework owning the DOM around it. React removes nodes it created
 * and is confused by nodes it did not, so "insert the widget next to my script
 * tag" -- which reads as the obvious thing to do -- is exactly the arrangement
 * that breaks a reconciler.
 *
 * Three shapes are exercised, one per control, because each fails differently:
 *
 *  1. `StrictMode`, which is what most React apps run in development and which
 *     double-invokes effects. A widget mounted from an effect has to tolerate
 *     being asked to mount twice.
 *  2. A re-render that changes state while the widget is on screen. This is the
 *     one that throws `NotFoundError` when the widget has added a sibling to a
 *     node React is managing.
 *  3. Unmount and remount, which is what a route change does.
 */

declare global {
  interface Window {
    sunny?: { widgets?: unknown[]; open?: () => void; close?: () => void };
  }
}

const PUBLIC_ID = 'w_demo000001';
const API_URL = 'http://localhost:8787';

/**
 * The embed snippet as JSX.
 *
 * Written the way an integrator would naturally write it -- as part of the
 * component's output -- rather than by appending to `document.head`, because
 * that is the shape that has to work.
 */
function SunnyEmbed(): JSX.Element {
  return (
    <script src="/widget/sunny-widget.js" data-widget-id={PUBLIC_ID} data-api-url={API_URL} async />
  );
}

function Page(): JSX.Element {
  const [tick, setTick] = useState(0);
  const [mounted, setMounted] = useState(true);
  const logRef = useRef<HTMLParagraphElement>(null);

  // Reads the handle rather than assuming it: a widget that never mounted must
  // read as "not there", not as an exception in the host page's own code.
  const widgetCount = window.sunny?.widgets?.length ?? 0;

  useEffect(() => {
    if (logRef.current) {
      logRef.current.textContent = `re-render ${tick}: ${widgetCount} widget(s) on the page, ${document.querySelectorAll('[data-sunny-widget]').length} host(s) in the DOM`;
    }
  });

  return (
    <>
      <header>
        <strong>Beacon Renewables</strong>
        <nav>
          <a href="#pricing">Pricing</a>
          <a href="#contact">Contact</a>
        </nav>
      </header>
      <main>
        <h1>A React site, with the same widget.</h1>
        <p>
          This page is rendered by React 19 under <code>StrictMode</code>. The embed snippet is part
          of the component tree, which is how an integrator would naturally write it — and is the
          arrangement that tests whether the widget can share a DOM with a framework.
        </p>

        <div className="controls">
          <button type="button" data-testid="rerender" onClick={() => setTick((n) => n + 1)}>
            Re-render
          </button>
          <button
            type="button"
            data-testid="toggle-mount"
            onClick={() => setMounted((value) => !value)}
          >
            {mounted ? 'Unmount the embed' : 'Mount the embed'}
          </button>
          <button type="button" data-testid="open-widget" onClick={() => window.sunny?.open?.()}>
            Open from React state
          </button>
        </div>
        <p className="note" ref={logRef} data-testid="mount-log" />

        {mounted && <SunnyEmbed />}
      </main>
      <footer>A React host for the Sunny widget. Not a real installer.</footer>
    </>
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from the host page');
createRoot(container).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);
