import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getAuthSpy = vi.fn();

vi.mock("@clerk/express", () => ({
  getAuth: (req: unknown) => getAuthSpy(req),
  // clerkMiddleware/clerkClient aren't reached by the unit under test but
  // the module still needs to export them so other imports don't break.
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  clerkClient: { users: { getUser: vi.fn() } },
}));

import { computeSseDeadline } from "../ai";

describe("computeSseDeadline", () => {
  beforeEach(() => {
    getAuthSpy.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const HARD_CAP_MS = 5 * 60 * 1000;

  it("gives every stream the 5-minute hard cap", () => {
    expect(computeSseDeadline()).toBe(Date.now() + HARD_CAP_MS);
    expect(computeSseDeadline(1_000)).toBe(1_000 + HARD_CAP_MS);
  });

  it("never reads the session token, whose 60 s expiry used to cut replies off (AI1)", () => {
    // Clerk's __session JWT lives 60 s and is refreshed in the background, so
    // a browser request always carried 10-60 s of it. Its `exp` once set the
    // deadline (exp - 5 s), stopping replies 5-55 s in. Authentication is
    // checked when the request arrives; the stream runs to the hard cap.
    getAuthSpy.mockReturnValue({ sessionClaims: { exp: Math.floor((Date.now() + 20_000) / 1000) } });

    expect(computeSseDeadline()).toBe(Date.now() + HARD_CAP_MS);
    expect(getAuthSpy).not.toHaveBeenCalled();
  });
});
