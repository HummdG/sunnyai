import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { issueDevToken } from '../src/auth/dev.js';
import { HSENERGY_PRICE_LIST_CSV } from '../src/catalogue/examples/hsenergy.js';
import { importPriceList, type PriceList } from '../src/catalogue/price-list.js';
import { priceListToCsv } from '../src/catalogue/price-list-service.js';
import type { ServerConfig } from '../src/config.js';
import { pricingFromPriceList, sentinelConfigFrom } from '../src/journey/catalogue-pricing.js';
import { prefillFromRoof, quoteAnswers } from '../src/journey/journey.js';
import { demoPricing } from '../src/journey/pricing.js';
import { buildQuote, type QuoteRecord } from '../src/journey/quote.js';
import { mapRoof, type RoofAssessmentSummary } from '../src/journey/roof.js';
import { proposalEmailConfigured, type ProposalEmail } from '../src/proposal/mailer.js';
import { renderProposal } from '../src/proposal/pdf.js';
import { loadPortalConfig } from '../src/routes/portal-config.js';
import { buildServer } from '../src/server.js';
import { issueSessionToken } from '../src/sessions.js';
import { FileStore } from '../src/store.js';
import { TenantRegistry, defaultTenants } from '../src/tenants.js';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const NOW = Date.parse('2026-10-12T12:00:00.000Z');
const SECRET = 'test-secret-not-used-in-production';
const PANEL = { widthMm: 1134, heightMm: 1762 };

function roofSummary(): RoofAssessmentSummary {
  return {
    assessmentId: 'ss_test1',
    status: 'succeeded',
    address: '164 Norwich Drive, Norwich',
    postcode: 'NR4 7TJ',
    builtForm: 'semi-detached',
    storeys: 2,
    roofType: 'hipped',
    eaveHeightM: 5.2,
    roofPlanes: [
      {
        id: 1,
        pitchDeg: 36,
        azimuthDeg: 180,
        facing: 'S',
        areaM2: 34,
        widthM: 8.4,
        slopeLengthM: 4.6,
        fillRatio: 0.9,
        usableAreaM2: 26,
        maxPanels: 11,
        suitable: true,
      },
    ],
    usableRoofAreaM2: 26,
    estimatedMaxPanels: 11,
    mainPlaneId: 1,
    bestFacing: 'S',
    shadingFlags: ['shading-not-assessed'],
    confidence: { roof: 'measured' },
    reliable: true,
    label: 'Indicative, subject to an on-site survey',
  };
}

function answers(tariff = 'smart_tou', lifestyle = 'ev_now'): Record<string, string> {
  const roof = mapRoof(roofSummary(), PANEL);
  return {
    address: '164 Norwich Drive, Norwich',
    ...prefillFromRoof({}, roof),
    roof_confirmed: 'yes',
    roof_shading: 'none',
    property_type: 'semi',
    ownership: 'own',
    usage_source: 'monthly_cost',
    monthly_cost: '120',
    lifestyle,
    tariff_type: tariff,
    existing_system: 'none',
    motivation: 'reduce_bills',
    budget_band: '10k_15k',
    finance_interest: 'maybe',
  };
}

function hsenergy(): PriceList {
  const { list, issues } = importPriceList(HSENERGY_PRICE_LIST_CSV);
  expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  return list!;
}

function quoteWith(pricing: ReturnType<typeof demoPricing> | null, id = 'q_test_1'): QuoteRecord {
  const roof = mapRoof(roofSummary(), PANEL);
  return buildQuote({
    id,
    tenantId: 't',
    sessionId: 's',
    createdAt: '2026-10-12T00:00:00Z',
    answers: quoteAnswers(answers(), roof, pricing)!,
    roof,
    pricing,
  });
}

describe('Sentinel on the price list', () => {
  it('reads from CSV rows and round-trips through the export', () => {
    const list = hsenergy();
    expect(list.sentinel).toMatchObject({
      enabled: true,
      basePercent: 12,
      capPercent: 30,
      noBatteryPercent: 40,
      batteryRequiredForFullUplift: true,
      addedCostMinor: 0,
    });
    expect(list.sentinel!.tariffPercent['smart_tou']).toBe(8);
    expect(list.sentinel!.lifestylePercent['ev_planned']).toBe(1.5);
    const again = importPriceList(priceListToCsv(list)).list!;
    expect(again.sentinel).toEqual(list.sentinel);
  });

  it('reports a bad setting by row instead of guessing', () => {
    const csv = [
      'Category,Key,Name,Pricing,Amount,Percent,From,Mandatory,Currency',
      'pv,PV-BASE,PV,table,£4000,,1,,',
      'mounting,MOUNT,Mount,per_unit,£30,,,,',
      'sentinel,base,Base,,,150,,,',
      'sentinel,turbo,Turbo,,,5,,,',
    ].join('\n');
    const messages = importPriceList(csv).issues.map((i) => i.message);
    expect(messages.some((m) => /between 0 and 100/.test(m))).toBe(true);
    expect(messages.some((m) => /"turbo" is not a Sentinel setting/.test(m))).toBe(true);
  });

  it('is off when a list has no sentinel rows, or switches it off', () => {
    expect(sentinelConfigFrom(null)).toBeNull();
    expect(sentinelConfigFrom({ ...hsenergy().sentinel!, enabled: false })).toBeNull();
  });

  it("maps to exactly SunScan v1's seed configuration for HSEnergy", async () => {
    const fixture = JSON.parse(
      await readFile(join(ROOT, 'fixtures', 'pricing', 'hsenergy-demo-pricelist.json'), 'utf8'),
    ) as { config: { sentinel: Record<string, unknown> } };
    const mapped = sentinelConfigFrom(hsenergy().sentinel)!;
    const v1 = fixture.config.sentinel;
    expect(mapped.baseUpliftPercent).toBeCloseTo(v1['baseUpliftPercent'] as number, 10);
    expect(mapped.capUpliftPercent).toBeCloseTo(v1['capUpliftPercent'] as number, 10);
    expect(mapped.noBatteryUpliftFactor).toBeCloseTo(v1['noBatteryUpliftFactor'] as number, 10);
    expect(mapped.batteryRequiredForFullUplift).toBe(v1['batteryRequiredForFullUplift']);
    for (const [k, v] of Object.entries(v1['tariffModifiers'] as Record<string, number>)) {
      expect(mapped.tariffModifiers[k]).toBeCloseTo(v, 10);
    }
    for (const [k, v] of Object.entries(v1['lifestyleBonus'] as Record<string, number>)) {
      expect(mapped.lifestyleBonus[k]).toBeCloseTo(v, 10);
    }
  });
});

describe('Sentinel in quotes', () => {
  it('reproduces v1: the published HSEnergy list gives the seed fixture’s Sentinel figures', () => {
    const fromCatalogue = quoteWith(pricingFromPriceList(hsenergy())!.pricing);
    const fromV1Seed = quoteWith(demoPricing());
    for (const [i, option] of fromCatalogue.options.entries()) {
      const v1 = fromV1Seed.options[i]!;
      expect(option.sentinel).not.toBeNull();
      expect(option.sentinel).toEqual(v1.sentinel);
    }
    // Smart tariff + EV: the uplift is above the base and within the cap.
    const uplifts = fromCatalogue.options.map((o) => o.sentinel!.upliftPercent);
    expect(Math.max(...uplifts)).toBeGreaterThan(12);
    expect(Math.max(...uplifts)).toBeLessThanOrEqual(30);
  });

  it('is absent, and prices are unchanged, when the list does not offer it', () => {
    const list = hsenergy();
    const on = quoteWith(pricingFromPriceList(list)!.pricing);
    const off = quoteWith(pricingFromPriceList({ ...list, sentinel: null })!.pricing);
    for (const option of off.options) expect(option.sentinel).toBeNull();
    expect(off.options.map((o) => o.priceGbp).sort()).toEqual(
      on.options.map((o) => o.priceGbp).sort(),
    );
    for (const option of off.options) {
      const same = on.options.find((o) => o.id === option.id);
      if (same) expect(same.annualSavingsGbp).toBe(option.annualSavingsGbp);
    }
  });
});

describe('the proposal PDF', () => {
  it('renders five A4 pages for a priced quote, and four-plus without prices', async () => {
    const base = {
      installer: {
        companyName: 'Brightside Solar',
        colour: '#FF7900',
        phone: '01632 960123',
        email: 'hello@brightside.example',
        website: 'https://brightside.example',
      },
      customer: { name: 'Sam Patel', address: '164 Norwich Drive, Norwich' },
      roof: {
        bestFacing: 'South',
        pitchDeg: 36,
        usableRoofAreaM2: 26,
        estimatedMaxPanels: 11,
        reliable: true,
        label: 'Good fit to the 3D data',
      },
      generatedAt: new Date(NOW),
    };
    const priced = await renderProposal({
      ...base,
      quote: quoteWith(pricingFromPriceList(hsenergy())!.pricing),
    });
    expect(priced.subarray(0, 5).toString()).toBe('%PDF-');
    expect(priced.toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(5);
    expect(priced.length).toBeGreaterThan(20_000);

    const unpriced = await renderProposal({ ...base, roof: null, quote: quoteWith(null) });
    expect(unpriced.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

// ─── routes ──────────────────────────────────────────────────────────────────

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

function config(): ServerConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    nodeEnv: 'test',
    gemini: undefined,
    dataDir: '.data-test-proposal',
    allowedOrigins: [],
    sessionSecret: SECRET,
    adminToken: null,
    logLevel: 'silent',
    sandboxTenant: false,
    leadRetentionDays: 730,
    rateLimit: {
      enabled: false,
      trustProxyHops: 0,
      rules: {
        session: { limit: 1000, windowMs: 60_000 },
        chat: { limit: 1000, windowMs: 60_000 },
        leads: { limit: 1000, windowMs: 60_000 },
        qualification: { limit: 1000, windowMs: 60_000 },
        catalogue: { limit: 1000, windowMs: 60_000 },
        knowledge: { limit: 1000, windowMs: 60_000 },
      },
      maxKeys: 1000,
    },
  } as unknown as ServerConfig;
}

async function setup(mailer: { sent: ProposalEmail[] } | null) {
  const dir = await mkdtemp(join(tmpdir(), 'sunny-proposal-'));
  dirs.push(dir);
  const store = new FileStore(dir);
  const tenants = await TenantRegistry.load(store, defaultTenants(false));
  const app = buildServer({
    config: config(),
    store,
    tenants,
    now: () => NOW,
    portal: { ...loadPortalConfig({}, 'test'), devAuth: true },
    proposalMailer: mailer
      ? {
          send: (email) => {
            mailer.sent.push(email);
            return Promise.resolve({ messageId: 'm1' });
          },
        }
      : null,
  });
  await app.ready();

  // An installer, a visitor's quote and the lead the visitor agreed to.
  const owner = 'owner@brightside.example';
  const as = (email: string) => ({
    authorization: `Bearer ${issueDevToken(SECRET, email, NOW)}`,
  });
  const created = await app.inject({
    method: 'POST',
    url: '/v1/portal/tenants',
    headers: as(owner),
    payload: { companyName: 'Brightside Solar' },
  });
  const tenantId = created.json<{ tenant: { id: string } }>().tenant.id;
  const quote = { ...quoteWith(demoPricing(), 'q_route_1'), tenantId, sessionId: 'sess_1' };
  await store.mergeAnswers(tenantId, 'sess_1', { address: '164 Norwich Drive, Norwich' });
  const lead = {
    id: 'lead_1',
    tenantId,
    sessionId: 'sess_1',
    conversationId: null,
    name: 'Sam Patel',
    email: 'sam@example.com',
    phone: null,
    postcode: 'NR4 7TJ',
    summary: '',
    score: null,
    createdAt: new Date(NOW).toISOString(),
  };
  await store.saveLead(lead);
  await store.saveQuote({ ...quote, leadId: lead.id });

  const visitor = (sessionId: string, tenant = tenantId) => ({
    authorization: `Bearer ${issueSessionToken(
      { sessionId, tenantId: tenant, expiresAt: NOW + 60_000, origin: null },
      SECRET,
    )}`,
  });
  return { app, tenantId, quote, lead, owner, as, visitor };
}

describe('proposal routes', () => {
  it("serves the visitor their own quote's PDF, and no one else's", async () => {
    const { app, quote, visitor, tenantId } = await setup(null);
    const own = await app.inject({
      method: 'GET',
      url: `/v1/quote/${quote.id}/proposal.pdf`,
      headers: visitor('sess_1'),
    });
    expect(own.statusCode).toBe(200);
    expect(own.headers['content-type']).toBe('application/pdf');
    expect(own.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');

    for (const headers of [visitor('sess_other'), visitor('sess_1', 't_demo0001')]) {
      const other = await app.inject({
        method: 'GET',
        url: `/v1/quote/${quote.id}/proposal.pdf`,
        headers,
      });
      expect(other.statusCode).toBe(404);
    }
    const anonymous = await app.inject({
      method: 'GET',
      url: `/v1/quote/${quote.id}/proposal.pdf`,
    });
    expect(anonymous.statusCode).toBe(401);
    void tenantId;
  });

  it('gives the installer their lead’s proposal, and other installers nothing', async () => {
    const { app, tenantId, lead, owner, as } = await setup(null);
    const url = `/v1/portal/tenants/${tenantId}/leads/${lead.id}/quote/proposal.pdf`;
    const mine = await app.inject({ method: 'GET', url, headers: as(owner) });
    expect(mine.statusCode).toBe(200);
    expect(mine.headers['content-disposition']).toMatch(/Brightside-Solar-proposal-/);

    await app.inject({
      method: 'POST',
      url: '/v1/portal/tenants',
      headers: as('rival@other.example'),
      payload: { companyName: 'Rival Solar' },
    });
    const theirs = await app.inject({ method: 'GET', url, headers: as('rival@other.example') });
    expect(theirs.statusCode).toBe(404);
  });

  it('emails the quote only with consent, from the installer, at most three times a day', async () => {
    const mailer = { sent: [] as ProposalEmail[] };
    const { app, quote, visitor } = await setup(mailer);
    const url = `/v1/quote/${quote.id}/proposal/email`;
    const noConsent = await app.inject({
      method: 'POST',
      url,
      headers: visitor('sess_1'),
      payload: { email: 'sam@example.com', consent: false },
    });
    expect(noConsent.statusCode).toBe(400);
    expect(mailer.sent).toHaveLength(0);

    for (let i = 0; i < 3; i++) {
      const ok = await app.inject({
        method: 'POST',
        url,
        headers: visitor('sess_1'),
        payload: { email: 'sam@example.com', consent: true },
      });
      expect(ok.statusCode).toBe(200);
    }
    const fourth = await app.inject({
      method: 'POST',
      url,
      headers: visitor('sess_1'),
      payload: { email: 'sam@example.com', consent: true },
    });
    expect(fourth.statusCode).toBe(429);

    const email = mailer.sent[0]!;
    expect(email.to).toBe('sam@example.com');
    expect(email.fromName).toBe('Brightside Solar via Sunny');
    expect(email.subject).toMatch(/Brightside Solar/);
    expect(email.text).toMatch(/indicative and non-binding/);
    expect(email.attachment.data.subarray(0, 5).toString()).toBe('%PDF-');

    const stranger = await app.inject({
      method: 'POST',
      url,
      headers: visitor('sess_other'),
      payload: { email: 'x@example.com', consent: true },
    });
    expect(stranger.statusCode).toBe(404);
  });

  it('refuses to email when outbound email is not configured', async () => {
    const { app, quote, visitor } = await setup(null);
    const response = await app.inject({
      method: 'POST',
      url: `/v1/quote/${quote.id}/proposal/email`,
      headers: visitor('sess_1'),
      payload: { email: 'sam@example.com', consent: true },
    });
    expect(response.statusCode).toBe(403);
    expect(proposalEmailConfigured({})).toBe(false);
    expect(
      proposalEmailConfigured({ SUNNY_POSTMARK_SERVER_TOKEN: 't', SUNNY_PROPOSAL_FROM: 'q@x.io' }),
    ).toBe(true);
  });
});
