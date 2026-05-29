import type { Request, Response } from "express";
import { describe, expect, it } from "vitest";

import { buildCspDirectives } from "./csp";

type ScriptSrcEntry = string | ((req: Request, res: Response) => string);

describe("buildCspDirectives", () => {
  describe("production", () => {
    const directives = buildCspDirectives({ isDev: false });
    const scriptSrc = directives.scriptSrc as ScriptSrcEntry[];
    const connectSrc = directives.connectSrc as string[];

    it("locks down the baseline directives", () => {
      expect(directives.defaultSrc).toEqual(["'self'"]);
      expect(directives.frameAncestors).toEqual(["'none'"]);
      expect(directives.workerSrc).toEqual(["'self'", "blob:"]);
    });

    it("uses a per-request nonce for scripts, not unsafe-inline/eval", () => {
      expect(scriptSrc).not.toContain("'unsafe-inline'");
      expect(scriptSrc).not.toContain("'unsafe-eval'");

      const nonceFns = scriptSrc.filter(
        (s): s is (req: Request, res: Response) => string => typeof s === "function",
      );
      expect(nonceFns).toHaveLength(1);
      const res = { locals: { cspNonce: "abc123" } } as unknown as Response;
      expect(nonceFns[0]({} as Request, res)).toBe("'nonce-abc123'");
    });

    it("allows Clerk/Strava/Sentry on connect-src, no websockets", () => {
      expect(connectSrc).toContain("https://*.clerk.accounts.dev");
      expect(connectSrc).toContain("https://www.strava.com");
      expect(connectSrc).toContain("https://*.ingest.us.sentry.io");
      expect(connectSrc).not.toContain("ws:");
      expect(connectSrc).not.toContain("wss:");
    });
  });

  describe("development", () => {
    const directives = buildCspDirectives({ isDev: true });
    const scriptSrc = directives.scriptSrc as ScriptSrcEntry[];
    const connectSrc = directives.connectSrc as string[];

    it("relaxes script-src for Vite HMR and adds websocket origins", () => {
      expect(scriptSrc).toContain("'unsafe-inline'");
      expect(scriptSrc).toContain("'unsafe-eval'");
      expect(scriptSrc.some((s) => typeof s === "function")).toBe(false);
      expect(connectSrc).toContain("ws:");
      expect(connectSrc).toContain("wss:");
    });
  });
});
