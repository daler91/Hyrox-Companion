import { beforeEach, describe, expect, it, vi } from 'vitest';

import { rawRequest, typedRequest } from './client';
import { chat } from './coaching';
import { AI_REQUEST_TIMEOUT_MS, IMAGE_REPARSE_TIMEOUT_MS } from './constants';
import { exercises } from './exercises';
import { nutrition } from './nutrition';
import { plans } from './plans';
import { strava } from './user';
import { workouts } from './workouts';

vi.mock('./client', () => ({
  rawRequest: vi.fn(() => Promise.resolve(undefined)),
  typedRequest: vi.fn(() => Promise.resolve({})),
}));

// The server gives one AI request up to 120 s across its retries
// (AI_REQUEST_TIMEOUT_MS in server/constants.ts) and Strava's sync up to 30 s
// of enrichment on top of the import itself.
const SERVER_AI_BUDGET_MS = 120_000;
const MIN_STRAVA_SYNC_TIMEOUT_MS = 45_000;

function lastTimeoutMs(): number | undefined {
  const call = vi.mocked(typedRequest).mock.calls.at(-1);
  return call?.[3]?.timeoutMs;
}

const image = { imageBase64: 'aGk=', mimeType: 'image/jpeg' } as const;

describe('request timeouts for calls that wait on the server (CL26)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sizes the shared AI timeout past the server AI budget', () => {
    expect(AI_REQUEST_TIMEOUT_MS).toBeGreaterThan(SERVER_AI_BUDGET_MS);
    expect(IMAGE_REPARSE_TIMEOUT_MS).toBe(AI_REQUEST_TIMEOUT_MS);
  });

  it.each([
    ['exercises.parse', () => exercises.parse('3x10 squats')],
    ['exercises.parseStructured', () => exercises.parseStructured('3x10 squats')],
    ['exercises.parseFromImage', () => exercises.parseFromImage(image)],
    ['exercises.parseStructuredFromImage', () => exercises.parseStructuredFromImage(image)],
    ['workouts.reparse', () => workouts.reparse('w-1')],
    ['workouts.reparseFromImage', () => workouts.reparseFromImage('w-1', image)],
    ['plans.reparseDay', () => plans.reparseDay('pd-1')],
    ['plans.reparseDayFromImage', () => plans.reparseDayFromImage('pd-1', image)],
    ['nutrition.parseMealText', () => nutrition.parseMealText('two eggs on toast')],
    ['nutrition.parseMealPhoto', () => nutrition.parseMealPhoto('aGk=', 'image/jpeg')],
    ['nutrition.parseLabel', () => nutrition.parseLabel('aGk=', 'image/jpeg')],
    ['nutrition.regenerateInsights', () => nutrition.regenerateInsights()],
    ['chat.send', () => chat.send({ message: 'How did my week go?', userMessageId: 'u-1', assistantMessageId: 'a-1' })],
  ])('%s waits out the server AI budget', async (_name, call) => {
    await call();
    expect(lastTimeoutMs()).toBe(AI_REQUEST_TIMEOUT_MS);
  });

  it('keeps the caller signal on a parse that gets the AI timeout', async () => {
    const controller = new AbortController();
    await exercises.parseStructured('3x10 squats', { signal: controller.signal });
    expect(vi.mocked(typedRequest).mock.calls.at(-1)?.[3]).toEqual({
      signal: controller.signal,
      timeoutMs: AI_REQUEST_TIMEOUT_MS,
    });
  });

  it('gives the Strava sync more than its enrichment budget', async () => {
    await strava.sync();
    expect(lastTimeoutMs()).toBeGreaterThanOrEqual(MIN_STRAVA_SYNC_TIMEOUT_MS);
  });

  it('leaves ordinary reads on the default timeout', async () => {
    await workouts.get('w-1');
    expect(lastTimeoutMs()).toBeUndefined();
    expect(rawRequest).not.toHaveBeenCalled();
  });
});
