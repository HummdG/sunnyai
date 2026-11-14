import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkflowSet } from '@sunny/contracts';
import { EMPTY_KNOWLEDGE } from '@sunny/knowledge';
import type { GoogleSolarBuildingInsights } from '@sunny/quote-engine';

import { runTurn, type TurnEvent } from '../src/agent/agent.js';
import { CHANNEL_POLICIES } from '../src/agent/channels.js';
import { executeTool, type ToolContext, type ToolEvent } from '../src/agent/tools.js';
import {
  ageBandOf,
  answersFromCertificate,
  fuelOf,
  glazingOf,
  isSameHome,
  loftOf,
  lookUpEpc,
  sharedAnswers,
  wallsOf,
  type EpcCertificate,
  type EpcClient,
  type EpcSearchRow,
} from '../src/homedata/epc.js';
import {
  HOME_KEYS,
  clearHomeDataCache,
  homeDataFromEnv,
  lookUpHome,
  type HomeData,
} from '../src/homedata/index.js';
import {
  compactInsights,
  lookUpGoogleRoof,
  parseGoogleRoof,
  type SolarClient,
} from '../src/homedata/solar.js';
import type { HeatPumpQuoteRecord } from '../src/journey/heat-pump/record.js';
import { quoteAnswers } from '../src/journey/journey.js';
import { demoPricing } from '../src/journey/pricing.js';
import type { QuoteRecord } from '../src/journey/quote.js';
import { FileStore } from '../src/store.js';
import { DEMO_TENANT } from '../src/tenants.js';
import { EMPTY_SESSION, cloneSession } from '../src/workflows/session.js';
import { defaultWorkflowSet, heatPumpTemplate } from '../src/workflows/templates.js';
import { ScriptedProvider } from './scripted-provider.js';
import { resolvedFlowFor } from '../src/workflows/tenant.js';

const SESSION = 'sess_homedata';
const NOW = '2026-11-12T10:00:00.000Z';
const ADDRESS = '12 Mill Lane, Norwich NR4 7TJ';

// ── Certificates shaped like the register's published samples ──────────────

/** RdSAP 20: descriptions as plain strings. */
const RDSAP_20: EpcCertificate = {
  schema_type: 'RdSAP-Schema-20.0.0',
  dwelling_type: 'Semi-detached house',
  total_floor_area: 92,
  registration_date: '2014-05-04',
  walls: [{ description: 'Cavity wall, filled cavity' }],
  roofs: [{ description: 'Pitched, 270 mm loft insulation' }],
  window: { description: 'Fully double glazed' },
  main_heating: [{ description: 'Boiler and radiators, mains gas' }],
  hot_water: { description: 'From main system' },
  sap_heating: { cylinder_size: 1 },
  sap_building_parts: [{ construction_age_band: 'D' }],
};

/** RdSAP 21: descriptions as `{ value, language }`. */
const RDSAP_21: EpcCertificate = {
  schema_type: 'RdSAP-Schema-21.0.1',
  dwelling_type: { value: 'Mid-terrace house', language: '1' },
  total_floor_area: 55,
  registration_date: '2025-04-04',
  walls: [
    { description: { value: 'Solid brick, as built, no insulation (assumed)', language: '1' } },
  ],
  roofs: [{ description: { value: 'Pitched, 25 mm loft insulation', language: '1' } }],
  window: { description: { value: 'Fully double glazed', language: '1' } },
  main_heating: [{ description: { value: 'Electric storage heaters', language: '1' } }],
  hot_water: { description: { value: 'Electric immersion, off-peak', language: '1' } },
  sap_heating: { cylinder_size: 2 },
  sap_building_parts: [{ construction_age_band: 'A' }],
};

describe('reading a certificate', () => {
  it('reads plain-string descriptions (RdSAP 20)', () => {
    expect(answersFromCertificate(RDSAP_20)).toEqual({
      property_type: 'semi',
      hp_age: '1945_1964',
      hp_floor_area: '92',
      hp_walls: 'cavity_filled',
      hp_loft: 'good',
      hp_glazing: 'double',
      hp_current_heating: 'gas',
      hp_emitters: 'radiators_standard',
      hp_hot_water: 'combi',
    });
  });

  it('reads { value, language } descriptions (RdSAP 21)', () => {
    expect(answersFromCertificate(RDSAP_21)).toEqual({
      property_type: 'terraced',
      hp_age: 'pre_1919',
      hp_floor_area: '55',
      hp_walls: 'solid_uninsulated',
      hp_loft: 'none',
      hp_glazing: 'double',
      hp_current_heating: 'electric_storage',
      hp_hot_water: 'cylinder',
    });
  });

  it('dates a new build (SAP) from its registration', () => {
    expect(ageBandOf({ schema_type: 'SAP-Schema-19.0.0', registration_date: '2022-05-09' })).toBe(
      '2007_on',
    );
    expect(ageBandOf({ construction_age_band: 'England and Wales: 1967-1975' })).toBe('1965_1982');
    expect(ageBandOf({ sap_building_parts: [{ construction_age_band: 'K' }] })).toBe('2007_on');
    expect(ageBandOf({})).toBeNull();
  });

  it('reads the fabric descriptions the register uses', () => {
    expect(wallsOf('Cavity wall, as built, no insulation (assumed)')).toBe('cavity_unfilled');
    expect(wallsOf('Cavity wall, as built, insulated (assumed)')).toBe('cavity_filled');
    expect(wallsOf('Solid brick, with external insulation')).toBe('solid_insulated');
    expect(wallsOf('Sandstone or limestone, as built, no insulation (assumed)')).toBe(
      'solid_uninsulated',
    );
    expect(wallsOf('Timber frame, as built, insulated (assumed)')).toBe('timber_or_modern');
    expect(wallsOf('Average thermal transmittance 0.18 W/m²K')).toBe('timber_or_modern');
    expect(loftOf('Pitched, 100 mm loft insulation')).toBe('some');
    expect(loftOf('Pitched, no insulation (assumed)')).toBe('none');
    expect(loftOf('(another dwelling above)')).toBe('good');
    expect(loftOf('Flat, insulated (assumed)')).toBe('good');
    expect(glazingOf('Partial double glazing')).toBe('single');
    expect(glazingOf('Single glazed')).toBe('single');
    expect(glazingOf('High performance glazing')).toBe('double');
    expect(fuelOf('Air source heat pump, radiators, electric')).toBe('heat_pump');
    expect(fuelOf('Boiler and radiators, oil')).toBe('oil');
    expect(fuelOf('Boiler and radiators, LPG')).toBe('lpg');
    expect(fuelOf('Room heaters, electric')).toBe('electric_direct');
    expect(fuelOf('Boiler and radiators, anthracite')).toBe('other');
  });
});

// ── Finding the home in a postcode ──────────────────────────────────────────

function row(n: string, line1: string, date: string, line2: string | null = null): EpcSearchRow {
  return {
    certificateNumber: n,
    addressLine1: line1,
    addressLine2: line2,
    addressLine3: null,
    addressLine4: null,
    postcode: 'NR4 7TJ',
    registrationDate: date,
    uprn: null,
  };
}

describe('matching the visitor to a certificate', () => {
  it('matches every number and a street word, and nothing less', () => {
    expect(isSameHome(row('a', '12 Mill Lane', '2014-01-01'), ADDRESS)).toBe(true);
    expect(isSameHome(row('a', '12, MILL LN', '2014-01-01'), ADDRESS)).toBe(true);
    expect(isSameHome(row('a', '120 Mill Lane', '2014-01-01'), ADDRESS)).toBe(false);
    expect(isSameHome(row('a', '12 Mill Road', '2014-01-01'), '12 Oak Avenue, NR4 7TJ')).toBe(
      false,
    );
  });

  it('tells flats apart', () => {
    const flat2 = row('a', 'Flat 2', '2014-01-01', '10 Some Street');
    expect(isSameHome(flat2, 'Flat 2, 10 Some Street, Leeds LS1 4AP')).toBe(true);
    expect(isSameHome(flat2, 'Flat 3, 10 Some Street, Leeds LS1 4AP')).toBe(false);
    expect(isSameHome(flat2, '10 Some Street, Leeds LS1 4AP')).toBe(false);
  });

  it('matches a named home on its name', () => {
    const cottage = row('a', 'Rose Cottage', '2014-01-01', 'Mill Lane');
    expect(isSameHome(cottage, 'Rose Cottage, Mill Lane, Norwich NR4 7TJ')).toBe(true);
    expect(isSameHome(cottage, 'Ivy Cottage, Mill Lane, Norwich NR4 7TJ')).toBe(false);
  });
});

describe('what the neighbours share', () => {
  it('takes the answer most of them give, from two or more', () => {
    const shared = sharedAnswers([
      {
        hp_age: '1945_1964',
        hp_walls: 'cavity_filled',
        hp_loft: 'good',
        hp_current_heating: 'gas',
      },
      { hp_age: '1945_1964', hp_walls: 'cavity_unfilled', hp_loft: 'good' },
      { hp_age: '1945_1964', hp_walls: 'solid_uninsulated' },
    ]);
    // Three different walls: no pattern. Heating is never shared.
    expect(shared).toEqual({ hp_age: '1945_1964', hp_loft: 'good' });
  });

  it('needs at least two homes to agree', () => {
    expect(sharedAnswers([{ hp_age: 'pre_1919' }])).toEqual({});
  });
});

function fakeEpc(rows: EpcSearchRow[], certs: Record<string, EpcCertificate>) {
  const client: EpcClient = {
    search: vi.fn(() => Promise.resolve(rows)),
    certificate: vi.fn((n: string) => Promise.resolve(certs[n] ?? null)),
  };
  return client;
}

describe('looking a home up', () => {
  beforeEach(() => clearHomeDataCache());

  it("uses the home's own newest certificate", async () => {
    const client = fakeEpc(
      [
        row('old', '12 Mill Lane', '2009-01-01'),
        row('new', '12 Mill Lane', '2014-05-04'),
        row('n1', '14 Mill Lane', '2015-01-01'),
      ],
      { old: RDSAP_21, new: RDSAP_20 },
    );
    const found = await lookUpEpc(client, ADDRESS, 'NR4 7TJ');
    expect(found.source).toBe('own');
    expect(found.source === 'own' && found.answers['hp_walls']).toBe('cavity_filled');
    expect(found.source === 'own' && found.registrationDate).toBe('2014-05-04');
  });

  it("falls back to what the neighbours' certificates share", async () => {
    const client = fakeEpc(
      [
        row('n1', '14 Mill Lane', '2015-01-01'),
        row('n2', '16 Mill Lane', '2016-01-01'),
        row('n3', '18 Mill Lane', '2017-01-01'),
      ],
      { n1: RDSAP_20, n2: RDSAP_20, n3: RDSAP_21 },
    );
    const found = await lookUpEpc(client, ADDRESS, 'NR4 7TJ');
    expect(found).toEqual({
      source: 'neighbours',
      homes: 3,
      answers: {
        hp_age: '1945_1964',
        hp_walls: 'cavity_filled',
        hp_loft: 'good',
        hp_glazing: 'double',
      },
    });
  });

  it('finds nothing in an empty postcode', async () => {
    const found = await lookUpEpc(fakeEpc([], {}), ADDRESS, 'NR4 7TJ');
    expect(found).toEqual({ source: 'none' });
  });

  it('keeps what the visitor said, and takes back an earlier address', async () => {
    const home: HomeData = {
      epc: fakeEpc([row('new', '12 Mill Lane', '2014-05-04')], { new: RDSAP_20 }),
      solar: null,
    };
    const earlier = {
      hp_current_heating: 'oil',
      hp_age: '2007_on',
      [HOME_KEYS.epc]: JSON.stringify({ source: 'own', fields: ['hp_age'] }),
    };
    const found = await lookUpHome(home, 'heat_pump', ADDRESS, earlier);
    // Heating was the visitor's: kept. The age came from the last address: replaced.
    expect(found.patch['hp_current_heating']).toBeUndefined();
    expect(found.patch['hp_age']).toBe('1945_1964');
    expect(found.removed).toEqual([]);
    expect(found.found).toBe(
      "The home's 2014 energy certificate shows filled cavity walls, a well insulated loft and double glazing.",
    );
    const record = JSON.parse(found.patch[HOME_KEYS.epc]!) as { fields: string[] };
    expect(record.fields).not.toContain('hp_current_heating');
  });

  it('never throws: a failing register means carrying on without it', async () => {
    const warn = vi.fn();
    const home: HomeData = {
      epc: { search: () => Promise.reject(new Error('down')), certificate: vi.fn() },
      solar: null,
    };
    const found = await lookUpHome(home, 'heat_pump', ADDRESS, {}, { warn });
    expect(found).toEqual({ patch: {}, removed: [], found: null });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('is off without keys', () => {
    expect(homeDataFromEnv({})).toBeNull();
    expect(homeDataFromEnv({ EPC_API_TOKEN: 't' })?.solar).toBeNull();
    expect(homeDataFromEnv({ GOOGLE_MAPS_API_KEY: 'k' })?.epc).toBeNull();
  });
});

// ── Google's roof ────────────────────────────────────────────────────────────

const POINT = { lat: 52.62, lng: 1.25 };

function insights(): GoogleSolarBuildingInsights {
  const seg = (az: number, panels: number, kwh: number, index: number) => ({
    pitchDegrees: 38,
    azimuthDegrees: az,
    panelsCount: panels,
    yearlyEnergyDcKwh: kwh,
    segmentIndex: index,
  });
  return {
    name: 'buildings/x',
    center: { latitude: POINT.lat, longitude: POINT.lng },
    imageryQuality: 'HIGH',
    imageryDate: { year: 2023, month: 6, day: 1 },
    solarPotential: {
      maxArrayPanelsCount: 22,
      panelCapacityWatts: 400,
      roofSegmentStats: [
        { pitchDegrees: 38, azimuthDegrees: 180, stats: { sunshineQuantiles: [900, 1000, 1100] } },
        { pitchDegrees: 38, azimuthDegrees: 0, stats: { sunshineQuantiles: [300, 400, 500] } },
      ],
      solarPanelConfigs: [
        { panelsCount: 4, yearlyEnergyDcKwh: 1600, roofSegmentSummaries: [seg(180, 4, 1600, 0)] },
        {
          panelsCount: 22,
          yearlyEnergyDcKwh: 6400,
          // 14 on the south face, 8 on the north face (not usable).
          roofSegmentSummaries: [seg(180, 14, 5400, 0), seg(0, 8, 1000, 1)],
        },
      ],
    },
  } as unknown as GoogleSolarBuildingInsights;
}

function fakeSolar(found: GoogleSolarBuildingInsights | null, point = POINT): SolarClient {
  return {
    geocode: vi.fn(() => Promise.resolve(point)),
    buildingInsights: vi.fn(() => Promise.resolve(found)),
  };
}

describe("Google's roof", () => {
  beforeEach(() => clearHomeDataCache());

  it('keeps the usable panels, the sunniest face and the layouts', () => {
    expect(compactInsights(insights())).toEqual({
      source: 'google',
      usablePanels: 14,
      pitchDeg: 38,
      mcsOrientationDeg: 0,
      panelCapacityWatts: 400,
      imageryQuality: 'HIGH',
      imageryYear: 2023,
      layouts: [
        [4, 1600],
        [22, 6400],
      ],
    });
  });

  it("refuses a building far from the address's rooftop", async () => {
    const far = { lat: POINT.lat + 0.001, lng: POINT.lng };
    expect(await lookUpGoogleRoof(fakeSolar(insights(), far), ADDRESS)).toBeNull();
    expect(await lookUpGoogleRoof(fakeSolar(insights()), ADDRESS)).not.toBeNull();
  });

  it('prices on the roof model: room for the usable panels, no roof questions', () => {
    const roof = compactInsights(insights())!;
    const answers = {
      ownership: 'own',
      address: ADDRESS,
      usage_source: 'household',
      household_size: '3',
      lifestyle: 'none',
      existing_system: 'none',
      [HOME_KEYS.solar]: JSON.stringify(roof),
    };
    const flow = resolvedFlowFor(defaultWorkflowSet(NOW).workflows[0]!);
    const qa = quoteAnswers(answers, null, demoPricing(), flow)!;
    expect(qa.roof).toMatchObject({ maxPanelCount: 14, pitchDeg: 38, confidence: 'high' });
    expect(qa.solarInsights?.solarPotential.solarPanelConfigs).toHaveLength(2);
    expect(parseGoogleRoof('not json')).toBeNull();
  });
});

// ── Through the workflows ────────────────────────────────────────────────────

const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function tempStore(): Promise<FileStore> {
  const dir = await mkdtemp(join(tmpdir(), 'sunny-homedata-'));
  dirs.push(dir);
  return new FileStore(dir);
}

function setWithHeatPump(): WorkflowSet {
  const set = defaultWorkflowSet(NOW);
  set.workflows.push({ ...heatPumpTemplate(NOW), enabled: true });
  return set;
}

function context(
  store: FileStore,
  homeData: HomeData,
  workflows: WorkflowSet = setWithHeatPump(),
): ToolContext & { events: ToolEvent[] } {
  return {
    tenant: DEMO_TENANT,
    sessionId: SESSION,
    conversationId: null,
    store,
    answers: {},
    events: [],
    sunscanConnected: false,
    knowledge: EMPTY_KNOWLEDGE,
    flow: resolvedFlowFor(workflows.workflows[0]!),
    quote: { pricing: { forTenant: () => Promise.resolve(demoPricing()) } },
    workflows,
    session: cloneSession(EMPTY_SESSION),
    pagePath: '/',
    homeData,
  };
}

async function tool(name: string, args: Record<string, unknown>, ctx: ToolContext) {
  const result = await executeTool({ name, args }, ctx);
  return { ...result, data: result.data as Record<string, unknown> };
}

const save = (ctx: ToolContext, questionId: string, value: string) =>
  tool('save_workflow_answers', { answers: [{ questionId, value }] }, ctx);

describe('a heat pump workflow with the energy certificates', () => {
  beforeEach(() => clearHomeDataCache());

  it("asks nothing the home's certificate answers", async () => {
    const store = await tempStore();
    const epc = fakeEpc([row('c1', '12 Mill Lane', '2014-05-04')], { c1: RDSAP_20 });
    const ctx = context(store, { epc, solar: null });
    await tool('start_workflow', { workflowId: 'wf_heat_pump' }, ctx);
    await save(ctx, 'ownership', 'own');
    const after = await save(ctx, 'address', ADDRESS);
    const said =
      "The home's 2014 energy certificate shows filled cavity walls, a well insulated loft and double glazing.";
    expect(after.data['sayFirst']).toBe(said);
    // Type, age, floor area (so no bedrooms), heating, radiators, hot water: all known.
    expect(after.data['readyForQuote']).toBe(true);
    const quote = await tool('get_quote_options', {}, ctx);
    expect(quote.ok).toBe(true);
    const stored = (await store.listQuotes(DEMO_TENANT.id, SESSION))[0] as HeatPumpQuoteRecord;
    expect(stored.estimate.assumptions.join(' ')).toContain("home's energy certificate (2014)");
  });

  it('asks only what a homeowner knows when the neighbours stand in', async () => {
    const store = await tempStore();
    const epc = fakeEpc(
      [row('n1', '14 Mill Lane', '2015-01-01'), row('n2', '16 Mill Lane', '2016-01-01')],
      { n1: RDSAP_20, n2: RDSAP_20 },
    );
    const ctx = context(store, { epc, solar: null });
    await tool('start_workflow', { workflowId: 'wf_heat_pump' }, ctx);
    await save(ctx, 'ownership', 'own');
    const after = await save(ctx, 'address', ADDRESS);
    // The age came from the street; the type and the household's own choices are asked.
    const asked: string[] = [];
    let next = after.data['nextQuestionId'] as string | null;
    const values: Record<string, string> = {
      property_type: 'semi',
      hp_bedrooms: '3',
      hp_current_heating: 'gas',
      hp_emitters: 'radiators_standard',
      hp_hot_water: 'combi',
    };
    while (next) {
      asked.push(next);
      next = (await save(ctx, next, values[next]!)).data['nextQuestionId'] as string | null;
    }
    expect(asked).toEqual([
      'property_type',
      'hp_bedrooms',
      'hp_current_heating',
      'hp_emitters',
      'hp_hot_water',
    ]);
  });

  it('asks the age too when there are no certificates at all', async () => {
    const store = await tempStore();
    const ctx = context(store, { epc: fakeEpc([], {}), solar: null });
    await tool('start_workflow', { workflowId: 'wf_heat_pump' }, ctx);
    await save(ctx, 'ownership', 'own');
    const after = await save(ctx, 'address', ADDRESS);
    expect(after.data['nextQuestionId']).toBe('property_type');
    expect(after.data['sayFirst']).toBeUndefined();
    const second = await save(ctx, 'property_type', 'semi');
    expect(second.data['nextQuestionId']).toBe('hp_age');
  });
});

describe("a solar workflow with Google's roof", () => {
  beforeEach(() => clearHomeDataCache());

  it('quotes on the roof model without asking about the roof', async () => {
    const store = await tempStore();
    const ctx = context(
      store,
      { epc: null, solar: fakeSolar(insights()) },
      defaultWorkflowSet(NOW),
    );
    await tool('start_workflow', { workflowId: 'wf_solar' }, ctx);
    await save(ctx, 'ownership', 'own');
    const after = await save(ctx, 'address', ADDRESS);
    expect(after.data['sayFirst']).toContain('about 14 panels');
    const asked: string[] = [];
    let next = after.data['nextQuestionId'] as string | null;
    const values: Record<string, string> = {
      usage_source: 'household',
      household_size: '3',
      lifestyle: 'none',
      existing_system: 'none',
    };
    while (next) {
      asked.push(next);
      next = (await save(ctx, next, values[next]!)).data['nextQuestionId'] as string | null;
    }
    expect(asked).toEqual(['usage_source', 'household_size', 'lifestyle', 'existing_system']);
    const quote = await tool('get_quote_options', {}, ctx);
    expect(quote.ok).toBe(true);
    const stored = (await store.listQuotes(DEMO_TENANT.id, SESSION))[0] as QuoteRecord;
    expect(stored.basis.roofMaxPanels).toBe(14);
    expect(stored.basis.roofConfidence).toBe('high');
    expect(stored.estimatedFrom).toEqual([]);
    expect(stored.warnings.join(' ')).not.toMatch(/does not ask/);
    // No panel positions in this model, so no photo to offer.
    expect(ctx.events.some((e) => e.kind === 'roof_image')).toBe(false);
  });

  it('keeps a street and postcode given before the quote started', async () => {
    // Seen live: "3A Downs Walk", then "BN10 7SN", then the quote began and
    // asked for the address again.
    const store = await tempStore();
    const ctx = context(
      store,
      { epc: null, solar: fakeSolar(insights()) },
      defaultWorkflowSet(NOW),
    );
    ctx.earlierVisitorMessages = ['3A Downs Walk'];
    ctx.visitorMessage = 'BN10 7SN';
    const started = await tool('start_workflow', { workflowId: 'wf_solar' }, ctx);
    const answers = (await store.getConversation(DEMO_TENANT.id, SESSION))?.answers ?? {};
    expect(answers['address']).toBe('3A Downs Walk, BN10 7SN');
    expect(answers['journey_home_solar']).toBeDefined();
    expect(started.data['nextQuestionId']).not.toBe('address');
  });

  it('chat offers the model no roof-measuring tools: the workflow measures', () => {
    expect(CHANNEL_POLICIES.chat.tools).not.toContain('start_sunscan_assessment');
    expect(CHANNEL_POLICIES.chat.tools).not.toContain('get_sunscan_result');
  });

  it('keeps the address when the model measures the roof instead of saving it', async () => {
    // Seen live: the visitor typed their address, the model called the roof
    // tool and nothing else, and the workflow asked for the address again.
    const store = await tempStore();
    const ctx = context(
      store,
      { epc: null, solar: fakeSolar(insights()) },
      defaultWorkflowSet(NOW),
    );
    await tool('start_workflow', { workflowId: 'wf_solar' }, ctx);
    await save(ctx, 'ownership', 'own');
    ctx.visitorMessage = ADDRESS;
    const measured = await tool('start_sunscan_assessment', { address: ADDRESS }, ctx);
    expect(measured.data['saved']).toEqual([{ questionId: 'address', value: ADDRESS }]);
    expect(measured.data['nextQuestionId']).not.toBe('address');
    expect(measured.data['sayFirst']).toContain('about 14 panels');
    const answers = (await store.getConversation(DEMO_TENANT.id, SESSION))?.answers ?? {};
    expect(answers['address']).toBe(ADDRESS);
    expect(answers['journey_home_solar']).toBeDefined();
    // The model then saves the same message too: its house number is not read
    // as an answer to the next question (a "£12" bill, say).
    const next = measured.data['nextQuestionId'];
    const resaved = await save(ctx, 'address', ADDRESS);
    await tool('save_workflow_answers', { answers: [], visitorMessage: ADDRESS }, ctx);
    expect(resaved.data['nextQuestionId']).toBe(next);
    const after = (await store.getConversation(DEMO_TENANT.id, SESSION))?.answers ?? {};
    expect(after['usage_source']).toBeUndefined();
    expect(after['monthly_cost']).toBeUndefined();
    // Once the workflow has its address, the tool goes back to only measuring.
    const again = await tool('start_sunscan_assessment', { address: ADDRESS }, ctx);
    expect(again.data['saved']).toBeUndefined();
  });

  it('offers the house from above when Google has the panel positions', async () => {
    const store = await tempStore();
    const withPanels = insights();
    Object.assign(withPanels, {
      boundingBox: {
        sw: { latitude: POINT.lat - 0.00005, longitude: POINT.lng - 0.00008 },
        ne: { latitude: POINT.lat + 0.00005, longitude: POINT.lng + 0.00008 },
      },
    });
    Object.assign(withPanels.solarPotential, {
      panelWidthMeters: 1.045,
      panelHeightMeters: 1.879,
      solarPanels: [
        {
          center: { latitude: POINT.lat - 0.00002, longitude: POINT.lng },
          orientation: 'PORTRAIT',
          segmentIndex: 0,
          yearlyEnergyDcKwh: 400,
        },
      ],
    });
    (withPanels.solarPotential.roofSegmentStats as unknown as { stats: object }[]).forEach((s) =>
      Object.assign(s.stats, { areaMeters2: 30 }),
    );
    const ctx = context(
      store,
      { epc: null, solar: fakeSolar(withPanels) },
      defaultWorkflowSet(NOW),
    );
    await tool('start_workflow', { workflowId: 'wf_solar' }, ctx);
    await save(ctx, 'ownership', 'own');
    await save(ctx, 'address', ADDRESS);
    expect(ctx.events.filter((e) => e.kind === 'roof_image')).toHaveLength(1);
    const saved = (await store.getConversation(DEMO_TENANT.id, SESSION))?.answers ?? {};
    expect(JSON.parse(saved['journey_home_solar']!).view.panels).toHaveLength(1);
  });

  it('still quotes on typical values when Google has no model', async () => {
    const store = await tempStore();
    const ctx = context(store, { epc: null, solar: fakeSolar(null) }, defaultWorkflowSet(NOW));
    await tool('start_workflow', { workflowId: 'wf_solar' }, ctx);
    await store.mergeAnswers(DEMO_TENANT.id, SESSION, {
      ownership: 'own',
      usage_source: 'household',
      household_size: '3',
      lifestyle: 'none',
      existing_system: 'none',
    });
    const after = await save(ctx, 'address', ADDRESS);
    expect(after.data['homeRecords']).toBeUndefined();
    expect(after.data['readyForQuote']).toBe(true);
    expect((await tool('get_quote_options', {}, ctx)).ok).toBe(true);
    const stored = (await store.listQuotes(DEMO_TENANT.id, SESSION))[0] as QuoteRecord;
    expect(stored.basis.roofConfidence).toBe('low');
    expect(stored.estimatedFrom).toEqual([]);
  });
});

describe('what the lookup found, in a chat turn', () => {
  beforeEach(() => clearHomeDataCache());

  it('is said once by the server, ahead of the reply, and the model is told so', async () => {
    const store = await tempStore();
    const workflows = setWithHeatPump();
    await store.saveWorkflowState(DEMO_TENANT.id, SESSION, {
      ...cloneSession(EMPTY_SESSION),
      active: { workflowId: 'wf_heat_pump', startedAt: NOW },
    });
    await store.mergeAnswers(DEMO_TENANT.id, SESSION, { ownership: 'own' });
    const epc = fakeEpc([row('c1', '12 Mill Lane', '2014-05-04')], { c1: RDSAP_20 });
    const notes: string[] = [];
    const provider = new ScriptedProvider(() => [
      {
        type: 'tool_started',
        call: {
          name: 'save_workflow_answers',
          args: { answers: [{ questionId: 'address', value: ADDRESS }] },
        },
      },
      { type: 'text', text: 'How many bedrooms does it have?' },
    ]);
    const events: TurnEvent[] = [];
    for await (const event of runTurn({
      tenant: { ...DEMO_TENANT, config: { ...DEMO_TENANT.config, workflows } },
      provider,
      store,
      sessionId: SESSION,
      conversationId: null,
      history: [],
      message: ADDRESS,
      clientMessageId: 'c_1',
      sunscanConnected: false,
      homeData: { epc, solar: null },
      quote: { pricing: { forTenant: () => Promise.resolve(demoPricing()) } },
    })) {
      events.push(event);
      if (event.type === 'tool_finished') notes.push(String(event.tool));
    }
    const finished = events.find(
      (e): e is Extract<TurnEvent, { type: 'message_finished' }> => e.type === 'message_finished',
    );
    const said =
      "The home's 2014 energy certificate shows filled cavity walls, a well insulated loft and double glazing.";
    expect(finished?.text).toBe(`${said} How many bedrooms does it have?`);
    expect(finished?.text.split(said)).toHaveLength(2);
    // The model saw the note, and not the field to repeat.
    const result = await provider.lastRequest!.execute({
      name: 'get_workflow_step',
      args: {},
    });
    expect(JSON.stringify(result)).not.toContain('sayFirst');
  });
});

describe('a visitor who opens with a street address', () => {
  it('is asked for its postcode next, and the postcode alone completes it', async () => {
    const store = await tempStore();
    const ctx = context(store, { epc: null, solar: null }, defaultWorkflowSet(NOW));
    ctx.visitorMessage = '3A Downs Walk';
    const started = await tool('start_workflow', { workflowId: 'wf_solar' }, ctx);
    expect(started.data['nextQuestionId']).toBe('address');
    expect(started.data['ask']).toBe('What is the postcode for 3A Downs Walk?');
    ctx.visitorMessage = 'BN10 7SN';
    const after = await tool(
      'save_workflow_answers',
      { answers: [], visitorMessage: 'BN10 7SN' },
      ctx,
    );
    expect(ctx.answers['address']).toBe('3A Downs Walk, BN10 7SN');
    expect(after.data['nextQuestionId']).toBe('ownership');
  });
});
