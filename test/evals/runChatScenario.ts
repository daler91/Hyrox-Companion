import { type ChatCallOptions, chatWithCoach, streamChatWithCoachTools } from "../../server/gemini/chatService";
import { analyzeChatSafety } from "../../server/services/aiSafety";
import { chatToolsFor, PROPOSE_PLAN_CHANGES } from "../../server/services/chatTools";
import type { ChatEvalMode, ChatScenario } from "./chatScenarios";
import type { CoachRun } from "./judge";

/** The options the chat route would pass for this scenario. */
function callOptions(scenario: ChatScenario): ChatCallOptions {
  return {
    // The route scans the athlete's own words the same way.
    chatSafety: analyzeChatSafety(scenario.message, scenario.history ?? []),
    focusedWorkout: scenario.focusedWorkout,
    messageNotes: scenario.messageNotes,
    recentPlanChanges: scenario.recentPlanChanges,
  };
}

/** A read tool's result in this scenario: its canned answer, or nothing found. */
function cannedResult(scenario: ChatScenario, name: string): string {
  const canned = new Map(Object.entries(scenario.toolResults ?? {}));
  return JSON.stringify(canned.get(name) ?? { note: "Nothing found for that lookup." });
}

function proposalRequestOf(args: Record<string, unknown>): string {
  return typeof args.request === "string" ? args.request : JSON.stringify(args);
}

async function runWithTools(scenario: ChatScenario, options: ChatCallOptions): Promise<CoachRun> {
  // As the route decides it: no proposal tool after a red-flag symptom.
  const planChanges = !options.chatSafety?.redFlagDetected;
  const calls: string[] = [];
  let reply = "";
  let proposalRequest: string | undefined;
  const stream = streamChatWithCoachTools(scenario.message, [...(scenario.history ?? [])], scenario.context, undefined, undefined, undefined, {
    ...options,
    chatTools: { planChanges },
    toolset: {
      tools: chatToolsFor({ planChanges }),
      run: (call) => {
        calls.push(call.name);
        return Promise.resolve(cannedResult(scenario, call.name));
      },
      ...(planChanges ? { handoff: PROPOSE_PLAN_CHANGES } : {}),
    },
  });
  for await (const event of stream) {
    if (event.type === "text") {
      reply += event.text;
    } else {
      calls.push(event.call.name);
      proposalRequest = proposalRequestOf(event.call.arguments);
    }
  }
  return { reply, calls, proposalRequest };
}

/** Ask the coach, as the chat would in this mode. A blocked or failed reply throws. */
export async function runScenario(scenario: ChatScenario, mode: ChatEvalMode): Promise<CoachRun> {
  const options = callOptions(scenario);
  if (mode === "tools") return runWithTools(scenario, options);
  const reply = await chatWithCoach(scenario.message, [...(scenario.history ?? [])], scenario.context, undefined, undefined, undefined, options);
  return { reply, calls: [] };
}

/** The scenario's tool-call expectations the run missed, as failure lines. */
export function toolCallFailures(scenario: ChatScenario, run: CoachRun): string[] {
  const failures: string[] = [];
  const wanted = scenario.mustCallOneOf ?? [];
  if (wanted.length > 0 && !wanted.some((name) => run.calls.includes(name))) {
    failures.push(`Expected a call to ${wanted.join(" or ")}; the coach called ${run.calls.join(", ") || "nothing"}.`);
  }
  for (const name of scenario.mustNotCall ?? []) {
    if (run.calls.includes(name)) failures.push(`The coach called ${name}, which this scenario forbids.`);
  }
  return failures;
}
