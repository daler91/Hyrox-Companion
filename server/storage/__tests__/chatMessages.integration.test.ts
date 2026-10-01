import { planAdjustmentProposals, trainingPlans } from "@shared/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "../../db";
import { storage } from "../index";
import { resetIntegrationDb, seedUser } from "./integrationDb";

/**
 * The server-owned chat conversation against the REAL schema: a message saved
 * once under its client id, a failed reply deleted for its owner only, a
 * reply's metadata columns, the kind and feedback CHECKs, the athlete's
 * rating, and the proposal link that unlinks rather than deletes. The route and service tests mock all of this.
 */
describe("chat messages and their proposals (real Postgres)", () => {
  const ALICE = "chat-alice";
  const BOB = "chat-bob";
  const MESSAGE_ID = "4f1c8a2e-5b7d-4e0a-9c3f-1a2b3c4d5e6f";

  beforeEach(async () => {
    await resetIntegrationDb();
    await seedUser(ALICE);
    await seedUser(BOB);
  });

  afterAll(async () => {
    await resetIntegrationDb();
  });

  it("saves a message under its client id once, keeping its timestamp", async () => {
    const message = {
      id: MESSAGE_ID,
      userId: ALICE,
      role: "user",
      content: "How was Tuesday?",
      kind: "text",
      timestamp: new Date("2026-10-01T10:00:00Z"),
    };

    expect(await storage.users.saveChatMessageOnce(message)).toBe(true);
    expect(await storage.users.saveChatMessageOnce({ ...message, content: "the retry" })).toBe(false);

    const rows = await storage.users.getChatMessages(ALICE);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: MESSAGE_ID, content: "How was Tuesday?", kind: "text" });
    expect(rows[0].timestamp?.toISOString()).toBe("2026-10-01T10:00:00.000Z");
  });

  it("never writes over another athlete's message that has the same id", async () => {
    await storage.users.saveChatMessageOnce({ id: MESSAGE_ID, userId: ALICE, role: "user", content: "mine" });

    expect(await storage.users.saveChatMessageOnce({ id: MESSAGE_ID, userId: BOB, role: "user", content: "bob's" })).toBe(false);
    expect(await storage.users.getChatMessages(BOB)).toEqual([]);
    expect((await storage.users.getChatMessages(ALICE))[0].content).toBe("mine");
  });

  it("deletes only the athlete's own coach replies", async () => {
    const reply = await storage.users.saveChatMessage({ userId: ALICE, role: "assistant", content: "partial" });
    const question = await storage.users.saveChatMessage({ userId: ALICE, role: "user", content: "question" });

    await storage.users.deleteAssistantChatMessage(BOB, reply.id);
    await storage.users.deleteAssistantChatMessage(ALICE, question.id);
    expect((await storage.users.getChatMessages(ALICE)).map((row) => row.id).sort()).toEqual([question.id, reply.id].sort());

    await storage.users.deleteAssistantChatMessage(ALICE, reply.id);
    expect((await storage.users.getChatMessages(ALICE)).map((row) => row.id)).toEqual([question.id]);
  });

  it("keeps a reply's metadata, and refuses a kind it doesn't know", async () => {
    await storage.users.saveChatMessage({
      userId: ALICE,
      role: "assistant",
      content: "Guide it by RPE.",
      safetyNotice: { level: "caution", message: "Heart-rate zones can be unreliable." },
      ragInfo: { source: "rag", chunkCount: 2, sources: ["Pacing notes"] },
      focusPlanDayId: "day-1",
    });

    const [row] = await storage.users.getChatMessages(ALICE);
    expect(row).toMatchObject({
      kind: "text",
      safetyNotice: { level: "caution", message: "Heart-rate zones can be unreliable." },
      ragInfo: { source: "rag", chunkCount: 2, sources: ["Pacing notes"] },
      focusPlanDayId: "day-1",
      focusWorkoutLogId: null,
    });
    await expect(
      storage.users.saveChatMessage({ userId: ALICE, role: "assistant", content: "x", kind: "bogus" }),
    ).rejects.toThrow();
    // A long session's rolling note (migration 0113).
    await expect(
      storage.users.saveChatMessage({ userId: ALICE, role: "assistant", content: "- note", kind: "rolling" }),
    ).resolves.toMatchObject({ kind: "rolling" });
  });

  it("rates only the athlete's own visible coach replies, and refuses a rating it doesn't know", async () => {
    const reply = await storage.users.saveChatMessage({ userId: ALICE, role: "assistant", content: "Easy today." });
    const question = await storage.users.saveChatMessage({ userId: ALICE, role: "user", content: "Today?" });
    const summary = await storage.users.saveChatMessage({ userId: ALICE, role: "assistant", content: "- notes", kind: "summary" });

    expect(await storage.users.setChatMessageFeedback(BOB, reply.id, "down")).toBe(false);
    expect(await storage.users.setChatMessageFeedback(ALICE, question.id, "up")).toBe(false);
    expect(await storage.users.setChatMessageFeedback(ALICE, summary.id, "up")).toBe(false);
    expect(await storage.users.setChatMessageFeedback(ALICE, reply.id, "up")).toBe(true);

    const rated = (await storage.users.getChatMessages(ALICE)).find((row) => row.id === reply.id);
    expect(rated?.feedback).toBe("up");
    expect(rated?.feedbackAt).toBeInstanceOf(Date);

    expect(await storage.users.setChatMessageFeedback(ALICE, reply.id, null)).toBe(true);
    const cleared = (await storage.users.getChatMessages(ALICE)).find((row) => row.id === reply.id);
    expect(cleared).toMatchObject({ feedback: null, feedbackAt: null });

    await expect(
      storage.users.saveChatMessage({ userId: ALICE, role: "assistant", content: "x", feedback: "meh" }),
    ).rejects.toThrow();
  });

  it("keeps each workout's conversation in its own thread", async () => {
    const at = (minute: number) => new Date(`2026-10-01T10:${String(minute).padStart(2, "0")}:00Z`);
    await storage.users.saveChatMessage({ userId: ALICE, role: "user", content: "general", timestamp: at(0) });
    await storage.users.saveChatMessage({ userId: ALICE, role: "user", content: "planned day", timestamp: at(1), focusPlanDayId: "day-1" });
    await storage.users.saveChatMessage({
      userId: ALICE,
      role: "user",
      content: "same day, logged",
      timestamp: at(2),
      focusPlanDayId: "day-1",
      focusWorkoutLogId: "log-1",
    });
    await storage.users.saveChatMessage({ userId: ALICE, role: "user", content: "ad-hoc log", timestamp: at(3), focusWorkoutLogId: "log-2" });

    const contents = async (thread?: { planDayId?: string; workoutLogId?: string }) =>
      (await storage.users.getChatMessages(ALICE, { thread })).map((row) => row.content);

    expect(await contents({})).toEqual(["general"]);
    expect(await contents({ planDayId: "day-1" })).toEqual(["planned day", "same day, logged"]);
    // Once logged, the day's thread is found by either id.
    expect(await contents({ planDayId: "day-1", workoutLogId: "log-1" })).toEqual(["planned day", "same day, logged"]);
    expect(await contents({ workoutLogId: "log-2" })).toEqual(["ad-hoc log"]);
    expect(await contents()).toHaveLength(4);
  });

  it("reads proposals by id for their owner only, and unlinks a deleted proposal from its reply", async () => {
    const [plan] = await db
      .insert(trainingPlans)
      .values({ userId: ALICE, name: "Block", totalWeeks: 8, startDate: "2026-08-03", endDate: "2026-09-27" })
      .returning();
    const proposal = await storage.planProposals.create({
      userId: ALICE,
      planId: plan.id,
      summaryMessage: "Moved your long run to Saturday.",
      userRequest: "move my long run",
      payload: { changes: [] },
    });
    await storage.users.saveChatMessage({
      userId: ALICE,
      role: "assistant",
      content: "Moved your long run to Saturday.",
      kind: "proposal",
      proposalId: proposal.id,
    });

    expect((await storage.planProposals.getByIds([proposal.id], ALICE)).map((row) => row.id)).toEqual([proposal.id]);
    expect(await storage.planProposals.getByIds([proposal.id], BOB)).toEqual([]);
    expect(await storage.planProposals.getByIds([], ALICE)).toEqual([]);

    await db.delete(planAdjustmentProposals).where(eq(planAdjustmentProposals.id, proposal.id));
    const [reply] = await storage.users.getChatMessages(ALICE);
    expect(reply).toMatchObject({ kind: "proposal", proposalId: null, content: "Moved your long run to Saturday." });
  });
});
