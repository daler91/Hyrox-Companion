import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runWithOfflineFallback } from "./offlineMutationFallback";

const mocks = vi.hoisted(() => ({
  enqueueMutation: vi.fn(),
  createOfflineMutationId: vi.fn(),
}));

vi.mock("./offlineQueue", () => ({
  enqueueMutation: mocks.enqueueMutation,
  createOfflineMutationId: mocks.createOfflineMutationId,
}));

function setOnline(online: boolean) {
  Object.defineProperty(globalThis.navigator, "onLine", {
    value: online,
    configurable: true,
  });
}

describe("runWithOfflineFallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createOfflineMutationId.mockReturnValue("gen-id");
    setOnline(true);
  });

  afterEach(() => {
    setOnline(true);
  });

  it("performs the live call when online and returns saved", async () => {
    const perform = vi.fn().mockResolvedValue({ ok: true });

    const result = await runWithOfflineFallback({
      method: "POST",
      url: "/api/v1/x",
      body: { a: 1 },
      perform,
    });

    expect(perform).toHaveBeenCalledWith("gen-id");
    expect(result).toEqual({ status: "saved", data: { ok: true } });
    expect(mocks.enqueueMutation).not.toHaveBeenCalled();
  });

  it("skips the network and queues when offline", async () => {
    setOnline(false);
    const perform = vi.fn();

    const result = await runWithOfflineFallback({
      method: "POST",
      url: "/api/v1/x",
      body: { a: 1 },
      perform,
    });

    expect(perform).not.toHaveBeenCalled();
    expect(mocks.enqueueMutation).toHaveBeenCalledWith("POST", "/api/v1/x", { a: 1 }, { id: "gen-id" });
    expect(result).toEqual({ status: "queued", id: "gen-id" });
  });

  it("queues on a connectivity failure using the same idempotency key", async () => {
    const perform = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    const result = await runWithOfflineFallback({
      method: "PATCH",
      url: "/api/v1/y",
      body: { b: 2 },
      perform,
    });

    expect(perform).toHaveBeenCalledWith("gen-id");
    expect(mocks.enqueueMutation).toHaveBeenCalledWith("PATCH", "/api/v1/y", { b: 2 }, { id: "gen-id" });
    expect(result).toEqual({ status: "queued", id: "gen-id" });
  });

  it("rethrows application errors instead of queuing them", async () => {
    const perform = vi.fn().mockRejectedValue(new Error("500: Internal Server Error"));

    await expect(
      runWithOfflineFallback({ method: "POST", url: "/api/v1/z", body: {}, perform }),
    ).rejects.toThrow("500: Internal Server Error");
    expect(mocks.enqueueMutation).not.toHaveBeenCalled();
  });

  it("does not queue a failed CSRF token fetch", async () => {
    const perform = vi.fn().mockRejectedValue(new Error("Failed to fetch CSRF token: 500"));

    await expect(
      runWithOfflineFallback({ method: "POST", url: "/api/v1/z", body: {}, perform }),
    ).rejects.toThrow("Failed to fetch CSRF token");
    expect(mocks.enqueueMutation).not.toHaveBeenCalled();
  });
});
