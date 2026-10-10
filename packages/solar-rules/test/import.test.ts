import { describe, expect, it } from 'vitest';

import type { Product } from '@sunny/contracts';

import { importProducts, importRecords, parseCsv } from '@sunny/solar-rules';

/**
 * The import is where an installer's file becomes claims this product will make
 * to their customers, so the tests here are mostly about what it *refuses*.
 *
 * Every rejection is one of two things: a row whose meaning cannot be read (no
 * model, a price with no currency, two rows that are the same product), or a row
 * that is readable and thin (no warranty, no source for the price). The first
 * has to stop the row; the second has to be stored and said aloud. A test that
 * only checked the happy path would pass with both kinds thrown away.
 */

const NOW = '2026-01-01T00:00:00.000Z';

function importCsv(text: string, existing: readonly Product[] = []) {
  const parsed = parseCsv(text);
  let n = 0;
  const result = importProducts(parsed.rows, {
    tenantId: 'w_demo000001',
    now: NOW,
    nextId: () => `prd_${String((n += 1)).padStart(4, '0')}`,
    existing,
  });
  return { parsed, result };
}

function codes(input: { code: string }[]): string[] {
  return input.map((entry) => entry.code);
}

describe('reading the file', () => {
  it('reads a European export: BOM, semicolons, a quoted delimiter, CRLF', () => {
    const { parsed } = importCsv(
      '﻿Category;Manufacturer;Model;Power (W);Price;Currency\r\n' +
        'Panel;"Aurora Solar Ltd; trading as Aurora";A430;430;£180.00;GBP\r\n' +
        'Panel;Aurora;A425;425;€200.00;EUR\r\n',
    );

    expect(parsed.delimiter).toBe(';');
    expect(parsed.headers).toEqual([
      'Category',
      'Manufacturer',
      'Model',
      'Power (W)',
      'Price',
      'Currency',
    ]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]!.values['Manufacturer']).toBe('Aurora Solar Ltd; trading as Aurora');
    // The line a row started on, so a report can point at the file rather than at
    // a row index that only exists inside this process.
    expect(parsed.rows.map((row) => row.line)).toEqual([2, 3]);
    expect(parsed.issues).toEqual([]);
  });

  it('counts lines through a quoted value that spans two of them', () => {
    const { parsed } = importCsv('Model,Notes\nA430,"two\nlines"\nA425,plain\n');
    expect(parsed.rows[0]!.values['Notes']).toBe('two\nlines');
    // Without the embedded newline being counted, this row would claim line 2.
    expect(parsed.rows[1]!.line).toBe(4);
  });

  it('says so when there is nothing to read', () => {
    const empty = parseCsv('');
    expect(empty.rows).toEqual([]);
    expect(codes(empty.issues)).toEqual(['empty-file']);

    const unterminated = parseCsv('Model,Notes\nA430,"never closed\n');
    expect(codes(unterminated.issues)).toContain('unterminated-quote');
  });

  it('refuses a file that names the same column twice', () => {
    const parsed = parseCsv('Model,Model\nA430,A425\n');
    expect(parsed.repeatedHeaders).toEqual(['Model']);
    expect(codes(parsed.issues)).toContain('duplicate-column');
  });
});

describe('reading a row into a product', () => {
  it('reads one priced panel, with the units the header states', () => {
    const { result } = importCsv(
      'Category,Manufacturer,Model,Power (W),Price,Currency,Source,Warranty\n' +
        'Panel,Aurora,A430,430,180.00,GBP,https://example.test/a430.pdf,25\n',
    );

    expect(result.products).toHaveLength(1);
    const product = result.products[0]!;
    expect(product.powerW).toBe(430);
    expect(product.priceMinor).toBe(18000);
    expect(product.currency).toBe('GBP');
    expect(product.warrantyYears).toBe(25);
    expect(product.rowNumber).toBe(2);
    expect(product.tenantId).toBe('w_demo000001');
    // The price has a source, so it is verified rather than indicative -- and
    // the two warnings that would otherwise fire are absent.
    expect(product.priceStatus).toBe('verified');
    expect(result.issues.filter((entry) => entry.severity === 'error')).toEqual([]);
    expect(codes(result.issues)).not.toContain('no-price');
    expect(codes(result.issues)).not.toContain('no-provenance');
    expect(result.currency).toBe('GBP');
  });

  it('scales a value written in kW, because the header said (kW)', () => {
    const { result } = importCsv(
      'Category,Manufacturer,Model,Power (kW),Price,Currency\n' +
        'Panel,Aurora,A500,0.5,250.00,GBP\n',
    );
    expect(result.products[0]!.powerW).toBe(500);
  });

  it('refuses a price with no currency rather than assuming one', () => {
    const { result } = importCsv(
      'Category,Manufacturer,Model,Power (W),Price\nPanel,Aurora,A430,430,180.00\n',
    );
    expect(result.products).toEqual([]);
    expect(codes(result.issues)).toContain('price-without-currency');
  });

  it('marks a price with no source as indicative, and says why', () => {
    const { result } = importCsv(
      'Category,Manufacturer,Model,Power (W),Price,Currency\nPanel,Aurora,A430,430,180.00,GBP\n',
    );
    expect(result.products[0]!.priceStatus).toBe('indicative');
    expect(codes(result.issues)).toContain('no-provenance');
  });

  it('names a missing unit instead of guessing it', () => {
    const { result } = importCsv(
      'Category,Manufacturer,Model,Power,Price,Currency\nPanel,Aurora,A430,4.2,180.00,GBP\n',
    );
    expect(result.products).toEqual([]);
    expect(codes(result.issues)).toContain('missing-unit');
  });

  it('separates a negative figure from an unreadable one', () => {
    const { result } = importCsv(
      'Category,Manufacturer,Model,Power (W),Price,Currency\nPanel,Aurora,A430,-430,180.00,GBP\n',
    );
    expect(result.products).toEqual([]);
    const issue = result.issues.find((entry) => entry.code === 'negative-value');
    expect(issue?.message).toContain('below zero');
  });

  it('keeps the rows it can read and rejects the ones it cannot', () => {
    const { result } = importCsv(
      'Category,Manufacturer,Model,Power (W),Price,Currency\n' +
        'Panel,Aurora,A430,430,180.00,GBP\n' +
        'Washing machine,Bosch,WAN280,0,0,GBP\n' +
        'Panel,Aurora,A425,425,175.00,GBP\n',
    );
    expect(result.products.map((product) => product.model)).toEqual(['A430', 'A425']);
    expect(codes(result.issues)).toContain('unknown-category');
    // The bad row is reported against its own line, not against the file.
    expect(result.issues.find((entry) => entry.code === 'unknown-category')?.rowNumber).toBe(3);
  });

  it('rejects the second copy of a product inside one file', () => {
    const { result } = importCsv(
      'Category,Manufacturer,Model,Power (W),Price,Currency\n' +
        'Panel,Aurora,A430,430,180.00,GBP\n' +
        'Panel,aurora,a430,430,180.00,GBP\n',
    );
    expect(result.products).toHaveLength(1);
    const issue = result.issues.find((entry) => entry.code === 'duplicate-in-file');
    expect(issue?.message).toContain('line 2');
  });

  it('rejects a product the tenant already holds', () => {
    const parsed = parseCsv(
      'Category,Manufacturer,Model,Power (W),Price,Currency\nPanel,Aurora,A430,430,180.00,GBP\n',
    );
    const existing: Product[] = [
      {
        id: 'prd_existing',
        tenantId: 'w_demo000001',
        category: 'panel',
        manufacturer: 'Aurora',
        model: 'A430',
        powerW: 430,
        capacityWh: null,
        priceMinor: 18000,
        currency: 'GBP',
        priceStatus: 'verified',
        warrantyYears: null,
        compatibility: {
          vocV: null,
          iscA: null,
          maxDcPowerW: null,
          maxStringVoltageV: null,
          mpptCount: null,
          phase: null,
          hybrid: null,
          batteryFamilies: null,
          batteryFamily: null,
          inverterModels: null,
        },
        sourceRef: null,
        sourceVersion: null,
        documentRefs: [],
        imageUrl: null,
        notes: null,
        rowNumber: null,
        createdAt: NOW,
      },
    ];
    const result = importProducts(parsed.rows, {
      tenantId: 'w_demo000001',
      now: NOW,
      nextId: () => 'prd_new',
      existing,
    });
    expect(result.products).toEqual([]);
    expect(
      result.issues.find((entry) => entry.code === 'duplicate-in-catalogue')?.message,
    ).toContain('prd_existing');
  });

  it('never converts a currency, even inside one file', () => {
    const { result } = importCsv(
      'Category,Manufacturer,Model,Power (W),Price,Currency\n' +
        'Panel,Aurora,A430,430,180.00,GBP\n' +
        'Panel,Aurora,A425,425,200.00,EUR\n',
    );
    expect(result.products).toHaveLength(1);
    expect(result.currency).toBe('GBP');
    expect(codes(result.issues)).toContain('mixed-currency');
  });

  it('reads a battery’s pairing columns, and warns when there are none', () => {
    const { result } = importCsv(
      'Category,Manufacturer,Model,Capacity (kWh),Price,Currency,Compatible inverters\n' +
        'Battery,Powercell,PC-10,13.5,4500.00,GBP,"Solaris SI-4K; Solaris SI-6K"\n' +
        'Battery,Othercell,OC-5,5,2000.00,GBP,\n',
    );
    const [paired, unpaired] = result.products;
    expect(paired!.capacityWh).toBe(13500);
    expect(paired!.compatibility.inverterModels).toEqual(['Solaris SI-4K', 'Solaris SI-6K']);
    expect(unpaired!.compatibility.inverterModels).toBeNull();
    expect(codes(result.issues)).toContain('battery-pairing-unknown');
  });

  it('notes columns it does not read, once each, however many rows use them', () => {
    const { result } = importCsv(
      'Category,Manufacturer,Model,Power (W),Price,Currency,Lead time\n' +
        'Panel,Aurora,A430,430,180.00,GBP,6 weeks\n' +
        'Panel,Aurora,A425,425,175.00,GBP,4 weeks\n',
    );
    expect(result.ignoredColumns).toEqual(['Lead time']);
    expect(result.products).toHaveLength(2);
    // Summarised at the top of the report, not repeated for every row.
    expect(codes(result.issues)).not.toContain('unknown-column');
  });
});

describe('structured records', () => {
  it('goes through the same reader as a file', () => {
    const result = importRecords(
      [
        {
          Category: 'panel',
          Manufacturer: 'Aurora',
          Model: 'A430',
          'Power (W)': 430,
          Price: '£180.00',
        },
        {
          Category: 'panel',
          Manufacturer: 'Aurora',
          Model: 'A430',
          'Power (W)': 430,
          Price: '£180.00',
        },
      ],
      {
        tenantId: 'w_demo000001',
        now: NOW,
        nextId: () => `prd_${Math.random().toString(36).slice(2, 8)}`,
      },
    );
    expect(result.products).toHaveLength(1);
    expect(result.products[0]!.priceMinor).toBe(18000);
    expect(result.products[0]!.currency).toBe('GBP');
    expect(codes(result.issues)).toContain('duplicate-in-file');
  });

  it('rejects a row whose cell is not a value, quoting what arrived', () => {
    const result = importRecords(
      [
        {
          Category: 'panel',
          Manufacturer: 'Aurora',
          Model: 'A430',
          'Power (W)': { watts: 430 },
          'Price (GBP)': 180,
        },
      ],
      { tenantId: 'w_demo000001', now: NOW, nextId: () => 'prd_0001' },
    );

    expect(result.products).toEqual([]);
    // The cell is shown as it arrived rather than as "[object Object]", so the
    // installer can see which column their export mangled.
    const error = result.issues.find((issue) => issue.severity === 'error');
    expect(error?.code).toBe('unreadable-number');
    expect(error?.message).toContain('{"watts":430}');
  });
});
