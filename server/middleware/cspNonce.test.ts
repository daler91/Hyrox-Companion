import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";

import { cspNonceMiddleware } from "./cspNonce";

describe("cspNonceMiddleware (S8)", () => {
  it("sets a base64url nonce with no +, / or = and calls next", () => {
    const res = { locals: {} } as unknown as Response;
    const next = vi.fn();

    cspNonceMiddleware({} as Request, res, next);

    const nonce = res.locals.cspNonce;
    expect(typeof nonce).toBe("string");
    expect(nonce.length).toBeGreaterThan(0);
    // base64url alphabet only — the chars that could break out of an HTML
    // attribute (or need re-encoding) must never appear.
    expect(nonce).not.toMatch(/[+/=]/);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
