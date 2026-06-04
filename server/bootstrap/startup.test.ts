import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { registerHealthEndpoint } from "./health";
import { registerShutdownHandlers } from "./lifecycle";
import { registerProcessErrorHandlers } from "./observability";

describe("bootstrap startup parity", () => {
  it("registers health and reports readiness + degraded", async () => {
    const app = express();
    const state = { isReady: true, startupError: null, startupPhase: "ready", startupBeganAt: Date.now() - 1000 };
    registerHealthEndpoint(app, { state, probeDatabase: async () => true, probeVectorDatabase: async () => false });
    const res = await request(app).get("/api/v1/health");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("degraded");
  });

  it("liveness probe stays 200 on a runtime DB blip but 503 on startup failure (W7)", async () => {
    // Healthy process, DB probe failing → readiness is degraded, yet liveness
    // must stay 200 so a transient DB blip can't churn restarts.
    const app = express();
    const live = { isReady: true, startupError: null, startupPhase: "ready", startupBeganAt: Date.now() - 1000 };
    registerHealthEndpoint(app, { state: live, probeDatabase: async () => false, probeVectorDatabase: async () => false });
    const liveRes = await request(app).get("/api/v1/health/live");
    expect(liveRes.status).toBe(200);
    expect(liveRes.body.status).toBe("alive");

    // Definitive startup failure → liveness 503 so the platform restarts boot.
    const failedApp = express();
    const failed = { isReady: false, startupError: "db_maintenance failed", startupPhase: "db_maintenance", startupBeganAt: Date.now() };
    registerHealthEndpoint(failedApp, { state: failed, probeDatabase: async () => true, probeVectorDatabase: async () => true });
    const failedRes = await request(failedApp).get("/api/v1/health/live");
    expect(failedRes.status).toBe(503);
    expect(failedRes.body.status).toBe("startup_failed");
  });

  it("registers process error handlers, sets startup error, and exits after flushing (C2)", async () => {
    let uncaught: ((e: Error) => void) | undefined;
    let unhandled: ((e: unknown) => void) | undefined;
    let startupError = "";
    const exit = vi.fn();
    const flush = vi.fn<(timeoutMs?: number) => Promise<boolean>>().mockResolvedValue(true);
    registerProcessErrorHandlers({
      onUncaught: (cb) => { uncaught = cb; },
      onUnhandled: (cb) => { unhandled = cb; },
      setStartupError: (v) => { startupError = v; },
      captureException: vi.fn(),
      flush,
      exit,
    });

    uncaught?.(new Error("boom"));
    expect(startupError).toContain("uncaught_exception");

    unhandled?.("bad");
    expect(startupError).toContain("unhandled_rejection");

    // A fatal must flush Sentry and then cycle the process (exit non-zero) so
    // the platform restart policy fires instead of leaving it wedged.
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(flush).toHaveBeenCalled();
  });

  it("runs shutdown hooks in order", async () => {
    const calls: string[] = [];
    const server = { close: (cb: (err?: Error) => void) => { calls.push("close"); cb(); } } as any;
    const shutdown = registerShutdownHandlers(server, {
      stopCron: () => calls.push("stopCron"),
      drainSseStreams: async () => { calls.push("drainSseStreams"); return 0; },
      stopQueue: async () => { calls.push("stopQueue"); },
      drainPools: async () => { calls.push("drainPools"); },
      flushSentry: async () => { calls.push("flushSentry"); },
      exit: () => calls.push("exit"),
    });
    shutdown();
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual(["stopCron", "drainSseStreams", "close", "stopQueue", "drainPools", "flushSentry", "exit"]);
  });
});
