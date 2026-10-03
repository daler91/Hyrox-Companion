import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";

import type { ChatMessage, PlanAdjustmentProposal } from "@shared/schema";
import type express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { generateJsonText, generateText } from "../../ai/providers";
import { env } from "../../env";
import { AppError, ErrorCode } from "../../errors";
import { chatWithCoach, type CoachStreamEvent, streamChatWithCoach, streamChatWithCoachTools } from "../../gemini";
import { logger } from "../../logger";
import { withPhotoReading } from "../../prompts/chatPhoto";
import { buildTrainingContext } from "../../services/ai";
import { readChatPhoto } from "../../services/chatPhoto";
import { applyPlanAdjustmentProposal, createPlanAdjustmentProposal } from "../../services/planAdjustmentService";
import { drainSseStreams } from "../../sseRegistry";
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
      setChatMessageFeedback: vi.fn(() => Promise.resolve(true)),
      getPendingChatFactProposal: vi.fn(() => Promise.resolve(null)),
      settleChatFactProposal: vi.fn(() => Promise.resolve(true)),
    },
    athleteFacts: { add: vi.fn() },
    coaching: {
      listCoachingMaterials: vi.fn(() => Promise.resolve([])),
      hasChunksForUser: vi.fn(() => Promise.resolve(false)),
      getStoredEmbeddingDimension: vi.fn(() => Promise.resolve(3072)),
    },
    aiUsage: { getDailyTotalCents: vi.fn(() => Promise.resolve(0)) },
    planProposals: { getByIds: vi.fn(() => Promise.resolve([])), getById: vi.fn(), getRecentlyApplied: vi.fn() },
    planDayMoves: { listRecent: vi.fn(() => Promise.resolve([])) },
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
// The vision call itself is covered in chatPhoto.test.ts; here it is a stand-in.
vi.mock("../../services/chatPhoto", () => ({ readChatPhoto: vi.fn() }));
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
// The first bytes of a JPEG: enough for the request schema's type check.
const PHOTO = { mimeType: "image/jpeg", imageBase64: "/9j/4AAQ" };

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
    feedback: null,
    feedbackAt: null,
    factProposal: null,
    attachment: null,
    ...extra,
  };
}

function streamReply(...chunks: string[]) {
  vi.mocked(streamChatWithCoach).mockImplementation(async function* () {
    for (const chunk of chunks) yield chunk;
  });
}

const savesOnce = () => vi.mocked(storage.users.saveChatMessageOnce).mock.calls.map(([row]) => row);

const parseStreamEvents = (text: string): unknown[] =>
  text
    .split("\n\n")
    .filter(Boolean)
    .map((event) => JSON.parse(event.slice("data: ".length)) as unknown);

/**
 * POST the stream over a real socket and hang up once `until` has arrived, as
 * Stop or a closed tab does: supertest can't leave mid-response.
 */
async function postAndLeave(app: express.Express, body: unknown, until: string): Promise<void> {
  const server = app.listen(0);
  await once(server, "listening");
  try {
    const { port } = server.address() as AddressInfo;
    await new Promise<void>((resolve, reject) => {
      const clientRequest = http.request(
        { port, method: "POST", path: STREAM, headers: { "content-type": "application/json" } },
        (response) => {
          let received = "";
          response.on("error", () => {});
          response.on("data", (chunk: Buffer) => {
            received += chunk.toString();
            if (!received.includes(until)) return;
            clientRequest.destroy();
            resolve();
          });
          response.on("end", () => reject(new Error(`The stream ended before ${until}`)));
        },
      );
      clientRequest.on("error", reject);
      clientRequest.end(JSON.stringify(body));
    });
  } finally {
    server.close();
  }
}

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

  it("streams a proposal's summary as the coach writes it, and sends no part of it twice (I11)", async () => {
    vi.mocked(generateJsonText).mockResolvedValue({
      text: JSON.stringify({ intent: "plan_modification", confidence: 0.95 }),
      model: "fast",
    });
    vi.mocked(createPlanAdjustmentProposal).mockImplementation(async (input) => {
      await input.onSummaryText?.("Moved your long run ");
      await input.onSummaryText?.("to Saturday.");
      return {
        kind: "proposal",
        proposal: { id: "proposal-1", status: "pending", summaryMessage: "Moved your long run to Saturday.", payload: { changes: [] }, createdAt: new Date() } as unknown as PlanAdjustmentProposal,
      };
    });

    const response = await request(app).post(STREAM).send({ message: "Move my long run to Saturday", ...IDS });

    const status = response.text.indexOf('"status":"drafting_plan"');
    expect(status).toBeGreaterThan(-1);
    expect(response.text.indexOf('"text":"Moved your long run "')).toBeGreaterThan(status);
    expect(response.text).toContain('"text":"to Saturday."');
    expect(response.text).not.toContain('"text":"Moved your long run to Saturday."');
    expect(response.text).toContain('"planProposal"');
    expect(savesOnce().at(-1)).toEqual(
      expect.objectContaining({ content: "Moved your long run to Saturday.", kind: "proposal", proposalId: "proposal-1" }),
    );
  });

  it("closes a summary that broke off with an apology, not a second answer under it", async () => {
    vi.mocked(generateJsonText).mockResolvedValue({
      text: JSON.stringify({ intent: "plan_modification", confidence: 0.95 }),
      model: "fast",
    });
    vi.mocked(createPlanAdjustmentProposal).mockImplementation(async (input) => {
      await input.onSummaryText?.("Moved your long run ");
      return { kind: "generation_failed" };
    });

    const response = await request(app).post(STREAM).send({ message: "Move my long run to Saturday", ...IDS });

    expect(streamChatWithCoach).not.toHaveBeenCalled();
    expect(response.text).toContain("I couldn't draft that change just now.");
    expect(response.text).not.toContain('"planProposal":');
    expect(savesOnce().at(-1)).toEqual(
      expect.objectContaining({
        content: "Moved your long run \n\nI couldn't draft that change just now. Ask me again in a moment, or tell me exactly which session to change.",
        kind: "text",
        proposalId: null,
      }),
    );
  });

  it("sends an auto-applied proposal as it now stands, so its card can offer Undo", async () => {
    vi.mocked(storage.users).getUser.mockResolvedValue({ aiCoachEnabled: true, coachAutoApplyPlanChanges: true } as never);
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
    vi.mocked(storage.planProposals).getById.mockResolvedValue({
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
    vi.mocked(storage.users).getUser.mockResolvedValue({ aiCoachEnabled: true, coachAutoApplyPlanChanges: true } as never);
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

  it("stops the reply when the athlete leaves mid-stream, and saves only what reached them (AI10)", async () => {
    let providerCancelled!: (cancelled: boolean) => void;
    const providerOutcome = new Promise<boolean>((resolve) => {
      providerCancelled = resolve;
    });
    vi.mocked(streamChatWithCoach).mockImplementation(async function* (_message, _history, _context, _materials, _chunks, _userId, options) {
      yield "Start with";
      // Thinking until the stream is cancelled; one nobody cancels runs on.
      const cancelled = await new Promise<boolean>((resolve) => {
        options?.signal?.addEventListener("abort", () => resolve(true), { once: true });
        setTimeout(() => resolve(false), 500);
      });
      providerCancelled(cancelled);
      if (cancelled) throw new DOMException("This operation was aborted", "AbortError");
      yield " an easy first lap.";
    });
    const replySaved = new Promise<void>((resolve) => {
      vi.mocked(storage.users.saveChatMessageOnce).mockImplementation(async (row) => {
        if (row.role === "assistant") resolve();
        return true;
      });
    });

    // The body is read in full before the handler runs, as express.json() reads it.
    await postAndLeave(app, { message: "How should I pace a 5k?", ...IDS }, '"text":"Start with"');

    expect(await providerOutcome).toBe(true);
    await replySaved;
    expect(savesOnce().at(-1)).toEqual(expect.objectContaining({ id: REPLY_ID, content: "Start with" }));
  });

  it("applies no plan change the stream was cut off from, and leaves it pending (AI7)", async () => {
    vi.mocked(storage.users).getUser.mockResolvedValue({ aiCoachEnabled: true, coachAutoApplyPlanChanges: true } as never);
    vi.mocked(generateJsonText).mockResolvedValue({
      text: JSON.stringify({ intent: "plan_modification", confidence: 0.95 }),
      model: "fast",
    });
    let draftSignal: AbortSignal | undefined;
    vi.mocked(createPlanAdjustmentProposal).mockImplementation(async (input) => {
      draftSignal = input.signal;
      await input.onSummaryText?.("Moved your long run ");
      // A deploy drains the stream just as the proposal is created.
      await drainSseStreams(0);
      return {
        kind: "proposal",
        proposal: { id: "proposal-1", status: "pending", summaryMessage: "Moved your long run to Saturday.", payload: { changes: [] }, createdAt: new Date() } as unknown as PlanAdjustmentProposal,
      };
    });

    const response = await request(app).post(STREAM).send({ message: "Move my long run to Saturday", ...IDS });

    expect(draftSignal?.aborted).toBe(true);
    expect(applyPlanAdjustmentProposal).not.toHaveBeenCalled();
    expect(response.text).not.toContain('"planProposal"');
    expect(parseStreamEvents(response.text).at(-1)).toEqual({ error: "Stream error" });
    // Its card comes back with the reply, from the history.
    expect(savesOnce().at(-1)).toEqual(
      expect.objectContaining({ content: "Moved your long run ", kind: "proposal", proposalId: "proposal-1" }),
    );
  });

  it("gives the coach the plan changes its proposals made, with the dates before and after", async () => {
    vi.mocked(storage.planProposals.getRecentlyApplied).mockResolvedValue([
      {
        id: "proposal-1",
        status: "applied",
        resolvedAt: new Date(Date.now() - 4 * MINUTE),
        revertedAt: null,
        applyUndo: null,
        payload: {
          changes: [
            {
              planDayId: "day-long",
              updatedFields: { scheduledDate: "2026-10-04" },
              kind: "reschedule",
              baseline: { focus: "Long Run", scheduledDate: "2026-10-05" },
            },
          ],
        },
      } as unknown as PlanAdjustmentProposal,
    ]);
    streamReply("It was on Monday.");

    const response = await request(app).post(STREAM).send({ message: "Where was my long run before?", ...IDS });

    expect(response.status).toBe(200);
    expect(vi.mocked(storage.planProposals.getRecentlyApplied).mock.calls[0][0]).toBe("test_user_id");
    // "today", or "yesterday" in the first minutes after midnight: the day label isn't this test's business.
    expect(vi.mocked(streamChatWithCoach).mock.calls[0][6]?.recentPlanChanges).toContain(
      ", applied: Long Run moved from Monday 2026-10-05 to Sunday 2026-10-04.",
    );
  });

  it("gives the coach the moves the athlete made on the timeline too", async () => {
    vi.mocked(storage.planProposals.getRecentlyApplied).mockResolvedValue([]);
    vi.mocked(storage.planDayMoves).listRecent.mockResolvedValueOnce([
      {
        planDayId: "day-long",
        focus: "Long Run",
        fromDate: "2026-10-03",
        toDate: "2026-10-04",
        kind: "moved",
        movedAt: new Date(Date.now() - 20 * MINUTE),
      },
    ]);
    streamReply("You moved it from Saturday.");

    const response = await request(app).post(STREAM).send({ message: "Put my long run back", ...IDS });

    expect(response.status).toBe(200);
    expect(vi.mocked(storage.planDayMoves).listRecent.mock.calls[0][0]).toBe("test_user_id");
    expect(vi.mocked(streamChatWithCoach).mock.calls[0][6]?.recentPlanChanges).toContain(
      ", moved by the athlete: Long Run moved from Saturday 2026-10-03 to Sunday 2026-10-04.",
    );
  });

  it("reads an attached photo for the coach and keeps what it showed, never the photo", async () => {
    vi.mocked(readChatPhoto).mockResolvedValueOnce("Watch summary: 10 km in 45:12.");
    streamReply("Nice even pacing.");

    const response = await request(app).post(STREAM).send({ message: "How was my pacing?", photo: PHOTO, ...IDS });

    expect(response.status).toBe(200);
    expect(readChatPhoto).toHaveBeenCalledWith(PHOTO, "test_user_id");
    // The athlete's words, then what the photo showed, as withPhotoReading writes it.
    expect(vi.mocked(streamChatWithCoach).mock.calls[0][0]).toBe(
      withPhotoReading("How was my pacing?", "Watch summary: 10 km in 45:12."),
    );
    expect(savesOnce()[0]).toEqual(
      expect.objectContaining({
        role: "user",
        content: "How was my pacing?",
        attachment: { kind: "photo", reading: "Watch summary: 10 km in 45:12." },
      }),
    );
    expect(JSON.stringify(savesOnce())).not.toContain(PHOTO.imageBase64);
  });

  it("refuses the send, saving nothing, when the photo can't be read", async () => {
    vi.mocked(readChatPhoto).mockRejectedValueOnce(
      new AppError(ErrorCode.CHAT_PHOTO_UNREADABLE, "Couldn't read that photo. Try again, or say what it shows.", 502),
    );

    const response = await request(app).post(STREAM).send({ message: "How was my pacing?", photo: PHOTO, ...IDS });

    expect(response.status).toBe(502);
    expect(response.body).toMatchObject({ code: "CHAT_PHOTO_UNREADABLE" });
    expect(storage.users.saveChatMessageOnce).not.toHaveBeenCalled();
    expect(streamChatWithCoach).not.toHaveBeenCalled();
  });

  it("refuses a photo whose bytes aren't the image type it claims, before reading it", async () => {
    const response = await request(app)
      .post(STREAM)
      .send({ message: "Look", photo: { mimeType: "image/png", imageBase64: PHOTO.imageBase64 }, ...IDS });

    expect(response.status).toBe(400);
    expect(readChatPhoto).not.toHaveBeenCalled();
  });

  it("counts a red flag in what the photo showed as one the athlete typed: the notice, the guidance, no plan change", async () => {
    vi.mocked(readChatPhoto).mockResolvedValueOnce("A training diary page: chest pain on Tuesday's run.");
    vi.mocked(generateJsonText).mockResolvedValue({
      text: JSON.stringify({ intent: "plan_modification", confidence: 0.95 }),
      model: "fast",
    });
    streamReply("Please get that checked first.");

    const response = await request(app).post(STREAM).send({ message: "Move my long run to Saturday", photo: PHOTO, ...IDS });

    expect(response.text).toContain('"safetyNotice":{"level":"urgent"');
    expect(vi.mocked(streamChatWithCoach).mock.calls[0][6]?.chatSafety).toEqual({ redFlagDetected: true, hrMedicationDetected: false });
    expect(createPlanAdjustmentProposal).not.toHaveBeenCalled();
  });

  it("scans what the photo showed for a non-streamed reply too", async () => {
    vi.mocked(readChatPhoto).mockResolvedValueOnce("A pill box: bisoprolol 5 mg.");
    vi.mocked(chatWithCoach).mockResolvedValue("Go by effort for now.");

    const response = await request(app).post("/api/v1/chat").send({ message: "Can I train on these?", photo: PHOTO, ...IDS });

    expect(response.body.safetyNotice).toEqual(expect.objectContaining({ level: "caution" }));
    expect(vi.mocked(chatWithCoach).mock.calls[0][6]?.chatSafety).toEqual({ redFlagDetected: false, hrMedicationDetected: true });
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
    vi.mocked(storage.users).getChatMessages.mockResolvedValue(
      Array.from({ length: 31 }, (_, i) => savedRow(i % 2 === 0 ? "user" : "assistant", `turn ${i + 1}`, 40 - i)),
    );
    vi.mocked(generateText).mockResolvedValue({ text: "- The athlete asked about pacing.", model: "fast" });
    streamReply("Sure.");

    const response = await request(app).post(STREAM).send({ message: "And the sled?", ...IDS });

    expect(response.status).toBe(200);
    expect(vi.mocked(streamChatWithCoach).mock.calls[0][1]).toHaveLength(20);
    expect(vi.mocked(streamChatWithCoach).mock.calls[0][6]?.earlierInSession).toBe("- The athlete asked about pacing.");
    expect(vi.mocked(storage.users).saveChatMessage.mock.calls).toContainEqual([expect.objectContaining({ kind: "rolling" })]);
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

    expect(vi.mocked(storage.analytics).getExerciseSetsForPersonalRecords.mock.calls).toContainEqual([
      "test_user_id",
      undefined,
      undefined,
      { onlyTraining: true },
    ]);
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
    expect(response.text).toContain('"status":"drafting_plan"');
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

  it("names each lookup while it runs, then goes back to thinking (I11)", async () => {
    vi.mocked(streamChatWithCoachTools).mockImplementation(async function* (...args) {
      yield { type: "text", text: "Let me look. " };
      await args[6].toolset.run({ id: "call-1", name: "get_workouts", arguments: { from: "2026-09-01", to: "2026-09-30" } });
      yield { type: "text", text: "You trained 12 times." };
    });

    const response = await request(app).post(STREAM).send({ message: "How much did I train in September?", ...IDS });

    const lookup = response.text.indexOf('"status":"looking_up_workouts"');
    expect(lookup).toBeGreaterThan(response.text.indexOf('"text":"Let me look. "'));
    expect(response.text.indexOf('"status":"thinking"')).toBeGreaterThan(lookup);
    expect(response.text.indexOf('"text":"You trained 12 times."')).toBeGreaterThan(response.text.indexOf('"status":"thinking"'));
  });

  it("streams the proposal's summary after what the coach already said", async () => {
    coachSays({ type: "text", text: "Good call." }, handoff("Move Sunday's long run to Saturday"));
    vi.mocked(createPlanAdjustmentProposal).mockImplementation(async (input) => {
      await input.onSummaryText?.("Moved your long run ");
      await input.onSummaryText?.("to Saturday.");
      return { kind: "proposal", proposal: PROPOSAL };
    });

    const response = await request(app).post(STREAM).send({ message: "Yes, do that", ...IDS });

    expect(response.text).toContain('"text":"\\n\\nMoved your long run "');
    expect(response.text).toContain('"text":"to Saturday."');
    expect(savesOnce().at(-1)).toEqual(
      expect.objectContaining({ content: "Good call.\n\nMoved your long run to Saturday.", kind: "proposal" }),
    );
  });

  it("still shows a drafted proposal when auto-apply fails", async () => {
    vi.mocked(storage.users).getUser.mockResolvedValue({ aiCoachEnabled: true, coachAutoApplyPlanChanges: true } as never);
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

describe("rating a coach reply (I23)", () => {
  let app: express.Express;
  const RATE = `/api/v1/chat/messages/${REPLY_ID}`;

  beforeEach(async () => {
    vi.resetAllMocks();
    await resetRouteTestState();
    app = createTestApp(aiRouter);
  });

  it("saves the athlete's thumbs on their reply, and clears it with null", async () => {
    const up = await request(app).patch(RATE).send({ feedback: "up" });
    const cleared = await request(app).patch(RATE).send({ feedback: null });

    expect(up.status).toBe(200);
    expect(up.body).toEqual({ id: REPLY_ID, feedback: "up" });
    expect(cleared.body).toEqual({ id: REPLY_ID, feedback: null });
    expect(vi.mocked(storage.users.setChatMessageFeedback).mock.calls).toEqual([
      ["test_user_id", REPLY_ID, "up"],
      ["test_user_id", REPLY_ID, null],
    ]);
  });

  it("finds nothing to rate outside the athlete's own coach replies", async () => {
    vi.mocked(storage.users.setChatMessageFeedback).mockResolvedValue(false);

    const response = await request(app).patch(RATE).send({ feedback: "down" });

    expect(response.status).toBe(404);
  });

  it("accepts only up, down or null", async () => {
    const response = await request(app).patch(RATE).send({ feedback: "meh" });

    expect(response.status).toBe(400);
    expect(storage.users.setChatMessageFeedback).not.toHaveBeenCalled();
  });
});

describe("a lasting fact the athlete states in chat (I5b)", () => {
  let app: express.Express;
  const KNEE = "My left knee is bad, deep lunges hurt.";
  const OFFER = { fact: "Bad left knee: deep lunges hurt", category: "constraint", status: "pending" };

  beforeEach(async () => {
    vi.resetAllMocks();
    await resetRouteTestState();
    app = createTestApp(aiRouter);
    vi.mocked(buildTrainingContext).mockResolvedValue({ athleteFacts: [] } as never);
    vi.mocked(generateJsonText).mockResolvedValue({
      text: JSON.stringify({ fact: OFFER.fact, category: OFFER.category }),
    } as never);
  });

  it("is offered for the card as the reply's last event, and saved with the reply", async () => {
    streamReply("Noted: ", "we'll keep lunges shallow.");

    const response = await request(app).post(STREAM).send({ message: KNEE, ...IDS });

    expect(response.status).toBe(200);
    const offer = response.text.indexOf(`data: ${JSON.stringify({ factProposal: OFFER })}`);
    expect(offer).toBeGreaterThan(response.text.indexOf("lunges shallow"));
    expect(offer).toBeLessThan(response.text.indexOf('"done":true'));
    expect(savesOnce()).toContainEqual(expect.objectContaining({ id: REPLY_ID, role: "assistant", factProposal: OFFER }));
  });

  it("is not offered when the card already holds it", async () => {
    vi.mocked(buildTrainingContext).mockResolvedValue({
      athleteFacts: [{ fact: "bad left knee: deep lunges hurt.", category: "constraint", reviewOn: "2026-12-30" }],
    } as never);
    streamReply("Noted.");

    const response = await request(app).post(STREAM).send({ message: KNEE, ...IDS });

    expect(response.text).not.toContain("factProposal");
    expect(savesOnce()).toContainEqual(expect.objectContaining({ role: "assistant", factProposal: null }));
  });

  it("is never read for after a red-flag symptom", async () => {
    streamReply("Please stop and get checked.");

    const response = await request(app).post(STREAM).send({ message: "Chest pain and my knee gave out", ...IDS });

    expect(response.text).not.toContain("factProposal");
    expect(generateJsonText).not.toHaveBeenCalled();
  });
});

describe("answering a fact the coach offered (I5b)", () => {
  let app: express.Express;
  const DECIDE = `/api/v1/chat/messages/${REPLY_ID}/fact`;
  const PENDING = { fact: "No sled at my gym", category: "equipment" as const, status: "pending" as const };

  beforeEach(async () => {
    vi.resetAllMocks();
    await resetRouteTestState();
    app = createTestApp(aiRouter);
    vi.mocked(storage.users.getPendingChatFactProposal).mockResolvedValue(PENDING);
    vi.mocked(storage.users).getUser.mockResolvedValue({ aiCoachEnabled: true, userTimezone: "UTC" } as never);
  });

  it("saves it to the card and marks it saved", async () => {
    const fact = { id: "fact-1", fact: PENDING.fact, category: PENDING.category, source: "chat", active: true };
    vi.mocked(storage.athleteFacts.add).mockResolvedValue({ ok: true, fact, created: true } as never);

    const response = await request(app).post(DECIDE).send({ decision: "save" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ factProposal: { ...PENDING, status: "saved" }, fact });
    expect(storage.users.settleChatFactProposal).toHaveBeenCalledWith("test_user_id", REPLY_ID, "saved");
  });

  it("says the card is full, and leaves the offer waiting", async () => {
    vi.mocked(storage.athleteFacts.add).mockResolvedValue({ ok: false, reason: "limit" });

    const response = await request(app).post(DECIDE).send({ decision: "save" });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: "ATHLETE_FACT_LIMIT" });
    expect(storage.users.settleChatFactProposal).not.toHaveBeenCalled();
  });

  it("turns it down, finds nothing on a reply without an offer, and takes only save or dismiss", async () => {
    const dismissed = await request(app).post(DECIDE).send({ decision: "dismiss" });
    expect(dismissed.body).toEqual({ factProposal: { ...PENDING, status: "dismissed" } });

    vi.mocked(storage.users.getPendingChatFactProposal).mockResolvedValue(null);
    expect((await request(app).post(DECIDE).send({ decision: "save" })).status).toBe(404);
    expect((await request(app).post(DECIDE).send({ decision: "maybe" })).status).toBe(400);
    expect(storage.athleteFacts.add).not.toHaveBeenCalled();
  });
});

describe("the [chat] turn log line (I23)", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.resetAllMocks();
    await resetRouteTestState();
    app = createTestApp(aiRouter);
    vi.mocked(buildTrainingContext).mockResolvedValue({ currentDate: "2026-10-01" } as never);
  });

  afterEach(() => {
    env.AI_CHAT_TOOLS = "false";
    vi.restoreAllMocks();
  });

  /** The fields of the turn's log line. */
  function turnLog(info: { mock: { calls: unknown[][] } }): Record<string, unknown> {
    const call = info.mock.calls.find((args) => args[1] === "[chat] turn");
    if (!call) throw new Error("No [chat] turn log line");
    return call[0] as Record<string, unknown>;
  }

  it("reports a classified plan change, its proposal, a regenerate and the timings, without the text", async () => {
    const info = vi.spyOn(logger, "info");
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

    await request(app).post(STREAM).send({ message: "Move my long run to Saturday", ...IDS, replaceAssistantId: FAILED_REPLY_ID });

    const fields = turnLog(info);
    expect(fields).toMatchObject({
      userId: "test_user_id",
      mode: "classic",
      outcome: "proposal",
      regenerate: true,
      planEditGate: "open",
      planEditIntent: "plan_modification",
      planEditConfidence: 0.95,
      proposal: "proposal",
      proposalId: "proposal-1",
      replyChars: "Moved your long run to Saturday.".length,
    });
    expect(fields.ttftMs).toEqual(expect.any(Number));
    expect(JSON.stringify(fields)).not.toContain("long run");
  });

  it("reports a closed gate on a plain question", async () => {
    const info = vi.spyOn(logger, "info");
    streamReply("Even splits.");

    await request(app).post(STREAM).send({ message: "How should I pace a 5k?", ...IDS });

    expect(turnLog(info)).toMatchObject({ mode: "classic", outcome: "prose", planEditGate: "closed", regenerate: false });
    expect(generateJsonText).not.toHaveBeenCalled();
  });

  it("lists the tools a coach with tools called", async () => {
    env.AI_CHAT_TOOLS = "true";
    const info = vi.spyOn(logger, "info");
    vi.mocked(streamChatWithCoachTools).mockImplementation(async function* (...args) {
      await args[6].toolset.run({ id: "call-1", name: "get_personal_records", arguments: {} });
      yield { type: "text", text: "Your bests." };
    });

    await request(app).post(STREAM).send({ message: "What are my PRs?", ...IDS });

    expect(turnLog(info)).toMatchObject({ mode: "tools", outcome: "prose", toolCalls: ["get_personal_records"] });
    expect(turnLog(info)).not.toHaveProperty("planEditGate");
  });
});
