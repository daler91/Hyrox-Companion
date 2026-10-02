import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMockAthleteFact } from "../../test/factories";
import { generateJsonText } from "../ai/providers";
import { storage } from "../storage";
import {
  decideChatFactProposal,
  extractFactCandidate,
  type FactCandidate,
  mayStateLastingFact,
  settleFactProposal,
  startFactProposal,
} from "./chatFactProposal";
import { invalidateTrainingContext } from "./trainingContextCache";

vi.mock("../ai/providers", () => ({ generateJsonText: vi.fn() }));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("./trainingContextCache", () => ({ invalidateTrainingContext: vi.fn() }));
vi.mock("../storage", () => ({
  storage: {
    users: {
      getUser: vi.fn(),
      getPendingChatFactProposal: vi.fn(),
      settleChatFactProposal: vi.fn(),
    },
    athleteFacts: { add: vi.fn() },
  },
}));

const SAFE = { redFlagDetected: false, hrMedicationDetected: false };

function modelSays(body: unknown) {
  vi.mocked(generateJsonText).mockResolvedValue({ text: JSON.stringify(body) } as never);
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("mayStateLastingFact", () => {
  it("lets through what an injury, kit, a fixed schedule or a preference is said with", () => {
    for (const message of [
      "There's no sled at my gym",
      "My left knee flares up on deep lunges",
      "I work night shifts on Tuesdays",
      "I hate treadmill running",
      "I only have a 20kg kettlebell",
    ]) {
      expect(mayStateLastingFact(message), message).toBe(true);
    }
  });

  it("spares the model a message that can't hold one", () => {
    for (const message of ["How should I pace a 5k?", "Great session today!", "What's a good warm-up?"]) {
      expect(mayStateLastingFact(message), message).toBe(false);
    }
  });
});

describe("extractFactCandidate", () => {
  it("returns the fact the model picked out, reading the athlete's words as data", async () => {
    modelSays({ fact: "No sled at my gym", category: "equipment" });

    const candidate = await extractFactCandidate("<b>No sled</b> at my gym", [{ role: "assistant", content: "Do you have a sled?" }], "u1");

    expect(candidate).toEqual({ fact: "No sled at my gym", category: "equipment" });
    const request = vi.mocked(generateJsonText).mock.calls[0]?.[0];
    expect(request).toMatchObject({ modelRole: "fast", reasoningEffort: "none", feature: "chat_fact", userId: "u1" });
    const sent = request?.messages[0]?.content ?? "";
    expect(sent).toContain("&lt;b&gt;No sled&lt;/b&gt; at my gym");
    expect(sent).toContain("<coach_message>\nDo you have a sled?\n</coach_message>");
  });

  it("offers nothing when the model finds no fact, answers out of shape, or fails", async () => {
    modelSays({ fact: null, category: "other" });
    await expect(extractFactCandidate("my knee is fine now", [], "u1")).resolves.toBeNull();

    modelSays({ fact: "x".repeat(200), category: "constraint" });
    await expect(extractFactCandidate("my knee", [], "u1")).resolves.toBeNull();

    vi.mocked(generateJsonText).mockRejectedValue(new Error("provider down"));
    await expect(extractFactCandidate("my knee", [], "u1")).resolves.toBeNull();
  });

  it("files an unknown category under other rather than dropping the fact", async () => {
    modelSays({ fact: "Allergic to latex bands", category: "medical" });

    await expect(extractFactCandidate("I'm allergic to latex bands", [], "u1")).resolves.toEqual({
      fact: "Allergic to latex bands",
      category: "other",
    });
  });
});

describe("startFactProposal", () => {
  const turn = { message: "No sled at my gym", history: [], userId: "u1", chatSafety: SAFE, serverOwned: true };

  it("reads a message that may hold a lasting fact", async () => {
    modelSays({ fact: "No sled at my gym", category: "equipment" });

    await expect(startFactProposal(turn)).resolves.toEqual({ fact: "No sled at my gym", category: "equipment" });
  });

  it("never reads after red-flag symptoms, for a turn the server doesn't save, or past the gate", () => {
    expect(startFactProposal({ ...turn, chatSafety: { ...SAFE, redFlagDetected: true } })).toBeNull();
    expect(startFactProposal({ ...turn, serverOwned: false })).toBeNull();
    expect(startFactProposal({ ...turn, message: "How should I pace a 5k?" })).toBeNull();
    expect(generateJsonText).not.toHaveBeenCalled();
  });
});

describe("settleFactProposal", () => {
  const found = (candidate: FactCandidate | null) => Promise.resolve(candidate);

  it("offers the fact, pending the athlete's answer", async () => {
    await expect(settleFactProposal(found({ fact: "No sled at my gym", category: "equipment" }), [])).resolves.toEqual({
      fact: "No sled at my gym",
      category: "equipment",
      status: "pending",
    });
  });

  it("offers nothing the card already holds, by the card's own key", async () => {
    await expect(
      settleFactProposal(found({ fact: "no sled at my gym.", category: "equipment" }), [{ fact: "No sled at my gym" }]),
    ).resolves.toBeNull();
  });

  it("closes without an offer rather than wait on a slow read", async () => {
    const never = new Promise<FactCandidate | null>(vi.fn());

    await expect(settleFactProposal(never, [], 5)).resolves.toBeNull();
  });
});

describe("decideChatFactProposal", () => {
  const pending = { fact: "No sled at my gym", category: "equipment" as const, status: "pending" as const };

  beforeEach(() => {
    vi.mocked(storage.users.getPendingChatFactProposal).mockResolvedValue(pending);
    vi.mocked(storage.users.settleChatFactProposal).mockResolvedValue(true);
    vi.mocked(storage.users.getUser).mockResolvedValue({ userTimezone: "UTC" } as never);
  });

  it("saves the fact to the card from chat, then marks the offer saved", async () => {
    const saved = createMockAthleteFact({ source: "chat" });
    vi.mocked(storage.athleteFacts.add).mockResolvedValue({ ok: true, fact: saved, created: true });

    const result = await decideChatFactProposal("u1", "m1", "save");

    expect(storage.athleteFacts.add).toHaveBeenCalledWith(
      "u1",
      { fact: "No sled at my gym", category: "equipment", source: "chat" },
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
    expect(storage.users.settleChatFactProposal).toHaveBeenCalledWith("u1", "m1", "saved");
    expect(invalidateTrainingContext).toHaveBeenCalledWith("u1");
    expect(result).toEqual({ kind: "settled", factProposal: { ...pending, status: "saved" }, fact: saved });
  });

  it("leaves the offer pending when the card is full", async () => {
    vi.mocked(storage.athleteFacts.add).mockResolvedValue({ ok: false, reason: "limit" });

    await expect(decideChatFactProposal("u1", "m1", "save")).resolves.toEqual({ kind: "limit" });
    expect(storage.users.settleChatFactProposal).not.toHaveBeenCalled();
  });

  it("turns an offer down without touching the card", async () => {
    await expect(decideChatFactProposal("u1", "m1", "dismiss")).resolves.toEqual({
      kind: "settled",
      factProposal: { ...pending, status: "dismissed" },
    });
    expect(storage.athleteFacts.add).not.toHaveBeenCalled();
    expect(storage.users.settleChatFactProposal).toHaveBeenCalledWith("u1", "m1", "dismissed");
  });

  it("finds nothing to answer on a reply without a pending offer", async () => {
    vi.mocked(storage.users.getPendingChatFactProposal).mockResolvedValue(null);

    await expect(decideChatFactProposal("u1", "m1", "save")).resolves.toEqual({ kind: "not_found" });
    expect(storage.athleteFacts.add).not.toHaveBeenCalled();
  });
});
