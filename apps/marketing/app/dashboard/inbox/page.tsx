'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import { EmptyState, SkeletonRows } from '../../../components/dashboard/kit.js';
import { PortalShell, usePortal } from '../../../components/dashboard/portal.js';
import {
  Card,
  Chip,
  ErrorNote,
  errorText,
  formatDate,
  PageHeader,
} from '../../../components/dashboard/ui.js';
import {
  api,
  tenantPath,
  type ConversationDetail,
  type EmailThread,
  type InboxRow,
} from '../../../lib/portal-api.js';

const CHANNEL_LABEL = { chat: 'Web chat', email: 'Email', voice: 'Voice' } as const;

type Filter = 'all' | 'escalated' | 'sales' | 'support' | 'chat' | 'email' | 'voice';

function query(filter: Filter): string {
  if (filter === 'escalated') return '?escalated=1';
  if (filter === 'sales' || filter === 'support') return `?intent=${filter}`;
  if (filter === 'chat' || filter === 'email' || filter === 'voice') return `?channel=${filter}`;
  return '';
}

/**
 * The draft Sunny wrote for an email conversation, and why it is waiting for
 * a person (from the Email Assistant, routes/email.ts).
 */
function EmailDraft({ tenantId, sessionId }: { tenantId: string; sessionId: string }) {
  const [thread, setThread] = useState<EmailThread | null | 'none'>(null);
  useEffect(() => {
    setThread(null);
    api<EmailThread>(tenantPath(tenantId, `/email/threads/${encodeURIComponent(sessionId)}`))
      .then(setThread)
      .catch(() => setThread('none'));
  }, [tenantId, sessionId]);
  if (thread === null) return <SkeletonRows rows={2} />;
  if (thread === 'none') return null;
  const sent = thread.sentMessageId !== null;
  return (
    <section aria-labelledby="draft-title" style={{ marginTop: 18 }}>
      <h3 id="draft-title" style={{ fontSize: '1rem', marginBottom: 8 }}>
        {sent ? 'Reply sent' : 'Draft reply'} · {thread.subject}
      </h3>
      {thread.notes.length > 0 ? (
        <ul className="warning-list" style={{ marginBottom: 10 }}>
          {thread.notes.map((note, index) => (
            <li key={index}>{note}</li>
          ))}
        </ul>
      ) : null}
      <pre
        className="snippet"
        style={{
          whiteSpace: 'pre-wrap',
          background: '#fff',
          color: 'inherit',
          border: '1px solid var(--line)',
        }}
      >
        {thread.draftText}
      </pre>
      {thread.webLink ? (
        <a className="button" href={thread.webLink} target="_blank" rel="noreferrer">
          {sent ? 'Open in your inbox' : 'Review and send in your inbox'}
        </a>
      ) : !sent ? (
        <button
          className="button secondary"
          type="button"
          onClick={() => void navigator.clipboard.writeText(thread.draftText)}
        >
          Copy draft
        </button>
      ) : null}
    </section>
  );
}

function Inbox() {
  const { tenant } = usePortal();
  const params = useSearchParams();
  const [filter, setFilter] = useState<Filter>(
    params.get('escalated') === '1' ? 'escalated' : 'all',
  );
  const [rows, setRows] = useState<InboxRow[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRows(null);
    api<{ conversations: InboxRow[] }>(tenantPath(tenant.id, `/inbox${query(filter)}`))
      .then(({ conversations }) => {
        setRows(conversations);
        setSelected((current) => current ?? conversations[0]?.id ?? null);
      })
      .catch((failure: unknown) => setError(errorText(failure)));
  }, [tenant.id, filter]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    api<{ conversation: ConversationDetail }>(
      tenantPath(tenant.id, `/inbox/${encodeURIComponent(selected)}`),
    )
      .then(({ conversation }) => setDetail(conversation))
      .catch((failure: unknown) => setError(errorText(failure)));
  }, [tenant.id, selected]);

  const filters: Array<[Filter, string]> = [
    ['all', 'All'],
    ['escalated', 'Safety escalations'],
    ['sales', 'Sales'],
    ['support', 'Support'],
    ['chat', 'Web chat'],
    ['email', 'Email'],
    ['voice', 'Voice'],
  ];

  return (
    <>
      <PageHeader
        title="Inbox"
        lead="Every conversation Sunny has had, across web chat, email and phone. Safety escalations are always first."
      />
      <div className="pills" role="group" aria-label="Filter conversations">
        {filters.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className="pill"
            aria-pressed={filter === key}
            onClick={() => {
              setSelected(null);
              setFilter(key);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <ErrorNote error={error} />
      <div className="inbox">
        <div>
          {rows === null ? (
            <SkeletonRows rows={5} />
          ) : rows.length === 0 ? (
            <Card>
              <EmptyState
                pose="rest"
                sequence="relax-sunbathe"
                at={0.5}
                title="No conversations yet"
                say="All quiet. Perfect sunbathing weather."
              >
                Once Sunny’s on your website, every chat lands here.
              </EmptyState>
            </Card>
          ) : (
            <ul className="thread-list" aria-label="Conversations">
              {rows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    aria-pressed={selected === row.id}
                    className={row.escalation ? 'escalated' : undefined}
                    onClick={() => setSelected(row.id)}
                  >
                    <span className="thread-meta">
                      {row.escalation ? <Chip tone="danger">Safety escalation</Chip> : null}
                      <Chip>{CHANNEL_LABEL[row.channel]}</Chip>
                      {row.intent ? (
                        <Chip tone={row.intent === 'support' ? 'orange' : 'neutral'}>
                          {row.intent === 'support' ? 'Support' : 'Sales'}
                        </Chip>
                      ) : null}
                      {row.lead ? <Chip tone="ok">Lead · {row.lead.status}</Chip> : null}
                      <span className="muted small">{formatDate(row.updatedAt)}</span>
                    </span>
                    <span className="thread-preview">{row.preview || 'No messages yet'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Card title={detail ? `Conversation · ${CHANNEL_LABEL[detail.channel]}` : 'Conversation'}>
          {detail ? (
            <>
              {detail.escalation ? (
                <div className="escalation-banner" role="alert">
                  Safety escalation: &ldquo;{detail.escalation.reason}&rdquo; (
                  {formatDate(detail.escalation.at)}). Call this customer back now.
                </div>
              ) : null}
              <div className="transcript">
                {detail.turns.map((turn, index) => (
                  <div key={index} className={`bubble ${turn.role}`}>
                    {turn.text}
                    <time dateTime={turn.at}>{formatDate(turn.at)}</time>
                  </div>
                ))}
              </div>
              {detail.channel === 'email' ? (
                <EmailDraft tenantId={tenant.id} sessionId={detail.sessionId} />
              ) : null}
              {Object.keys(detail.answers).length > 0 ? (
                <>
                  <h3 style={{ margin: '18px 0 8px', fontSize: '1rem' }}>What Sunny collected</h3>
                  <table>
                    <tbody>
                      {Object.entries(detail.answers).map(([key, value]) => (
                        <tr key={key}>
                          <th scope="row">{key}</th>
                          <td>{value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : null}
            </>
          ) : rows && rows.length > 0 && !rows.some((row) => row.escalation) ? (
            // Calm inbox, nothing open: Sunny takes five. Never shown when a
            // safety escalation is waiting (guidelines B2, dial 0).
            <EmptyState
              pose="rest"
              sequence="relax-sunbathe"
              at={0.5}
              title="You’re all caught up"
              say="Nothing needs you right now. I’ll shout if it does."
            >
              Choose a conversation on the left to read it.
            </EmptyState>
          ) : (
            <p className="muted">Choose a conversation to read it.</p>
          )}
        </Card>
      </div>
    </>
  );
}

export default function InboxPage() {
  return (
    <PortalShell>
      <Suspense fallback={<SkeletonRows rows={5} />}>
        <Inbox />
      </Suspense>
    </PortalShell>
  );
}
