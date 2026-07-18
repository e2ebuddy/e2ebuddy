import { describe, expect, it } from 'vitest';

import type { TestRun } from 'shared';

import { deriveResumeStage } from '../src/index.js';

const base: TestRun = {
  id: 'r123456789012345678901234',
  targetUrl: 'https://example.com/',
  status: 'queued',
  createdAt: new Date(),
};

describe('worker resume stage', () => {
  it('derives recovery solely from validated artifacts, not status', () => {
    expect(deriveResumeStage({ ...base, status: 'done' })).toBe('explore');
    expect(
      deriveResumeStage({
        ...base,
        understanding: {
          productType: 'site',
          summary: 'summary',
          primaryLanguage: 'en',
          pages: [],
          coreFlows: [],
          observations: [],
        },
      }),
    ).toBe('plan');
  });
});
