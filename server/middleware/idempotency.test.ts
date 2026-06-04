import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock modules before importing the middleware.
vi.mock("../storage", () => ({
  storage: {
    idempotency: {
      claim: vi.fn(),
      complete: vi.fn().mockResolvedValue(undefined),
      release: vi.fn().mockResolvedValue(undefined),
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
    claim: ReturnType<typeof vi.fn>;
    complete: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
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
  const listeners: Record<string, Array<() => void>> = {};
  const statusFn = vi.fn(function (this: Response, code: number) {
    (this as Response & { statusCode: number }).statusCode = code;
    return this;
  });
  const jsonFn = vi.fn(function (this: Response) {
    return this;
  });
  const onFn = vi.fn(function (this: Response, event: string, handler: () => void) {
    (listeners[event] ??= []).push(handler);
    return this;
  });
  const res = {
    statusCode: 200,
    status: statusFn,
    json: jsonFn,
    on: onFn,
  } as unknown as Response;
  // Fire registered "finish"/"close" listeners the way Express would once the
  // response is flushed, so tests can exercise the release backstop.
  const emit = (event: string) => {
    for (const handler of listeners[event] ?? []) handler();
  };
  return { res, emit };
}

// settle() runs its DB write as `void work().catch(...)`, so the storage call
// lands on a later microtask. Flush it before asserting.
const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0));

describe("idempotencyMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.idempotency.complete.mockResolvedValue(undefined);
    mockStorage.idempotency.release.mockResolvedValue(undefined);
  });

  it("skips GET requests entirely", async () => {
    const req = makeReq("GET", { "x-idempotency-key": "abc" });
    const { res } = makeRes();
    const next: NextFunction = vi.fn();

    await idempotencyMiddleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(mockStorage.idempotency.claim).not.toHaveBeenCalled();
  });

  it("passes mutating requests through when no key is present", async () => {
    const req = makeReq("POST");
    const { res } = makeRes();
    const next: NextFunction = vi.fn();

    await idempotencyMiddleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(mockStorage.idempotency.claim).not.toHaveBeenCalled();
  });

  it("rejects keys longer than MAX_KEY_LENGTH", async () => {
    const longKey = "x".repeat(256);
    const req = makeReq("POST", { "x-idempotency-key": longKey });
    const { res } = makeRes();
    const next: NextFunction = vi.fn();

    await idempotencyMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockStorage.idempotency.claim).not.toHaveBeenCalled();
  });

  it("replays the cached response when a prior request already completed", async () => {
    mockStorage.idempotency.claim.mockResolvedValue({
      outcome: "completed",
      statusCode: 201,
      responseBody: { id: "w-1" },
    });

    const req = makeReq("POST", { "x-idempotency-key": "retry-key" });
    const { res } = makeRes();
    const next: NextFunction = vi.fn();

    await idempotencyMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ id: "w-1" });
    expect(mockStorage.idempotency.complete).not.toHaveBeenCalled();
  });

  it("rejects a concurrent in-flight duplicate with 409", async () => {
    // The claim found a live in-progress row owned by a racing request — the
    // TOCTOU guard (W11). The handler must NOT run; the client retries and
    // hits the cached result once the first request completes.
    mockStorage.idempotency.claim.mockResolvedValue({ outcome: "in_progress" });

    const req = makeReq("POST", { "x-idempotency-key": "in-flight" });
    const { res } = makeRes();
    const next: NextFunction = vi.fn();

    await idempotencyMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "IDEMPOTENT_REQUEST_IN_PROGRESS" }),
    );
  });

  it("persists the response body after the handler runs on a fresh claim", async () => {
    mockStorage.idempotency.claim.mockResolvedValue({ outcome: "claimed" });

    const req = makeReq("POST", { "x-idempotency-key": "new-key" });
    const { res } = makeRes();
    (res as Response & { statusCode: number }).statusCode = 200;
    const next: NextFunction = vi.fn();

    await idempotencyMiddleware(req, res, next);
    expect(next).toHaveBeenCalledOnce();

    // Simulate the handler writing its response.
    res.json({ id: "w-2" });

    await flushMicrotasks();
    expect(mockStorage.idempotency.complete).toHaveBeenCalledOnce();
    const [userId, key, record] = mockStorage.idempotency.complete.mock.calls[0];
    expect(userId).toBe("user-1");
    expect(key).toBe("new-key");
    expect(record.responseBody).toEqual({ id: "w-2" });
    expect(record.statusCode).toBe(200);
    expect(mockStorage.idempotency.release).not.toHaveBeenCalled();
  });

  it("persists the record when the handler sends a non-stringifiable body", async () => {
    // Guards against the size cap throwing on JSON.stringify(undefined) →
    // Buffer.byteLength(undefined) rejections, which would otherwise turn a
    // successful 2xx into a crashed response path and leak the
    // idempotency key so retries re-execute the write (Codex review of #877).
    mockStorage.idempotency.claim.mockResolvedValue({ outcome: "claimed" });

    const req = makeReq("POST", { "x-idempotency-key": "empty" });
    const { res } = makeRes();
    (res as Response & { statusCode: number }).statusCode = 200;
    const next: NextFunction = vi.fn();

    await idempotencyMiddleware(req, res, next);

    expect(() => res.json(undefined)).not.toThrow();

    await flushMicrotasks();
    expect(mockStorage.idempotency.complete).toHaveBeenCalledOnce();
    const [, , record] = mockStorage.idempotency.complete.mock.calls[0];
    expect(record.statusCode).toBe(200);
    expect(record.responseBody).toBeUndefined();
  });

  it("persists a sentinel body when the response exceeds the cache size cap", async () => {
    // Even for oversized responses we still need to lock the idempotency
    // key so a retry doesn't re-execute the mutation. Only the full
    // payload is discarded — the key is always recorded (Codex P1).
    mockStorage.idempotency.claim.mockResolvedValue({ outcome: "claimed" });

    const req = makeReq("POST", { "x-idempotency-key": "huge" });
    const { res } = makeRes();
    (res as Response & { statusCode: number }).statusCode = 200;
    const next: NextFunction = vi.fn();

    await idempotencyMiddleware(req, res, next);

    const hugeBody = { blob: "x".repeat(64 * 1024 + 1) };
    res.json(hugeBody);

    await flushMicrotasks();
    expect(mockStorage.idempotency.complete).toHaveBeenCalledOnce();
    const [, , record] = mockStorage.idempotency.complete.mock.calls[0];
    expect(record.responseBody).toEqual({ idempotencyReplayed: true });
    expect(record.statusCode).toBe(200);
  });

  it("releases the claim instead of caching a non-2xx response", async () => {
    // A transient 5xx/404 must not pin the key — releasing the claim lets a
    // retry with the same key re-execute the handler (S10 semantics).
    mockStorage.idempotency.claim.mockResolvedValue({ outcome: "claimed" });

    const req = makeReq("POST", { "x-idempotency-key": "will-fail" });
    const { res } = makeRes();
    (res as Response & { statusCode: number }).statusCode = 500;
    const next: NextFunction = vi.fn();

    await idempotencyMiddleware(req, res, next);
    res.json({ error: "boom" });

    await flushMicrotasks();
    expect(mockStorage.idempotency.complete).not.toHaveBeenCalled();
    expect(mockStorage.idempotency.release).toHaveBeenCalledOnce();
    expect(mockStorage.idempotency.release).toHaveBeenCalledWith("user-1", "will-fail");
  });

  it("releases the claim when the response finishes without going through res.json", async () => {
    // Backstop: a handler that throws (error middleware sends via res.end), a
    // redirect, or a streamed response never hits the patched res.json. The
    // finish/close listener must release the claim so it doesn't pin retries.
    mockStorage.idempotency.claim.mockResolvedValue({ outcome: "claimed" });

    const req = makeReq("POST", { "x-idempotency-key": "streamed" });
    const { res, emit } = makeRes();
    const next: NextFunction = vi.fn();

    await idempotencyMiddleware(req, res, next);
    emit("finish");

    await flushMicrotasks();
    expect(mockStorage.idempotency.complete).not.toHaveBeenCalled();
    expect(mockStorage.idempotency.release).toHaveBeenCalledOnce();
    expect(mockStorage.idempotency.release).toHaveBeenCalledWith("user-1", "streamed");
  });

  it("does not double-finalize when res.json runs and finish fires afterward", async () => {
    // The `settled` guard makes the terminal action run exactly once: a 2xx
    // response completes the record, and the trailing finish event is a no-op.
    mockStorage.idempotency.claim.mockResolvedValue({ outcome: "claimed" });

    const req = makeReq("POST", { "x-idempotency-key": "settled-once" });
    const { res, emit } = makeRes();
    (res as Response & { statusCode: number }).statusCode = 201;
    const next: NextFunction = vi.fn();

    await idempotencyMiddleware(req, res, next);
    res.json({ id: "w-3" });
    emit("finish");

    await flushMicrotasks();
    expect(mockStorage.idempotency.complete).toHaveBeenCalledOnce();
    expect(mockStorage.idempotency.release).not.toHaveBeenCalled();
  });

  it("falls through to the handler when the claim itself fails", async () => {
    // A storage outage must not block writes — we run the handler without
    // idempotency rather than 500, matching the pre-claim lookup behaviour.
    mockStorage.idempotency.claim.mockRejectedValue(new Error("db down"));

    const req = makeReq("POST", { "x-idempotency-key": "oops" });
    const { res } = makeRes();
    const next: NextFunction = vi.fn();

    await idempotencyMiddleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(mockStorage.idempotency.complete).not.toHaveBeenCalled();
    expect(mockStorage.idempotency.release).not.toHaveBeenCalled();
  });
});
