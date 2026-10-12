import {
  chatStreamEventSchema,
  PAGE_ACTIONS as CONTRACT_PAGE_ACTIONS,
  publicWidgetIdSchema,
  SUNSCAN_STATUSES as CONTRACT_SUNSCAN_STATUSES,
} from '@sunny/contracts';
import { describe, expect, it } from 'vitest';

import { PAGE_ACTIONS, parseStreamEvent, SUNSCAN_STATUSES } from '../src/chat.js';
import { PUBLIC_WIDGET_ID } from '../src/index.js';

/**
 * The widget checks stream events and widget ids without zod, to stay small.
 * These tests pin its copies to the contracts so the two cannot drift.
 */
describe('the widget’s own contract checks', () => {
  it('knows exactly the contract’s page actions', () => {
    expect([...PAGE_ACTIONS]).toEqual([...CONTRACT_PAGE_ACTIONS]);
  });

  it('knows exactly the contract’s roof assessment statuses', () => {
    expect([...SUNSCAN_STATUSES]).toEqual([...CONTRACT_SUNSCAN_STATUSES]);
  });

  it('accepts a roof assessment event the contract accepts, and drops a malformed one', () => {
    const running = {
      type: 'sunscan',
      messageId: 'm',
      assessmentId: 'ss_1',
      status: 'running',
      summary: null,
    };
    expect(chatStreamEventSchema.safeParse(running).success).toBe(true);
    expect(parseStreamEvent(running)).not.toBeNull();
    const done = {
      ...running,
      status: 'succeeded',
      summary: {
        address: '20 Forthlin Road',
        postcode: 'L18 9TN',
        builtForm: 'mid-terrace',
        era: 'unknown',
        storeys: 2,
        roofType: 'gabled',
        eaveHeightM: 5,
        roofPlanes: [
          {
            id: 0,
            partId: 'main',
            pitchDeg: 40,
            azimuthDeg: 180,
            facing: 'S',
            areaM2: 30,
            planAreaM2: 23,
            widthM: 6,
            slopeLengthM: 5,
            fillRatio: 1,
            usableAreaM2: 21,
            maxPanels: 12,
            suitable: true,
          },
        ],
        suitableRoofAreaM2: 30,
        usableRoofAreaM2: 21,
        estimatedMaxPanels: 12,
        mainPlaneId: 0,
        obstructions: { chimneys: 0 },
        shadingFlags: ['shading-not-assessed'],
        bestFacing: 'S',
        confidence: { geocode: 'high', footprint: 'high', heights: 'measured', roof: 'high' },
        reliable: true,
        flags: [],
        notes: [],
        sources: [],
        label: 'Indicative — subject to an on-site survey',
      },
    };
    expect(chatStreamEventSchema.safeParse(done).success).toBe(true);
    expect(parseStreamEvent(done)).not.toBeNull();
    expect(parseStreamEvent({ ...running, status: 'done' })).toBeNull();
    expect(parseStreamEvent({ ...running, assessmentId: 7 })).toBeNull();
    expect(parseStreamEvent({ ...running, summary: { address: 'x' } })).toBeNull();
  });

  it('accepts exactly the widget ids the contract accepts', () => {
    for (const id of [
      'w_demo000001',
      'w_abc1234567',
      'w_' + 'a'.repeat(40),
      'w_short',
      'W_demo000001',
      'w_demo-00001',
      '',
    ]) {
      expect(PUBLIC_WIDGET_ID.test(id), id).toBe(publicWidgetIdSchema.safeParse(id).success);
    }
  });

  it('accepts well-formed events, including citations, notices and escalations', () => {
    const ok = [
      { type: 'message_started', messageId: 'm' },
      { type: 'text_delta', messageId: 'm', text: 'hi' },
      { type: 'page_action_suggested', messageId: 'm', action: 'scroll', target: 'quote-form' },
      {
        type: 'sources',
        messageId: 'm',
        sources: [{ ref: 'S1', title: 'Warranty', url: 'https://x.example', chunkId: 'c1' }],
      },
      {
        type: 'sources',
        messageId: 'm',
        sources: [{ ref: 'S1', title: 'Doc', url: null, chunkId: 'c' }],
      },
      { type: 'disclaimer', messageId: 'm', kind: 'estimate', text: 'Non-binding.' },
      { type: 'escalation', messageId: 'm', kind: 'safety' },
      { type: 'error', messageId: 'm', code: 'upstream_failed', message: 'oops' },
      { type: 'done', messageId: 'done' },
    ];
    for (const event of ok) expect(parseStreamEvent(event), event.type).not.toBeNull();
  });

  it('drops malformed or unknown events', () => {
    const bad = [
      null,
      'text',
      { type: 'text_delta', messageId: 'm' },
      { type: 'text_delta', messageId: 'm', text: 5 },
      { type: 'page_action_suggested', messageId: 'm', action: 'eval', target: 'x' },
      { type: 'sources', messageId: 'm', sources: [{ ref: 'S1', title: 3, url: null }] },
      { type: 'escalation', messageId: 'm', kind: 'other' },
      { type: 'run_script', messageId: 'm' },
      { type: 'done' },
    ];
    for (const event of bad) expect(parseStreamEvent(event)).toBeNull();
  });

  it('accepts a quote event the contract accepts, and drops a malformed one', () => {
    const quote = {
      type: 'quote',
      messageId: 'm',
      quote: {
        quoteId: 'q_1',
        priced: true,
        disclaimer: 'Indicative and non-binding.',
        options: [
          {
            id: 'recommended',
            label: 'Recommended',
            isRecommended: true,
            headline: 'Best value over 25 years',
            panelCount: 10,
            systemKwp: 4.3,
            batteryType: 'Fox ESS EC2900',
            batteryCapacityKwh: 5.8,
            priceGbp: 9277,
            priceLabel: 'Indicative price',
            annualGenerationKwh: 3900,
            annualSavingsGbp: 820,
            paybackYears: 11.3,
          },
        ],
      },
    };
    expect(chatStreamEventSchema.safeParse(quote).success).toBe(true);
    expect(parseStreamEvent(quote)).not.toBeNull();
    const broken = { ...quote, quote: { ...quote.quote, options: [{ id: 'x' }] } };
    expect(parseStreamEvent(broken)).toBeNull();
  });
});
