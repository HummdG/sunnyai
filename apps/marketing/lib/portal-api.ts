/**
 * The installer dashboard's API client and types. Calls go through this app's
 * same-origin proxy (`app/api/portal`), which carries the HttpOnly session
 * cookie to the API; the API resolves the caller's role on every request.
 */

import type {
  ConversationFlow,
  FlowChoice,
  FlowEffect,
  FlowFollowUp,
  FlowStep,
  LeadFlowAnswer,
  LogoEffect,
  PageRule,
  QuotationSettings,
  Workflow,
  WorkflowOutcome,
  WorkflowSet,
} from '@sunny/contracts';

export type {
  ConversationFlow,
  FlowChoice,
  FlowEffect,
  FlowFollowUp,
  FlowStep,
  LogoEffect,
  PageRule,
  QuotationSettings,
  Workflow,
  WorkflowOutcome,
  WorkflowSet,
};
export type Role = 'viewer' | 'sales' | 'admin' | 'owner';
export type AddonKey = 'web_chat' | 'email_assistant';
export type Channel = 'chat' | 'email';
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
  connections: Record<AddonKey, Connection>;
  installSnippet: string;
  /** What the assistant calls itself; `Sunny` unless the installer renamed it. */
  assistantName: string;
  branding: {
    mode: 'sunny' | 'logo';
    icon: BrandAssetView | null;
    wordmark: BrandAssetView | null;
    effects: LogoEffect[];
    colors: BrandColors | null;
  };
}

export interface BrandColors {
  primary: string;
  glow: string;
}

/** An uploaded logo image. `url` and `maskUrl` are portal paths, read through the proxy. */
export interface BrandAssetView {
  id: string;
  kind: 'icon' | 'wordmark' | 'pdf-logo' | 'accreditation';
  width: number;
  height: number;
  outline: string | null;
  availableEffects: LogoEffect[];
  suggestedColors: BrandColors | null;
  /** The chip the logo sits on: light for a dark or colourful logo, dark for a pale one. */
  plate?: 'light' | 'dark';
  url: string;
  maskUrl: string | null;
}

/** A portal path as the browser loads it: through this app's same-origin proxy. */
export function portalUrl(path: string): string {
  return `/api/portal${path}`;
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
  /** The installer's questions and the visitor's answers, in the flow's order. */
  flowAnswers?: LeadFlowAnswer[];
  flowVersion?: number;
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
  plans: Array<{ key: 'base' | 'email' | 'suite'; available: boolean }>;
  addons: Record<AddonKey, boolean>;
  billing: TenantView['billing'];
  hasCustomer: boolean;
  connections: Record<AddonKey, Connection>;
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
    /** The error response's whole body, for routes that explain more than one thing. */
    readonly body: unknown = null,
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
      body,
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
  'base' | 'email' | 'suite',
  { name: string; price: string; blurb: string }
> = {
  base: {
    name: 'Base',
    price: '£199/mo',
    blurb: 'Web chat, website & Drive knowledge, lead capture',
  },
  email: {
    name: 'Email Assistant',
    price: '+£99/mo',
    blurb: 'Grounded reply drafts in your inbox',
  },
  suite: {
    name: 'Full Suite',
    price: '£449/mo',
    blurb: 'Web chat and the Email Assistant, on one knowledge base',
  },
};

export const ADDON_LABELS: Record<AddonKey, string> = {
  web_chat: 'Web chat',
  email_assistant: 'Email Assistant',
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

// ── the quote conversation (Studio's "Your conversation") ─────────────────

/** One of Sunny's own questions, as the editor draws it. */
export interface PresetView {
  id: string;
  prompt: string;
  options: Array<{ value: string; label: string }>;
  /** Part of the fixed start: shown locked. */
  fixed: boolean;
  /** What the quote loses without it, shown before removal; null when it feeds only the lead. */
  warning: string | null;
  /** The presets asked with this one, moved and removed with it. */
  group: string[];
  /** The earlier answer this question waits on (a group member's, say), or null. */
  appearsWhen: { questionId: string; anyOf: string[] } | null;
}

/** A published price-list item an answer might add, remove or swap. */
export interface PriceItemView {
  key: string;
  name: string;
  category: string;
  unitLabel: string;
  /** Priced per panel: the quantity comes from each package. */
  packageUnit: boolean;
  /** An answer adds this item in a quantity the installer sets (the server's rule). */
  needsQuantity: boolean;
  mandatory: boolean;
  targetable: boolean;
  priceText: string;
}

/** Something in a flow the installer must fix, placed beside its question. */
export interface FlowIssue {
  stepId: string;
  choice?: string;
  code:
    | 'missing_item'
    | 'mandatory_item'
    | 'not_targetable'
    | 'needs_quantity'
    | 'bad_parent'
    | 'duplicate_id'
    | 'no_choices';
  message: string;
}

export interface ConversationView {
  /** Null while the installer uses Sunny's own questions. */
  flow: ConversationFlow | null;
  presets: PresetView[];
  priceItems: PriceItemView[];
  issues: FlowIssue[];
}

export interface ConversationPreview {
  next: { id: string; prompt: string; options: Array<{ value: string; label: string }> } | null;
  /** Every effect the answers trigger, in flow order, with the answer that causes it. */
  effects: Array<{ label: string; priceText: string; questionId: string; value: string }>;
  issues: FlowIssue[];
}

const conversationPath = (tenantId: string, rest = '') =>
  tenantPath(tenantId, `/conversation${rest}`);

export function getConversation(tenantId: string): Promise<ConversationView> {
  return api<ConversationView>(conversationPath(tenantId));
}

/** Save a flow. A 400 carries `issues` in the `ApiFailure` body; see `flowIssuesOf`. */
export function saveConversation(
  tenantId: string,
  flow: ConversationFlow,
): Promise<ConversationView> {
  return api<ConversationView>(conversationPath(tenantId), { method: 'PUT', body: { flow } });
}

/** Back to Sunny's own questions. */
export function resetConversation(tenantId: string): Promise<ConversationView> {
  return api<ConversationView>(conversationPath(tenantId), { method: 'DELETE' });
}

/** What Sunny asks next and what the answers do to the quote. No chat runs. */
export function previewConversation(
  tenantId: string,
  flow: ConversationFlow,
  answers: Record<string, string>,
): Promise<ConversationPreview> {
  return api<ConversationPreview>(conversationPath(tenantId, '/preview'), {
    body: { flow, answers },
  });
}

/** The issues a rejected save explained, or none. */
export function flowIssuesOf(failure: unknown): FlowIssue[] {
  if (!(failure instanceof ApiFailure)) return [];
  const issues = (failure.body as { issues?: unknown } | null)?.issues;
  return Array.isArray(issues) ? (issues as FlowIssue[]) : [];
}

/** What Sunny would have each answer of a question do to the price, from the published list. */
export interface PriceSuggestion {
  /** Each answer Sunny worked out, by value. An answer missing here was not worked out. */
  effects: Record<string, FlowEffect[]>;
}

/** Ask Sunny for a question's price changes. Admins and owners only; never fails on the model. */
export function suggestPriceChanges(
  tenantId: string,
  question: { prompt: string; choices: Array<{ value: string; label: string }> },
): Promise<PriceSuggestion> {
  return api<PriceSuggestion>(conversationPath(tenantId, '/suggest'), { body: question });
}

// ── workflows (Studio's workflow builder) ──────────────────────────────────

export interface WorkflowIssue {
  workflowId: string;
  stepId?: string;
  choice?: string;
  field?: 'pages' | 'steps' | 'interests';
  code:
    | FlowIssue['code']
    | 'needs_address'
    | 'bad_page_pattern'
    | 'duplicate_step_id'
    | 'interest_overlap';
  message: string;
  /** Worth knowing, but it does not stop a save. */
  warning?: boolean;
}

export interface WorkflowSetView {
  set: WorkflowSet;
  /** The set was made from the installer's earlier settings and is not yet saved. */
  migrated: boolean;
  /**
   * The saved set could not be read: `set` is Sunny's defaults, and every
   * change is refused until it is put right.
   */
  unreadable?: boolean;
  /** The solar bank's presets (older APIs send only these). */
  presets: PresetView[];
  /** Each workflow's presets, from the bank its outcome draws on. */
  presetsByWorkflow?: Record<string, PresetView[]>;
  priceItems: PriceItemView[];
  issues: WorkflowIssue[];
}

export interface WorkflowView {
  workflow: Workflow;
  presets: PresetView[];
  priceItems: PriceItemView[];
  issues: WorkflowIssue[];
}

export interface WorkflowPreview extends Omit<ConversationPreview, 'issues'> {
  issues: WorkflowIssue[];
  /** Whether the workflow is offered on `path`; null when no path was given. */
  appearsOnPage: boolean | null;
}

const workflowPath = (tenantId: string, rest = '') => tenantPath(tenantId, `/workflows${rest}`);
const workflowIdPath = (tenantId: string, id: string, rest = '') =>
  workflowPath(tenantId, `/${encodeURIComponent(id)}${rest}`);

export function getWorkflows(tenantId: string): Promise<WorkflowSetView> {
  return api<WorkflowSetView>(workflowPath(tenantId));
}

/** Start from the solar template, a blank workflow, or a copy of one of the installer's own. */
export function createWorkflow(
  tenantId: string,
  from: 'solar_quote' | 'blank' | { copy: string },
  name?: string,
): Promise<{ workflow: Workflow; view: WorkflowSetView }> {
  return api<{ workflow: Workflow; view: WorkflowSetView }>(workflowPath(tenantId), {
    body: { from, ...(name === undefined ? {} : { name }) },
  });
}

export function getWorkflow(tenantId: string, id: string): Promise<WorkflowView> {
  return api<WorkflowView>(workflowIdPath(tenantId, id));
}

/**
 * Save a workflow at the version it was loaded. A 409 (someone else saved first)
 * and a 400 with `issues` arrive as an `ApiFailure`; see `workflowIssuesOf`.
 */
export function saveWorkflow(tenantId: string, workflow: Workflow): Promise<WorkflowSetView> {
  return api<WorkflowSetView>(workflowIdPath(tenantId, workflow.id), {
    method: 'PUT',
    body: { workflow },
  });
}

export function deleteWorkflow(tenantId: string, id: string): Promise<WorkflowSetView> {
  return api<WorkflowSetView>(workflowIdPath(tenantId, id), { method: 'DELETE' });
}

/** A built-in workflow back to its template. */
export function resetWorkflow(tenantId: string, id: string): Promise<WorkflowSetView> {
  return api<WorkflowSetView>(workflowIdPath(tenantId, id, '/reset'), { method: 'POST', body: {} });
}

export function previewWorkflow(
  tenantId: string,
  workflow: Workflow,
  answers: Record<string, string>,
  path?: string,
): Promise<WorkflowPreview> {
  return api<WorkflowPreview>(workflowIdPath(tenantId, workflow.id, '/preview'), {
    body: { workflow, answers, ...(path === undefined ? {} : { path }) },
  });
}

export function suggestWorkflowPriceChanges(
  tenantId: string,
  workflowId: string,
  question: { prompt: string; choices: Array<{ value: string; label: string }> },
): Promise<PriceSuggestion> {
  return api<PriceSuggestion>(workflowIdPath(tenantId, workflowId, '/suggest'), {
    body: question,
  });
}

export function saveWorkflowSettings(
  tenantId: string,
  settings: { discoveryEnabled: boolean },
): Promise<WorkflowSetView> {
  return api<WorkflowSetView>(workflowPath(tenantId, '/settings'), {
    method: 'PUT',
    body: settings,
  });
}

/** The issues a rejected workflow save explained, or none. */
export function workflowIssuesOf(failure: unknown): WorkflowIssue[] {
  if (!(failure instanceof ApiFailure)) return [];
  const issues = (failure.body as { issues?: unknown } | null)?.issues;
  return Array.isArray(issues) ? (issues as WorkflowIssue[]) : [];
}

function trimSlash(s: string): string {
  return s.length > 1 ? s.replace(/\/+$/, '') || '/' : s;
}

function compileGlob(glob: string): RegExp {
  const g = trimSlash(glob);
  let src = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i]!;
    if (c === '*') {
      if (g[i + 1] === '*') {
        src += '.*';
        i++;
      } else src += '[^/]*';
    } else src += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${src}$`);
}

/**
 * Whether a page rule offers a workflow on a path. A copy of `pathMatches` in
 * @sunny/contracts (workflow.ts), kept here so zod stays out of the page; keep
 * the two the same.
 */
export function pathMatches(rule: PageRule, path: string | null): boolean {
  if (path === null) return rule.include.length === 0;
  const p = trimSlash(path);
  if (rule.exclude.some((g) => compileGlob(g).test(p))) return false;
  return rule.include.length === 0 || rule.include.some((g) => compileGlob(g).test(p));
}

// ── the quotation PDF (Studio's "Your quotation") ──────────────────────────

/** The API's limits (`QUOTATION_LIMITS` in @sunny/contracts), kept here so zod stays out of the page. */
export const QUOTATION_LIMITS = {
  terms: 40000,
  line: 200,
  accreditationLogos: 8,
  validityMin: 1,
  validityMax: 365,
  percentMin: 1,
  percentMax: 100,
  fixedMin: 1,
  fixedMax: 1000000,
} as const;

/** What PUT and the preview take: the settings without the server's version and time. */
export type QuotationInput = Omit<QuotationSettings, 'version' | 'updatedAt'>;

export interface QuotationView {
  settings: QuotationSettings;
  /** False until the installer first saves: the settings are then the defaults. */
  saved: boolean;
  assets: { logo: BrandAssetView | null; accreditations: BrandAssetView[] };
  /** The saved colours as the PDF uses them, and whether a chosen one was adjusted. */
  colourNotes: {
    rail: { hex: string; adjusted: boolean };
    accent: { hex: string; adjusted: boolean };
  };
}

const quotationPath = (tenantId: string, rest = '') => tenantPath(tenantId, `/quotation${rest}`);

export function getQuotation(tenantId: string): Promise<QuotationView> {
  return api<QuotationView>(quotationPath(tenantId));
}

export function saveQuotation(tenantId: string, settings: QuotationInput): Promise<QuotationView> {
  return api<QuotationView>(quotationPath(tenantId), { method: 'PUT', body: { settings } });
}

/** A PDF answer, or why there is none: `retryAfterSec` is set when the limit was reached. */
export type PdfResult =
  | { ok: true; blob: Blob; fileName: string | null }
  | { ok: false; status: number; message: string; retryAfterSec: number | null };

async function pdfFrom(response: Response): Promise<PdfResult> {
  if (response.ok) {
    const disposition = response.headers.get('content-disposition') ?? '';
    const named = /filename="?([^";]+)"?/i.exec(disposition);
    return { ok: true, blob: await response.blob(), fileName: named?.[1] ?? null };
  }
  const body = (await response.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  const retry = Number(response.headers.get('retry-after'));
  return {
    ok: false,
    status: response.status,
    message: body?.error?.message ?? `Request failed (${response.status})`,
    retryAfterSec: response.status === 429 ? (retry > 0 ? retry : 20) : null,
  };
}

/** The real PDF, drawn from a sample quote with these (unsaved) settings. */
export async function previewQuotation(
  tenantId: string,
  settings: QuotationInput,
  signal?: AbortSignal,
): Promise<PdfResult> {
  const response = await fetch(`/api/portal${quotationPath(tenantId, '/preview')}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { [CSRF_HEADER]: '1', 'content-type': 'application/json' },
    body: JSON.stringify({ settings }),
    ...(signal ? { signal } : {}),
  });
  return pdfFrom(response);
}

/** The sample PDF with the saved settings, as a download. */
export async function sampleQuotation(tenantId: string): Promise<PdfResult> {
  const response = await fetch(`/api/portal${quotationPath(tenantId, '/sample.pdf')}`, {
    credentials: 'same-origin',
    headers: { [CSRF_HEADER]: '1' },
  });
  return pdfFrom(response);
}
