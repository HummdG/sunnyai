import { describe, expect, it } from 'vitest';

import { stem } from '../src/stem.js';

describe('stem', () => {
  it.each([
    [['accountant', 'accountants', 'accounts', 'accounting', 'account'], 'account'],
    [['installer', 'installers', 'installation', 'installing', 'installed', 'install'], 'install'],
    [['battery', 'batteries'], 'battery'],
    [['price', 'prices', 'priced', 'pricing'], 'pric'],
    [['manager', 'managers', 'management', 'managing', 'manage'], 'manag'],
    [['process', 'processes'], 'process'],
    [['house', 'houses'], 'hous'],
    [['planning', 'plans'], 'plan'],
    [['panel', 'panels'], 'panel'],
  ])('gives every form of %j one root', (words, root) => {
    for (const word of words) expect(stem(word)).toBe(root);
  });

  it.each(['plant', 'power', 'string', 'solar', 'gas', 'roof', 'sb430', 'status', 'basis'])(
    'leaves %s alone',
    (word) => {
      expect(stem(word)).toBe(word);
    },
  );

  it('never touches part numbers or short words', () => {
    expect(stem('sb-430s')).toBe('sb-430s');
    expect(stem('kw')).toBe('kw');
  });
});
