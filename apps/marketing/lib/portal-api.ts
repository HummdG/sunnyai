/**
 * The installer dashboard's API client and types. Calls go through this app's
 * same-origin proxy (`app/api/portal`), which carries the HttpOnly session
 * cookie to the API; the API resolves the caller's role on every request.
 */

export type Role = 'viewer' | 'sales' | 'admin' | 'owner';
export type AddonKey = 'web_chat' | 'email_assistant' | 'voice_widget' | 'phone_agent';
export type Channel = 'chat' | 'voice' | 'email';
export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'won' | 'lost';
export type SyncStatus = 'disconnected' | 'pending' | 'syncing' | 'connected' | 'failed';
export type OnboardingStep =
  'organisation' | 'website' | 'drive' | 'customise' | 'install' | 'live';

export interface Connection {
  connected: boolean;
  detail: string;
  autoSend?: boolean;
}

export interface TenantView {
  id: string;
  publicId: string;
  role: Role;
  companyName: string;
  tagline: string | null;
  greeting: string;
  primaryColor: string;
  position: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  suggestions: string[];
  supportContact: { phone?: string; email?: string; hours?: string } | null;
  websiteUrl: string | null;
  gdriveFolderId: string | null;
  domains: string[];
  onboarding: { step: OnboardingStep; completedAt: string | null };
  addons: Record<AddonKey, boolean>;
  billing: {
    status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'none';
    graceUntil: string | null;
  } | null;
  email: {
    provider: 'gmail' | 'outlook' | 'forwarding';
    inboundAddress?: string;
    autoSend: boolean;
    signatureName?: string;
  } | null;
  voice: {
    twilioNumbers?: string[];
    voiceName?: string;
    maxCallSeconds: number;
    concurrency: number;
    bookingUrl?: string;
    disclosure?: string;
  } | null;
  connections: Record<AddonKey, Connection>;
  installSnippet: string;
}

export interface Overview {
  conversations: {
    total: number;
    last30Days: number;
    byChannel: Record<Channel, number>;
    byIntent: { sales: number; support: number; unclassified: number };
    escalations: number;
  };
  leads: { total: number; new: number; last30Days: number };
  knowledge: { sources: number; placeholders: number };
  warnings: Array<{ id: string; text: string; href: string }>;
}

export interface Escalation {
  kind: 'safety';
  reason: string;
  at: string;
}

export interface InboxRow {
  id: string;
  channel: Channel;
  intent: 'sales' | 'support' | null;
  escalation: Escalation | null;
  startedAt: string;
  updatedAt: string;
  messages: number;
  preview: string;
  lead: { id: string; name: string | null; status: LeadStatus } | null;
}

export interface ConversationDetail {
  id: string;
  sessionId: string;
  channel: Channel;
  intent: 'sales' | 'support' | null;
  escalation: Escalation | null;
  startedAt: string;
  answers: Record<string, string>;
  turns: Array<{ role: 'user' | 'assistant'; text: string; at: string }>;
}

export interface LeadRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  postcode: string | null;
  summary: string;
  createdAt: string;
  conversationId: string | null;
  status: LeadStatus;
  assessmentId: string | null;
}

/** How far a running sync has got (null when nothing is running). */
export interface SyncProgress {
  phase: 'reading' | 'indexing';
  done: number;
  total: number | null;
}

export interface KnowledgeView {
  website: {
    status: SyncStatus;
    target: string | null;
    at: string | null;
    error: string | null;
    progress?: SyncProgress | null;
  };
  drive: {
    status: SyncStatus;
    target: string | null;
    at: string | null;
    error: string | null;
    serviceAccountEmail: string | null;
    progress?: SyncProgress | null;
  };
  syncAvailable: { website: boolean; drive: boolean };
  sources: Array<{
    id: string;
    title: string;
    url: string | null;
    updatedAt: string;
    characters: number;
    warnings: Array<{ kind: string; text: string; section: string | null }>;
  }>;
}

export interface BillingView {
  stripeConfigured: boolean;
  plans: Array<{ key: 'base' | 'email' | 'voice' | 'suite'; available: boolean }>;
  addons: Record<AddonKey, boolean>;
  billing: TenantView['billing'];
  hasCustomer: boolean;
  connections: Record<AddonKey, Connection>;
  voice: { numbers: string[]; minutesUsed: number | null; minutesQuota: number | null };
}

export interface Member {
  email: string;
  role: Role;
  joined: boolean;
  since: string;
}

// ── calling the API ────────────────────────────────────────────────────────
//
// The browser never holds a credential. Every call goes to this app's own
// `/api/portal/...` proxy, which adds the Sunny session from the HttpOnly
// cookie set at sign-in and forwards to the API. Mutating calls carry a
// custom header the proxy requires, which a cross-site form cannot send.

export const CSRF_HEADER = 'x-sunny-csrf';

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  init: { method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; body?: unknown } = {},
): Promise<T> {
  const method = init.method ?? (init.body === undefined ? 'GET' : 'POST');
  const response = await fetch(`/api/portal${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      [CSRF_HEADER]: '1',
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new ApiFailure(
      response.status,
      body?.error?.message ?? `Request failed (${response.status})`,
    );
  }
  const type = response.headers.get('content-type') ?? '';
  return (type.includes('json') ? await response.json() : await response.text()) as T;
}

/** A path under the current installer. */
export function tenantPath(tenantId: string, rest = ''): string {
  return `/v1/portal/tenants/${encodeURIComponent(tenantId)}${rest}`;
}

export const PLAN_LABELS: Record<
  'base' | 'email' | 'voice' | 'suite',
  { name: string; price: string; blurb: string }
> = {
  base: {
    name: 'Base',
    price: '$199/mo',
    blurb: 'Web chat, website & Drive knowledge, lead capture',
  },
  email: {
    name: 'Email Assistant',
    price: '+$99/mo',
    blurb: 'Grounded reply drafts in your inbox',
  },
  voice: {
    name: 'Voice & Phone',
    price: '+$199/mo',
    blurb: 'Web voice and an AI phone receptionist',
  },
  suite: { name: 'Full Suite', price: '$449/mo', blurb: 'Everything, on one knowledge base' },
};

export const ADDON_LABELS: Record<AddonKey, string> = {
  web_chat: 'Web chat',
  email_assistant: 'Email Assistant',
  voice_widget: 'Web voice',
  phone_agent: 'Phone receptionist',
};

export interface EmailThread {
  sessionId: string;
  provider: 'gmail' | 'outlook' | 'none';
  draftId: string | null;
  webLink: string | null;
  sentMessageId: string | null;
  outcome: string;
  subject: string;
  at: string;
  draftText: string;
  notes: string[];
}

/**
 * Download a file from an authenticated route (template, export). A plain link
 * cannot carry the sign-in token, so the file is fetched and handed to the
 * browser as a blob.
 */
export async function download(path: string, fileName: string): Promise<void> {
  const text = await api<string>(path);
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
