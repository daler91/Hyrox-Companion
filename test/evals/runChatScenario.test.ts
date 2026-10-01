import { beforeEach, describe, expect, it, vi } from "vitest";

import { chatWithCoach, type CoachStreamEvent, streamChatWithCoachTools } from "../../server/gemini/chatService";
import { CHAT_SCENARIOS, type ChatScenario } from "./chatScenarios";
import { runScenario, toolCallFailures } from "./runChatScenario";

vi.mock("../../server/gemini/chatService", () => ({ chatWithCoach: vi.fn(), streamChatWithCoachTools: vi.fn() }));
vi.mock("../../server/storage", () => ({ storage: {} }));

function scenario(id: string): ChatScenario {
  const found = CHAT_SCENARIOS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`No scenario ${id}`);
  return found;
}

/** The coach streams these events, after running each read call through the scenario's toolset. */
function coachWithTools(reads: string[], events: CoachStreamEvent[]) {
  vi.mocked(streamChatWithCoachTools).mockImplementation(async function* (...args) {
    for (const name of reads) {
      const result = await args[6].toolset.run({ id: `call-${name}`, name, arguments: {} });
      yield { type: "text", text: `[${name}: ${result}] ` };
    }
    for (const event of events) yield event;
  });
}

const toolOptions = () => vi.mocked(streamChatWithCoachTools).mock.calls[0][6];

describe("runScenario", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("asks the classic coach with the options the chat route would pass", async () => {
    vi.mocked(chatWithCoach).mockResolvedValue("It's still on Saturday.");
    const dismissed = scenario("dismissed-proposal");

    const run = await runScenario(dismissed, "classic");

    expect(run).toEqual({ reply: "It's still on Saturday.", calls: [] });
    expect(chatWithCoach).toHaveBeenCalledWith(dismissed.message, dismissed.history, dismissed.context, undefined, undefined, undefined, {
      chatSafety: { redFlagDetected: false, hrMedicationDetected: false },
      focusedWorkout: undefined,
      messageNotes: dismissed.messageNotes,
    });
  });

  it("scans the athlete's words for red flags, as the route does", async () => {
    vi.mocked(chatWithCoach).mockResolvedValue("Please get checked first.");

    await runScenario(scenario("red-flag-chest-pain"), "classic");

    expect(vi.mocked(chatWithCoach).mock.calls[0][6]?.chatSafety?.redFlagDetected).toBe(true);
  });

  it("answers the coach's lookups with the scenario's canned results, and records the calls", async () => {
    coachWithTools(["get_exercise_history", "get_personal_records"], [{ type: "text", text: "100 and 105 kg." }]);

    const run = await runScenario(scenario("tools-exercise-history"), "tools");

    expect(run.calls).toEqual(["get_exercise_history", "get_personal_records"]);
    expect(run.reply).toContain('"date":"2026-07-14","sets":"Back Squat: 5 sets x 5 reps, 100 kg"');
    // A tool the scenario has no answer for finds nothing.
    expect(run.reply).toContain('[get_personal_records: {"note":"Nothing found for that lookup."}]');
    expect(run.reply.endsWith("100 and 105 kg.")).toBe(true);
    expect(toolOptions().chatTools).toEqual({ planChanges: true });
    expect(toolOptions().toolset.handoff).toBe("propose_plan_changes");
  });

  it("records a plan-change call and what it asked for", async () => {
    coachWithTools(
      [],
      [
        { type: "text", text: "Drafting that." },
        { type: "handoff", call: { id: "call-1", name: "propose_plan_changes", arguments: { request: "Move Saturday's long run to Sunday" } } },
      ],
    );

    const run = await runScenario(scenario("yes-please-tools"), "tools");

    expect(run).toEqual({ reply: "Drafting that.", calls: ["propose_plan_changes"], proposalRequest: "Move Saturday's long run to Sunday" });
  });

  it("offers no plan-change tool after a red-flag symptom, as the route does", async () => {
    coachWithTools([], [{ type: "text", text: "Please get checked first." }]);

    await runScenario(scenario("red-flag-chest-pain"), "tools");

    expect(toolOptions().chatTools).toEqual({ planChanges: false });
    expect(toolOptions().toolset.handoff).toBeUndefined();
    expect(toolOptions().toolset.tools.map((tool) => tool.name)).not.toContain("propose_plan_changes");
  });
});

describe("toolCallFailures", () => {
  it("fails a run that missed every expected tool, or called a forbidden one", () => {
    const history = scenario("tools-exercise-history");
    expect(toolCallFailures(history, { reply: "", calls: ["get_workouts"] })).toEqual([]);
    expect(toolCallFailures(history, { reply: "", calls: [] })).toEqual([
      "Expected a call to get_exercise_history or get_workouts; the coach called nothing.",
    ]);

    expect(toolCallFailures(scenario("red-flag-chest-pain"), { reply: "", calls: ["propose_plan_changes"] })).toEqual([
      "The coach called propose_plan_changes, which this scenario forbids.",
    ]);
  });
});
