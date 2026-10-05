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
      daysPerWeek: 5,
      experienceLevel: 'intermediate',
      startDate: '2026-05-04',
      endDate: '2026-06-29',
      endDateIsRaceDate: true,
    } as const;

    plans.generate(payload);

    expect(typedRequest).toHaveBeenCalledWith(
      'POST',
      '/api/v1/plans/generate',
      payload,
    );
  });

  it('updateDayStructure() sends the blocks and the rows that follow them in one PATCH (CL15)', () => {
    const blocks = [{ id: 'block-emom', sectionType: 'main', formatType: 'emom', steps: [] }] as Parameters<typeof plans.updateDayStructure>[1];
    const relinks = [{ setId: 'set-1', fromBlockId: 'block-emom', fromStepNumber: 2, blockId: 'block-emom', stepNumber: 1 }];

    plans.updateDayStructure('day-1', blocks, relinks);

    expect(typedRequest).toHaveBeenCalledWith('PATCH', '/api/v1/plans/days/day-1/structure', {
      structureBlocks: blocks,
      relinks,
    });
  });

  it('getGenerationStatus() GETs the status endpoint for the given plan', () => {
    plans.getGenerationStatus('plan-123');
    expect(typedRequest).toHaveBeenCalledWith(
      'GET',
      '/api/v1/plans/plan-123/generation-status',
    );
  });
});
