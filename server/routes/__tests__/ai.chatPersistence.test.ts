import type { ChatMessage, PlanAdjustmentProposal } from "@shared/schema";
import type express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { generateJsonText, generateText } from "../../ai/providers";
import { env } from "../../env";
import { chatWithCoach, type CoachStreamEvent, streamChatWithCoach, streamChatWithCoachTools } from "../../gemini";
import { buildTrainingContext } from "../../services/ai";
import { applyPlanAdjustmentProposal, createPlanAdjustmentProposal } from "../../services/planAdjustmentService";
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
    planProposals: { getByIds: vi.fn(() => Promise.resolve([])), getById: vi.fn() },
    plans: { getPlanDay: vi.fn() },
    workouts: { getWorkoutLog: vi.fn() },
    analytics: { getExerciseSetsForPersonalRecords: vi.fn(() => Promise.resolve([])) },
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
  streamChatWithCoachTools: vi.fn(),
  generateWorkoutSuggestions: vi.fn(),
  EMBEDDING_DIMENSIONS: 3072,
}));

vi.mock("../../services/ai", () => ({ buildTrainingContext: vi.fn() }));
// The chat reads its training context through a per-athlete cache; here it
// builds every time, so one test's context never answers the next.
vi.mock("../../services/trainingContextCache", () => ({
  getCachedTrainingContext: (userId: string, build: (id: string) => Promise<unknown>) => build(userId),
  invalidateTrainingContext: vi.fn(),
}));
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

  it("sends an auto-applied proposal as it now stands, so its card can offer Undo", async () => {
    vi.mocked(storage.users.getUser).mockResolvedValue({ aiCoachEnabled: true, coachAutoApplyPlanChanges: true } as never);
    vi.mocked(generateJsonText).mockResolvedValue({
      text: JSON.stringify({ intent: "plan_modification", confidence: 0.95 }),
      model: "fast",
    });
    const pending = {
      id: "proposal-1",
      planId: "plan-1",
      status: "pending",
      summaryMessage: "Moved your long run to Saturday.",
      payload: { changes: [{ planDayId: "day-1" }] },
      createdAt: new Date(),
      resolvedAt: null,
      applyUndo: null,
    } as unknown as PlanAdjustmentProposal;
    vi.mocked(createPlanAdjustmentProposal).mockResolvedValue({ kind: "proposal", proposal: pending });
    vi.mocked(applyPlanAdjustmentProposal).mockResolvedValue({ applied: true, changeCount: 1 });
    vi.mocked(storage.planProposals.getById).mockResolvedValue({
      ...pending,
      status: "applied",
      resolvedAt: new Date(),
      applyUndo: { days: [{ planDayId: "day-1" }] },
    } as unknown as PlanAdjustmentProposal);

    const response = await request(app).post(STREAM).send({ message: "Move my long run to Saturday", ...IDS });

    expect(applyPlanAdjustmentProposal).toHaveBeenCalledWith("test_user_id", "proposal-1", expect.anything());
    expect(response.text).toContain('"status":"applied"');
    expect(response.text).toContain('"undoable":true');
  });

  it("still sends the drafted proposal when auto-apply throws, for the athlete to apply", async () => {
    vi.mocked(storage.users.getUser).mockResolvedValue({ aiCoachEnabled: true, coachAutoApplyPlanChanges: true } as never);
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
    vi.mocked(applyPlanAdjustmentProposal).mockRejectedValue(new Error("db down"));

    const response = await request(app).post(STREAM).send({ message: "Move my long run to Saturday", ...IDS });

    expect(response.text).toContain('"status":"pending"');
    expect(streamChatWithCoach).not.toHaveBeenCalled();
    expect(savesOnce().at(-1)).toEqual(expect.objectContaining({ kind: "proposal", proposalId: "proposal-1" }));
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

  it("gives the coach a note on the start of a long session it no longer reads in full", async () => {
    // 31 turns a minute apart: past the 30 the coach reads before the note is written.
    vi.mocked(storage.users.getChatMessages).mockResolvedValue(
      Array.from({ length: 31 }, (_, i) => savedRow(i % 2 === 0 ? "user" : "assistant", `turn ${i + 1}`, 40 - i)),
    );
    vi.mocked(generateText).mockResolvedValue({ text: "- The athlete asked about pacing.", model: "fast" });
    streamReply("Sure.");

    const response = await request(app).post(STREAM).send({ message: "And the sled?", ...IDS });

    expect(response.status).toBe(200);
    expect(vi.mocked(streamChatWithCoach).mock.calls[0][1]).toHaveLength(20);
    expect(vi.mocked(streamChatWithCoach).mock.calls[0][6]?.earlierInSession).toBe("- The athlete asked about pacing.");
    expect(storage.users.saveChatMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: "rolling" }));
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

describe("the coach with tools (AI_CHAT_TOOLS)", () => {
  let app: express.Express;

  const PROPOSAL = {
    id: "proposal-1",
    planId: "plan-1",
    status: "pending",
    summaryMessage: "Moved your long run to Saturday.",
    payload: { changes: [] },
    createdAt: new Date(),
  } as unknown as PlanAdjustmentProposal;

  function coachSays(...events: CoachStreamEvent[]) {
    vi.mocked(streamChatWithCoachTools).mockImplementation(async function* () {
      for (const event of events) yield event;
    });
  }

  const handoff = (request: string): CoachStreamEvent => ({
    type: "handoff",
    call: { id: "call-1", name: "propose_plan_changes", arguments: { request } },
  });
  const toolOptions = () => vi.mocked(streamChatWithCoachTools).mock.calls[0][6];

  beforeEach(async () => {
    vi.resetAllMocks();
    await resetRouteTestState();
    app = createTestApp(aiRouter);
    vi.mocked(buildTrainingContext).mockResolvedValue({ currentDate: "2026-10-01", weightUnit: "kg", distanceUnit: "km" } as never);
    env.AI_CHAT_TOOLS = "true";
  });

  afterEach(() => {
    env.AI_CHAT_TOOLS = "false";
  });

  it("streams the reply in one model call, without the plan-change classifier", async () => {
    coachSays({ type: "text", text: "Keep it " }, { type: "text", text: "where it is." });

    const response = await request(app).post(STREAM).send({ message: "Should I move my long run to Saturday?", ...IDS });

    expect(response.status).toBe(200);
    expect(response.text).toContain('"text":"Keep it "');
    expect(generateJsonText).not.toHaveBeenCalled();
    expect(streamChatWithCoach).not.toHaveBeenCalled();
    expect(toolOptions().chatTools).toEqual({ planChanges: true });
    expect(toolOptions().toolset.handoff).toBe("propose_plan_changes");
    expect(toolOptions().toolset.tools.map((tool) => tool.name)).toContain("propose_plan_changes");
    expect(savesOnce().at(-1)).toEqual(
      expect.objectContaining({ id: REPLY_ID, content: "Keep it where it is.", kind: "text", proposalId: null }),
    );
  });

  it("runs the read tools for the athlete the request is for", async () => {
    coachSays({ type: "text", text: "Here are your bests." });

    await request(app).post(STREAM).send({ message: "What are my PRs?", ...IDS });
    const result = await toolOptions().toolset.run({ id: "call-1", name: "get_personal_records", arguments: {} });

    expect(storage.analytics.getExerciseSetsForPersonalRecords).toHaveBeenCalledWith("test_user_id", undefined, undefined, {
      onlyTraining: true,
    });
    expect(JSON.parse(result)).toEqual({ records: [] });
  });

  it("turns the coach's plan-change call into a proposal reply after what it already said", async () => {
    coachSays({ type: "text", text: "Good call." }, handoff("Move Sunday's long run to Saturday"));
    vi.mocked(createPlanAdjustmentProposal).mockResolvedValue({ kind: "proposal", proposal: PROPOSAL });

    const response = await request(app).post(STREAM).send({ message: "Yes, do that", ...IDS });

    expect(createPlanAdjustmentProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "test_user_id",
        message: "Yes, do that\n\nThe coach's summary of the change: Move Sunday's long run to Saturday",
      }),
      expect.anything(),
    );
    expect(response.text).toContain('"planProposalPending":true');
    expect(response.text).toContain('"text":"\\n\\nMoved your long run to Saturday."');
    expect(response.text).toContain('"planProposal"');
    expect(savesOnce().at(-1)).toEqual(
      expect.objectContaining({
        id: REPLY_ID,
        content: "Good call.\n\nMoved your long run to Saturday.",
        kind: "proposal",
        proposalId: "proposal-1",
      }),
    );
  });

  it("still shows a drafted proposal when auto-apply fails", async () => {
    vi.mocked(storage.users.getUser).mockResolvedValue({ aiCoachEnabled: true, coachAutoApplyPlanChanges: true } as never);
    coachSays(handoff("Move Sunday's long run to Saturday"));
    vi.mocked(createPlanAdjustmentProposal).mockResolvedValue({ kind: "proposal", proposal: PROPOSAL });
    vi.mocked(applyPlanAdjustmentProposal).mockRejectedValue(new Error("db down"));

    const response = await request(app).post(STREAM).send({ message: "Move my long run to Saturday", ...IDS });

    expect(response.text).toContain('"status":"pending"');
    expect(savesOnce().at(-1)).toEqual(expect.objectContaining({ kind: "proposal", proposalId: "proposal-1" }));
  });

  it("says so when the change can't be drafted, and saves no proposal", async () => {
    coachSays(handoff("Move Sunday's long run to Saturday"));
    vi.mocked(createPlanAdjustmentProposal).mockRejectedValue(new Error("model down"));

    const response = await request(app).post(STREAM).send({ message: "Move my long run to Saturday", ...IDS });

    expect(response.text).toContain("I couldn't draft that change just now.");
    expect(response.text).not.toContain('"planProposal":');
    expect(savesOnce().at(-1)).toEqual(expect.objectContaining({ kind: "text", proposalId: null }));
  });

  it("offers no plan changes where the surface can't show a proposal, or after a red-flag symptom", async () => {
    coachSays({ type: "text", text: "Rest today." });

    await request(app).post(STREAM).send({ message: "Move my long run", planEditing: false, ...IDS });
    await request(app).post(STREAM).send({ message: "I had chest pain on my run, move it", ...IDS });

    for (const [, , , , , , options] of vi.mocked(streamChatWithCoachTools).mock.calls) {
      expect(options.chatTools).toEqual({ planChanges: false });
      expect(options.toolset.handoff).toBeUndefined();
      expect(options.toolset.tools.map((tool) => tool.name)).not.toContain("propose_plan_changes");
    }
    expect(streamChatWithCoachTools).toHaveBeenCalledTimes(2);
  });
});
