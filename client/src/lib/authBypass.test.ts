import { afterEach, describe, expect, it, vi } from "vitest";

import { isCypressTest, isDevPreview, shouldBypassAuth } from "./authBypass";

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
});
