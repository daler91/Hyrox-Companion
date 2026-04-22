import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock modules before importing the middleware.
vi.mock("../storage", () => ({
  storage: {
    idempotency: {
      get: vi.fn(),
      set: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

vi.mock("../types", () => ({
  getUserId: vi.fn(() => "user-1"),
}));

import { storage } from "../storage";
import { idempotencyMiddleware } from "./idempotency";

type MockStorage = {
  idempotency: {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
  };
};

const mockStorage = storage as unknown as MockStorage;

function makeReq(method: string, headers: Record<string, string> = {}): Request {
  return {
    method,
    path: "/api/v1/workouts",
    header: (name: string) => headers[name.toLowerCase()],
    log: { error: vi.fn(), warn: vi.fn() },
  } as unknown as Request;
}

function makeRes() {
  const statusFn = vi.fn(function (this: Response, code: number) {
    (this as Response & { statusCode: number }).statusCode = code;
    return this;
  });
  const jsonFn = vi.fn(function (this: Response) {
    return this;
  });
  const res = {
    statusCode: 200,
    status: statusFn,
    json: jsonFn,
  } as unknown as Response;
  return res;
}

describe("idempotencyMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips GET requests entirely", async () => {
    const req = makeReq("GET", { "x-idempotency-key": "abc" });
    const res = makeRes();
    const next: NextFunction = vi.fn();

    await idempotencyMiddleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(mockStorage.idempotency.get).not.toHaveBeenCalled();
  });

  it("passes mutating requests through when no key is present", async () => {
    const req = makeReq("POST");
    const res = makeRes();
    const next: NextFunction = vi.fn();

    await idempotencyMiddleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(mockStorage.idempotency.get).not.toHaveBeenCalled();
  });

  it("rejects keys longer than MAX_KEY_LENGTH", async () => {
    const longKey = "x".repeat(256);
    const req = makeReq("POST", { "x-idempotency-key": longKey });
    const res = makeRes();
    const next: NextFunction = vi.fn();

    await idempotencyMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("replays a cached response when the key has been seen before", async () => {
    mockStorage.idempotency.get.mockResolvedValue({
      statusCode: 201,
      responseBody: { id: "w-1" },
    });

    const req = makeReq("POST", { "x-idempotency-key": "retry-key" });
    const res = makeRes();
    const next: NextFunction = vi.fn();

    await idempotencyMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ id: "w-1" });
  });

  it("persists the response body after the handler runs", async () => {
    mockStorage.idempotency.get.mockResolvedValue(undefined);

    const req = makeReq("POST", { "x-idempotency-key": "new-key" });
    const res = makeRes();
    (res as Response & { statusCode: number }).statusCode = 200;
    const next: NextFunction = vi.fn();

    await idempotencyMiddleware(req, res, next);
    expect(next).toHaveBeenCalledOnce();

    // Simulate the handler writing its response.
    res.json({ id: "w-2" });

    // res.json is called once to patch, once by the handler above.
    // The side effect (storing) happens inside the patched json.
    await new Promise((r) => setTimeout(r, 0));
    expect(mockStorage.idempotency.set).toHaveBeenCalledOnce();
    const [userId, key, record] = mockStorage.idempotency.set.mock.calls[0];
    expect(userId).toBe("user-1");
    expect(key).toBe("new-key");
    expect(record.responseBody).toEqual({ id: "w-2" });
    expect(record.statusCode).toBe(200);
  });

  it("skips persisting response bodies that exceed the cache size cap", async () => {
    mockStorage.idempotency.get.mockResolvedValue(undefined);

    const req = makeReq("POST", { "x-idempotency-key": "huge" });
    const res = makeRes();
    (res as Response & { statusCode: number }).statusCode = 200;
    const next: NextFunction = vi.fn();

    await idempotencyMiddleware(req, res, next);

    // 64 KiB cap — fill just over to trigger the skip.
    const hugeBody = { blob: "x".repeat(64 * 1024 + 1) };
    res.json(hugeBody);

    await new Promise((r) => setTimeout(r, 0));
    expect(mockStorage.idempotency.set).not.toHaveBeenCalled();
  });

  it("does not cache non-2xx responses", async () => {
    mockStorage.idempotency.get.mockResolvedValue(undefined);

    const req = makeReq("POST", { "x-idempotency-key": "will-fail" });
    const res = makeRes();
    (res as Response & { statusCode: number }).statusCode = 500;
    const next: NextFunction = vi.fn();

    await idempotencyMiddleware(req, res, next);
    res.json({ error: "boom" });

    await new Promise((r) => setTimeout(r, 0));
    expect(mockStorage.idempotency.set).not.toHaveBeenCalled();
  });

  it("falls through on a storage lookup failure", async () => {
    mockStorage.idempotency.get.mockRejectedValue(new Error("db down"));

    const req = makeReq("POST", { "x-idempotency-key": "oops" });
    const res = makeRes();
    const next: NextFunction = vi.fn();

    await idempotencyMiddleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });
});
