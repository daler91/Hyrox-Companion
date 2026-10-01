import { describe, expect, it, vi } from "vitest";

import type { Message } from "@/lib/chatMessage";

import { buildHistory, createTurnSaver, type SavedTurn, truncateHistory } from "../chatSessionModel";

function message(overrides: Partial<Message>): Message {
  return { id: "m", role: "user", content: "", timestamp: "", createdAtMs: 1, ...overrides };
}

describe("buildHistory", () => {
  it("drops the welcome and any reply that failed before text arrived", () => {
    const history = buildHistory([
      message({ id: "welcome", role: "assistant", content: "hey" }),
      message({ id: "u1", content: "First try" }),
      message({ id: "a1", role: "assistant", content: "", failure: { message: "Connection dropped." } }),
      message({ id: "u2", content: "Second try" }),
      message({ id: "a2", role: "assistant", content: "Here you go." }),
    ]);
    expect(history).toEqual([
      { role: "user", content: "First try" },
      { role: "user", content: "Second try" },
      { role: "assistant", content: "Here you go." },
    ]);
  });

  it("keeps text that arrived before a failure", () => {
    const history = buildHistory([
      message({ id: "a1", role: "assistant", content: "Start with a", failure: { message: "Stopped." } }),
    ]);
    expect(history).toEqual([{ role: "assistant", content: "Start with a" }]);
  });

  it("sends at most the last 20 turns", () => {
    const many = Array.from({ length: 25 }, (_, i) => message({ id: `u${i}`, content: `turn ${i}` }));
    const history = buildHistory(many);
    expect(history).toHaveLength(20);
    expect(history[0].content).toBe("turn 5");
  });
});

describe("truncateHistory", () => {
  it("leaves a history under the character budget alone", () => {
    const turns = [{ role: "user", content: "short" }];
    expect(truncateHistory(turns)).toBe(turns);
  });

  it("keeps recent turns whole and cuts older ones once over budget", () => {
    const old = { role: "user", content: "o".repeat(20_000) };
    const recent = { role: "assistant", content: "r".repeat(15_000) };
    const [cutOld, keptRecent] = truncateHistory([old, recent]);
    expect(keptRecent).toEqual(recent);
    expect(cutOld.content).toBe(`${"o".repeat(200)} [truncated]`);
  });
});

describe("createTurnSaver", () => {
  const user = message({ id: "u1", content: "Taper advice?" });

  function recordingSaver() {
    const saved: SavedTurn[] = [];
    const saveTurn = vi.fn((turn: SavedTurn) => {
      saved.push(turn);
      return Promise.resolve();
    });
    return { saved, saveTurn };
  }

  it("saves the athlete's turn once, however often it is asked", async () => {
    const { saved, saveTurn } = recordingSaver();
    const turns = createTurnSaver(saveTurn, user, "a1", false);

    expect(turns.userSaved()).toBe(false);
    await turns.saveUser();
    await turns.saveUser();
    expect(turns.userSaved()).toBe(true);
    expect(saved).toEqual([{ role: "user", content: "Taper advice?", idempotencyKey: "u1" }]);
  });

  it("saves the reply after the athlete's turn, saving that first if needed", async () => {
    const { saved, saveTurn } = recordingSaver();
    const turns = createTurnSaver(saveTurn, user, "a1", false);

    turns.saveAssistant("Cut volume by a third.");
    await vi.waitFor(() => expect(saved).toHaveLength(2));
    expect(saved.map((t) => t.role)).toEqual(["user", "assistant"]);
    expect(saved[1]).toEqual({ role: "assistant", content: "Cut volume by a third.", idempotencyKey: "a1" });
  });

  it("never saves an athlete turn that an earlier attempt already saved", async () => {
    const { saved, saveTurn } = recordingSaver();
    const turns = createTurnSaver(saveTurn, user, "a2", true);

    expect(turns.userSaved()).toBe(true);
    turns.saveAssistant("6 x 60 s hills.");
    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].role).toBe("assistant");
  });
});
