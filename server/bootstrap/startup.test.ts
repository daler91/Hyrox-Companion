import { readFileSync } from "node:fs";
import path from "node:path";

import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { __resetHealthCacheForTests, registerHealthEndpoint } from "./health";
import { registerShutdownHandlers, SHUTDOWN_TIMEOUT_MS } from "./lifecycle";
import { registerProcessErrorHandlers } from "./observability";

describe("bootstrap startup parity", () => {
  // The probe cache in health.ts is module-level with a 5s TTL, so a healthy
  // result cached by whichever test runs first would otherwise be served to
  // every later test regardless of its own probe stubs.
  beforeEach(() => {
    __resetHealthCacheForTests();
  });

  it("registers health and reports readiness + degraded", async () => {
    const app = express();
    const state = { isReady: true, startupError: null, startupPhase: "ready", startupBeganAt: Date.now() - 1000 };
    registerHealthEndpoint(app, { state, probeDatabase: async () => true, probeVectorDatabase: async () => false });
    const res = await request(app).get("/api/v1/health");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("degraded");
  });

  it("reports vector-schema state without gating traffic on it", async () => {
    // The DR hole this closes: probeVectorDatabase only runs `SELECT 1`, which
    // a reachable-but-empty vector DB answers happily. Before the readiness
    // payload carried vectorSchema, a restore that never built document_chunks
    // / food_embeddings reported a flat `status: "ok"` and the drill in
    // docs/operations/backup-restore.md §6 had nothing to check.
    const app = express();
    const state = { isReady: true, startupError: null, startupPhase: "ready", startupBeganAt: Date.now() - 1000 };
    registerHealthEndpoint(app, {
      state,
      probeDatabase: async () => true,
      probeVectorDatabase: async () => true,
      vectorSchemaStatus: () => "failed",
    });
    const res = await request(app).get("/api/v1/health");
    // Still 200: the vector DB is derived data, so losing it must not stop the
    // app serving workouts while an operator re-embeds.
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.vectorSchema).toBe("failed");

    // Unwired (the dep is optional) reads as "unknown", never a false "ok".
    __resetHealthCacheForTests();
    const bare = express();
    registerHealthEndpoint(bare, { state, probeDatabase: async () => true, probeVectorDatabase: async () => true });
    const bareRes = await request(bare).get("/api/v1/health");
    expect(bareRes.body.vectorSchema).toBe("unknown");
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

    // Definitive startup failure → liveness 503 too: boot failed for good.
    const failedApp = express();
    const failed = { isReady: false, startupError: "db_maintenance failed", startupPhase: "db_maintenance", startupBeganAt: Date.now() };
    registerHealthEndpoint(failedApp, { state: failed, probeDatabase: async () => true, probeVectorDatabase: async () => true });
    const failedRes = await request(failedApp).get("/api/v1/health/live");
    expect(failedRes.status).toBe(503);
    expect(failedRes.body.status).toBe("startup_failed");
  });

  it("never leaks the raw startup error message to unauthenticated callers", async () => {
    // Both endpoints are mounted before auth (platform probes hit them with
    // no credentials), so `startupError` — a raw Error.message that can
    // contain internal hostnames, ports, or DB usernames — must never appear
    // in the public JSON body. Only the fixed, non-sensitive phase name may.
    const rawMessage = "connect ECONNREFUSED 10.0.4.12:5432 password authentication failed for user \"app_admin\"";
    const state = { isReady: false, startupError: rawMessage, startupPhase: "db_maintenance", startupBeganAt: Date.now() };

    const liveApp = express();
    registerHealthEndpoint(liveApp, { state, probeDatabase: async () => true, probeVectorDatabase: async () => true });
    const liveRes = await request(liveApp).get("/api/v1/health/live");
    expect(liveRes.status).toBe(503);
    expect(JSON.stringify(liveRes.body)).not.toContain(rawMessage);
    expect(liveRes.body.message).toBeUndefined();

    const readyApp = express();
    registerHealthEndpoint(readyApp, { state, probeDatabase: async () => true, probeVectorDatabase: async () => true });
    const readyRes = await request(readyApp).get("/api/v1/health");
    expect(readyRes.status).toBe(503);
    expect(JSON.stringify(readyRes.body)).not.toContain(rawMessage);
    expect(readyRes.body.message).toBeUndefined();
    expect(readyRes.body.phase).toBe("db_maintenance");
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

/**
 * railway.toml and nixpacks.toml are what production actually runs, and no
 * other test reads them. Both are flat, so a line match stands in for a TOML
 * parser (none is in the dependency tree).
 */
describe("Railway deploy config", () => {
  const readRepoFile = (relative: string) => readFileSync(path.resolve(process.cwd(), relative), "utf8");
  const tomlValue = (file: string, key: string): string | undefined =>
    new RegExp(`^${key}\\s*=\\s*(.+)$`, "m").exec(readRepoFile(file))?.[1].trim();

  it("gates the deploy on readiness: the healthcheck path is non-2xx until every route is mounted (D2)", async () => {
    // Railway promotes a deployment, and retires the old one, on the first 2xx
    // from this path, and never polls it again after go-live. Pointed at the
    // liveness route it answered 200 as soon as the port bound — before the DB
    // was reached or any route existed — so a release whose boot then failed
    // replaced the healthy one.
    const healthcheckPath = JSON.parse(tomlValue("railway.toml", "healthcheckPath") ?? "null") as string;
    const probe = async (state: { isReady: boolean; startupError: string | null }) => {
      __resetHealthCacheForTests();
      const app = express();
      registerHealthEndpoint(app, {
        state: { ...state, startupPhase: "db_maintenance", startupBeganAt: Date.now() },
        probeDatabase: async () => true,
        probeVectorDatabase: async () => true,
      });
      return (await request(app).get(healthcheckPath)).status;
    };

    expect(await probe({ isReady: false, startupError: null })).toBe(503);
    expect(await probe({ isReady: false, startupError: "migration failed" })).toBe(503);
    expect(await probe({ isReady: true, startupError: null })).toBe(200);
  });

  it("gives the outgoing deployment its whole graceful-shutdown budget before SIGKILL (D3)", () => {
    // Railway's default is 0 s between SIGTERM and SIGKILL, which killed the
    // old instance before registerShutdownHandlers could drain anything.
    // Unquoted: Railway's config schema types it as a number.
    const drainingSeconds = tomlValue("railway.toml", "drainingSeconds");
    expect(drainingSeconds).toMatch(/^\d+$/);
    expect(Number(drainingSeconds) * 1000).toBeGreaterThan(SHUTDOWN_TIMEOUT_MS);
  });

  it("never runs dependency install scripts in the production build (S4)", () => {
    // The build environment carries every Railway service variable, and CI
    // installs with --ignore-scripts, so a malicious postinstall would first
    // execute here. nixpacks' default install phase runs scripts too, so it
    // must be overridden, not just the build command. npm counts as well: the
    // override keeps the default phase's global corepack install.
    const installs = ["railway.toml", "nixpacks.toml"].flatMap((file) =>
      readRepoFile(file)
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("#"))
        .flatMap((line) => [...line.matchAll(/\bp?npm (?:install|i)\b[^"&]*/g)].map((m) => `${file}: ${m[0].trim()}`)),
    );
    expect(installs.some((line) => line.startsWith("nixpacks.toml: pnpm"))).toBe(true);
    expect(installs.filter((line) => !line.includes("--ignore-scripts"))).toEqual([]);
  });
});
