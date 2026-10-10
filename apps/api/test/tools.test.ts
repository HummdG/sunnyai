import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { executeTool, type ToolContext, type ToolEvent } from '../src/agent/tools.js';
import { FileStore } from '../src/store.js';
import { TenantRegistry } from '../src/tenants.js';
import {
  BATTERY,
  DEMO_TENANT_ID,
  INVERTER_4K,
  PANEL_430,
  csv,
  seedProducts,
} from './catalogue-fixture.js';

/**
 * The three tools that read the catalogue, called directly rather than through
 * a chat turn.
 *
 * Going through the model boundary would prove less: the scripted provider feeds
 * a fixed answer back, so the tool's *data* never surfaces, and a test that
 * cannot see what a tool told the model can only assert that it ran. Calling
 * `executeTool` is where the honesty of these three can actually be checked --
 * that a price reaching the model came from a row, that a rule that could not
 * run says so, and that a refinement is stored even when it produced nothing.
 */

let dirs: string[] = [];

beforeEach(() => {
  dirs = [];
});

afterEach(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

async function makeStore(): Promise<{ store: FileStore; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'sunny-tools-'));
  dirs.push(dir);
  return { store: new FileStore(dir), dir };
}

function context(store: FileStore, events: ToolEvent[]): ToolContext {
  return {
    tenant: new TenantRegistry().all[0]!,
    sessionId: 'sess_tools',
    conversationId: 'conv_tools',
    store,
    answers: {},
    events,
    sunscanConnected: false,
    knowledgeSourceCount: 0,
  };
}

/** A tool's `data`, as the model receives it, with the shape this file asserts. */
interface ToolData {
  products?: Array<{
    id: string;
    model: string;
    price: { minor: number; currency: string | null; label: string | null; status: string } | null;
  }>;
  catalogueSize?: number;
  matching?: number;
  truncated?: boolean;
  warnings?: string[];
  notes?: string[];
  constraintsChecked?: Array<{ id: string; outcome: string }>;
  exclusions?: Array<{ code: string }>;
  packages?: Array<{
    id: string;
    items: Array<{
      productId: string;
      category: string;
      priceMinor: number | null;
      priceLabel: string | null;
    }>;
    totalMinor: number | null;
    totalLabel: string | null;
    totalStatus: string;
  }>;
  want?: Record<string, unknown>;
  note?: string;
  catalogue?: { products: number; priceable: number; currency: string | null };
}

async function call(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<{ ok: boolean; summary: string; data: ToolData }> {
  const result = await executeTool({ name, args }, ctx);
  return { ok: result.ok, summary: result.summary, data: result.data as ToolData };
}

describe('search_catalogue', () => {
  it('returns the installer’s own rows, with the prices they carry', async () => {
    const { store } = await makeStore();
    await seedProducts(store);

    const result = await call('search_catalogue', { kind: 'panel' }, context(store, []));

    expect(result.ok).toBe(true);
    expect(result.data.products).toHaveLength(2);
    expect(result.data.catalogueSize).toBe(4);
    expect(result.data.matching).toBe(2);
    expect(result.data.truncated).toBe(false);

    // Cheapest priced row first, and every figure traceable to a row: these are
    // the numbers the model is allowed to quote, and it may quote no others.
    const [cheapest] = result.data.products!;
    expect(cheapest?.model).toBe('SB-430');
    expect(cheapest?.price).toMatchObject({
      minor: 18_000,
      currency: 'GBP',
      label: 'GBP 180.00',
      status: 'verified',
    });
  });

  it('returns a priced row first and an unpriced one with no price at all', async () => {
    const { store } = await makeStore();
    // A panel with no price, uploaded alongside priced ones. It is still a row
    // the installer has -- it just cannot be quoted, and the difference between
    // "free" and "not priced" has to survive all the way to the model.
    await seedProducts(store, {
      csv: csv(
        { ...PANEL_430, Model: 'SB-UNPRICED', Price: '' },
        { ...PANEL_430, Model: 'SB-PRICED', Price: '£300' },
      ),
      tenantId: DEMO_TENANT_ID,
    });

    const result = await call('search_catalogue', { kind: 'panel' }, context(store, []));
    const unpriced = result.data.products!.find((product) => product.model === 'SB-UNPRICED');

    expect(unpriced?.price).toBeNull();
  });

  it('says there is no catalogue rather than describing an empty one', async () => {
    const { store } = await makeStore();

    const result = await call('search_catalogue', {}, context(store, []));

    expect(result.ok).toBe(false);
    expect(result.data.products).toEqual([]);
    expect(result.data.catalogueSize).toBe(0);
    expect(result.summary).toMatch(/no product list/i);
  });
});

describe('validate_compatibility', () => {
  /** Named as the tool's arguments, so a test cannot pass an id under a key the tool does not read. */
  async function ids(store: FileStore): Promise<{
    panelProductId: string;
    inverterProductId: string;
    batteryProductId: string;
  }> {
    const products = await store.listProducts(DEMO_TENANT_ID);
    return {
      panelProductId: products.find((product) => product.model === 'SB-430')!.id,
      inverterProductId: products.find((product) => product.model === 'VX-4K')!.id,
      batteryProductId: products.find((product) => product.model === 'Home 5')!.id,
    };
  }

  it('checks a size the visitor named against both the inverter’s limits', async () => {
    const { store } = await makeStore();
    await seedProducts(store);
    const productIds = await ids(store);

    const result = await call(
      'validate_compatibility',
      { panelCount: 9, ...productIds },
      context(store, []),
    );

    expect(result.ok).toBe(true);
    expect(result.data.warnings).toEqual([]);
    expect(result.data.exclusions).toEqual([]);
    const applied = (result.data.constraintsChecked ?? []).filter(
      (check) => check.outcome === 'applied',
    );
    expect(applied.map((check) => check.id)).toEqual(
      expect.arrayContaining([
        'inverter-dc-limit',
        'panel-string-voltage',
        'battery-inverter-pairing',
      ]),
    );
  });

  it('contradicts a size the inverter cannot take', async () => {
    const { store } = await makeStore();
    await seedProducts(store);
    const productIds = await ids(store);

    // 20 × 430 W is 8.6 kW against a 4.6 kW DC input limit.
    const result = await call(
      'validate_compatibility',
      { panelCount: 20, ...productIds },
      context(store, []),
    );

    expect(result.data.warnings?.join(' ')).toMatch(/above the 4600 W DC input limit/);
    expect(result.data.exclusions?.map((exclusion) => exclusion.code)).toContain(
      'inverter-dc-limit',
    );
  });

  it('reports a rule it could not run instead of calling it a pass', async () => {
    const { store } = await makeStore();
    // A catalogue with an inverter that says nothing about its DC input limit.
    await seedProducts(store, {
      csv: csv(PANEL_430, {
        Category: 'Inverter',
        Manufacturer: 'Voltix',
        Model: 'VX-4K',
        Price: '1200',
        Currency: 'GBP',
        Source: 'https://example.test/vx-4k.pdf',
      }),
      tenantId: DEMO_TENANT_ID,
    });
    const products = await store.listProducts(DEMO_TENANT_ID);
    const panel = products.find((product) => product.category === 'panel')!;
    const inverter = products.find((product) => product.category === 'inverter')!;

    const result = await call(
      'validate_compatibility',
      { panelCount: 9, panelProductId: panel.id, inverterProductId: inverter.id },
      context(store, []),
    );

    const skipped = (result.data.constraintsChecked ?? []).filter(
      (check) => check.outcome === 'skipped-missing-data',
    );
    expect(skipped.map((check) => check.id)).toContain('inverter-dc-limit');
  });

  it('says nothing was checked when there is no catalogue, and still reports the roof', async () => {
    const { store } = await makeStore();
    const ctx = context(store, []);
    ctx.answers = { roof_shading: 'heavy', roof_direction: 'north' };

    const result = await call('validate_compatibility', { panelCount: 12 }, ctx);

    expect(result.data.catalogueSize).toBe(0);
    expect(result.data.notes?.join(' ')).toMatch(/nothing about the hardware could be checked/i);
    // The visitor's own answers still produce caveats; those do not need a
    // catalogue to be true.
    expect(result.data.notes?.join(' ')).toMatch(/shad|survey/i);
  });

  it('refuses a call with no panel count rather than guessing one', async () => {
    const { store } = await makeStore();
    await seedProducts(store);

    const result = await call('validate_compatibility', {}, context(store, []));

    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/panel count/i);
  });
});

describe('recommend_packages', () => {
  it('assembles priced options and tells the widget they exist', async () => {
    const { store } = await makeStore();
    await seedProducts(store);
    const events: ToolEvent[] = [];

    const result = await call('recommend_packages', { targetKwp: 4 }, context(store, events));

    expect(result.ok).toBe(true);
    expect(result.data.packages!.length).toBeGreaterThan(0);
    const best = result.data.packages![0]!;
    expect(best.totalMinor).toBeGreaterThan(0);
    expect(best.totalLabel).toMatch(/^GBP /);
    expect(best.items.every((item) => item.productId.startsWith('prd_'))).toBe(true);

    // The event the widget's "here are your options" moment fires on, carrying
    // the id of the option it should show.
    expect(events).toEqual([
      { kind: 'recommendation_ready', detail: { recommendationId: best.id } },
    ]);
  });

  it('accumulates the model’s refinement onto what the visitor already asked for', async () => {
    const { store } = await makeStore();
    await seedProducts(store);
    await store.saveWant(DEMO_TENANT_ID, 'sess_tools', { targetKwp: 4 });
    const events: ToolEvent[] = [];

    const result = await call(
      'recommend_packages',
      { requireBattery: true },
      context(store, events),
    );

    // The model sent one field; the visitor's size was not restated and is
    // nevertheless still in force.
    expect(result.data.want).toEqual({ targetKwp: 4, requireBattery: true });
    expect(await store.getWant(DEMO_TENANT_ID, 'sess_tools')).toEqual({
      targetKwp: 4,
      requireBattery: true,
    });
    for (const option of result.data.packages!) {
      expect(option.items.some((item) => item.category === 'battery')).toBe(true);
    }
  });

  it('reads a boolean the model sent as text without turning false into true', async () => {
    const { store } = await makeStore();
    await seedProducts(store);

    const result = await call(
      'recommend_packages',
      { targetKwp: '4', requireBattery: 'false' },
      context(store, []),
    );

    expect(result.data.want).toEqual({ targetKwp: 4, requireBattery: false });
  });

  it('keeps the refinement even when nothing could be built from it', async () => {
    const { store } = await makeStore();
    await seedProducts(store);
    const events: ToolEvent[] = [];

    // No size has ever been stated: there is nothing to assemble.
    const result = await call(
      'recommend_packages',
      { requireBattery: true },
      context(store, events),
    );

    expect(result.ok).toBe(false);
    expect(result.data.packages).toEqual([]);
    expect(events).toEqual([]);
    expect(result.summary).toMatch(/how big a system/i);
    // Stored anyway: the requirement stands, and forgetting it would make the
    // next turn answer a different question.
    expect(await store.getWant(DEMO_TENANT_ID, 'sess_tools')).toEqual({ requireBattery: true });
  });

  it('shows no total at all when one item in the option has no price', async () => {
    const { store } = await makeStore();
    await seedProducts(store, {
      csv: csv({ ...PANEL_430, Price: '' }, INVERTER_4K, BATTERY),
      tenantId: DEMO_TENANT_ID,
    });
    const events: ToolEvent[] = [];

    const result = await call('recommend_packages', { targetKwp: 4 }, context(store, events));

    expect(result.data.packages!.length).toBeGreaterThan(0);
    const best = result.data.packages![0]!;
    // A total built from a priced inverter and battery plus unpriced panels
    // would be a number the installer never gave, so there is no total.
    expect(best.totalMinor).toBeNull();
    expect(best.totalLabel).toBeNull();
    expect(result.summary).toMatch(/no total/i);
  });
});
