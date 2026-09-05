import crypto from 'node:crypto';

import { afterEach,beforeEach, describe, expect, it, vi } from 'vitest';

// Delay-free manual mock (server/utils/__mocks__/httpRetry.ts): keeps the real
// RetryableHttpError class and retry semantics, drops the backoff sleeps.
vi.mock('./utils/httpRetry');

import { AppError } from './errors';
import {
  computeSyncAfterEpoch,
  createSignedState,
  deauthorizeStravaBestEffort,
  enrichCaloriesFromDetail,
  fetchStravaActivities,
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

describe('enrichCaloriesFromDetail', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const log = { warn: vi.fn() };

  function candidates(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      stravaActivityId: String(i + 1),
      calories: null as number | null,
    })) as unknown as Parameters<typeof enrichCaloriesFromDetail>[1];
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

    await enrichCaloriesFromDetail('token', workouts, log);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(workouts.map((w) => w.calories)).toEqual([480, 480, 480]);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('stops once the overall budget is spent, keeping the rows already enriched', async () => {
    // Each detail call limps along for 12s: the third finishes at 36s, past
    // the 30s budget, so the fourth and fifth are never attempted.
    fetchMock.mockImplementation(async () => {
      vi.setSystemTime(Date.now() + 12_000);
      return stravaResponse({ id: 1, calories: 500 });
    });
    const workouts = candidates(5);

    await enrichCaloriesFromDetail('token', workouts, log);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(workouts.map((w) => w.calories)).toEqual([500, 500, 500, null, null]);
    expect(log.warn).toHaveBeenCalledWith(
      { attempted: 3, of: 5 },
      expect.stringContaining('time budget'),
    );
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
