'use client';

import { useSearchParams } from 'next/navigation';
import {
  Suspense,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { ConversationEditor } from '../../../components/dashboard/conversation/editor.js';
import { SkeletonRows } from '../../../components/dashboard/kit.js';
import { PortalShell, usePortal } from '../../../components/dashboard/portal.js';
import { StudioForm, type StudioPart } from '../../../components/dashboard/studio-form.js';
import { Card, PageHeader } from '../../../components/dashboard/ui.js';
import { assistantNameOf } from '../../../lib/assistant-name.js';

const TABS = [
  { key: 'brand', title: 'Your brand' },
  { key: 'conversation', title: 'Your conversation' },
  { key: 'settings', title: 'Assistant settings' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

function tabFrom(value: string | null): TabKey {
  return TABS.find((t) => t.key === value)?.key ?? TABS[0].key;
}

/** Arrow keys move between tabs (the WAI-ARIA tabs pattern, automatic activation). */
function nextIndex(key: string, at: number, count: number): number | null {
  if (key === 'ArrowRight') return (at + 1) % count;
  if (key === 'ArrowLeft') return (at - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

function Studio() {
  const { tenant, setTenant } = usePortal();
  const canEdit = tenant.role === 'admin' || tenant.role === 'owner';
  // The assistant's name, not the product's: renamed on Assistant settings, every tab follows.
  const assistant = assistantNameOf(tenant.assistantName);
  const params = useSearchParams();
  const [tab, setTab] = useState<TabKey>(() => tabFrom(params.get('tab')));
  // A tab is mounted the first time it opens and then kept, so an unsaved
  // draft on one tab survives a visit to another.
  const [seen, setSeen] = useState<Set<TabKey>>(() => new Set([tab]));
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  // The address leads: a link to Studio (the sidebar, say) opens the tab it names, or the first.
  const fromAddress = tabFrom(params.get('tab'));
  useEffect(() => {
    setTab(fromAddress);
    setSeen((current) => (current.has(fromAddress) ? current : new Set([...current, fromAddress])));
  }, [fromAddress]);
  const id = useId();

  function open(next: TabKey): void {
    setTab(next);
    setSeen((current) => (current.has(next) ? current : new Set([...current, next])));
    // In the address, so a reload or a shared link opens the same tab.
    const url = new URL(window.location.href);
    url.searchParams.set('tab', next);
    window.history.replaceState(window.history.state, '', url);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const at = TABS.findIndex((t) => t.key === tab);
    const next = nextIndex(event.key, at, TABS.length);
    if (next === null) return;
    event.preventDefault();
    open(TABS[next]!.key);
    buttons.current[next]?.focus();
  }

  const form = (part: StudioPart) =>
    canEdit ? (
      // Keyed by installer: an unsaved draft never follows the owner to another one.
      <StudioForm key={tenant.id} tenant={tenant} onSaved={setTenant} part={part} />
    ) : (
      <p className="muted">Ask an admin to change how {assistant} looks.</p>
    );

  const panels: Record<TabKey, ReactNode> = {
    brand: <Card>{form('brand')}</Card>,
    // Keyed by installer: a draft never follows the owner to another one.
    conversation: (
      <ConversationEditor
        key={tenant.id}
        tenantId={tenant.id}
        canEdit={canEdit}
        assistant={assistant}
      />
    ),
    settings: <Card>{form('settings')}</Card>,
  };

  return (
    <>
      <PageHeader
        title="Sunny Studio"
        lead={`Your colour, your greeting, your questions. The preview is the real ${assistant}.`}
      />
      <div className="studio-tabs" role="tablist" aria-label="Studio" onKeyDown={onKeyDown}>
        {TABS.map((t, index) => (
          <button
            key={t.key}
            ref={(el) => {
              buttons.current[index] = el;
            }}
            type="button"
            role="tab"
            id={`${id}-tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls={`${id}-panel-${t.key}`}
            tabIndex={tab === t.key ? 0 : -1}
            onClick={() => open(t.key)}
          >
            {t.title}
          </button>
        ))}
      </div>
      {TABS.map((t) => (
        <div
          key={t.key}
          className="studio-panel"
          role="tabpanel"
          id={`${id}-panel-${t.key}`}
          aria-labelledby={`${id}-tab-${t.key}`}
          hidden={tab !== t.key}
          data-tab={t.key}
        >
          {seen.has(t.key) ? panels[t.key] : null}
        </div>
      ))}
    </>
  );
}

export default function StudioPage() {
  return (
    <PortalShell>
      <Suspense fallback={<SkeletonRows rows={4} />}>
        <Studio />
      </Suspense>
    </PortalShell>
  );
}
