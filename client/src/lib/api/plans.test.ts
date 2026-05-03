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
});
