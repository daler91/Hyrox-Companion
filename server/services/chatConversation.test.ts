import type { ChatMessage, PlanAdjustmentProposal } from "@shared/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { generateText } from "../ai/providers";
import { storage } from "../storage";
import {
  annotateSession,
  describeDuration,
  fitHistoryWindow,
  loadConversation,
  saveCoachReply,
  saveUserTurn,
  serverOwnedTurn,
  splitSessions,
} from "./chatConversation";

vi.mock("../storage", () => ({
  storage: {
    users: {
      getChatMessages: vi.fn(),
      saveChatMessage: vi.fn(),
      saveChatMessageOnce: vi.fn(),
      deleteAssistantChatMessage: vi.fn(),
    },
    planProposals: { getByIds: vi.fn() },
  },
}));

vi.mock("../ai/providers", () => ({ generateText: vi.fn() }));

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-10-01T18:00:00Z");
const TURN = {
  userMessageId: "11111111-1111-4111-8111-111111111111",
  assistantMessageId: "22222222-2222-4222-8222-222222222222",
};

let nextId = 0;
function row(
  role: "user" | "assistant",
  content: string,
  hoursAgo: number,
  extra: Partial<ChatMessage> = {},
): ChatMessage {
  nextId += 1;
  return {
    id: `row-${nextId}`,
    userId: "user-1",
    role,
    content,
    timestamp: new Date(NOW.getTime() - hoursAgo * HOUR),
    kind: "text",
    proposalId: null,
    safetyNotice: null,
    ragInfo: null,
    focusPlanDayId: null,
    focusWorkoutLogId: null,
    ...extra,
  };
}

function proposal(id: string, status: string, resolvedHoursAgo?: number): PlanAdjustmentProposal {
  return {
    id,
    userId: "user-1",
    planId: "plan-1",
    status,
    summaryMessage: "Moved your long run to Saturday.",
    userRequest: "move my long run",
    payload: { changes: [] },
    aiSource: null,
    createdAt: NOW,
    resolvedAt: resolvedHoursAgo === undefined ? null : new Date(NOW.getTime() - resolvedHoursAgo * HOUR),
  };
}

describe("serverOwnedTurn", () => {
  it("hands the turn to the server only when both message ids are sent", () => {
    expect(serverOwnedTurn({ ...TURN })).toEqual({ ...TURN, replaceAssistantId: undefined });
    expect(serverOwnedTurn({ userMessageId: TURN.userMessageId })).toBeNull();
    expect(serverOwnedTurn({})).toBeNull();
  });
});

describe("fitHistoryWindow", () => {
  it("keeps the last 20 turns and cuts older ones past the character budget", () => {
    const turns = Array.from({ length: 25 }, (_, i) => ({ role: "user" as const, content: `${i}`.padEnd(2_000, "x") }));
    const fitted = fitHistoryWindow(turns);
    expect(fitted).toHaveLength(20);
    expect(fitted.at(-1)?.content).toHaveLength(2_000);
    expect(fitted[0].content.endsWith(" [truncated]")).toBe(true);
  });
});

describe("describeDuration", () => {
  it("reads in hours, then days, then weeks", () => {
    expect(describeDuration(0.4 * HOUR)).toBe("1 hour");
    expect(describeDuration(5 * HOUR)).toBe("5 hours");
    expect(describeDuration(30 * HOUR)).toBe("1 day");
    expect(describeDuration(19 * 24 * HOUR)).toBe("3 weeks");
  });
});

describe("splitSessions", () => {
  it("keeps the turns since the last long break as the current session", () => {
    const old = row("user", "old question", 40);
    const recent = [row("user", "how was my run?", 3), row("assistant", "solid", 3)];
    const split = splitSessions([old, row("assistant", "old answer", 40), ...recent], NOW.getTime());
    expect(split.current).toEqual(recent);
    expect(split.toSummarise).toBeUndefined();
  });

  it("starts a session after a 12-hour break, with the one before still to summarise", () => {
    const earlierNote = row("assistant", "- The athlete has a sore knee.", 80, { kind: "summary" });
    const previous = [row("user", "knee feels better", 30), row("assistant", "great, ease back in", 30)];
    const split = splitSessions([row("user", "older", 90), earlierNote, ...previous], NOW.getTime());
    expect(split.current).toEqual([]);
    expect(split.carried).toBeUndefined();
    expect(split.toSummarise).toEqual({ turns: previous, earlier: earlierNote });
    expect(split.previousEndedAt).toBe(previous[1].timestamp?.getTime());
  });

  it("finds the summary written when the current session started", () => {
    const note = row("assistant", "- The athlete moved to evenings.", 2.01, { kind: "summary" });
    const split = splitSessions(
      [row("user", "old", 30), note, row("user", "hi again", 2), row("assistant", "hello", 2)],
      NOW.getTime(),
    );
    expect(split.carried).toBe(note);
    expect(split.current).toHaveLength(2);
  });

  it("reuses the summary when the first message of a session is retried", () => {
    const note = row("assistant", "- Summary", 0.01, { kind: "summary" });
    const split = splitSessions([row("user", "old", 30), note], NOW.getTime());
    expect(split.carried).toBe(note);
    expect(split.toSummarise).toBeUndefined();
  });

  it("has nothing to carry for a first conversation", () => {
    expect(splitSessions([], NOW.getTime())).toEqual({ current: [], carried: undefined, previousEndedAt: undefined });
  });
});

describe("annotateSession", () => {
  it("tells the coach about pauses inside the session and before the new message", () => {
    const rows = [row("user", "about to run", 8), row("assistant", "have fun", 8), row("user", "done!", 3)];
    const { turns, notes } = annotateSession(rows, new Map(), NOW.getTime());
    expect(turns[0].notes).toBeUndefined();
    expect(turns[2].notes).toEqual(["5 hours later"]);
    expect(notes).toEqual(["3 hours later"]);
  });

  it("puts a proposal's outcome ahead of the first athlete turn after it was decided", () => {
    const rows = [
      row("user", "move my long run", 0.5),
      row("assistant", "Here's a proposal.", 0.5, { kind: "proposal", proposalId: "p-1" }),
      row("user", "thanks", 0.4),
      row("user", "what next?", 0.2),
    ];
    const { turns, notes } = annotateSession(rows, new Map([["p-1", proposal("p-1", "applied", 0.3)]]), NOW.getTime());
    expect(turns[2].notes).toBeUndefined();
    expect(turns[3].notes).toEqual(["The athlete applied the plan changes the coach proposed."]);
    expect(notes).toEqual([]);
  });

  it("tells the coach about a dismissal or a pending proposal with the new message", () => {
    const rows = [
      row("assistant", "First idea.", 0.6, { kind: "proposal", proposalId: "p-1" }),
      row("assistant", "Second idea.", 0.5, { kind: "proposal", proposalId: "p-2" }),
    ];
    const { notes } = annotateSession(
      rows,
      new Map([
        ["p-1", proposal("p-1", "dismissed", 0.55)],
        ["p-2", proposal("p-2", "pending")],
      ]),
      NOW.getTime(),
    );
    expect(notes).toEqual([
      "The athlete dismissed the plan changes the coach proposed; the plan was not changed.",
      "The plan changes the coach proposed are still waiting for the athlete to apply or dismiss them.",
    ]);
  });
});

describe("loadConversation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(storage.planProposals.getByIds).mockResolvedValue([]);
  });

  it("drops the failed reply a retry replaces, and leaves the retried turn out", async () => {
    const retried = { ...row("user", "how should I pace it?", 0.01), id: TURN.userMessageId };
    vi.mocked(storage.users.getChatMessages).mockResolvedValue([row("user", "hi", 1), row("assistant", "hey", 1), retried]);

    const conversation = await loadConversation("user-1", { ...TURN, replaceAssistantId: "33333333-3333-4333-8333-333333333333" }, NOW);

    expect(storage.users.deleteAssistantChatMessage).toHaveBeenCalledWith("user-1", "33333333-3333-4333-8333-333333333333");
    expect(storage.users.getChatMessages).toHaveBeenCalledWith("user-1", { limit: 60 });
    expect(conversation.turns.map((turn) => turn.content)).toEqual(["hi", "hey"]);
    expect(conversation.notes).toEqual(["1 hour later"]);
    await expect(conversation.earlier).resolves.toBeUndefined();
  });

  it("reads the outcome of the session's proposals", async () => {
    vi.mocked(storage.users.getChatMessages).mockResolvedValue([
      row("assistant", "A proposal.", 0.5, { kind: "proposal", proposalId: "p-1" }),
    ]);
    vi.mocked(storage.planProposals.getByIds).mockResolvedValue([proposal("p-1", "invalidated", 0.2)]);

    const conversation = await loadConversation("user-1", TURN, NOW);

    expect(storage.planProposals.getByIds).toHaveBeenCalledWith(["p-1"], "user-1");
    expect(conversation.notes).toEqual([
      "The proposed plan changes went out of date before they were applied; the plan was not changed.",
    ]);
  });

  it("summarises the earlier conversation for the first message after a break, and saves the note", async () => {
    vi.mocked(storage.users.getChatMessages).mockResolvedValue([
      row("user", "my knee hurts", 30),
      row("assistant", "get it checked", 30),
    ]);
    vi.mocked(generateText).mockResolvedValue({ text: "- The athlete reported knee pain.", model: "fast" });

    const conversation = await loadConversation("user-1", TURN, NOW);

    expect(conversation.turns).toEqual([]);
    await expect(conversation.earlier).resolves.toEqual({ text: "- The athlete reported knee pain.", endedAgo: "1 day" });
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({ modelRole: "fast", reasoningEffort: "none", feature: "chat_summary", userId: "user-1" }),
    );
    const prompt = vi.mocked(generateText).mock.calls[0][0].messages[0].content;
    expect(prompt).toContain("Athlete: my knee hurts");
    expect(prompt).toContain("Coach: get it checked");
    expect(storage.users.saveChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", role: "assistant", kind: "summary", content: "- The athlete reported knee pain." }),
    );
  });

  it("carries the athlete's last words forward when the summary can't be written", async () => {
    vi.mocked(storage.users.getChatMessages).mockResolvedValue([row("user", "travelling next week", 20)]);
    vi.mocked(generateText).mockRejectedValue(new Error("provider down"));

    const conversation = await loadConversation("user-1", TURN, NOW);

    await expect(conversation.earlier).resolves.toEqual({
      text: '- The athlete wrote: "travelling next week"',
      endedAgo: "20 hours",
    });
    expect(storage.users.saveChatMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: "summary" }));
  });

  it("uses the session's saved summary without writing another", async () => {
    vi.mocked(storage.users.getChatMessages).mockResolvedValue([
      row("user", "old", 30),
      row("assistant", "- Earlier note", 2.01, { kind: "summary" }),
      row("user", "back again", 2),
    ]);

    const conversation = await loadConversation("user-1", TURN, NOW);

    await expect(conversation.earlier).resolves.toEqual({ text: "- Earlier note", endedAgo: "1 day" });
    expect(generateText).not.toHaveBeenCalled();
    expect(conversation.turns.map((turn) => turn.content)).toEqual(["back again"]);
  });
});

describe("saving turns", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("saves the athlete's turn once, under its client id, with the open workout", async () => {
    const at = new Date("2026-10-01T10:00:00Z");
    await saveUserTurn("user-1", TURN, "How was Tuesday?", { focusPlanDayId: "day-1" }, at);
    expect(storage.users.saveChatMessageOnce).toHaveBeenCalledWith({
      id: TURN.userMessageId,
      userId: "user-1",
      role: "user",
      content: "How was Tuesday?",
      kind: "text",
      timestamp: at,
      focusPlanDayId: "day-1",
      focusWorkoutLogId: null,
    });
  });

  it("throws when the athlete's turn can't be saved", async () => {
    vi.mocked(storage.users.saveChatMessageOnce).mockRejectedValue(new Error("db down"));
    await expect(saveUserTurn("user-1", TURN, "hi", {})).rejects.toThrow("db down");
  });

  it("saves a proposal reply with its proposal, retrieval and safety notice, but not the excerpts", async () => {
    await saveCoachReply(
      "user-1",
      TURN,
      {
        content: "Here's the change.",
        proposalId: "p-1",
        ragInfo: { source: "rag", chunkCount: 2, chunks: ["secret excerpt"], sources: ["Pacing notes"] },
        safetyNotice: { level: "caution", message: "Check with your clinician." },
      },
      {},
    );
    expect(storage.users.saveChatMessageOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        id: TURN.assistantMessageId,
        role: "assistant",
        kind: "proposal",
        proposalId: "p-1",
        ragInfo: { source: "rag", chunkCount: 2, sources: ["Pacing notes"] },
        safetyNotice: { level: "caution", message: "Check with your clinician." },
        timestamp: expect.any(Date),
      }),
    );
  });

  it("saves nothing when no reply text reached the athlete, and never throws", async () => {
    await saveCoachReply("user-1", TURN, { content: "  " }, {});
    expect(storage.users.saveChatMessageOnce).not.toHaveBeenCalled();

    vi.mocked(storage.users.saveChatMessageOnce).mockRejectedValue(new Error("db down"));
    await expect(saveCoachReply("user-1", TURN, { content: "partial" }, {})).resolves.toBeUndefined();
  });
});
