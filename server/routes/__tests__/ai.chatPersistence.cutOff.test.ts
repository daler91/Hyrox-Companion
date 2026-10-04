import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";

import type { PlanAdjustmentProposal } from "@shared/schema";
import type express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { generateJsonText } from "../../ai/providers";
import { streamChatWithCoach } from "../../gemini";
import { buildTrainingContext } from "../../services/ai";
import { applyPlanAdjustmentProposal, createPlanAdjustmentProposal } from "../../services/planAdjustmentService";
import { drainSseStreams } from "../../sseRegistry";
import { storage } from "../../storage";
import aiRouter from "../ai";
import { createTestApp, resetRouteTestState } from "./testUtils";

/**
 * A server-owned chat reply cut off mid-stream, by the athlete leaving (AI10)
 * or by a deploy draining the stream (AI7). ai.chatPersistence.test.ts covers
 * the conversation otherwise.
 */

vi.mock("../../clerkAuth", async () => (await import("./testUtils")).mockClerkAuthModule());
vi.mock("../../types", async () => (await import("./testUtils")).mockTypesModule());

vi.mock("../../storage", () => ({
  storage: {
    users: {
      getUser: vi.fn(() => Promise.resolve({ aiCoachEnabled: true })),
      getChatMessages: vi.fn(() => Promise.resolve([])),
      saveChatMessageOnce: vi.fn(() => Promise.resolve(true)),
    },
    coaching: {
      listCoachingMaterials: vi.fn(() => Promise.resolve([])),
      hasChunksForUser: vi.fn(() => Promise.resolve(false)),
      getStoredEmbeddingDimension: vi.fn(() => Promise.resolve(3072)),
    },
    aiUsage: { getDailyTotalCents: vi.fn(() => Promise.resolve(0)) },
    planProposals: { getByIds: vi.fn(() => Promise.resolve([])), getRecentlyApplied: vi.fn() },
    planDayMoves: { listRecent: vi.fn(() => Promise.resolve([])) },
  },
}));

vi.mock("../../ai/providers", () => ({ generateJsonText: vi.fn() }));
vi.mock("../../gemini", () => ({ streamChatWithCoach: vi.fn() }));

vi.mock("../../services/ai", () => ({ buildTrainingContext: vi.fn() }));
// The chat reads its training context through a per-athlete cache; here it
// builds every time, so one test's context never answers the next.
vi.mock("../../services/trainingContextCache", () => ({
  getCachedTrainingContext: (userId: string, build: (id: string) => Promise<unknown>) => build(userId),
}));
vi.mock("../../services/planAdjustmentService", () => ({
  createPlanAdjustmentProposal: vi.fn(),
  applyPlanAdjustmentProposal: vi.fn(),
}));

const STREAM = "/api/v1/chat/stream";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const REPLY_ID = "22222222-2222-4222-8222-222222222222";
const IDS = { userMessageId: USER_ID, assistantMessageId: REPLY_ID };

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
        response.on("end", () => {
          reject(new Error(`The stream ended before ${until}`));
        });
      },
    );
    clientRequest.on("error", reject);
    clientRequest.end(JSON.stringify(body));
  }).finally(() => server.close());
}

describe("the server-owned chat conversation", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.resetAllMocks();
    await resetRouteTestState();
    app = createTestApp(aiRouter);
    vi.mocked(buildTrainingContext).mockResolvedValue("Training context" as never);
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
        options?.signal?.addEventListener("abort", () => {
          resolve(true);
        }, { once: true });
        setTimeout(() => { // DevSkim: ignore DS172411
          resolve(false);
        }, 500);
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
});
