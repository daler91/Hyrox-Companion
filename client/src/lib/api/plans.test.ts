import { beforeEach, describe, expect, it, vi } from 'vitest';

import { typedRequest } from './client';
import { IMAGE_REPARSE_REQUEST_OPTIONS } from './constants';
import { plans } from './plans';

vi.mock('./client', () => ({
  rawRequest: vi.fn(() => Promise.resolve(undefined)),
  typedRequest: vi.fn(),
}));

describe('plans API client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reparseDayFromImage() uses shared timeout request options', () => {
    const payload = { imageData: 'base64' } as Parameters<typeof plans.reparseDayFromImage>[1];
    plans.reparseDayFromImage('day-1', payload);
    expect(typedRequest).toHaveBeenCalledWith(
      'POST',
      '/api/v1/plans/days/day-1/reparse-from-image',
      payload,
      IMAGE_REPARSE_REQUEST_OPTIONS,
    );
  });

  it('generate() POSTs to the generate endpoint without a custom timeout (returns 202 immediately)', () => {
    const payload = {
      goal: 'Hyrox race prep',
      totalWeeks: 8,
      daysPerWeek: 5,
      experienceLevel: 'intermediate',
    } as const;

    plans.generate(payload);

    expect(typedRequest).toHaveBeenCalledWith(
      'POST',
      '/api/v1/plans/generate',
      payload,
    );
  });

  it('getGenerationStatus() GETs the status endpoint for the given plan', () => {
    plans.getGenerationStatus('plan-123');
    expect(typedRequest).toHaveBeenCalledWith(
      'GET',
      '/api/v1/plans/plan-123/generation-status',
    );
  });
});
