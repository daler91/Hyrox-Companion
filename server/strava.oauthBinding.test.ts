import crypto from 'node:crypto';

import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Delay-free manual mock (server/utils/__mocks__/httpRetry.ts): keeps the real
// RetryableHttpError class and retry semantics, drops the backoff sleeps.
vi.mock('./utils/httpRetry');

/** The request's cookies by name, as cookie-parser would give them. */
function parseCookieHeader(header: string | undefined): Record<string, string> {
  return Object.fromEntries(
    (header ?? '')
      .split(';')
      .filter((part) => part.indexOf('=') > 0)
      .map((part) => {
        const eq = part.indexOf('=');
        return [part.slice(0, eq).trim(), decodeURIComponent(part.slice(eq + 1).trim())];
      }),
  );
}

/** Minimal fetch Response stand-in for the fields the Strava client reads. */
function stravaResponse(body: unknown, status = 200, retryAfter: string | null = null) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: { get: () => retryAfter },
  };
}

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
      isAuthenticated: (_req: Request, _res: Response, next: NextFunction) => {
        next();
      },
    }));
    vi.doMock('./routeGuards', () => ({ protectedMutationGuards: [] }));
    // The real limiter needs the shared Postgres store.
    vi.doMock('./routeUtils', () => ({
      rateLimiter: () => (_req: Request, _res: Response, next: NextFunction) => {
        next();
      },
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
    // reqLogger(req) prefers req.log, so the handler's log lines land here.
    // req.cookies is read from the header directly. The real app mounts
    // cookie-parser globally (server/index.ts) with csrfProtection on /api/v1
    // (server/routes.ts); a bare cookie-parser in this test app, with no CSRF
    // middleware, reads to CodeQL as exactly the setup it warns about.
    app.use((req, _res, next) => {
      Object.assign(req, { log, cookies: parseCookieHeader(req.headers.cookie) });
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
    expect(pair.startsWith(`${DEV_COOKIE}=`)).toBe(true);
    expect(pair.length).toBeGreaterThan(DEV_COOKIE.length + 1);
    return pair;
  }

  /**
   * /auth in one browser: the state it minted and the cookie that browser
   * holds. The callback is then sent with that cookie by hand, because
   * supertest's cookie jar withholds a Secure cookie over plain http, which
   * Chromium and Firefox send on the local machine.
   */
  async function startConnect(app: express.Express): Promise<{ state: string; cookie: string }> {
    const res = await request(app).get('/api/v1/strava/auth');
    return { state: stateOf(res), cookie: cookiePair(res) };
  }

  /** The Strava consent URL /auth answered with. */
  function authUrlOf(res: request.Response): URL {
    return new URL((res.body as { authUrl: string }).authUrl);
  }

  function stateOf(res: request.Response): string {
    expect(res.status).toBe(200);
    return authUrlOf(res).searchParams.get('state') ?? '';
  }

  function callbackUrl(state: string): string {
    return `/api/v1/strava/callback?code=strava-code&state=${encodeURIComponent(state)}`;
  }

  function expectBindingCookieCleared(res: request.Response) {
    const cleared = findSetCookie(res, DEV_COOKIE);
    expect(cleared.startsWith(`${DEV_COOKIE}=;`)).toBe(true);
    expect(cleared).toContain('Expires=Thu, 01 Jan 1970');
    // Same path as the cookie /auth set, or the browser keeps that one.
    expect(cleared).toContain('Path=/');
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
    expect(authUrlOf(res).searchParams.get('approval_prompt')).toBe('force');

    const [pair, ...attributes] = findSetCookie(res, DEV_COOKIE).split(/;\s*/);
    // A hash, so the cookie does not carry the user id the state names.
    expect(pair).toBe(`${DEV_COOKIE}=${crypto.createHash('sha256').update(state).digest('base64url')}`);
    // Secure even in dev; Chromium and Firefox accept it over local http.
    expect(attributes).toEqual(
      expect.arrayContaining(['Max-Age=600', 'Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax']),
    );
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
    const { state, cookie } = await startConnect(app);

    const res = await request(app).get(callbackUrl(state)).set('Cookie', cookie);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/settings?strava=connected');
    expect(claimRuntimeCacheKey).toHaveBeenCalledTimes(1);
    expect(upsertStravaConnection).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'dev-user', stravaAthleteId: '4242', accessToken: 'new-access' }),
    );
    expect(enqueueStravaSync).toHaveBeenCalledWith('dev-user', 'connect');
    expectBindingCookieCleared(res);

    // The cookie is gone, so the same callback URL cannot complete again.
    const replay = await request(app).get(callbackUrl(state));
    expect(replay.headers.location).toBe('/settings?strava=error');
    expect(upsertStravaConnection).toHaveBeenCalledTimes(1);
  });

  it('clears the cookie when the athlete cancels on Strava', async () => {
    const app = await buildApp();
    const { state, cookie } = await startConnect(app);

    const res = await request(app)
      .get(`/api/v1/strava/callback?error=access_denied&state=${encodeURIComponent(state)}`)
      .set('Cookie', cookie);

    expect(res.headers.location).toBe('/settings?strava=error');
    expectBindingCookieCleared(res);
    expectNothingLinked();
  });

  describe('after the binding check passes', () => {
    /** Runs /auth then the callback in one browser, as a real connect does. */
    async function completeFlow() {
      const app = await buildApp();
      const { state, cookie } = await startConnect(app);
      return request(app).get(callbackUrl(state)).set('Cookie', cookie);
    }

    it('refuses a state that was already claimed (replay) before exchanging the code', async () => {
      claimRuntimeCacheKey.mockResolvedValue(false);

      const res = await completeFlow();

      expect(res.headers.location).toBe('/settings?strava=error');
      // The binding check passed: the state reached its single-use claim.
      expect(claimRuntimeCacheKey).toHaveBeenCalledTimes(1);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(upsertStravaConnection).not.toHaveBeenCalled();
    });

    it('stores nothing when the token exchange fails', async () => {
      fetchMock.mockResolvedValue(stravaResponse({ message: 'Bad Request' }, 400));

      const res = await completeFlow();

      expect(res.headers.location).toBe('/settings?strava=error');
      expect(fetchMock).toHaveBeenCalled();
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
      expect(fetchMock).toHaveBeenCalled();
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
