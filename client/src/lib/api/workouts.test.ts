import { beforeEach,describe, expect, it, vi } from 'vitest';

import { typedRequest } from './client';
import { IMAGE_REPARSE_REQUEST_OPTIONS } from './constants';
import { workouts } from './workouts';

vi.mock('./client', () => ({
  typedRequest: vi.fn(),
}));

describe('workouts API client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('create() calls typedRequest with POST and correct data', () => {
    const data = { title: 'Test Workout', rawText: "I did something" } satisfies Parameters<typeof workouts.create>[0];
    workouts.create(data);
    expect(typedRequest).toHaveBeenCalledWith('POST', '/api/v1/workouts', data);
  });

  it('create() passes idempotency headers when provided', () => {
    const data = { title: 'Test Workout', rawText: "I did something" } satisfies Parameters<typeof workouts.create>[0];
    workouts.create(data, { idempotencyKey: "fixed-id" });
    expect(typedRequest).toHaveBeenCalledWith('POST', '/api/v1/workouts', data, {
      headers: { "X-Idempotency-Key": "fixed-id" },
    });
  });

  it('list() calls typedRequest with GET and empty query string when no params provided', () => {
    workouts.list();
    expect(typedRequest).toHaveBeenCalledWith('GET', '/api/v1/workouts');
  });

  it('list() calls typedRequest with GET and correct query string when params provided', () => {
    workouts.list({ limit: 10, offset: 5 });
    expect(typedRequest).toHaveBeenCalledWith('GET', '/api/v1/workouts?limit=10&offset=5');
  });

  it('list() filters out null or undefined params from query string', () => {
    workouts.list({ limit: 10, offset: undefined });
    expect(typedRequest).toHaveBeenCalledWith('GET', '/api/v1/workouts?limit=10');
  });

  it('get() calls typedRequest with GET and correct id', () => {
    workouts.get('123');
    expect(typedRequest).toHaveBeenCalledWith('GET', '/api/v1/workouts/123');
  });

  it('latest() calls typedRequest with GET on the /latest endpoint', () => {
    workouts.latest();
    expect(typedRequest).toHaveBeenCalledWith('GET', '/api/v1/workouts/latest');
  });

  it('update() calls typedRequest with PATCH and correct id and data', () => {
    const data: Parameters<typeof workouts.update>[1] = { title: 'Updated Workout' };
    workouts.update('123', data);
    expect(typedRequest).toHaveBeenCalledWith('PATCH', '/api/v1/workouts/123', data);
  });

  it('delete() calls typedRequest with DELETE and correct id', () => {
    workouts.delete('123');
    expect(typedRequest).toHaveBeenCalledWith('DELETE', '/api/v1/workouts/123');
  });

  it('bulkDelete() posts workout and plan-day targets', () => {
    const payload = { workoutLogIds: ['w-1'], planDayIds: ['pd-1'] };
    workouts.bulkDelete(payload);
    expect(typedRequest).toHaveBeenCalledWith('POST', '/api/v1/workouts/bulk-delete', payload);
  });

  it('getUnstructured() calls typedRequest with GET', () => {
    workouts.getUnstructured();
    expect(typedRequest).toHaveBeenCalledWith('GET', '/api/v1/workouts/unstructured');
  });

  it('reparse() calls typedRequest with POST and correct id', () => {
    workouts.reparse('123');
    expect(typedRequest).toHaveBeenCalledWith('POST', '/api/v1/workouts/123/reparse');
  });

  it('batchReparse() calls typedRequest with POST', () => {
    workouts.batchReparse();
    expect(typedRequest).toHaveBeenCalledWith('POST', '/api/v1/workouts/batch-reparse');
  });

  it('reparseFromImage() uses shared timeout request options', () => {
    const payload = { imageData: 'base64' } as Parameters<typeof workouts.reparseFromImage>[1];
    workouts.reparseFromImage('123', payload);
    expect(typedRequest).toHaveBeenCalledWith(
      'POST',
      '/api/v1/workouts/123/reparse-from-image',
      payload,
      IMAGE_REPARSE_REQUEST_OPTIONS,
    );
  });
});
