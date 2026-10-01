import { describe, expect, it } from "vitest";

import { chatTurnLogFields, markFirstText, recordClassifierVerdict, startChatTurn } from "./chatTurnTelemetry";

const T0 = 1_000_000;

describe("the [chat] turn log line", () => {
  it("times the turn from the request: context, first text and the whole reply", () => {
    const turn = startChatTurn("classic", false, T0);
    turn.contextReadyAt = T0 + 120;
    markFirstText(turn, T0 + 900);
    markFirstText(turn, T0 + 1_400);
    turn.outcome = "prose";

    expect(chatTurnLogFields(turn, { content: "Run easy." }, T0 + 3_000)).toEqual({
      mode: "classic",
      outcome: "prose",
      regenerate: false,
      ttftMs: 900,
      contextMs: 120,
      totalMs: 3_000,
      replyChars: 9,
      retrieval: "none",
    });
  });

  it("reports what the plan-edit gate and classifier decided, and the proposal drafted", () => {
    const turn = startChatTurn("classic", true, T0);
    recordClassifierVerdict(turn, { intent: "plan_modification", confidence: 0.92 });
    turn.proposal = "proposal";
    turn.outcome = "proposal";

    expect(
      chatTurnLogFields(turn, {
        content: "Moved your long run.",
        proposalId: "proposal-1",
        ragInfo: { source: "rag", chunkCount: 2 },
        safetyNotice: { level: "caution", message: "Heart-rate zones can be unreliable." },
      }),
    ).toMatchObject({
      regenerate: true,
      planEditGate: "open",
      planEditIntent: "plan_modification",
      planEditConfidence: 0.92,
      proposal: "proposal",
      proposalId: "proposal-1",
      retrieval: "rag",
      safetyNotice: "caution",
    });
  });

  it("lists the tools a coach with tools called, and reads an unfinished turn as aborted", () => {
    const turn = startChatTurn("tools", false, T0);
    turn.toolCalls.push("get_exercise_history", "propose_plan_changes");
    turn.planEdit = { gate: "closed" };

    const fields = chatTurnLogFields(turn, { content: "" }, T0 + 50);

    expect(fields).toMatchObject({ mode: "tools", toolCalls: ["get_exercise_history", "propose_plan_changes"], outcome: "aborted", ttftMs: null });
    expect(fields).toMatchObject({ planEditGate: "closed" });
    expect(fields).not.toHaveProperty("planEditIntent");
  });
});
