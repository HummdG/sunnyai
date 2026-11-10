import { describe, expect, it } from 'vitest';

// Studio's copy of the PDF's colour adjustment, which says "Adjusted so text
// stays readable." before a save. Tested here, beside the API, because the
// marketing build must not compile the API's sources.
import { readable } from '../../marketing/components/dashboard/quotation/model.js';
import { readableAccent, readableRail } from '../src/proposal/layout.js';

describe("Studio's colour adjustment", () => {
  it("matches the PDF's for the side panel and the highlight", () => {
    for (const hex of [
      '#ff7900',
      '#ffe066',
      '#0f2a3d',
      '#1e9e5a',
      '#7c4dff',
      '#ffffff',
      '#000000',
    ]) {
      expect(readable(hex, 'rail')).toEqual(readableRail(hex));
      expect(readable(hex, 'accent')).toEqual(readableAccent(hex));
    }
  });
});
