import type { Request as ExpressRequest } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getAuthSpy = vi.fn();

vi.mock("@clerk/express", () => ({
  getAuth: (req: ExpressRequest) => getAuthSpy(req),
  // clerkMiddleware/clerkClient aren't reached by the unit under test but
  // the module still needs to export them so other imports don't break.
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  clerkClient: { users: { getUser: vi.fn() } },
}));

import { computeSseDeadlineMs } from "../ai";

function makeReq(): ExpressRequest {
  return {} as ExpressRequest;
}

describe("computeSseDeadlineMs", () => {
  beforeEach(() => {
    getAuthSpy.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const HARD_CAP_MS = 5 * 60 * 1000;
  const MARGIN_MS = 5_000;
  const now = () => Date.now();

  it("returns the JWT expiry when it falls before the hard cap", () => {
    // Token has 60s of life → stream should stop at 60s - 5s margin = 55s.
    getAuthSpy.mockReturnValue({
      sessionClaims: { exp: Math.floor((now() + 60_000) / 1000) },
    });
    const deadline = computeSseDeadlineMs(makeReq());
    expect(deadline).toBeLessThan(now() + HARD_CAP_MS);
    expect(deadline).toBe(now() + 60_000 - MARGIN_MS);
  });

  it("returns the hard cap when the JWT expires later than the cap", () => {
    // Token has 1h of life, cap is 5min.
    getAuthSpy.mockReturnValue({
      sessionClaims: { exp: Math.floor((now() + 60 * 60_000) / 1000) },
    });
    const deadline = computeSseDeadlineMs(makeReq());
    expect(deadline).toBe(now() + HARD_CAP_MS);
  });

  it("clamps to now when the JWT is already past its margin", () => {
    // Codex P1: a token with only 2s left (inside the 5s margin) must
    // abort immediately rather than falling back to the 5-minute hard cap.
    getAuthSpy.mockReturnValue({
      sessionClaims: { exp: Math.floor((now() + 2_000) / 1000) },
    });
    const deadline = computeSseDeadlineMs(makeReq());
    expect(deadline).toBe(now());
  });

  it("clamps to now when the JWT already expired", () => {
    // Defence in depth: request admitted then token revoked before this
    // call runs. The deadline must fire immediately, not grant another
    // 5 minutes of streaming.
    getAuthSpy.mockReturnValue({
      sessionClaims: { exp: Math.floor((now() - 60_000) / 1000) },
    });
    const deadline = computeSseDeadlineMs(makeReq());
    expect(deadline).toBe(now());
  });

  it("falls back to the hard cap when sessionClaims is missing", () => {
    // Dev bypass and test harnesses don't populate sessionClaims —
    // the hard cap is the only defence and must still apply.
    getAuthSpy.mockReturnValue({ sessionClaims: null });
    const deadline = computeSseDeadlineMs(makeReq());
    expect(deadline).toBe(now() + HARD_CAP_MS);
  });

  it("falls back to the hard cap when getAuth throws", () => {
    getAuthSpy.mockImplementation(() => {
      throw new Error("clerk middleware not mounted");
    });
    const deadline = computeSseDeadlineMs(makeReq());
    expect(deadline).toBe(now() + HARD_CAP_MS);
  });
});
