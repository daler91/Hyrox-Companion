import crypto from 'node:crypto';

import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { afterEach,beforeEach, describe, expect, it, vi } from 'vitest';

// Delay-free manual mock (server/utils/__mocks__/httpRetry.ts): keeps the real
// RetryableHttpError class and retry semantics, drops the backoff sleeps.
vi.mock('./utils/httpRetry');

import { AppError } from './errors';
import {
  computeSyncAfterEpoch,
  createSignedState,
  deauthorizeStravaBestEffort,
  enrichFromActivityDetail,
  fetchStravaActivities,
  fetchStravaActivityStreams,
  verifySignedState,
} from './strava';
import { RetryableHttpError } from './utils/httpRetry';

describe('strava service state signing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1700000000000)); // Nov 14 2023
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('createSignedState', () => {
    it('generates a deterministically verifiable state', () => {
      // Mock crypto.randomBytes just for this test so we know the nonce
      const randomBytesSpy = vi.spyOn(crypto, 'randomBytes').mockImplementation((size: number) => {
        return Buffer.alloc(size, 'a'); // Fill with 'a' chars, 8 bytes
      });

      const userId = 'user_123';
      const state = createSignedState(userId);

      // Restore to allow normal verify function execution
      randomBytesSpy.mockRestore();

      // State format should be `userId:timestamp:nonce:signature`
      const parts = state.split(':');
      expect(parts).toHaveLength(4);
      expect(parts[0]).toBe('user_123');

      // 1700000000000 in base36 is 'lo6z9d8g'
      expect(parts[1]).toBe((1700000000000).toString(36));

      // The nonce is 8 bytes of 'a' -> 16 hex chars
      expect(parts[2]).toBe('6161616161616161');

      // verifySignedState should be able to decode it correctly
      const verified = verifySignedState(state);
      expect(verified).toStrictEqual({ userId: 'user_123' });
    });

    it('generates unique states for different times and nonces', () => {
      const state1 = createSignedState('user_123');

      vi.advanceTimersByTime(1000); // advance 1 second

      const state2 = createSignedState('user_123');

      expect(state1).not.toBe(state2);

      const parts1 = state1.split(':');
      const parts2 = state2.split(':');

      // Timestamps or nonces should differ
      expect(parts1[1] !== parts2[1] || parts1[2] !== parts2[2]).toBe(true);
    });
  });


  describe('state secret isolation', () => {
    it('uses a dedicated secret instead of reusing CLERK_SECRET_KEY', async () => {
      // Isolate module imports
      vi.resetModules();

      // Mock the env with specific values to ensure they are distinct
      vi.doMock('./env', () => ({
        env: {
          STRAVA_STATE_SECRET: 'dedicated-strava-secret-12345678',
          CLERK_SECRET_KEY: 'shared-clerk-secret-87654321',
          DATABASE_URL: 'postgres://dummy',
          APP_URL: 'http://localhost'
        }
      }));

      const { createSignedState, verifySignedState } = await import('./strava');
      const crypto = await import('node:crypto');

      const userId = 'user_isolate_test';
      const state = createSignedState(userId);
      const parts = state.split(':');
      expect(parts).toHaveLength(4);

      const [id, timestamp, nonce, signature] = parts;
      const payload = `${id}:${timestamp}:${nonce}`;

      // Verify the signature is generated using STRAVA_STATE_SECRET, not CLERK_SECRET_KEY
      const expectedWithStrava = crypto.createHmac('sha256', 'dedicated-strava-secret-12345678').update(payload).digest('hex');
      const expectedWithClerk = crypto.createHmac('sha256', 'shared-clerk-secret-87654321').update(payload).digest('hex');

      expect(signature).toBe(expectedWithStrava);
      expect(signature).not.toBe(expectedWithClerk);

      expect(verifySignedState(state)).toStrictEqual({ userId: 'user_isolate_test' });
    });
  });

  describe('verifySignedState', () => {
    it('returns user ID for a valid state', () => {
      const state = createSignedState('user_123');
      const verified = verifySignedState(state);
      expect(verified).toStrictEqual({ userId: 'user_123' });
    });

    it('returns null if state is missing parts', () => {
      // Missing signature
      expect(verifySignedState('user_123:timestamp:nonce')).toBeNull();
      // Only user ID
      expect(verifySignedState('user_123')).toBeNull();
      // Empty string
      expect(verifySignedState('')).toBeNull();
    });

    it('returns null if signature is invalid', () => {
      const state = createSignedState('user_123');
      // Tamper with the signature by changing the last character (to maintain length)
      const tamperedState = state.slice(0, -1) + (state.endsWith('a') ? 'b' : 'a');
      expect(verifySignedState(tamperedState)).toBeNull();

      // Tamper with the user ID
      const parts = state.split(':');
      parts[0] = 'user_999';
      expect(verifySignedState(parts.join(':'))).toBeNull();
    });

    it('returns null instead of throwing an exception for length mismatch (DoS protection)', () => {
      const state = createSignedState('user_123');
      // Append an extra character to the signature, changing its length.
      // Prior to the fix, crypto.timingSafeEqual would throw an error here.
      const tamperedState = state + 'a';
      expect(() => verifySignedState(tamperedState)).not.toThrow();
      expect(verifySignedState(tamperedState)).toBeNull();
    });

    it('returns null if state is expired', () => {
      // STATE_MAX_AGE_MS is 10 * 60 * 1000 = 600,000ms
      const state = createSignedState('user_123');

      // Advance time by 10 minutes and 1 millisecond
      vi.advanceTimersByTime(10 * 60 * 1000 + 1);

      expect(verifySignedState(state)).toBeNull();
    });

    it('returns user ID if state is barely valid', () => {
      const state = createSignedState('user_123');

      // Advance time by exactly 10 minutes (still valid)
      vi.advanceTimersByTime(10 * 60 * 1000);

      expect(verifySignedState(state)).toStrictEqual({ userId: 'user_123' });
    });
  });
});

const MS_PER_DAY = 86_400_000;

describe('computeSyncAfterEpoch', () => {
  const NOW = new Date(1700000000000);

  it('backfills 90 days on first sync (no cursor)', () => {
    expect(computeSyncAfterEpoch(null, NOW)).toBe(
      Math.floor((NOW.getTime() - 90 * MS_PER_DAY) / 1000),
    );
  });

  it('resumes 7 days before the stored cursor for incremental syncs', () => {
    const lastSyncedAt = new Date(NOW.getTime() - 3 * MS_PER_DAY);
    expect(computeSyncAfterEpoch(lastSyncedAt, NOW)).toBe(
      Math.floor((lastSyncedAt.getTime() - 7 * MS_PER_DAY) / 1000),
    );
  });

  it('returns whole epoch seconds, clamped at zero', () => {
    // A cursor near the epoch would otherwise go negative after the overlap.
    expect(computeSyncAfterEpoch(new Date(0), NOW)).toBe(0);
    expect(Number.isInteger(computeSyncAfterEpoch(null, NOW))).toBe(true);
  });
});

/** Minimal fetch Response stand-in for the fields the Strava client reads. */
function stravaResponse(body: unknown, status = 200, retryAfter: string | null = null) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: { get: () => retryAfter },
  };
}

describe('fetchStravaActivities', () => {
  const log = { error: vi.fn() };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('requests with after/per_page/page and stops on a short page', async () => {
    fetchMock.mockResolvedValueOnce(stravaResponse([{ id: 1 }, { id: 2 }]));

    const result = await fetchStravaActivities('token-abc', log, 1234567);

    expect(result.activities.map((a) => a.id)).toEqual([1, 2]);
    expect(result.hasMore).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe('/api/v3/athlete/activities');
    expect(url.searchParams.get('after')).toBe('1234567');
    expect(url.searchParams.get('per_page')).toBe('200');
    expect(url.searchParams.get('page')).toBe('1');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer token-abc');
  });

  it('aggregates across pages, incrementing the page param', async () => {
    const fullPage = Array.from({ length: 200 }, (_, i) => ({ id: i }));
    fetchMock
      .mockResolvedValueOnce(stravaResponse(fullPage))
      .mockResolvedValueOnce(stravaResponse([{ id: 9999 }]));

    const result = await fetchStravaActivities('token', log, 0);

    expect(result.activities).toHaveLength(201);
    expect(result.hasMore).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get('page')).toBe('2');
  });

  it('caps at 5 pages and reports hasMore', async () => {
    const fullPage = Array.from({ length: 200 }, (_, i) => ({ id: i }));
    fetchMock.mockResolvedValue(stravaResponse(fullPage));

    const result = await fetchStravaActivities('token', log, 0);

    expect(result.activities).toHaveLength(1000);
    expect(result.hasMore).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('throws a non-retryable 401 AppError when authorization was revoked', async () => {
    fetchMock.mockResolvedValue(stravaResponse(null, 401));

    const err = await fetchStravaActivities('token', log, 0).catch((e) => e);

    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(401);
    // Revocation must not be retried.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries 429s then surfaces RetryableHttpError with the Retry-After hint', async () => {
    fetchMock.mockResolvedValue(stravaResponse(null, 429, '120'));

    const err = await fetchStravaActivities('token', log, 0).catch((e) => e);

    expect(err).toBeInstanceOf(RetryableHttpError);
    expect(err.status).toBe(429);
    expect(err.retryAfterMs).toBe(120_000);
    // Initial attempt + 3 retries.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

describe('enrichFromActivityDetail', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const log = { warn: vi.fn() };

  function candidates(count: number, calories: number | null = null) {
    return Array.from({ length: count }, (_, i) => ({
      stravaActivityId: String(i + 1),
      calories,
      rpe: null as number | null,
    })) as unknown as Parameters<typeof enrichFromActivityDetail>[1];
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1700000000000));
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('enriches every candidate while the time budget holds', async () => {
    fetchMock.mockResolvedValue(stravaResponse({ id: 1, calories: 480.4 }));
    const workouts = candidates(3);

    await enrichFromActivityDetail('token', workouts, log);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(workouts.map((w) => w.calories)).toEqual([480, 480, 480]);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("takes the athlete's own Strava rating as the RPE, and leaves it empty without one", async () => {
    fetchMock
      .mockResolvedValueOnce(stravaResponse({ id: 1, calories: 400, perceived_exertion: 7.0 }))
      .mockResolvedValueOnce(stravaResponse({ id: 2, calories: 400, perceived_exertion: null }))
      .mockResolvedValueOnce(stravaResponse({ id: 3, calories: 400 }));
    const workouts = candidates(3);

    await enrichFromActivityDetail('token', workouts, log);

    expect(workouts.map((w) => w.rpe)).toEqual([7, null, null]);
  });

  it('fetches the detail for a power-meter ride too, keeping its kilojoule calories', async () => {
    // The rating only exists on the detail, so a row whose calories the list
    // already gave (kilojoules) still needs the read — but its calories stay.
    fetchMock.mockResolvedValue(stravaResponse({ id: 1, calories: 900, perceived_exertion: 6 }));
    const workouts = candidates(1, 612);

    await enrichFromActivityDetail('token', workouts, log);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(workouts[0].calories).toBe(612);
    expect(workouts[0].rpe).toBe(6);
  });

  it('stops once the overall budget is spent, keeping the rows already enriched', async () => {
    // Each detail call limps along for 12s: the third finishes at 36s, past
    // the 30s budget, so the fourth and fifth are never attempted.
    fetchMock.mockImplementation(async () => {
      vi.setSystemTime(Date.now() + 12_000);
      return stravaResponse({ id: 1, calories: 500 });
    });
    const workouts = candidates(5);

    await enrichFromActivityDetail('token', workouts, log);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(workouts.map((w) => w.calories)).toEqual([500, 500, 500, null, null]);
    expect(log.warn).toHaveBeenCalledWith(
      { attempted: 3, of: 5 },
      expect.stringContaining('time budget'),
    );
  });
});

describe('fetchStravaActivityStreams', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('asks for the HR/pace series only, keyed by type, and flattens the body', async () => {
    fetchMock.mockResolvedValue(
      stravaResponse({
        time: { data: [0, 1, 2] },
        heartrate: { data: [120, 121, 122] },
        velocity_smooth: { data: [3, 3.1, 3.2] },
        moving: { data: [true, true, true] },
      }),
    );

    const result = await fetchStravaActivityStreams('token', '9001');

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe('/api/v3/activities/9001/streams');
    expect(url.searchParams.get('keys')).toBe('time,heartrate,velocity_smooth,distance,moving');
    expect(url.searchParams.get('key_by_type')).toBe('true');
    // No GPS is ever requested.
    expect(url.searchParams.get('keys')).not.toContain('latlng');
    expect(result).toEqual({
      ok: true,
      streams: {
        time: [0, 1, 2],
        heartrate: [120, 121, 122],
        velocity_smooth: [3, 3.1, 3.2],
        moving: [true, true, true],
      },
    });
  });

  it.each([
    [404, { ok: false, reason: 'not_found' }],
    [401, { ok: false, reason: 'reauth_required' }],
    [403, { ok: false, reason: 'reauth_required' }],
    [400, { ok: false, reason: 'failed', status: 400 }],
  ])('maps HTTP %s to %o', async (status, expected) => {
    fetchMock.mockResolvedValue(stravaResponse(null, status));
    await expect(fetchStravaActivityStreams('token', '1')).resolves.toEqual(expected);
  });

  it('reports a 429 that outlasts the retry as rate_limited with the Retry-After hint', async () => {
    fetchMock.mockResolvedValue(stravaResponse(null, 429, '300'));
    await expect(fetchStravaActivityStreams('token', '1')).resolves.toEqual({
      ok: false,
      reason: 'rate_limited',
      retryAfterSeconds: 300,
    });
    // One retry, then give up: a stream is never worth the full retry ladder.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports a persistent 5xx or network failure as failed', async () => {
    fetchMock.mockResolvedValue(stravaResponse(null, 503));
    await expect(fetchStravaActivityStreams('token', '1')).resolves.toEqual({
      ok: false,
      reason: 'failed',
      status: 503,
    });
    fetchMock.mockRejectedValue(new Error('boom'));
    await expect(fetchStravaActivityStreams('token', '1')).resolves.toEqual({
      ok: false,
      reason: 'failed',
      status: null,
    });
  });
});

describe('deauthorizeStravaBestEffort', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs the deauthorize endpoint with the access token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const log = { warn: vi.fn() };

    await deauthorizeStravaBestEffort('token-123', log);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.strava.com/oauth/deauthorize',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(String(fetchMock.mock.calls[0][1].body)).toContain('access_token=token-123');
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('swallows upstream failures with a warning (must never block disconnect)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const log = { warn: vi.fn() };

    await expect(deauthorizeStravaBestEffort('token-123', log)).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalled();
  });
});

describe('getValidAccessToken', () => {
  const FIXED_NOW = 1700000000000;

  const freshConnection = {
    id: 'conn-1',
    userId: 'user-1',
    stravaAthleteId: 'athlete-1',
    accessToken: 'stored-access',
    refreshToken: 'stored-refresh',
    expiresAt: new Date(FIXED_NOW + 3_600_000),
    scope: 'activity:read_all',
    lastSyncedAt: null,
    requiresReauth: false,
    createdAt: new Date(FIXED_NOW - MS_PER_DAY),
  };
  // Inside the 60s refresh safety window → treated as stale.
  const staleConnection = { ...freshConnection, expiresAt: new Date(FIXED_NOW + 1_000) };

  let getStravaConnection: ReturnType<typeof vi.fn>;
  let updateStravaTokens: ReturnType<typeof vi.fn>;
  let setStravaReauthRequired: ReturnType<typeof vi.fn>;
  let withPgAdvisoryLock: ReturnType<typeof vi.fn>;
  let fetchMock: ReturnType<typeof vi.fn>;
  let getValidAccessToken: typeof import('./strava')['getValidAccessToken'];

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    vi.resetModules();

    getStravaConnection = vi.fn();
    updateStravaTokens = vi.fn().mockResolvedValue(undefined);
    setStravaReauthRequired = vi.fn().mockResolvedValue(undefined);
    // Default: lock acquired, protected work runs inline.
    withPgAdvisoryLock = vi.fn(async (_pool, _opts, run) => ({ acquired: true, value: await run() }));

    // The refresh path reads STRAVA_CLIENT_ID/SECRET at module scope, so the
    // module must be re-imported with a mocked env (same pattern as the
    // "state secret isolation" test above).
    vi.doMock('./env', () => ({
      env: {
        STRAVA_CLIENT_ID: 'client-id',
        STRAVA_CLIENT_SECRET: 'client-secret',
        STRAVA_STATE_SECRET: 'dedicated-strava-secret-12345678', // gitleaks:allow — fake test-only value, not a credential
        DATABASE_URL: 'postgres://dummy',
        APP_URL: 'https://app.example.com',
      },
    }));
    vi.doMock('./storage', () => ({
      storage: {
        users: { getStravaConnection, updateStravaTokens, setStravaReauthRequired },
      },
    }));
    vi.doMock('./advisoryLock', () => ({ withPgAdvisoryLock }));

    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    ({ getValidAccessToken } = await import('./strava'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock('./env');
    vi.doUnmock('./storage');
    vi.doUnmock('./advisoryLock');
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('reports not_connected when no connection exists', async () => {
    getStravaConnection.mockResolvedValue(undefined);

    await expect(getValidAccessToken('user-1')).resolves.toEqual({
      ok: false,
      reason: 'not_connected',
    });
  });

  it('fails fast with reauth_required on a tombstoned connection', async () => {
    getStravaConnection.mockResolvedValue({ ...freshConnection, requiresReauth: true });

    await expect(getValidAccessToken('user-1')).resolves.toEqual({
      ok: false,
      reason: 'reauth_required',
    });
    expect(withPgAdvisoryLock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('short-circuits with the stored token while it is fresh', async () => {
    getStravaConnection.mockResolvedValue(freshConnection);

    const result = await getValidAccessToken('user-1');

    expect(result).toMatchObject({ ok: true, accessToken: 'stored-access' });
    expect(withPgAdvisoryLock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('re-reads under the lock and skips the refresh when a concurrent request already won', async () => {
    getStravaConnection
      .mockResolvedValueOnce(staleConnection)
      .mockResolvedValueOnce({ ...freshConnection, accessToken: 'winner-access' });

    const result = await getValidAccessToken('user-1');

    expect(result).toMatchObject({ ok: true, accessToken: 'winner-access' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(updateStravaTokens).not.toHaveBeenCalled();
  });

  it('refreshes a stale token and persists the rotated pair', async () => {
    getStravaConnection.mockResolvedValue(staleConnection);
    const expiresAtEpoch = Math.floor((FIXED_NOW + 6 * 3_600_000) / 1000);
    fetchMock.mockResolvedValue(stravaResponse({
      token_type: 'Bearer',
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      expires_at: expiresAtEpoch,
      expires_in: 21_600,
    }));

    const result = await getValidAccessToken('user-1');

    expect(result).toMatchObject({ ok: true, accessToken: 'new-access' });
    expect(updateStravaTokens).toHaveBeenCalledWith('user-1', {
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      expiresAt: new Date(expiresAtEpoch * 1000),
    });
  });

  it('tombstones the connection when the refresh is permanently rejected', async () => {
    getStravaConnection.mockResolvedValue(staleConnection);
    // invalid_grant: the user revoked the app on strava.com.
    fetchMock.mockResolvedValue(stravaResponse({ error: 'invalid_grant' }, 400));

    await expect(getValidAccessToken('user-1')).resolves.toEqual({
      ok: false,
      reason: 'reauth_required',
    });
    expect(setStravaReauthRequired).toHaveBeenCalledWith('user-1');
  });

  it('reports transient (no tombstone) when the refresh fails on a network error', async () => {
    getStravaConnection.mockResolvedValue(staleConnection);
    fetchMock.mockRejectedValue(new Error('socket hang up'));

    await expect(getValidAccessToken('user-1')).resolves.toEqual({
      ok: false,
      reason: 'transient',
    });
    expect(setStravaReauthRequired).not.toHaveBeenCalled();
  });

  it('polls for the winner’s token when the try-lock is already held', async () => {
    withPgAdvisoryLock.mockResolvedValue({ acquired: false, value: undefined });
    getStravaConnection
      .mockResolvedValueOnce(staleConnection)
      .mockResolvedValueOnce({ ...freshConnection, accessToken: 'other-instance-access' });

    const promise = getValidAccessToken('user-1');
    await vi.advanceTimersByTimeAsync(500);
    const result = await promise;

    expect(result).toMatchObject({ ok: true, accessToken: 'other-instance-access' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('gives up as transient when the lock holder never lands a fresh token', async () => {
    withPgAdvisoryLock.mockResolvedValue({ acquired: false, value: undefined });
    getStravaConnection.mockResolvedValue(staleConnection);

    const promise = getValidAccessToken('user-1');
    await vi.advanceTimersByTimeAsync(3 * 500);

    await expect(promise).resolves.toEqual({ ok: false, reason: 'transient' });
  });
});

describe('syncStravaForUser', () => {
  const FIXED_NOW = 1700000000000;

  const connection = {
    id: 'conn-1',
    userId: 'user-1',
    stravaAthleteId: 'athlete-1',
    accessToken: 'stored-access',
    refreshToken: 'stored-refresh',
    expiresAt: new Date(FIXED_NOW + 3_600_000),
    scope: 'activity:read_all',
    lastSyncedAt: new Date(FIXED_NOW - 2 * MS_PER_DAY),
    requiresReauth: false,
    createdAt: new Date(FIXED_NOW - 10 * MS_PER_DAY),
  };

  /** A list-endpoint activity row; higher ids are newer. */
  function activity(id: number) {
    const startedAt = new Date(FIXED_NOW - (100 - id) * 3_600_000);
    return {
      id,
      name: `Run ${id}`,
      type: 'Run',
      sport_type: 'Run',
      start_date: startedAt.toISOString(),
      start_date_local: startedAt.toISOString(),
      distance: 5000,
      moving_time: 1500,
      elapsed_time: 1600,
      total_elevation_gain: 20,
      average_speed: 3.3,
      max_speed: 4.1,
    };
  }

  const zeroCounts = { enriched: 0, completedPlanDays: 0, suggested: 0, standalone: 0, skipped: 0 };
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  let getStravaConnection: ReturnType<typeof vi.fn>;
  let getExistingStravaActivityIds: ReturnType<typeof vi.fn>;
  let listDeviceRecordingsForDates: ReturnType<typeof vi.fn>;
  let updateStravaLastSync: ReturnType<typeof vi.fn>;
  let setStravaReauthRequired: ReturnType<typeof vi.fn>;
  let reconcileStravaActivities: ReturnType<typeof vi.fn>;
  let fetchMock: ReturnType<typeof vi.fn>;
  let enqueueSessionStreams: ReturnType<typeof vi.fn>;
  let syncStravaForUser: typeof import('./strava')['syncStravaForUser'];

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    vi.resetModules();

    getStravaConnection = vi.fn().mockResolvedValue(connection);
    getExistingStravaActivityIds = vi.fn().mockResolvedValue([]);
    listDeviceRecordingsForDates = vi.fn().mockResolvedValue([]);
    updateStravaLastSync = vi.fn().mockResolvedValue(undefined);
    setStravaReauthRequired = vi.fn().mockResolvedValue(undefined);
    reconcileStravaActivities = vi.fn().mockResolvedValue({ ...zeroCounts });

    vi.doMock('./env', () => ({
      env: {
        STRAVA_CLIENT_ID: 'client-id',
        STRAVA_CLIENT_SECRET: 'client-secret',
        STRAVA_STATE_SECRET: 'dedicated-strava-secret-12345678', // gitleaks:allow — fake test-only value, not a credential
        DATABASE_URL: 'postgres://dummy',
        APP_URL: 'https://app.example.com',
      },
    }));
    vi.doMock('./storage', () => ({
      storage: {
        users: {
          getStravaConnection,
          getUser: vi.fn().mockResolvedValue({ id: 'user-1', distanceUnit: 'km' }),
          updateStravaTokens: vi.fn(),
          updateStravaLastSync,
          setStravaReauthRequired,
        },
        workouts: { getExistingStravaActivityIds, listDeviceRecordingsForDates },
      },
    }));
    vi.doMock('./advisoryLock', () => ({
      withPgAdvisoryLock: vi.fn(async (_pool, _opts, run) => ({ acquired: true, value: await run() })),
    }));
    vi.doMock('./services/stravaReconciler', () => ({ reconcileStravaActivities }));
    // The producer pulls in pg-boss; the engine never enqueues anything itself.
    vi.doMock('./services/stravaSyncQueue', () => ({
      enqueueStravaSync: vi.fn(),
      getStravaAutoSyncIntervalMs: () => 3_600_000,
      isStravaAutoSyncEnabled: () => true,
    }));
    vi.doMock('./stravaWebhook', () => ({ getStravaWebhookState: vi.fn().mockResolvedValue(null) }));
    enqueueSessionStreams = vi.fn().mockResolvedValue({ enqueued: true, jobId: 'job-1' });
    vi.doMock('./services/sessionStreamQueue', () => ({ enqueueSessionStreams }));

    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    ({ syncStravaForUser } = await import('./strava'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock('./env');
    vi.doUnmock('./storage');
    vi.doUnmock('./advisoryLock');
    vi.doUnmock('./services/stravaReconciler');
    vi.doUnmock('./services/stravaSyncQueue');
    vi.doUnmock('./stravaWebhook');
    vi.doUnmock('./services/sessionStreamQueue');
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('fetches from the overlap cursor, dedups, enriches from the detail, reconciles and advances the cursor', async () => {
    fetchMock
      // The activities page (short → single page).
      .mockResolvedValueOnce(stravaResponse([activity(1), activity(2)]))
      // Detail for the one new activity: calories and the athlete's rating.
      .mockResolvedValueOnce(stravaResponse({ id: 2, calories: 321.4, perceived_exertion: 8 }));
    getExistingStravaActivityIds.mockResolvedValue(['1']);
    reconcileStravaActivities.mockResolvedValue({ ...zeroCounts, enriched: 1 });

    const outcome = await syncStravaForUser('user-1', log);

    expect(outcome).toEqual({
      ok: true,
      imported: 1,
      enriched: 1,
      completedPlanDays: 0,
      suggested: 0,
      standalone: 0,
      skipped: 1,
      total: 2,
      hasMore: false,
    });

    const listUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(listUrl.searchParams.get('after')).toBe(
      String(Math.floor((connection.lastSyncedAt.getTime() - 7 * MS_PER_DAY) / 1000)),
    );
    expect(String(fetchMock.mock.calls[1][0])).toContain('/api/v3/activities/2');

    expect(getExistingStravaActivityIds).toHaveBeenCalledWith('user-1', ['1', '2']);
    const [userId, items] = reconcileStravaActivities.mock.calls[0];
    expect(userId).toBe('user-1');
    expect(items).toHaveLength(1);
    expect(items[0].activity.id).toBe(2);
    expect(items[0].row.stravaActivityId).toBe('2');
    expect(items[0].row.calories).toBe(321);
    expect(items[0].row.rpe).toBe(8);
    // A complete sync moves the cursor to "now" (no explicit cursor argument).
    expect(updateStravaLastSync).toHaveBeenCalledWith('user-1');
    expect(log.info).toHaveBeenCalledWith(expect.objectContaining({ imported: 1 }), 'strava.sync.ok');
    // A recording now sits on a log, so its stream is queued for grading.
    expect(enqueueSessionStreams).toHaveBeenCalledWith('user-1', 'sync');
  });

  it('skips an activity the Garmin sync already imported, before spending a detail fetch on it', async () => {
    // D16 (CODEBASE_ANALYSIS_2026-10-03): a Garmin watch auto-uploads to
    // Strava, so with both connected the same run arrives from both syncs.
    const run = activity(7);
    const evening = activity(9);
    fetchMock
      .mockResolvedValueOnce(stravaResponse([run, evening]))
      .mockResolvedValueOnce(stravaResponse({ id: 9 }));
    listDeviceRecordingsForDates.mockResolvedValue([
      {
        startedAt: new Date(new Date(run.start_date).getTime() + 30_000),
        duration: 25,
        focus: 'running',
        deviceActivity: null,
      },
    ]);
    reconcileStravaActivities.mockResolvedValue({ ...zeroCounts, standalone: 1 });

    const outcome = await syncStravaForUser('user-1', log);

    expect(outcome).toMatchObject({ ok: true, imported: 1, skipped: 1, total: 2 });
    expect(listDeviceRecordingsForDates).toHaveBeenCalledWith(
      'user-1',
      [...new Set([run, evening].map((a) => a.start_date_local.split('T')[0]))],
      'garmin',
    );
    const [, items] = reconcileStravaActivities.mock.calls[0];
    expect(items.map((item: { activity: { id: number } }) => item.activity.id)).toEqual([9]);
    // One list page and one detail read: none for the duplicate.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain('/api/v3/activities/9');
  });

  it('queues no stream fetch when nothing was linked to a log or plan day', async () => {
    fetchMock
      .mockResolvedValueOnce(stravaResponse([activity(5)]))
      .mockResolvedValueOnce(stravaResponse({ id: 5 }));
    reconcileStravaActivities.mockResolvedValue({ ...zeroCounts, standalone: 1 });

    await syncStravaForUser('user-1', log);

    expect(enqueueSessionStreams).not.toHaveBeenCalled();
  });

  it('advances the cursor only through the fetched window when the page cap is hit', async () => {
    const fullPage = Array.from({ length: 200 }, (_, i) => activity(i + 1));
    fetchMock.mockImplementation(async () => stravaResponse(fullPage));
    getExistingStravaActivityIds.mockImplementation(async (_userId: string, ids: string[]) => ids);

    const outcome = await syncStravaForUser('user-1', log);

    expect(outcome).toMatchObject({ ok: true, hasMore: true, total: 1000, imported: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(updateStravaLastSync).toHaveBeenCalledWith('user-1', new Date(activity(200).start_date));
  });

  it('reports the token failure without touching Strava when nothing is connected', async () => {
    getStravaConnection.mockResolvedValue(undefined);

    await expect(syncStravaForUser('user-1', log)).resolves.toEqual({
      ok: false,
      reason: 'not_connected',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces a 429 after retries as rate_limited with the Retry-After hint', async () => {
    fetchMock.mockResolvedValue(stravaResponse(null, 429, '120'));

    await expect(syncStravaForUser('user-1', log)).resolves.toEqual({
      ok: false,
      reason: 'rate_limited',
      retryAfterSeconds: 120,
    });
    expect(updateStravaLastSync).not.toHaveBeenCalled();
    expect(setStravaReauthRequired).not.toHaveBeenCalled();
  });

  it('tombstones the connection and reports reauth_required when Strava revoked access', async () => {
    fetchMock.mockResolvedValue(stravaResponse(null, 401));

    await expect(syncStravaForUser('user-1', log)).resolves.toEqual({
      ok: false,
      reason: 'reauth_required',
    });
    expect(setStravaReauthRequired).toHaveBeenCalledWith('user-1');
    expect(updateStravaLastSync).not.toHaveBeenCalled();
  });

  it('reports an upstream outage as transient and leaves the cursor alone', async () => {
    fetchMock.mockResolvedValue(stravaResponse(null, 503));

    await expect(syncStravaForUser('user-1', log)).resolves.toEqual({
      ok: false,
      reason: 'transient',
    });
    expect(updateStravaLastSync).not.toHaveBeenCalled();
  });

  it('lets a reconciler failure propagate instead of advancing the cursor past it', async () => {
    fetchMock.mockResolvedValueOnce(stravaResponse([activity(3)]));
    // No detail: the enrichment fetch fails softly.
    fetchMock.mockResolvedValueOnce(stravaResponse(null, 404));
    reconcileStravaActivities.mockRejectedValue(new Error('db down'));

    await expect(syncStravaForUser('user-1', log)).rejects.toThrow('db down');
    expect(updateStravaLastSync).not.toHaveBeenCalled();
  });
});

describe('Strava OAuth routes: the callback only completes in the browser that called /auth (S3)', () => {
  const DEV_COOKIE = 'fitai.strava-oauth';
  const PROD_COOKIE = '__Host-fitai.strava-oauth';
  const MOCKED_MODULES = [
    './env',
    '@clerk/express',
    './clerkAuth',
    './routeGuards',
    './routeUtils',
    './sharedRuntimeState',
    './storage',
    './services/stravaSyncQueue',
    './stravaWebhook',
    './services/sessionStreamQueue',
  ];

  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  let upsertStravaConnection: ReturnType<typeof vi.fn>;
  let enqueueStravaSync: ReturnType<typeof vi.fn>;
  let claimRuntimeCacheKey: ReturnType<typeof vi.fn>;
  let fetchMock: ReturnType<typeof vi.fn>;

  /**
   * Mounts the real Strava routes with only the I/O mocked. A request is
   * signed in as the user named in `x-test-user`; without that header the
   * dev auth bypass (never on in production) resolves the dev user, which is
   * the path local dev and Cypress take.
   */
  async function buildApp(nodeEnv = 'test') {
    vi.resetModules();
    vi.doMock('./env', () => ({
      env: {
        NODE_ENV: nodeEnv,
        ALLOW_DEV_AUTH_BYPASS: 'true',
        STRAVA_CLIENT_ID: 'client-id',
        STRAVA_CLIENT_SECRET: 'client-secret',
        STRAVA_STATE_SECRET: 'dedicated-strava-secret-12345678', // gitleaks:allow — fake test-only value, not a credential
        DATABASE_URL: 'postgres://dummy',
        APP_URL: 'https://app.example.com',
      },
    }));
    vi.doMock('@clerk/express', () => ({
      getAuth: (req: Request) => ({ userId: req.get('x-test-user') ?? null }),
    }));
    vi.doMock('./clerkAuth', () => ({
      DEV_USER_ID: 'dev-user',
      isAuthenticated: (_req: Request, _res: Response, next: NextFunction) => next(),
    }));
    vi.doMock('./routeGuards', () => ({ protectedMutationGuards: [] }));
    // The real limiter needs the shared Postgres store.
    vi.doMock('./routeUtils', () => ({
      rateLimiter: () => (_req: Request, _res: Response, next: NextFunction) => next(),
      asyncHandler:
        (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
        (req: Request, res: Response, next: NextFunction) => {
          fn(req, res, next).catch(next);
        },
    }));
    vi.doMock('./sharedRuntimeState', () => ({
      claimRuntimeCacheKey,
      runtimeCacheKey: (namespace: string, key: string) => `${namespace}:${key}`,
    }));
    vi.doMock('./storage', () => ({ storage: { users: { upsertStravaConnection } } }));
    vi.doMock('./services/stravaSyncQueue', () => ({
      enqueueStravaSync,
      getStravaAutoSyncIntervalMs: () => 3_600_000,
      isStravaAutoSyncEnabled: () => true,
    }));
    vi.doMock('./stravaWebhook', () => ({ getStravaWebhookState: vi.fn().mockResolvedValue(null) }));
    vi.doMock('./services/sessionStreamQueue', () => ({ enqueueSessionStreams: vi.fn() }));

    const { registerStravaRoutes } = await import('./strava');
    const app = express();
    app.use(cookieParser());
    // reqLogger(req) prefers req.log, so the handler's log lines land here.
    app.use((req, _res, next) => {
      Object.assign(req, { log });
      next();
    });
    registerStravaRoutes(app);
    return app;
  }

  function setCookies(res: request.Response): string[] {
    const header: unknown = res.headers['set-cookie'];
    return Array.isArray(header) ? header.map(String) : [];
  }

  function findSetCookie(res: request.Response, name: string): string {
    return setCookies(res).find((cookie) => cookie.startsWith(`${name}=`)) ?? '';
  }

  /** The binding cookie /auth set, as the browser would send it back. */
  function cookiePair(res: request.Response): string {
    const pair = findSetCookie(res, DEV_COOKIE).split(';')[0];
    expect(pair).toMatch(new RegExp(`^${DEV_COOKIE}=.+`));
    return pair;
  }

  function stateOf(res: request.Response): string {
    expect(res.status).toBe(200);
    return new URL(res.body.authUrl).searchParams.get('state') ?? '';
  }

  function callbackUrl(state: string): string {
    return `/api/v1/strava/callback?code=strava-code&state=${encodeURIComponent(state)}`;
  }

  function expectBindingCookieCleared(res: request.Response) {
    expect(findSetCookie(res, DEV_COOKIE)).toMatch(new RegExp(`^${DEV_COOKIE}=;.*Expires=Thu, 01 Jan 1970`));
  }

  function expectNothingLinked() {
    expect(claimRuntimeCacheKey).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(upsertStravaConnection).not.toHaveBeenCalled();
    expect(enqueueStravaSync).not.toHaveBeenCalled();
  }

  beforeEach(() => {
    upsertStravaConnection = vi.fn().mockResolvedValue(undefined);
    enqueueStravaSync = vi.fn().mockResolvedValue(undefined);
    claimRuntimeCacheKey = vi.fn().mockResolvedValue(true);
    fetchMock = vi.fn().mockResolvedValue(stravaResponse({
      token_type: 'Bearer',
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      expires_at: Math.floor(Date.now() / 1000) + 21_600,
      expires_in: 21_600,
      athlete: { id: 4242, username: 'athlete', firstname: 'Ath', lastname: 'Lete' },
    }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const path of MOCKED_MODULES) vi.doUnmock(path);
    vi.clearAllMocks();
  });

  it('sets an HttpOnly, SameSite=Lax cookie holding a hash of the state and forces the consent screen', async () => {
    const app = await buildApp();

    const res = await request(app).get('/api/v1/strava/auth');

    const state = stateOf(res);
    // No session header: the dev auth bypass minted the state for the dev user.
    expect(state.split(':')[0]).toBe('dev-user');
    expect(new URL(res.body.authUrl).searchParams.get('approval_prompt')).toBe('force');

    const [pair, ...attributes] = findSetCookie(res, DEV_COOKIE).split(/;\s*/);
    // A hash, so the cookie does not carry the user id the state names.
    expect(pair).toBe(`${DEV_COOKIE}=${crypto.createHash('sha256').update(state).digest('base64url')}`);
    expect(attributes).toEqual(expect.arrayContaining(['Max-Age=600', 'Path=/', 'HttpOnly', 'SameSite=Lax']));
    // Local dev runs over plain http.
    expect(attributes).not.toContain('Secure');
  });

  it('uses a Secure __Host- cookie in production', async () => {
    const app = await buildApp('production');

    const res = await request(app).get('/api/v1/strava/auth').set('x-test-user', 'user-1');

    expect(stateOf(res).split(':')[0]).toBe('user-1');
    const attributes = findSetCookie(res, PROD_COOKIE).split(/;\s*/).slice(1);
    expect(attributes).toEqual(
      expect.arrayContaining(['Max-Age=600', 'Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax']),
    );
  });

  it('refuses a callback that arrives without the binding cookie and links nothing', async () => {
    const app = await buildApp();
    const state = stateOf(await request(app).get('/api/v1/strava/auth').set('x-test-user', 'user-1'));

    const res = await request(app).get(callbackUrl(state));

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/settings?strava=error');
    expectNothingLinked();
    expect(log.error).toHaveBeenCalledWith(
      { hasBindingCookie: false },
      expect.stringContaining('possible CSRF attack'),
    );
  });

  it("refuses an authorize URL minted by another account when the victim's browser completes it", async () => {
    const app = await buildApp();
    // The attacker mints a state for their own account and sends the
    // authorize URL to the victim…
    const attackerState = stateOf(await request(app).get('/api/v1/strava/auth').set('x-test-user', 'attacker'));
    // …whose browser only holds a binding cookie for a flow it started itself.
    const victimCookie = cookiePair(await request(app).get('/api/v1/strava/auth').set('x-test-user', 'victim'));

    const res = await request(app).get(callbackUrl(attackerState)).set('Cookie', victimCookie);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/settings?strava=error');
    expectNothingLinked();
    expect(log.error).toHaveBeenCalledWith(
      { hasBindingCookie: true },
      expect.stringContaining('possible CSRF attack'),
    );
    expectBindingCookieCleared(res);
  });

  it('links the account when the browser that called /auth completes the flow, then clears the cookie', async () => {
    const app = await buildApp();
    const browser = request.agent(app);
    const state = stateOf(await browser.get('/api/v1/strava/auth'));

    const res = await browser.get(callbackUrl(state));

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/settings?strava=connected');
    expect(claimRuntimeCacheKey).toHaveBeenCalledTimes(1);
    expect(upsertStravaConnection).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'dev-user', stravaAthleteId: '4242', accessToken: 'new-access' }),
    );
    expect(enqueueStravaSync).toHaveBeenCalledWith('dev-user', 'connect');
    expectBindingCookieCleared(res);

    // The cookie is gone, so the same callback URL cannot complete again.
    const replay = await browser.get(callbackUrl(state));
    expect(replay.headers.location).toBe('/settings?strava=error');
    expect(upsertStravaConnection).toHaveBeenCalledTimes(1);
  });

  it('clears the cookie when the athlete cancels on Strava', async () => {
    const app = await buildApp();
    const browser = request.agent(app);
    const state = stateOf(await browser.get('/api/v1/strava/auth'));

    const res = await browser.get(`/api/v1/strava/callback?error=access_denied&state=${encodeURIComponent(state)}`);

    expect(res.headers.location).toBe('/settings?strava=error');
    expectBindingCookieCleared(res);
    expectNothingLinked();
  });

  describe('after the binding check passes', () => {
    /** Runs /auth then the callback in one browser, as a real connect does. */
    async function completeFlow() {
      const browser = request.agent(await buildApp());
      const state = stateOf(await browser.get('/api/v1/strava/auth'));
      return browser.get(callbackUrl(state));
    }

    it('refuses a state that was already claimed (replay) before exchanging the code', async () => {
      claimRuntimeCacheKey.mockResolvedValue(false);

      const res = await completeFlow();

      expect(res.headers.location).toBe('/settings?strava=error');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(upsertStravaConnection).not.toHaveBeenCalled();
    });

    it('stores nothing when the token exchange fails', async () => {
      fetchMock.mockResolvedValue(stravaResponse({ message: 'Bad Request' }, 400));

      const res = await completeFlow();

      expect(res.headers.location).toBe('/settings?strava=error');
      expect(upsertStravaConnection).not.toHaveBeenCalled();
      expect(enqueueStravaSync).not.toHaveBeenCalled();
    });

    it('stores nothing when the token response has no athlete', async () => {
      fetchMock.mockResolvedValue(stravaResponse({
        token_type: 'Bearer',
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_at: 1,
        expires_in: 0,
      }));

      const res = await completeFlow();

      expect(res.headers.location).toBe('/settings?strava=error');
      expect(upsertStravaConnection).not.toHaveBeenCalled();
    });

    it('still reports success when the post-connect sync cannot be enqueued', async () => {
      enqueueStravaSync.mockRejectedValue(new Error('queue down'));

      const res = await completeFlow();

      expect(res.headers.location).toBe('/settings?strava=connected');
      expect(upsertStravaConnection).toHaveBeenCalledTimes(1);
    });
  });
});
