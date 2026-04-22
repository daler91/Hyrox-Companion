import { afterEach, describe, expect, it, vi } from "vitest";

import {
  __resetSseRegistryForTests,
  activeSseStreamCount,
  drainSseStreams,
  registerSseStream,
} from "./sseRegistry";

describe("sseRegistry", () => {
  afterEach(() => {
    __resetSseRegistryForTests();
  });

  it("registers and unregisters controllers", () => {
    const controller = new AbortController();
    const unregister = registerSseStream(controller);
    expect(activeSseStreamCount()).toBe(1);
    unregister();
    expect(activeSseStreamCount()).toBe(0);
  });

  it("drainSseStreams returns 0 when nothing is active", async () => {
    const remaining = await drainSseStreams(50);
    expect(remaining).toBe(0);
  });

  it("drainSseStreams aborts every controller and resolves when registry empties", async () => {
    const controllers = Array.from({ length: 3 }, () => new AbortController());
    const unregisters = controllers.map((c) => registerSseStream(c));

    // Simulate handlers reacting to the abort signal by clearing themselves.
    for (const c of controllers) {
      c.signal.addEventListener("abort", () => {
        const unregister = unregisters[controllers.indexOf(c)];
        unregister();
      });
    }

    const remaining = await drainSseStreams(1_000);
    expect(remaining).toBe(0);
    expect(controllers.every((c) => c.signal.aborted)).toBe(true);
  });

  it("drainSseStreams returns the stuck count if handlers never unregister", async () => {
    const stuck = new AbortController();
    registerSseStream(stuck);

    const remaining = await drainSseStreams(100);
    expect(remaining).toBe(1);
    expect(stuck.signal.aborted).toBe(true);
  });

  it("drainSseStreams swallows individual abort errors", async () => {
    const bad = new AbortController();
    const abortSpy = vi.spyOn(bad, "abort").mockImplementation(() => {
      throw new Error("boom");
    });
    const good = new AbortController();
    registerSseStream(bad);
    const unregisterGood = registerSseStream(good);
    good.signal.addEventListener("abort", () => unregisterGood());

    const remaining = await drainSseStreams(200);
    expect(abortSpy).toHaveBeenCalled();
    expect(remaining).toBe(1);
    expect(good.signal.aborted).toBe(true);
  });
});
