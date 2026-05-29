import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";

import { buildCspPolicy, cspHeaderMiddleware } from "./csp";

describe("buildCspPolicy", () => {
  describe("production", () => {
    const policy = buildCspPolicy({ isDev: false, nonce: "abc123" });

    it("locks down the baseline directives", () => {
      expect(policy).toContain("default-src 'self'");
      expect(policy).toContain("frame-ancestors 'none'");
      expect(policy).toContain("worker-src 'self' blob:");
    });

    it("uses a per-request nonce for scripts, not unsafe-inline/eval", () => {
      expect(policy).toContain("script-src 'self' 'nonce-abc123'");
      expect(policy).not.toContain("'unsafe-eval'");
      // The only inline allowance in prod is style-src (Tailwind), never scripts.
      expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    });

    it("allows the Clerk, Strava, and Sentry origins on connect-src", () => {
      const connectSrc = policy.split("; ").find((d) => d.startsWith("connect-src"))!;
      expect(connectSrc).toContain("https://*.clerk.accounts.dev");
      expect(connectSrc).toContain("https://www.strava.com");
      expect(connectSrc).toContain("https://*.ingest.us.sentry.io");
    });

    it("does not permit websocket origins in production", () => {
      const connectSrc = policy.split("; ").find((d) => d.startsWith("connect-src"))!;
      expect(connectSrc).not.toContain("ws:");
      expect(connectSrc).not.toContain("wss:");
    });
  });

  describe("development", () => {
    const policy = buildCspPolicy({ isDev: true });

    it("relaxes script-src for Vite HMR and adds websocket origins", () => {
      expect(policy).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
      const connectSrc = policy.split("; ").find((d) => d.startsWith("connect-src"))!;
      expect(connectSrc).toContain("ws:");
      expect(connectSrc).toContain("wss:");
    });

    it("does not emit a nonce when none is supplied", () => {
      expect(policy).not.toContain("nonce-");
    });
  });
});

describe("cspHeaderMiddleware", () => {
  it("sets the Content-Security-Policy header from the nonce in res.locals and calls next", () => {
    const setHeader = vi.fn();
    const next = vi.fn();
    const res = { setHeader, locals: { cspNonce: "xyz789" } } as unknown as Response;

    cspHeaderMiddleware(false)({} as Request, res, next);

    expect(setHeader).toHaveBeenCalledTimes(1);
    const [headerName, headerValue] = setHeader.mock.calls[0];
    expect(headerName).toBe("Content-Security-Policy");
    expect(headerValue).toContain("'nonce-xyz789'");
    expect(next).toHaveBeenCalledOnce();
  });
});
