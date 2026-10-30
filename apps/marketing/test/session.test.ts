import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiHeaders, EDGE_KEY_HEADER } from '../lib/session.js';

describe('calls from the website server to the API', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('carry the edge key, so the load balancer does not rate-limit the dashboard as one visitor', () => {
    vi.stubEnv('SUNNY_EDGE_KEY', 'k-123');
    expect(apiHeaders({ authorization: 'Bearer t' })).toEqual({
      authorization: 'Bearer t',
      [EDGE_KEY_HEADER]: 'k-123',
    });
  });

  it('send nothing extra where no edge key is configured', () => {
    vi.stubEnv('SUNNY_EDGE_KEY', '');
    expect(apiHeaders({ 'content-type': 'application/json' })).toEqual({
      'content-type': 'application/json',
    });
  });
});
