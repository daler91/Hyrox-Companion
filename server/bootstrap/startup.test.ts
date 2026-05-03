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

  it("registers process error handlers and sets startup error", () => {
    let uncaught: ((e: Error) => void) | undefined;
    let unhandled: ((e: unknown) => void) | undefined;
    let startupError = "";
    registerProcessErrorHandlers({
      onUncaught: (cb) => { uncaught = cb; },
      onUnhandled: (cb) => { unhandled = cb; },
      setStartupError: (v) => { startupError = v; },
      captureException: vi.fn(),
    });
    uncaught?.(new Error("boom"));
    expect(startupError).toContain("uncaught_exception");
    unhandled?.("bad");
    expect(startupError).toContain("unhandled_rejection");
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
