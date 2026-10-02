import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TrainingContext } from "../gemini/types";
import { storage } from "../storage";
import { getUserId } from "../types";
import {
  clearTrainingContextCache,
  getCachedTrainingContext,
  invalidateTrainingContext,
  invalidateTrainingContextOnWrite,
} from "./trainingContextCache";

vi.mock("../storage", () => ({ storage: { users: { getUser: vi.fn() } } }));
vi.mock("../types", () => ({ getUserId: vi.fn(() => "user-1") }));

const CONTEXT = { totalWorkouts: 3 } as unknown as TrainingContext;

describe("getCachedTrainingContext", () => {
  beforeEach(() => {
    clearTrainingContextCache();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
    vi.mocked(storage.users).getUser.mockResolvedValue({ userTimezone: "UTC" } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds once for a conversation's turns, sharing a build already under way", async () => {
    const build = vi.fn(() => Promise.resolve(CONTEXT));

    const [first, second] = await Promise.all([
      getCachedTrainingContext("user-1", build),
      getCachedTrainingContext("user-1", build),
    ]);
    const third = await getCachedTrainingContext("user-1", build);

    expect(first).toBe(CONTEXT);
    expect(second).toBe(CONTEXT);
    expect(third).toBe(CONTEXT);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it("keeps each athlete's context apart", async () => {
    const build = vi.fn((userId: string) => Promise.resolve({ userId } as unknown as TrainingContext));

    await getCachedTrainingContext("user-1", build);
    const other = await getCachedTrainingContext("user-2", build);

    expect(other).toEqual({ userId: "user-2" });
    expect(build).toHaveBeenCalledTimes(2);
  });

  it("builds again after five minutes", async () => {
    const build = vi.fn(() => Promise.resolve(CONTEXT));
    await getCachedTrainingContext("user-1", build);

    vi.advanceTimersByTime(4 * 60 * 1000);
    await getCachedTrainingContext("user-1", build);
    expect(build).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60 * 1000);
    await getCachedTrainingContext("user-1", build);
    expect(build).toHaveBeenCalledTimes(2);
  });

  it("builds again at the athlete's midnight, since today is part of the context", async () => {
    vi.mocked(storage.users).getUser.mockResolvedValue({ userTimezone: "America/New_York" } as never);
    vi.setSystemTime(new Date("2026-10-02T03:58:00Z")); // 23:58 in New York
    const build = vi.fn(() => Promise.resolve(CONTEXT));
    await getCachedTrainingContext("user-1", build);

    vi.setSystemTime(new Date("2026-10-02T04:01:00Z")); // 00:01 the next day
    await getCachedTrainingContext("user-1", build);

    expect(build).toHaveBeenCalledTimes(2);
  });

  it("builds again once the athlete's data changes", async () => {
    const build = vi.fn(() => Promise.resolve(CONTEXT));
    await getCachedTrainingContext("user-1", build);

    invalidateTrainingContext("user-1");
    await getCachedTrainingContext("user-1", build);

    expect(build).toHaveBeenCalledTimes(2);
  });

  it("doesn't keep a failed build", async () => {
    const build = vi.fn().mockRejectedValueOnce(new Error("db down")).mockResolvedValue(CONTEXT);

    await expect(getCachedTrainingContext("user-1", build)).rejects.toThrow("db down");
    await expect(getCachedTrainingContext("user-1", build)).resolves.toBe(CONTEXT);
  });
});

describe("invalidateTrainingContextOnWrite", () => {
  const build = vi.fn(() => Promise.resolve(CONTEXT));

  function app(status = 200) {
    const server = express();
    server.use("/api/v1", invalidateTrainingContextOnWrite);
    server.all("/api/v1/*path", (_req, res) => {
      res.status(status).json({});
    });
    return server;
  }

  /** Cache a context, send `send`, and say whether the next read had to build again. */
  async function rebuiltAfter(send: (server: express.Express) => Promise<unknown>, status?: number) {
    await getCachedTrainingContext("user-1", build);
    build.mockClear();
    await send(app(status));
    await getCachedTrainingContext("user-1", build);
    return build.mock.calls.length > 0;
  }

  beforeEach(() => {
    clearTrainingContextCache();
    vi.mocked(storage.users).getUser.mockResolvedValue({ userTimezone: "UTC" } as never);
    vi.mocked(getUserId).mockReturnValue("user-1");
  });

  it("drops the context after a successful write", async () => {
    expect(await rebuiltAfter((server) => request(server).post("/api/v1/workouts").send({}))).toBe(true);
    expect(await rebuiltAfter((server) => request(server).patch("/api/v1/plans/p/days/d").send({}))).toBe(true);
  });

  it("keeps it for reads, chat turns and refused writes", async () => {
    expect(await rebuiltAfter((server) => request(server).get("/api/v1/timeline"))).toBe(false);
    expect(await rebuiltAfter((server) => request(server).post("/api/v1/chat/stream").send({}))).toBe(false);
    expect(await rebuiltAfter((server) => request(server).post("/api/v1/workouts").send({}), 422)).toBe(false);
  });

  it("leaves the cache alone when the request has no athlete", async () => {
    vi.mocked(getUserId).mockImplementation(() => {
      throw new Error("User not authenticated");
    });

    expect(await rebuiltAfter((server) => request(server).post("/api/v1/workouts").send({}))).toBe(false);
  });
});
