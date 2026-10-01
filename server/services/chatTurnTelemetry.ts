import type { ChatIntentResult, ChatSafetyNotice, RagInfo } from "@shared/schema";

import type { PlanAdjustmentProposalResult } from "./planAdjustmentService";

/** How a streamed chat turn ended. */
export type ChatTurnOutcome = "prose" | "proposal" | "error" | "aborted";

/** What drafting a proposal came to: its result, or an error. */
export type ChatTurnProposal = PlanAdjustmentProposalResult["kind"] | "error";

/**
 * What the chat route measures about a streamed turn, for its `[chat] turn`
 * log line (AI coach chat review, I23): how long the athlete waited, what the
 * plan-edit gate and classifier decided, which tools the coach called, and how
 * the reply ended. Never any message text.
 */
export interface ChatTurnTelemetry {
  readonly startedAt: number;
  readonly mode: "classic" | "tools";
  /** A retry of a failed reply: the client's Try again. */
  readonly regenerate: boolean;
  contextReadyAt?: number;
  /** When the first reply text was written: the time to first token ends here. */
  firstTextAt?: number;
  /** Classic mode: whether the gate let the message through to the classifier, and its verdict. */
  planEdit?: { readonly gate: "closed" } | { readonly gate: "open"; readonly intent: string; readonly confidence: number };
  /** Tools mode: each tool the coach called, in order. */
  readonly toolCalls: string[];
  proposal?: ChatTurnProposal;
  outcome?: ChatTurnOutcome;
}

export function startChatTurn(mode: ChatTurnTelemetry["mode"], regenerate: boolean, now = Date.now()): ChatTurnTelemetry {
  return { startedAt: now, mode, regenerate, toolCalls: [] };
}

export function markFirstText(turn: ChatTurnTelemetry, now = Date.now()): void {
  turn.firstTextAt ??= now;
}

export function recordClassifierVerdict(turn: ChatTurnTelemetry, verdict: ChatIntentResult): void {
  turn.planEdit = { gate: "open", intent: verdict.intent, confidence: verdict.confidence };
}

/** What the turn's reply carried, as far as the log line needs it. */
interface TurnReply {
  readonly content: string;
  readonly proposalId?: string;
  readonly ragInfo?: RagInfo;
  readonly safetyNotice?: ChatSafetyNotice;
}

const since = (start: number, at: number | undefined) => (at === undefined ? null : at - start);

/** The `[chat] turn` log fields: timings, decisions and sizes, no content. */
export function chatTurnLogFields(turn: ChatTurnTelemetry, reply: TurnReply, now = Date.now()) {
  const { planEdit } = turn;
  return {
    mode: turn.mode,
    outcome: turn.outcome ?? "aborted",
    regenerate: turn.regenerate,
    ttftMs: since(turn.startedAt, turn.firstTextAt),
    contextMs: since(turn.startedAt, turn.contextReadyAt),
    totalMs: now - turn.startedAt,
    ...(planEdit ? { planEditGate: planEdit.gate } : {}),
    ...(planEdit?.gate === "open" ? { planEditIntent: planEdit.intent, planEditConfidence: planEdit.confidence } : {}),
    ...(turn.toolCalls.length > 0 ? { toolCalls: turn.toolCalls } : {}),
    ...(turn.proposal ? { proposal: turn.proposal } : {}),
    ...(reply.proposalId ? { proposalId: reply.proposalId } : {}),
    replyChars: reply.content.length,
    retrieval: reply.ragInfo?.source ?? "none",
    ...(reply.safetyNotice ? { safetyNotice: reply.safetyNotice.level } : {}),
  };
}
