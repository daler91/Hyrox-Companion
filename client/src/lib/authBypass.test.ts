import { afterEach, describe, expect, it, vi } from "vitest";

import { devAuthBypassHeaders, isCypressTest, isDevPreview, shouldBypassAuth } from "./authBypass";

type WithCypress = typeof globalThis & { Cypress?: unknown };

describe("authBypass", () => {
  afterEach(() => {
    delete (globalThis as WithCypress).Cypress;
    vi.unstubAllEnvs();
  });

  it("detects Cypress from the window global", () => {
    expect(isCypressTest()).toBe(false);
    (globalThis as WithCypress).Cypress = {};
    expect(isCypressTest()).toBe(true);
    expect(shouldBypassAuth()).toBe(true);
  });

  it("treats a dev build with no Clerk key as a dev preview", () => {
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", "");
    expect(isDevPreview()).toBe(true);
    expect(shouldBypassAuth()).toBe(true);
  });

  it("uses Clerk in a dev build that has a key and is not framed", () => {
    // Any non-empty value counts as configured; the predicate never parses it.
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", "configured");
    expect(isDevPreview()).toBe(false);
    expect(shouldBypassAuth()).toBe(false);
  });

  it("never bypasses outside a dev build without Cypress", () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", "");
    expect(isDevPreview()).toBe(false);
    expect(shouldBypassAuth()).toBe(false);
  });

  // Tech debt #34: a dev server with Clerk keys grants the dev-user fallback
  // only to requests that ask for it.
  it("asks for the dev-user fallback only while auth is bypassed", () => {
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", "");
    expect(devAuthBypassHeaders()).toEqual({ "x-dev-auth-bypass": "true" });

    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", "configured");
    expect(devAuthBypassHeaders()).toEqual({});
  });
});
