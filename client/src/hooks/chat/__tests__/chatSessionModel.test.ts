import { describe, expect, it, vi } from "vitest";

import type { ChatHistoryMessage, PlanProposalView } from "@/lib/api";
import type { Message } from "@/lib/chatMessage";

import { createMessageUpdater, handleSendFailure, markReplyRateable, messageFromHistory, type SetMessages } from "../chatSessionModel";

function message(overrides: Partial<Message>): Message {
  return { id: "m", role: "user", content: "", timestamp: "", createdAtMs: 1, ...overrides };
}

/** A setMessages that applies each update to a local buffer. */
function messageBuffer(initial: Message[]) {
  let messages = initial;
  const setMessages: SetMessages = (update) => {
    messages = typeof update === "function" ? update(messages) : update;
  };
  return { setMessages, current: () => messages };
}

function savedRow(overrides: Partial<ChatHistoryMessage>): ChatHistoryMessage {
  return {
    id: "row-1",
    userId: "user-1",
    role: "assistant",
    content: "Easy run, 40 min.",
    timestamp: new Date("2026-09-29T08:30:00Z"),
    kind: "text",
    proposalId: null,
    safetyNotice: null,
    ragInfo: null,
    focusPlanDayId: null,
    focusWorkoutLogId: null,
    feedback: null,
    feedbackAt: null,
    factProposal: null,
    attachment: null,
    ...overrides,
  };
}

const PROPOSAL: PlanProposalView = {
  id: "proposal-1",
  planId: "plan-1",
  status: "applied",
  summaryMessage: "Moved your long run to Saturday.",
  changes: [],
  createdAt: "2026-09-29T08:30:00.000Z",
};

describe("messageFromHistory", () => {
  it("keeps a saved reply's safety notice, retrieval and proposal, and when it was sent", () => {
    const hydrated = messageFromHistory(
      savedRow({
        kind: "proposal",
        proposalId: "proposal-1",
        safetyNotice: { level: "caution", message: "Heart-rate zones can be unreliable." },
        ragInfo: { source: "rag", chunkCount: 2, sources: ["Pacing notes"] },
        proposal: PROPOSAL,
      }),
    );

    expect(hydrated).toMatchObject({
      id: "row-1",
      role: "assistant",
      kind: "proposal",
      createdAtMs: 0,
      sentAtMs: Date.parse("2026-09-29T08:30:00Z"),
      safetyNotice: { level: "caution", message: "Heart-rate zones can be unreliable." },
      ragInfo: { source: "rag", chunkCount: 2, sources: ["Pacing notes"] },
      proposal: PROPOSAL,
    });
    expect(hydrated.timestamp).not.toBe("");
  });

  it("reads a timestamp that arrived as JSON text", () => {
    const row = savedRow({ timestamp: "2026-09-29T08:30:00.000Z" as unknown as Date });
    expect(messageFromHistory(row).sentAtMs).toBe(Date.parse("2026-09-29T08:30:00Z"));
  });

  it("marks the note a new session carried, and leaves out what isn't there", () => {
    const hydrated = messageFromHistory(savedRow({ kind: "summary", content: "- The athlete has a sore knee." }));
    expect(hydrated.kind).toBe("summary");
    expect(hydrated).not.toHaveProperty("safetyNotice");
    expect(hydrated).not.toHaveProperty("proposal");
    expect(hydrated).not.toHaveProperty("ragInfo");
  });

  it("lets the athlete rate the coach's replies, with the rating they gave, and nothing else", () => {
    expect(messageFromHistory(savedRow({ feedback: "down" }))).toMatchObject({ rateable: true, feedback: "down" });
    expect(messageFromHistory(savedRow({ kind: "proposal" }))).toMatchObject({ rateable: true });
    expect(messageFromHistory(savedRow({ role: "user" }))).not.toHaveProperty("rateable");
    expect(messageFromHistory(savedRow({ kind: "summary" }))).not.toHaveProperty("rateable");
    expect(messageFromHistory(savedRow({ feedback: "meh" }))).not.toHaveProperty("feedback");
  });
});

describe("messageFromHistory — a fact offered for the athlete card (I5b)", () => {
  it("keeps the offer and the athlete's answer to it", () => {
    const factProposal = { fact: "No sled at my gym", category: "equipment" as const, status: "saved" as const };

    expect(messageFromHistory(savedRow({ factProposal })).factProposal).toEqual(factProposal);
    expect(messageFromHistory(savedRow({}))).not.toHaveProperty("factProposal");
  });
});

describe("messageFromHistory — an athlete's photo (I20)", () => {
  it("keeps what the coach read in an athlete's photo, and nothing malformed", () => {
    const attachment = { kind: "photo" as const, reading: "Watch summary: 10 km in 45:12." };

    expect(messageFromHistory(savedRow({ role: "user", attachment })).attachment).toEqual(attachment);
    expect(messageFromHistory(savedRow({ role: "user", attachment: { kind: "photo" } as never }))).not.toHaveProperty("attachment");
    expect(messageFromHistory(savedRow({ role: "assistant", attachment }))).not.toHaveProperty("attachment");
  });
});

describe("markReplyRateable", () => {
  it("opens a reply to rating once it arrived in full, never a failed or empty one", () => {
    const buffer = messageBuffer([
      message({ id: "done", role: "assistant", content: "Run easy." }),
      message({ id: "failed", role: "assistant", content: "Run", failure: { message: "Stopped." } }),
      message({ id: "empty", role: "assistant", content: "" }),
    ]);

    for (const id of ["done", "failed", "empty"]) markReplyRateable(buffer.setMessages, id);

    expect(buffer.current().map((m) => m.rateable)).toEqual([true, undefined, undefined]);
  });
});

describe("createMessageUpdater", () => {
  it("puts the stream's text, safety notice and drafted proposal on the reply", () => {
    const buffer = messageBuffer([message({ id: "u1" }), message({ id: "a1", role: "assistant" })]);

    createMessageUpdater("a1", buffer.setMessages)({
      content: "Here is the change.",
      extras: {
        safetyNotice: { level: "urgent", message: "Get checked." },
        planProposal: { ...PROPOSAL, status: "pending" },
      },
    });

    const messages = buffer.current();
    expect(messages[1]).toMatchObject({
      content: "Here is the change.",
      safetyNotice: { level: "urgent", message: "Get checked." },
      kind: "proposal",
      proposal: { id: "proposal-1", status: "pending" },
    });
    expect(messages[0]).toEqual(message({ id: "u1" }));
  });

  it("ignores a malformed proposal frame", () => {
    const buffer = messageBuffer([message({ id: "a1", role: "assistant" })]);

    createMessageUpdater("a1", buffer.setMessages)({ content: "Hi.", extras: { planProposal: { id: 3 } } });

    expect(buffer.current()[0]).not.toHaveProperty("proposal");
  });

  it("puts a fact offered for the athlete card on the reply, and ignores a malformed one (I5b)", () => {
    const offer = { fact: "No sled at my gym", category: "equipment", status: "pending" };
    const buffer = messageBuffer([message({ id: "a1", role: "assistant" }), message({ id: "a2", role: "assistant" })]);

    createMessageUpdater("a1", buffer.setMessages)({ content: "Noted.", extras: { factProposal: offer } });
    createMessageUpdater("a2", buffer.setMessages)({
      content: "Noted.",
      extras: { factProposal: { ...offer, category: "medical" } },
    });

    expect(buffer.current()[0]?.factProposal).toEqual(offer);
    expect(buffer.current()[1]).not.toHaveProperty("factProposal");
  });
});

describe("handleSendFailure", () => {
  it("keeps the text that arrived, and offers a retry under the same message id", () => {
    const user = message({ id: "u1", content: "Taper advice?" });
    const buffer = messageBuffer([user, message({ id: "a1", role: "assistant" })]);
    const setStreamError = vi.fn();

    handleSendFailure({
      err: new Error("500: {\"error\":\"Internal Server Error\"}"),
      fullResponse: "Cut volume",
      assistantMessageId: "a1",
      userMessage: user,
      setMessages: buffer.setMessages,
      setStreamError,
    });

    const messages = buffer.current();
    expect(messages[1].content).toBe("Cut volume");
    expect(messages[1].failure?.retry).toEqual({ content: "Taper advice?", userMessageId: "u1" });
    expect(setStreamError).toHaveBeenCalledWith(messages[1].failure?.message);
  });

  it("keeps the photo for the retry, so it goes again with the message (I20)", () => {
    const user = message({ id: "u1", content: "How was my pacing?", attachment: { kind: "photo" } });
    const buffer = messageBuffer([user]);
    const photo = { mimeType: "image/jpeg" as const, imageBase64: "/9j/4AAQ" };

    handleSendFailure({
      err: new Error('502: {"error":"Couldn\'t read that photo.","code":"CHAT_PHOTO_UNREADABLE"}'),
      fullResponse: "",
      assistantMessageId: "a1",
      userMessage: user,
      photo,
      setMessages: buffer.setMessages,
      setStreamError: vi.fn(),
    });

    const failed = buffer.current()[1];
    expect(failed.failure).toEqual({
      message: "Couldn't read that photo. Try again, or say what it shows.",
      retry: { content: "How was my pacing?", userMessageId: "u1", photo },
    });
  });
});
