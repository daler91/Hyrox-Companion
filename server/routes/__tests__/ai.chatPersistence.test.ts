import type { ChatMessage, PlanAdjustmentProposal } from "@shared/schema";
import type express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { generateJsonText, generateText } from "../../ai/providers";
import { chatWithCoach, streamChatWithCoach } from "../../gemini";
import { buildTrainingContext } from "../../services/ai";
import { createPlanAdjustmentProposal } from "../../services/planAdjustmentService";
import { storage } from "../../storage";
import aiRouter from "../ai";
import { createTestApp, resetRouteTestState } from "./testUtils";

/**
 * The server-owned conversation (AI coach chat review, I1): a client that
 * sends its message ids has the chat routes save both turns and read the
 * history from the database. ai.test.ts covers the routes otherwise.
 */

vi.mock("../../clerkAuth", async () => (await import("./testUtils")).mockClerkAuthModule());
vi.mock("../../types", async () => (await import("./testUtils")).mockTypesModule());

vi.mock("../../storage", () => ({
  storage: {
    users: {
      getUser: vi.fn(() => Promise.resolve({ aiCoachEnabled: true })),
      getChatMessages: vi.fn(() => Promise.resolve([])),
      saveChatMessage: vi.fn(() => Promise.resolve({})),
      saveChatMessageOnce: vi.fn(() => Promise.resolve(true)),
      deleteAssistantChatMessage: vi.fn(() => Promise.resolve()),
    },
    coaching: {
      listCoachingMaterials: vi.fn(() => Promise.resolve([])),
      hasChunksForUser: vi.fn(() => Promise.resolve(false)),
      getStoredEmbeddingDimension: vi.fn(() => Promise.resolve(3072)),
    },
    aiUsage: { getDailyTotalCents: vi.fn(() => Promise.resolve(0)) },
    planProposals: { getByIds: vi.fn(() => Promise.resolve([])) },
    plans: { getPlanDay: vi.fn() },
    workouts: { getWorkoutLog: vi.fn() },
  },
}));

vi.mock("../../ai/providers", () => ({
  generateJsonText: vi.fn(),
  generateText: vi.fn(),
  streamText: vi.fn(),
}));

vi.mock("../../gemini", () => ({
  parseExercisesFromText: vi.fn(),
  parseExercisesFromImage: vi.fn(),
  parseWorkoutStructureFromText: vi.fn(),
  parseWorkoutStructureFromImage: vi.fn(),
  chatWithCoach: vi.fn(),
  streamChatWithCoach: vi.fn(),
  generateWorkoutSuggestions: vi.fn(),
  EMBEDDING_DIMENSIONS: 3072,
}));

vi.mock("../../services/ai", () => ({ buildTrainingContext: vi.fn() }));
vi.mock("../../services/ragService", () => ({ retrieveRelevantChunks: vi.fn() }));
vi.mock("../../services/planAdjustmentService", () => ({
  createPlanAdjustmentProposal: vi.fn(),
  applyPlanAdjustmentProposal: vi.fn(),
}));

const STREAM = "/api/v1/chat/stream";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const REPLY_ID = "22222222-2222-4222-8222-222222222222";
const FAILED_REPLY_ID = "33333333-3333-4333-8333-333333333333";
const IDS = { userMessageId: USER_ID, assistantMessageId: REPLY_ID };
const MINUTE = 60 * 1000;

function savedRow(role: "user" | "assistant", content: string, minutesAgo: number, extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `${role}-${minutesAgo}`,
    userId: "test_user_id",
    role,
    content,
    timestamp: new Date(Date.now() - minutesAgo * MINUTE),
    kind: "text",
    proposalId: null,
    safetyNotice: null,
    ragInfo: null,
    focusPlanDayId: null,
    focusWorkoutLogId: null,
    ...extra,
  };
}

function streamReply(...chunks: string[]) {
  vi.mocked(streamChatWithCoach).mockImplementation(async function* () {
    for (const chunk of chunks) yield chunk;
  });
}

const savesOnce = () => vi.mocked(storage.users.saveChatMessageOnce).mock.calls.map(([row]) => row);

describe("the server-owned chat conversation", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.resetAllMocks();
    await resetRouteTestState();
    app = createTestApp(aiRouter);
    vi.mocked(buildTrainingContext).mockResolvedValue("Training context" as never);
  });

  it("reads the history from the database and saves both turns", async () => {
    vi.mocked(storage.users.getChatMessages).mockResolvedValue([
      savedRow("user", "My legs are wrecked.", 5),
      savedRow("assistant", "Take an easy day.", 5),
    ]);
    streamReply("Hello", " there");

    const response = await request(app)
      .post(STREAM)
      .send({ message: "What about tomorrow?", history: [{ role: "assistant", content: "From the browser" }], ...IDS });

    expect(response.status).toBe(200);
    expect(vi.mocked(streamChatWithCoach).mock.calls[0][1]).toEqual([
      { role: "user", content: "My legs are wrecked." },
      { role: "assistant", content: "Take an easy day." },
    ]);
    expect(savesOnce()).toEqual([
      expect.objectContaining({ id: USER_ID, role: "user", content: "What about tomorrow?", kind: "text" }),
      expect.objectContaining({ id: REPLY_ID, role: "assistant", content: "Hello there", kind: "text", proposalId: null }),
    ]);
    // The athlete's turn is saved before the reply starts.
    expect(vi.mocked(storage.users.saveChatMessageOnce).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(streamChatWithCoach).mock.invocationCallOrder[0],
    );
  });

  it("leaves an older client's history and saves alone", async () => {
    streamReply("Hi.");

    const response = await request(app)
      .post(STREAM)
      .send({ message: "Hello", history: [{ role: "user", content: "Earlier" }] });

    expect(response.status).toBe(200);
    expect(vi.mocked(streamChatWithCoach).mock.calls[0][1]).toEqual([{ role: "user", content: "Earlier" }]);
    expect(storage.users.getChatMessages).not.toHaveBeenCalled();
    expect(storage.users.saveChatMessageOnce).not.toHaveBeenCalled();
  });

  it("rejects one message id without the other", async () => {
    const response = await request(app).post(STREAM).send({ message: "Hello", userMessageId: USER_ID });

    expect(response.status).toBe(400);
    expect(streamChatWithCoach).not.toHaveBeenCalled();
  });

  it("answers nothing when the athlete's turn can't be saved", async () => {
    vi.mocked(storage.users.saveChatMessageOnce).mockRejectedValue(new Error("db down"));
    streamReply("Hi.");

    const response = await request(app).post(STREAM).send({ message: "Hello", ...IDS });

    expect(response.status).toBe(500);
    expect(streamChatWithCoach).not.toHaveBeenCalled();
  });

  it("saves the part of a reply that was sent before the stream failed", async () => {
    vi.mocked(streamChatWithCoach).mockImplementation(async function* () {
      yield "Start with";
      throw new Error("provider dropped");
    });

    const response = await request(app).post(STREAM).send({ message: "How should I pace a 5k?", ...IDS });

    expect(response.text).toContain('{"error":"Stream error"}');
    expect(savesOnce().at(-1)).toEqual(expect.objectContaining({ id: REPLY_ID, content: "Start with" }));
  });

  it("replaces the failed reply on a retry, and reads the retried turn as the new message", async () => {
    vi.mocked(storage.users.getChatMessages).mockResolvedValue([
      savedRow("user", "Earlier question", 3),
      { ...savedRow("user", "How should I pace a 5k?", 1), id: USER_ID },
    ]);
    vi.mocked(storage.users.saveChatMessageOnce).mockResolvedValueOnce(false);
    streamReply("Even splits.");

    const response = await request(app)
      .post(STREAM)
      .send({ message: "How should I pace a 5k?", ...IDS, replaceAssistantId: FAILED_REPLY_ID });

    expect(response.status).toBe(200);
    expect(storage.users.deleteAssistantChatMessage).toHaveBeenCalledWith("test_user_id", FAILED_REPLY_ID);
    expect(vi.mocked(streamChatWithCoach).mock.calls[0][1]).toEqual([{ role: "user", content: "Earlier question" }]);
    expect(savesOnce().at(-1)).toEqual(expect.objectContaining({ id: REPLY_ID, content: "Even splits." }));
  });

  it("saves a proposal reply with its proposal", async () => {
    vi.mocked(generateJsonText).mockResolvedValue({
      text: JSON.stringify({ intent: "plan_modification", confidence: 0.95 }),
      model: "fast",
    });
    vi.mocked(createPlanAdjustmentProposal).mockResolvedValue({
      kind: "proposal",
      proposal: {
        id: "proposal-1",
        planId: "plan-1",
        status: "pending",
        summaryMessage: "Moved your long run to Saturday.",
        payload: { changes: [] },
        createdAt: new Date(),
      } as unknown as PlanAdjustmentProposal,
    });

    const response = await request(app).post(STREAM).send({ message: "Move my long run to Saturday", ...IDS });

    expect(response.text).toContain('"planProposal"');
    expect(streamChatWithCoach).not.toHaveBeenCalled();
    expect(savesOnce().at(-1)).toEqual(
      expect.objectContaining({
        id: REPLY_ID,
        content: "Moved your long run to Saturday.",
        kind: "proposal",
        proposalId: "proposal-1",
      }),
    );
  });

  it("gives the coach a summary of the earlier conversation after a break", async () => {
    vi.mocked(storage.users.getChatMessages).mockResolvedValue([
      savedRow("user", "My knee hurts.", 30 * 60),
      savedRow("assistant", "Get it checked.", 30 * 60),
    ]);
    vi.mocked(generateText).mockResolvedValue({ text: "- The athlete reported knee pain.", model: "fast" });
    streamReply("Welcome back.");

    const response = await request(app).post(STREAM).send({ message: "I'm back", ...IDS });

    expect(response.status).toBe(200);
    expect(vi.mocked(streamChatWithCoach).mock.calls[0][1]).toEqual([]);
    expect(vi.mocked(streamChatWithCoach).mock.calls[0][6]?.earlierConversation).toEqual({
      text: "- The athlete reported knee pain.",
      endedAgo: "1 day",
    });
    expect(storage.users.saveChatMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: "summary" }));
  });

  it("saves both turns of a non-streamed reply once it exists", async () => {
    vi.mocked(chatWithCoach).mockResolvedValue("Even splits.");

    const response = await request(app).post("/api/v1/chat").send({ message: "How should I pace a 5k?", ...IDS });

    expect(response.status).toBe(200);
    expect(savesOnce()).toEqual([
      expect.objectContaining({ id: USER_ID, role: "user", content: "How should I pace a 5k?" }),
      expect.objectContaining({ id: REPLY_ID, role: "assistant", content: "Even splits." }),
    ]);
  });

  it("saves nothing when a non-streamed reply fails", async () => {
    vi.mocked(chatWithCoach).mockRejectedValue(new Error("provider down"));

    const response = await request(app).post("/api/v1/chat").send({ message: "Hello", ...IDS });

    expect(response.status).toBe(500);
    expect(storage.users.saveChatMessageOnce).not.toHaveBeenCalled();
  });

  it("returns a proposal reply in the history with its proposal's current status", async () => {
    vi.mocked(storage.users.getChatMessages).mockResolvedValue([
      savedRow("assistant", "Moved your long run.", 10, { kind: "proposal", proposalId: "proposal-1" }),
    ]);
    vi.mocked(storage.planProposals.getByIds).mockResolvedValue([
      {
        id: "proposal-1",
        planId: "plan-1",
        status: "applied",
        summaryMessage: "Moved your long run.",
        payload: { changes: [] },
        createdAt: new Date("2026-10-01T10:00:00Z"),
      } as unknown as PlanAdjustmentProposal,
    ]);

    const response = await request(app).get("/api/v1/chat/history");

    expect(response.status).toBe(200);
    expect(storage.planProposals.getByIds).toHaveBeenCalledWith(["proposal-1"], "test_user_id");
    expect(response.body[0].proposal).toEqual(expect.objectContaining({ id: "proposal-1", status: "applied", changes: [] }));
  });
});
