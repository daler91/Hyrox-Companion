import { getAuth } from "@clerk/express";
import { ATHLETE_FACT_LIMIT_MESSAGE } from "@shared/athleteFacts";
import type { ChatStatusStep } from "@shared/chat";
import { type ChatFactDecisionBody, chatFactDecisionSchema, type ChatIntentResult, type ChatMessage, type ChatMessageBody, type ChatMessageFeedbackBody, chatMessageFeedbackSchema, chatRequestSchema, insertChatMessageSchema, type OverviewAnalysisResult, parseExercisesFromImageRequestSchema, parseExercisesRequestSchema, type PlanAdjustmentProposal } from "@shared/schema";
import { type Request as ExpressRequest, type Response,Router } from "express";
import { z } from "zod";

import type { TextAiToolCall } from "../ai/providers";
import { isAuthenticated } from "../clerkAuth";
import { env } from "../env";
import { ErrorCode } from "../errors";
import { type ChatCallOptions, chatWithCoach, type CoachToolset, parseExercisesFromImage, parseExercisesFromText, parseWorkoutStructureFromImage, parseWorkoutStructureFromText,streamChatWithCoach, streamChatWithCoachTools } from "../gemini/index";
import { reqLogger } from "../logger";
import { aiBudgetCheck } from "../middleware/aibudget";
import { aiConsentCheck } from "../middleware/aiConsent";
import { formatFocusedWorkout } from "../prompts/focusedWorkoutContext";
import { asyncHandler, rateLimiter, sendNotFound, validateBody, validateQuery } from "../routeUtils";
import { type AIContext, buildAIContext, type ChatInput } from "../services/aiContextService";
import { analyzeChatSafety, buildChatSafetyNotice, type ChatSafetySignals } from "../services/aiSafety";
import { applyTimelineAiSuggestion, generateTimelineAiSuggestions } from "../services/aiSuggestionService";
import { computeStale, getWorkoutAnchor, regenerateAndStoreCoachInsights, regenerateAndStoreOverviewAnalysis } from "../services/analyticsPersistence";
import { type CoachReply, type Conversation, type ConversationTurn, loadConversation, saveCoachReply, saveUserTurn, type ServerOwnedTurn, serverOwnedTurn, type TurnFocus } from "../services/chatConversation";
import { decideChatFactProposal, type FactCandidate, settleFactProposal, startFactProposal } from "../services/chatFactProposal";
import { classifyPlanEditIntent, isPlanEditIntent, mayRequestPlanEdit } from "../services/chatIntentService";
import { chatRetrievalQuery } from "../services/chatRetrievalQuery";
import { type ChatToolContext, chatToolsFor, chatToolStatus, PROPOSE_PLAN_CHANGES, runChatTool } from "../services/chatTools";
import { chatTurnLogFields, type ChatTurnTelemetry, markFirstText, recordClassifierVerdict, startChatTurn } from "../services/chatTurnTelemetry";
import type { CoachInsightsResult } from "../services/coachInsightsService";
import { getCoachWelcome } from "../services/coachWelcome";
import { loadFocusedWorkout } from "../services/focusedWorkoutService";
import { applyPlanAdjustmentProposal, createPlanAdjustmentProposal } from "../services/planAdjustmentService";
import { sanitizeRagInfo } from "../services/ragRetrieval";
import { registerSseStream } from "../sseRegistry";
import { storage } from "../storage";
import { getLocalDateStrSafe } from "../timezone";
import { getUserId } from "../types";
import { getChatHistoryUseCase } from "../usecases/ai/chatHistory.usecase";
import { protectedDelete, protectedPatch, protectedPost } from "./_helpers/protectedRouteBuilder";
import { serializePlanProposal } from "./planProposals";

const router = Router();

const applyTimelineSuggestionSchema = z.object({
  workoutId: z.string().min(1),
  targetField: z.enum(["notes", "mainWorkout", "accessory"]),
  action: z.enum(["replace", "append"]),
  recommendation: z.string().min(1).max(10_000),
  rationale: z.string().max(2_000).nullable().optional(),
  aiSource: z.enum(["rag", "legacy", "none"]).nullable().optional(),
});

async function loadParseUserContext(req: ExpressRequest) {
  const userId = getUserId(req);
  const [user, userCustomExercises] = await Promise.all([
    storage.users.getUser(userId),
    storage.users.getCustomExercises(userId),
  ]);

  return {
    userId,
    unitPreferences: { weightUnit: user?.weightUnit || "kg", distanceUnit: user?.distanceUnit || "km" },
    customExerciseNames: userCustomExercises.map((exercise) => exercise.name),
  };
}

protectedPost(router, "/api/v1/parse-exercises", { limiter: rateLimiter("parse", 5), middleware: [aiConsentCheck, aiBudgetCheck, validateBody(parseExercisesRequestSchema)] }, async (req: ExpressRequest<Record<string, never>, unknown, z.infer<typeof parseExercisesRequestSchema>>, res: Response) => {
    const { text } = req.body;
    const { userId, unitPreferences, customExerciseNames } = await loadParseUserContext(req);
    const exercises = await parseExercisesFromText(text.trim(), unitPreferences, customExerciseNames, userId);
    res.json(exercises);
  });

protectedPost(router, "/api/v1/parse-workout-structure", { limiter: rateLimiter("parse", 5), middleware: [aiConsentCheck, aiBudgetCheck, validateBody(parseExercisesRequestSchema)] }, async (req: ExpressRequest<Record<string, never>, unknown, z.infer<typeof parseExercisesRequestSchema>>, res: Response) => {
    const { text } = req.body;
    const { userId, unitPreferences, customExerciseNames } = await loadParseUserContext(req);
    const parsed = await parseWorkoutStructureFromText(text.trim(), unitPreferences, customExerciseNames, userId);
    res.json(parsed);
  });

// Photo-parse sibling. Shares the "parse" rate bucket and AI-budget gates
// with the text route so total parse-family spend stays capped per user.
// Body size is enforced by a route-scoped express.json({ limit: "10mb" })
// mounted in server/index.ts BEFORE the global 100kb parser.
protectedPost(router, "/api/v1/parse-exercises-from-image", { limiter: rateLimiter("parse", 5), middleware: [aiConsentCheck, aiBudgetCheck, validateBody(parseExercisesFromImageRequestSchema)] }, async (req: ExpressRequest<Record<string, never>, unknown, z.infer<typeof parseExercisesFromImageRequestSchema>>, res: Response) => {
    const { imageBase64, mimeType } = req.body;
    const { userId, unitPreferences, customExerciseNames } = await loadParseUserContext(req);
    const exercises = await parseExercisesFromImage({
      imageBase64,
      mimeType,
      ...unitPreferences,
      customExerciseNames,
      userId,
    });
    res.json(exercises);
  });

protectedPost(router, "/api/v1/parse-workout-structure-from-image", { limiter: rateLimiter("parse", 5), middleware: [aiConsentCheck, aiBudgetCheck, validateBody(parseExercisesFromImageRequestSchema)] }, async (req: ExpressRequest<Record<string, never>, unknown, z.infer<typeof parseExercisesFromImageRequestSchema>>, res: Response) => {
    const { imageBase64, mimeType } = req.body;
    const { userId, unitPreferences, customExerciseNames } = await loadParseUserContext(req);
    const parsed = await parseWorkoutStructureFromImage({
      imageBase64,
      mimeType,
      ...unitPreferences,
      customExerciseNames,
      userId,
    });
    res.json(parsed);
  });

/** The per-message parts of the coach's prompt: the open workout, the earlier sessions, the notes on the new message. */
type ChatPromptOptions = Pick<ChatCallOptions, "focusedWorkout" | "earlierConversation" | "earlierInSession" | "messageNotes">;

// validateBody(chatRequestSchema) guarantees req.body conforms, so the
// handler can read it directly without a second safeParse pass.
async function prepareChatContext(
  req: ExpressRequest<Record<string, never>, unknown, z.infer<typeof chatRequestSchema>>,
  conversation: Conversation,
): Promise<{ input: ChatInput; aiContext: AIContext; promptOptions: ChatPromptOptions }> {
  const { message, focusPlanDayId, focusWorkoutLogId } = req.body;
  const userId = getUserId(req);
  const history = conversation.turns;
  // The first message after a break writes the earlier sessions' summary;
  // it runs alongside the context build rather than in front of it.
  const [aiContext, focused, earlierConversation, earlierInSession] = await Promise.all([
    buildAIContext(userId, chatRetrievalQuery(message, history), reqLogger(req), { cachedTrainingContext: true }),
    loadFocusedWorkout(userId, { planDayId: focusPlanDayId, workoutLogId: focusWorkoutLogId }),
    conversation.earlier,
    conversation.earlierInSession,
  ]);
  const { trainingContext } = aiContext;
  const focusedWorkout = focused
    ? formatFocusedWorkout(focused, {
        weightUnit: trainingContext?.weightUnit,
        distanceUnit: trainingContext?.distanceUnit,
        currentDate: trainingContext?.currentDate,
      })
    : undefined;
  return {
    input: { message, history },
    aiContext,
    promptOptions: {
      focusedWorkout,
      earlierConversation,
      earlierInSession,
      ...(conversation.notes.length > 0 ? { messageNotes: conversation.notes } : {}),
    },
  };
}

function turnFocus(body: z.infer<typeof chatRequestSchema>): TurnFocus {
  return { focusPlanDayId: body.focusPlanDayId, focusWorkoutLogId: body.focusWorkoutLogId };
}

/**
 * What the coach reads: the saved conversation when the server owns the turn,
 * else the history the client sent (an old client, open across a deploy).
 */
function conversationFor(
  userId: string,
  turn: ServerOwnedTurn | null,
  body: z.infer<typeof chatRequestSchema>,
): Promise<Conversation> | Conversation {
  if (turn) return loadConversation(userId, turn, turnFocus(body));
  return { turns: body.history, notes: [] };
}

protectedPost(router, "/api/v1/chat", { limiter: rateLimiter("chat", 10), middleware: [aiConsentCheck, aiBudgetCheck, validateBody(chatRequestSchema)] }, async (req: ExpressRequest<Record<string, never>, unknown, z.infer<typeof chatRequestSchema>>, res: Response) => {
    const userId = getUserId(req);
    const turn = serverOwnedTurn(req.body);
    const conversation = await conversationFor(userId, turn, req.body);
    const chatSafety = analyzeChatSafety(req.body.message, conversation.turns);
    const { input, aiContext, promptOptions } = await prepareChatContext(req, conversation);
    const acceptedAt = new Date();
    const response = await chatWithCoach(input.message, input.history, aiContext.trainingContext, aiContext.coachingMaterials, aiContext.retrievedChunks, userId, { chatSafety, ...promptOptions });
    const safetyNotice = buildChatSafetyNotice(chatSafety);
    if (turn) {
      // Both turns once the reply exists: a failed request leaves nothing behind.
      const focus = turnFocus(req.body);
      await saveUserTurn(userId, turn, input.message, focus, acceptedAt);
      await saveCoachReply(userId, turn, { content: response, ragInfo: aiContext.ragInfo, safetyNotice: safetyNotice ?? undefined }, focus);
    }
    res.json({ response, ragInfo: sanitizeRagInfo(aiContext.ragInfo), ...(safetyNotice ? { safetyNotice } : {}) });
  });

// Belt-and-suspenders ceiling for SSE stream duration. Both caps fire
// via controller.abort() so the existing drain/finally path runs cleanly:
//   - SSE_MAX_DURATION_MS: hard wall-clock cap, applies even when the JWT
//     has hours of headroom (prevents runaway AI generation on a
//     pathologically slow prompt).
//   - JWT `exp` minus a small margin: aborts before the Clerk session
//     actually expires so responses can't persist against a
//     now-invalid session (Warning-12).
const SSE_MAX_DURATION_MS = 5 * 60 * 1000;

/**
 * Grace period after a deadline-induced controller.abort() before we
 * forcibly destroy the underlying socket (W4). controller.abort() stops
 * the generator and res.end() tries to flush a final SSE event, but if
 * the client is hung and not draining its read buffer, the TCP FIN may
 * never be ACK'd and the file descriptor can linger up to the OS
 * keepalive timeout (~2 hours on Linux defaults). 2 seconds is enough
 * for a healthy client to ACK the FIN; anything still pending after
 * that gets destroyed.
 */
const SSE_FORCE_CLOSE_GRACE_MS = 2_000;
const SSE_EXPIRY_MARGIN_MS = 5_000;

export type SseDeadlineReason = "auth-expired" | "timeout";

// Exported for unit tests — no external consumer should rely on this.
export function computeSseDeadline(req: ExpressRequest): { deadlineMs: number; reason: SseDeadlineReason } {
  const hardCap = Date.now() + SSE_MAX_DURATION_MS;
  try {
    const auth = getAuth(req);
    const expSec = auth?.sessionClaims?.exp;
    if (typeof expSec === "number" && expSec > 0) {
      // The JWT floor overrides the hard cap even when it's already in
      // the past. A token that expires inside the 5s margin (or was
      // mid-stream when the user logged out) should abort the stream
      // immediately, not fall back to a 5-minute cap — otherwise the
      // stated "no persistence under an invalid session" invariant
      // silently breaks (Codex review of #877). Clamp to `now` so
      // setTimeout fires on the next tick.
      const expMs = expSec * 1000 - SSE_EXPIRY_MARGIN_MS;
      if (expMs < hardCap) {
        return { deadlineMs: Math.max(expMs, Date.now()), reason: "auth-expired" };
      }
    }
  } catch {
    // Dev bypass / test harness won't expose sessionClaims — fall back
    // to the hard cap, which is always safe.
  }
  return { deadlineMs: hardCap, reason: "timeout" };
}

type ChatStreamRequest = ExpressRequest<
  Record<string, never>,
  unknown,
  z.infer<typeof chatRequestSchema>
>;

/**
 * The abort reason, tracked separately so we can tell the client whether their
 * stream was killed because the Clerk session expired (which they can recover
 * from by re-authing) vs a hard-cap timeout vs a generic client/shutdown abort.
 * Wrapped in an object so TypeScript control-flow doesn't narrow it to its
 * initial literal value (the setTimeout reassignment is async).
 */
interface SseAbortState {
  reason: "auth-expired" | "timeout" | "generic";
}

type SseWriter = (payload: string) => Promise<void>;

const sseEvent = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;

/** Tell the chat what the coach is doing, in place of its typing dots (I11). */
function writeStatus(safeWrite: SseWriter, status: ChatStatusStep): Promise<void> {
  return safeWrite(sseEvent({ status }));
}

/**
 * A res.write() that honours slow-client backpressure. A slow client drains
 * the Node write buffer slowly — without waiting on `drain` we keep
 * res.write()-ing chunks that balloon the process's memory. The wait resolves
 * once the socket is ready for more, or immediately when the stream is
 * aborted so we don't leak a listener.
 */
function createSseWriter(res: Response, controller: AbortController): SseWriter {
  const awaitDrain = () =>
    new Promise<void>((resolve) => {
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        res.off("drain", onDrain);
        controller.signal.removeEventListener("abort", onAbort);
        resolve();
      };
      const onDrain = () => settle();
      const onAbort = () => settle();
      res.once("drain", onDrain);
      controller.signal.addEventListener("abort", onAbort, { once: true });
      // Re-check after registration: if abort fired between the caller's
      // pre-check and our addEventListener, the listener will never be
      // invoked and the promise would hang forever.
      if (controller.signal.aborted) settle();
    });

  return async (payload: string) => {
    // A late write (a lookup that finishes after the reply closed, or after the
    // client left) has nowhere to go.
    if (res.writableEnded || res.destroyed) return;
    const ok = res.write(payload);
    if (!ok && !controller.signal.aborted) {
      await awaitDrain();
    }
  };
}

/**
 * Auto-abort when the stream exceeds its deadline (hard cap OR Clerk session
 * expiry, whichever comes first). The deadline reason distinguishes which one
 * fired so we report the correct cause to the client — only auth-expired is
 * recoverable by re-authing. unref() so the timers don't block process exit on
 * an otherwise-idle server. Returns a teardown that clears both.
 */
function startSseDeadline(
  req: ExpressRequest,
  res: Response,
  controller: AbortController,
  abortState: SseAbortState,
): () => void {
  const { deadlineMs, reason: deadlineReason } = computeSseDeadline(req);
  let forceCloseTimer: ReturnType<typeof setTimeout> | null = null;
  const deadlineTimer = setTimeout(() => {
    abortState.reason = deadlineReason;
    controller.abort();
    // After a short grace period, forcibly destroy the underlying socket
    // if the response is still pending — a client that's hung past the
    // hard cap would otherwise pin the TCP connection (and FD) until OS
    // keepalive eventually reaps it (W4). Only fires on deadline-induced
    // aborts; normal completion clears this timer in the finally block.
    forceCloseTimer = setTimeout(() => {
      forceCloseTimer = null;
      if (!res.writableEnded) {
        reqLogger(req).warn(
          { context: "sse", reason: abortState.reason },
          "SSE deadline grace expired with response still open — destroying socket",
        );
        res.socket?.destroy();
      }
    }, SSE_FORCE_CLOSE_GRACE_MS);
    forceCloseTimer.unref();
  }, Math.max(0, deadlineMs - Date.now()));
  deadlineTimer.unref();

  return () => {
    clearTimeout(deadlineTimer);
    if (forceCloseTimer) clearTimeout(forceCloseTimer);
  };
}

interface PlanEditBranchOptions {
  readonly req: ChatStreamRequest;
  readonly res: Response;
  readonly userId: string;
  readonly input: ChatInput;
  readonly aiContext: AIContext;
  /** The classifier, already running (startPlanEditIntent); null when the message can't be a plan edit. */
  readonly planEditIntent: Promise<ChatIntentResult> | null;
  readonly controller: AbortController;
  readonly safeWrite: SseWriter;
  /** Filled with what was sent, for saving when the server owns the turn. */
  readonly reply: CoachReply;
  /** What the turn's log line reports (I23). */
  readonly telemetry: ChatTurnTelemetry;
  /** Offers the lasting fact the athlete stated, if any, just before the reply closes (I5b). */
  readonly offerFact: () => Promise<void>;
}

const NOT_A_PLAN_EDIT: ChatIntentResult = { intent: "normal_chat", confidence: 0 };

/**
 * Start the plan-edit intent classifier, or return null when this message
 * cannot be a plan edit. The classifier needs only the message and history,
 * so it runs alongside the context build instead of after it — on the many
 * messages the keyword gate lets through, its round trip no longer sits in
 * front of the first token.
 */
function startPlanEditIntent(
  req: ChatStreamRequest,
  userId: string,
  chatSafety: ChatSafetySignals,
  history: ConversationTurn[],
): Promise<ChatIntentResult> | null {
  const { message, planEditing } = req.body;
  // Red-flag symptoms in the athlete's own words mean no AI plan change —
  // the policy createPlanAdjustmentProposal already applies to workout text.
  // The message goes to normal chat, which is told to put medical care first.
  if (planEditing === false || chatSafety.redFlagDetected || !mayRequestPlanEdit(message, history)) return null;
  // classifyPlanEditIntent already fails open to normal chat; the catch only
  // guarantees no unhandled rejection if the context build fails first and
  // nothing ever awaits this.
  return classifyPlanEditIntent(message, history, userId).catch(() => NOT_A_PLAN_EDIT);
}

/**
 * Apply the proposal immediately when the athlete opted into auto-apply. On
 * failure, whether the apply declined or threw, the proposal stays pending (or
 * was invalidated); the card renders with its live status and the athlete can
 * retry or dismiss manually.
 */
async function maybeAutoApplyProposal(
  proposal: PlanAdjustmentProposal,
  userId: string,
  log: ReturnType<typeof reqLogger>,
): Promise<PlanAdjustmentProposal> {
  const user = await storage.users.getUser(userId);
  if (!user?.coachAutoApplyPlanChanges) return proposal;
  try {
    const applyResult = await applyPlanAdjustmentProposal(userId, proposal.id, { log });
    if (!applyResult?.applied) return proposal;
  } catch (error) {
    // The apply error and the proposal id; no plan content.
    // bearer:disable javascript_lang_logger_leak
    log.warn({ err: error, proposalId: proposal.id }, "[plan-adjustment] Auto-apply failed; the proposal stays pending");
    return proposal;
  }
  // Re-read, so the card that arrives with the reply can offer Undo.
  return (await storage.planProposals.getById(proposal.id, userId)) ?? { ...proposal, status: "applied" };
}

const PROPOSAL_FAILED_TEXT =
  "I couldn't draft that change just now. Ask me again in a moment, or tell me exactly which session to change.";

/** Close a proposal reply, its text already sent: the card, any fact offer, then the stream. */
async function sendPlanProposalReply(
  res: Response,
  controller: AbortController,
  safeWrite: SseWriter,
  proposal: PlanAdjustmentProposal | null,
  offerFact: () => Promise<void>,
): Promise<void> {
  if (!controller.signal.aborted) {
    if (proposal) {
      await safeWrite(sseEvent({ planProposal: serializePlanProposal(proposal) }));
    }
    await offerFact();
    res.write(sseEvent({ done: true }));
  }
  res.end();
}

/** A proposal's summary on its way to the chat (I11). */
interface SummaryOut {
  /** Send the next piece as the model writes it. */
  readonly write: (text: string) => Promise<void>;
  /** Whether any of it has gone out. */
  readonly began: () => boolean;
  /** Send what of the final text is still unsent; null says the proposal failed, after whatever went out. */
  readonly end: (finalText: string | null) => Promise<void>;
}

/**
 * The summary goes out piece by piece as the model writes it, the first piece
 * after `lead` (a paragraph break after prose the coach already sent). It is
 * the text the reply ends with whenever the model answers, so `end` normally
 * has nothing left to send.
 */
function summaryOut({ controller, safeWrite, reply, telemetry }: CoachStream, lead: string): SummaryOut {
  let sent = "";
  const write = async (text: string): Promise<void> => {
    if (!text || controller.signal.aborted) return;
    const piece = sent === "" ? lead + text : text;
    sent += text;
    reply.content += piece;
    markFirstText(telemetry);
    await safeWrite(sseEvent({ text: piece }));
  };
  return {
    write,
    began: () => sent !== "",
    end: async (finalText) => {
      if (finalText === null) {
        await write(sent === "" ? PROPOSAL_FAILED_TEXT : `\n\n${PROPOSAL_FAILED_TEXT}`);
        return;
      }
      await write(finalText.startsWith(sent) ? finalText.slice(sent.length) : "");
    },
  };
}

/**
 * Generate a structured multi-day proposal instead of a prose reply. Returns
 * true when it answered the request and closed the stream; false falls through
 * to the normal chat stream (including on `generation_failed`).
 */
async function handlePlanEditRequest(
  { req, res, userId, input, aiContext, controller, safeWrite, reply, telemetry, offerFact }: PlanEditBranchOptions,
  planEditIntent: Promise<ChatIntentResult>,
  summary: SummaryOut,
): Promise<boolean> {
  const intent = await planEditIntent;
  recordClassifierVerdict(telemetry, intent);
  if (!isPlanEditIntent(intent) || controller.signal.aborted) return false;

  await writeStatus(safeWrite, "drafting_plan");
  const result = await createPlanAdjustmentProposal(
    {
      userId,
      message: input.message,
      history: input.history,
      aiContext,
      focusPlanDayId: req.body.focusPlanDayId,
      onSummaryText: summary.write,
    },
    reqLogger(req),
  );
  telemetry.proposal = result.kind;
  if (result.kind !== "proposal" && result.kind !== "chat_fallback") {
    // Nothing on screen yet: answer in prose instead. Under a summary that
    // broke off, a second answer would read as nonsense.
    if (!summary.began()) return false;
    await summary.end(null);
    await sendPlanProposalReply(res, controller, safeWrite, null, offerFact);
    return true;
  }

  const proposal =
    result.kind === "proposal"
      ? await maybeAutoApplyProposal(result.proposal, userId, reqLogger(req))
      : null;
  await summary.end(result.kind === "proposal" ? result.proposal.summaryMessage : result.text);
  reply.proposalId = proposal?.id;
  await sendPlanProposalReply(res, controller, safeWrite, proposal, offerFact);
  return true;
}

/**
 * Conversational plan editing: when the message looks like a plan-change
 * request (cheap keyword gate, then a fast-model classifier), the coach
 * proposes changes rather than replying in prose. Any failure in this branch
 * falls through to the normal streaming chat — the feature must never break
 * plain conversation.
 */
async function tryPlanEditRequest(options: PlanEditBranchOptions): Promise<boolean> {
  const { req, res, planEditIntent, controller, safeWrite, telemetry, offerFact } = options;
  if (!planEditIntent) return false;
  const summary = summaryOut(options, "");
  try {
    return await handlePlanEditRequest(options, planEditIntent, summary);
  } catch (planEditError) {
    telemetry.proposal = "error";
    if (controller.signal.aborted) {
      res.end();
      return true;
    }
    reqLogger(req).warn({ err: planEditError }, "[plan-adjustment] Chat branch failed");
    if (!summary.began()) return false;
    await summary.end(null);
    await sendPlanProposalReply(res, controller, safeWrite, null, offerFact);
    return true;
  }
}

/** The open stream a reply goes out on, the reply as sent so far, and what its log line reports. */
interface CoachStream {
  readonly controller: AbortController;
  readonly safeWrite: SseWriter;
  readonly reply: CoachReply;
  readonly telemetry: ChatTurnTelemetry;
}

/** Function calling for the chat (I8), behind AI_CHAT_TOOLS until it has been evaluated. */
function chatToolsEnabled(): boolean {
  return env.AI_CHAT_TOOLS === "true";
}

/**
 * The coach may propose plan changes itself unless the surface can't show a
 * proposal, or the athlete described a red-flag symptom (the same policy the
 * classifier path applies).
 */
function canProposePlanChanges(req: ChatStreamRequest, chatSafety: ChatSafetySignals): boolean {
  return req.body.planEditing && !chatSafety.redFlagDetected;
}

async function toolContextFor(req: ChatStreamRequest, userId: string, aiContext: AIContext): Promise<ChatToolContext> {
  const { trainingContext } = aiContext;
  // Every training-context builder sets the athlete's date; the lookup is a fallback.
  const today =
    trainingContext.currentDate ?? getLocalDateStrSafe(new Date(), (await storage.users.getUser(userId))?.userTimezone);
  return {
    userId,
    today,
    weightUnit: trainingContext.weightUnit ?? "kg",
    distanceUnit: trainingContext.distanceUnit ?? "km",
    log: reqLogger(req),
  };
}

/**
 * Stream the reply with tools (I8): the model reads the athlete's history as
 * it needs to and decides for itself whether the message asks for a plan
 * change. Returns the plan-change call when it made one; the reply so far is
 * already sent.
 */
async function streamCoachReplyWithTools(
  req: ChatStreamRequest,
  input: ChatInput,
  aiContext: AIContext,
  userId: string,
  chatOptions: ChatCallOptions,
  { controller, safeWrite, reply, telemetry }: CoachStream,
  planChanges: boolean,
): Promise<TextAiToolCall | undefined> {
  const toolContext = await toolContextFor(req, userId, aiContext);
  const toolset: CoachToolset = {
    tools: chatToolsFor({ planChanges }),
    run: async (call) => {
      telemetry.toolCalls.push(call.name);
      await writeStatus(safeWrite, chatToolStatus(call.name));
      const result = await runChatTool(call, toolContext);
      // Back to the reply once the lookup is in.
      await writeStatus(safeWrite, "thinking");
      return result;
    },
    ...(planChanges ? { handoff: PROPOSE_PLAN_CHANGES } : {}),
  };
  const stream = streamChatWithCoachTools(input.message, input.history, aiContext.trainingContext, aiContext.coachingMaterials, aiContext.retrievedChunks, userId, {
    ...chatOptions,
    chatTools: { planChanges },
    signal: controller.signal,
    toolset,
  });
  for await (const event of stream) {
    if (controller.signal.aborted) {
      reqLogger(req).info("Client disconnected mid-stream, stopping AI generation");
      return undefined;
    }
    if (event.type === "handoff") {
      telemetry.toolCalls.push(event.call.name);
      return event.call;
    }
    await safeWrite(sseEvent({ text: event.text }));
    markFirstText(telemetry);
    reply.content += event.text;
  }
  return undefined;
}

/**
 * The coach called propose_plan_changes: draft the proposal from the
 * athlete's message and the coach's own summary of the change, and answer
 * with it (and its card) after whatever the coach already said.
 */
async function replyWithToolProposal(
  branch: Omit<PlanEditBranchOptions, "planEditIntent">,
  call: TextAiToolCall,
): Promise<void> {
  const { req, res, userId, input, aiContext, controller, safeWrite, reply, telemetry, offerFact } = branch;
  await writeStatus(safeWrite, "drafting_plan");
  const request = typeof call.arguments.request === "string" ? call.arguments.request.trim().slice(0, 1_000) : "";
  // After what the coach already said, the summary starts a new paragraph.
  const summary = summaryOut(branch, reply.content ? "\n\n" : "");
  let proposal: PlanAdjustmentProposal | null = null;
  let finalText: string | null = null;
  try {
    const result = await createPlanAdjustmentProposal(
      {
        userId,
        message: request ? `${input.message}\n\nThe coach's summary of the change: ${request}` : input.message,
        history: input.history,
        aiContext,
        focusPlanDayId: req.body.focusPlanDayId,
        onSummaryText: summary.write,
      },
      reqLogger(req),
    );
    telemetry.proposal = result.kind;
    if (result.kind === "proposal") {
      proposal = await maybeAutoApplyProposal(result.proposal, userId, reqLogger(req));
      finalText = result.proposal.summaryMessage;
    } else if (result.kind === "chat_fallback") {
      finalText = result.text;
    }
  } catch (error) {
    telemetry.proposal = "error";
    // The plan-adjustment error; no message content.
    // bearer:disable javascript_lang_logger_leak
    reqLogger(req).warn({ err: error }, "[plan-adjustment] Tool-called proposal failed");
  }
  await summary.end(finalText);
  reply.proposalId = proposal?.id;
  await sendPlanProposalReply(res, controller, safeWrite, proposal, offerFact);
}

async function streamCoachReply(
  req: ChatStreamRequest,
  input: ChatInput,
  aiContext: AIContext,
  userId: string,
  chatOptions: ChatCallOptions,
  { controller, safeWrite, reply, telemetry }: CoachStream,
): Promise<void> {
  const stream = streamChatWithCoach(input.message, input.history, aiContext.trainingContext, aiContext.coachingMaterials, aiContext.retrievedChunks, userId, { ...chatOptions, signal: controller.signal });

  for await (const chunk of stream) {
    if (controller.signal.aborted) {
      reqLogger(req).info("Client disconnected mid-stream, stopping AI generation");
      break;
    }
    await safeWrite(sseEvent({ text: chunk }));
    markFirstText(telemetry);
    // Only what was sent: a cut-off reply is saved as the athlete saw it.
    reply.content += chunk;
  }
}

/**
 * The stream's last event: normal completion, or why it was cut short.
 * Best-effort — the underlying socket may already be half-closed by the time
 * we try. The client SSE reader treats a visible error payload differently
 * from a silent close, so we prefer a named event over letting the connection
 * die in silence.
 */
function sendSseTerminalEvent(
  res: Response,
  controller: AbortController,
  abortState: SseAbortState,
): void {
  if (!controller.signal.aborted) {
    res.write(sseEvent({ done: true }));
    return;
  }
  if (abortState.reason === "auth-expired") {
    res.write(
      sseEvent({ error: "auth-expired", reason: "Your session expired — please sign in again." }),
    );
    return;
  }
  if (abortState.reason === "timeout") {
    res.write(sseEvent({ error: "timeout", reason: "The response took too long and was stopped." }));
  }
}

/**
 * Offer the lasting fact the athlete stated, if the read found one the card
 * doesn't hold, as the reply's last event (I5b). It is saved with the reply,
 * so the athlete can answer it after a reload too. Only on a reply that went
 * out: an offer under a failed or stopped reply would read as the coach
 * filing away what it never answered.
 */
async function offerFactProposal(
  { controller, safeWrite, reply }: Pick<CoachStream, "controller" | "safeWrite" | "reply">,
  candidate: Promise<FactCandidate | null> | null,
  aiContext: AIContext,
): Promise<void> {
  if (!candidate || controller.signal.aborted || !reply.content.trim()) return;
  const factProposal = await settleFactProposal(candidate, aiContext.trainingContext.athleteFacts);
  if (!factProposal || controller.signal.aborted) return;
  reply.factProposal = factProposal;
  await safeWrite(sseEvent({ factProposal }));
}

/** How a reply ended: streamed prose, or a proposal reply that already closed the stream. */
type ChatAnswer = "prose" | "proposal";

/** The classifier path: a plan-change request becomes a proposal, anything else streamed prose. */
async function answerWithoutTools(branch: PlanEditBranchOptions, chatOptions: ChatCallOptions): Promise<ChatAnswer> {
  if (await tryPlanEditRequest(branch)) return "proposal";
  const { req, input, aiContext, userId, controller, safeWrite, reply, telemetry } = branch;
  await streamCoachReply(req, input, aiContext, userId, chatOptions, { controller, safeWrite, reply, telemetry });
  return "prose";
}

/** The tools path (I8): one model call streams the reply, and a plan-change call becomes a proposal. */
async function answerWithTools(
  branch: Omit<PlanEditBranchOptions, "planEditIntent">,
  chatOptions: ChatCallOptions,
  planChanges: boolean,
): Promise<ChatAnswer> {
  const { req, input, aiContext, userId, controller, safeWrite, reply, telemetry } = branch;
  const call = await streamCoachReplyWithTools(req, input, aiContext, userId, chatOptions, { controller, safeWrite, reply, telemetry }, planChanges);
  if (!call || controller.signal.aborted) return "prose";
  await replyWithToolProposal(branch, call);
  return "proposal";
}

protectedPost(router, "/api/v1/chat/stream", { limiter: rateLimiter("chat", 10), middleware: [aiConsentCheck, aiBudgetCheck, validateBody(chatRequestSchema)] }, async (req: ChatStreamRequest, res: Response) => {
    const useTools = chatToolsEnabled();
    const telemetry = startChatTurn(useTools ? "tools" : "classic", req.body.replaceAssistantId !== undefined);
    const userId = getUserId(req);
    const turn = serverOwnedTurn(req.body);
    const conversation = await conversationFor(userId, turn, req.body);
    // The athlete's own words, scanned for red-flag symptoms and heart-rate
    // medication (analyzeSafetySignals only ever reads workout text).
    const chatSafety = analyzeChatSafety(req.body.message, conversation.turns);
    // With tools the reply model decides itself, so the classifier never runs.
    const planEditIntent = useTools ? null : startPlanEditIntent(req, userId, chatSafety, conversation.turns);
    if (!useTools && !planEditIntent) telemetry.planEdit = { gate: "closed" };
    // Read alongside the reply for a lasting fact to offer for the athlete card (I5b).
    const factCandidate = startFactProposal({
      message: req.body.message,
      history: conversation.turns,
      userId,
      chatSafety,
      serverOwned: turn !== null,
    });
    const { input, aiContext, promptOptions } = await prepareChatContext(req, conversation);
    telemetry.contextReadyAt = Date.now();
    const focus = turnFocus(req.body);
    // Accepted from here: the athlete's turn is saved before the first byte, so
    // any reply the client sees has its question in the history.
    if (turn) await saveUserTurn(userId, turn, input.message, focus);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    // Bridge Express req-close -> AbortController so upstream provider
    // generation is torn down promptly on client disconnect
    // (CODEBASE_AUDIT.md §3). The same controller is registered with
    // the SSE registry so graceful shutdown can abort every in-flight
    // stream and let `httpServer.close()` complete without waiting on
    // long-lived connections.
    const controller = new AbortController();
    const unregister = registerSseStream(controller);
    req.on("close", () => controller.abort());

    const abortState: SseAbortState = { reason: "generic" };
    const clearDeadline = startSseDeadline(req, res, controller, abortState);
    const safeWrite = createSseWriter(res, controller);
    const safetyNotice = buildChatSafetyNotice(chatSafety) ?? undefined;
    const reply: CoachReply = { content: "", ragInfo: aiContext.ragInfo, safetyNotice };

    try {
      await safeWrite(sseEvent({ ragInfo: sanitizeRagInfo(aiContext.ragInfo) }));
      // Ahead of any text, so the client shows it above the reply. Fixed copy,
      // independent of what the model goes on to write.
      if (safetyNotice) await safeWrite(sseEvent({ safetyNotice }));

      const offerFact = () => offerFactProposal({ controller, safeWrite, reply }, factCandidate, aiContext);
      const branch = { req, res, userId, input, aiContext, controller, safeWrite, reply, telemetry, offerFact };
      const answered = useTools
        ? await answerWithTools(branch, { chatSafety, ...promptOptions }, canProposePlanChanges(req, chatSafety))
        : await answerWithoutTools({ ...branch, planEditIntent }, { chatSafety, ...promptOptions });
      telemetry.outcome = controller.signal.aborted ? "aborted" : answered;
      if (answered === "proposal") return;

      await offerFact();
      sendSseTerminalEvent(res, controller, abortState);
      res.end();
    } catch (streamError) {
      telemetry.outcome = controller.signal.aborted ? "aborted" : "error";
      if (controller.signal.aborted) return;
      reqLogger(req).error({ err: streamError }, "Stream error:");
      res.write(sseEvent({ error: "Stream error" }));
      res.end();
    } finally {
      clearDeadline();
      unregister();
      // Finished, cut off, or a proposal: whatever reached the athlete.
      if (turn) await saveCoachReply(userId, turn, reply, focus);
      // Timings, decisions and sizes for an opaque user id; never message text (I23).
      // bearer:disable javascript_lang_logger_leak
      reqLogger(req).info({ userId, ...chatTurnLogFields(telemetry, reply) }, "[chat] turn");
    }
  });

/**
 * A proposal reply carries its proposal with its current status, so the card
 * renders at the turn that produced it, applied or not (I3).
 */
async function withProposals(userId: string, messages: ChatMessage[]) {
  const ids = messages.flatMap((message) => (message.proposalId ? [message.proposalId] : []));
  if (ids.length === 0) return messages;
  const proposals = await storage.planProposals.getByIds(ids, userId);
  const views = new Map(proposals.map((proposal) => [proposal.id, serializePlanProposal(proposal)]));
  return messages.map((message) => {
    const proposal = message.proposalId ? views.get(message.proposalId) : undefined;
    return proposal ? { ...message, proposal } : message;
  });
}

// Cursor-paginated to cap memory/bandwidth growth as chat history accumulates.
// Response body stays a plain ChatMessage[] for backward compatibility; the
// cursor for older messages is surfaced in two sibling response headers
// (`X-Next-Cursor` = timestamp, `X-Next-Cursor-Id` = row id). Both must be
// echoed back on the next request to avoid dropping rows that share a
// millisecond — see `storage/users.ts` comment for details.
const chatHistoryQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
    before: z.string().datetime({ offset: true }).optional(),
    beforeId: z.string().min(1).max(255).optional(),
    // A workout's conversation; without either, the general one (I4).
    focusPlanDayId: z.string().min(1).max(255).optional(),
    focusWorkoutLogId: z.string().min(1).max(255).optional(),
  })
  .refine(
    (q) => (q.before == null) === (q.beforeId == null),
    { message: "before and beforeId must be provided together" },
  );

router.get("/api/v1/chat/history", isAuthenticated, rateLimiter("chatHistory", 60), validateQuery(chatHistoryQuerySchema), asyncHandler(async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    const { limit, before, beforeId, focusPlanDayId, focusWorkoutLogId } = req.query as z.infer<typeof chatHistoryQuerySchema>;
    const { messages, nextCursor } = await getChatHistoryUseCase(storage.users, {
      userId,
      limit,
      before,
      beforeId,
      focusPlanDayId,
      focusWorkoutLogId,
    });
    if (nextCursor) {
      res.setHeader("X-Next-Cursor", nextCursor.timestamp);
      res.setHeader("X-Next-Cursor-Id", nextCursor.id);
    }
    // A long session's rolling notes are for the coach, never shown (I5).
    res.json(await withProposals(userId, messages.filter((message) => message.kind !== "rolling")));
  }));

// The coach's opening line and prompt chips, from the athlete's training (I19).
// No model call: the panel asks every time it opens.
router.get("/api/v1/chat/welcome", isAuthenticated, rateLimiter("chatWelcome", 30), asyncHandler(async (req: ExpressRequest, res: Response) => {
    res.json(await getCoachWelcome(getUserId(req)));
  }));

protectedPost(router, "/api/v1/chat/message", { limiter: rateLimiter("chatMessage", 20), middleware: [validateBody(insertChatMessageSchema)] }, async (req: ExpressRequest<Record<string, never>, unknown, ChatMessageBody>, res: Response) => {
    const userId = getUserId(req);
    const { role, content } = req.body;

    const message = await storage.users.saveChatMessage({ userId, role, content });
    res.json(message);
  });

// The athlete's thumbs on a coach reply (I23): whether it helped, which no
// log line can say. null clears it.
protectedPatch(router, "/api/v1/chat/messages/:id", { limiter: rateLimiter("chatFeedback", 60), validation: [validateBody(chatMessageFeedbackSchema)] }, async (req: ExpressRequest<{ id: string }, unknown, ChatMessageFeedbackBody>, res: Response) => {
    const userId = getUserId(req);
    const { feedback } = req.body;
    if (!(await storage.users.setChatMessageFeedback(userId, req.params.id, feedback))) {
      sendNotFound(res, "Message not found");
      return;
    }
    // The rating and the reply's id; never its content.
    reqLogger(req).info({ messageId: req.params.id, feedback }, "[chat] feedback");
    res.json({ id: req.params.id, feedback });
  });

// The athlete's answer to a fact the coach offered under a reply (I5b): save it
// to their athlete card, or not now. No AI consent needed: this calls no model,
// and the card's own routes take none either.
protectedPost(router, "/api/v1/chat/messages/:id/fact", { limiter: rateLimiter("athleteFacts", 20), validation: [validateBody(chatFactDecisionSchema)] }, async (req: ExpressRequest<{ id: string }, unknown, ChatFactDecisionBody>, res: Response) => {
    const result = await decideChatFactProposal(getUserId(req), req.params.id, req.body.decision);
    if (result.kind === "not_found") {
      sendNotFound(res, "No fact is waiting for an answer on that reply");
      return;
    }
    if (result.kind === "limit") {
      res.status(409).json({ error: ATHLETE_FACT_LIMIT_MESSAGE, code: ErrorCode.ATHLETE_FACT_LIMIT });
      return;
    }
    res.json({ factProposal: result.factProposal, ...(result.fact ? { fact: result.fact } : {}) });
  });

protectedDelete(router, "/api/v1/chat/history", { limiter: rateLimiter("chatHistoryDelete", 5) }, async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    await storage.users.clearChatHistory(userId);
    res.json({ success: true });
  });

// Coach Insights — single-shot AI analysis of the user's progress against
// their stated goal. The fixed analysis prompt and generation live in
// services/coachInsightsService so the route and the midnight recompute cron
// share one path.
//
// GET returns the LAST stored result instantly (no AI spend) so the tab paints
// the previous analysis on open instead of a blank state; `stale` flags that a
// workout was logged after it was generated. POST regenerates (gated by the AI
// consent/budget middleware) and persists the fresh result.
router.get("/api/v1/coach-insights", isAuthenticated, rateLimiter("analytics", 60), asyncHandler(async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    // Fetch the stored row and the staleness anchor concurrently — they read
    // unrelated tables (analytics_results vs workout_logs), so there's no
    // ordering dependency between them on this "paint instantly on tab open"
    // path. Halves the DB latency for the common case (row exists) at the cost
    // of one harmless unused query when a user has no stored insights yet.
    const [row, anchor] = await Promise.all([
      storage.analyticsResults.get(userId, "coach_insights"),
      getWorkoutAnchor(userId),
    ]);
    if (!row) {
      res.json({ insights: null });
      return;
    }
    const payload = row.payload as CoachInsightsResult;
    res.json({
      ...payload,
      generatedAt: row.generatedAt.toISOString(),
      stale: computeStale(row, anchor),
    });
  }));

protectedPost(router, "/api/v1/coach-insights", { limiter: rateLimiter("suggestions", 3), middleware: [aiConsentCheck, aiBudgetCheck] }, async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    const result = await regenerateAndStoreCoachInsights(userId, reqLogger(req));
    // Freshly generated against the current latest workout, so never stale.
    res.json({ ...result, stale: false });
  });

// Overview AI chart analysis — one AI call produces a short "what this means for
// you" reading per Overview-tab chart, keyed so each chart card renders its own
// explanation inline. Same stored-first shape as Coach Insights: GET paints the
// last stored result instantly (no AI spend) with a `stale` flag; POST
// regenerates (gated by the AI consent/budget middleware) and persists.
router.get("/api/v1/overview-analysis", isAuthenticated, rateLimiter("analytics", 60), asyncHandler(async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    // See the coach-insights GET above: row and staleness anchor read
    // unrelated tables, so fetch them concurrently instead of paying two
    // sequential DB round-trips on this instant-paint path.
    const [row, anchor] = await Promise.all([
      storage.analyticsResults.get(userId, "overview_analysis"),
      getWorkoutAnchor(userId),
    ]);
    if (!row) {
      res.json({ sections: null });
      return;
    }
    const payload = row.payload as OverviewAnalysisResult;
    res.json({
      ...payload,
      generatedAt: row.generatedAt.toISOString(),
      stale: computeStale(row, anchor),
    });
  }));

protectedPost(router, "/api/v1/overview-analysis", { limiter: rateLimiter("suggestions", 3), middleware: [aiConsentCheck, aiBudgetCheck] }, async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    const result = await regenerateAndStoreOverviewAnalysis(userId, reqLogger(req));
    // Freshly generated against the current latest workout, so never stale.
    res.json({ ...result, stale: false });
  });

protectedPost(router, "/api/v1/timeline/ai-suggestions", { limiter: rateLimiter("suggestions", 3), middleware: [aiConsentCheck, aiBudgetCheck] }, async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    const log = reqLogger(req);
    const startedAt = Date.now();
    try {
      const result = await generateTimelineAiSuggestions(userId, log);
      log.info(
        {
          userId,
          durationMs: Date.now() - startedAt,
          suggestionCount: result.suggestions.length,
          ragSource: result.ragInfo?.source ?? "none",
        },
        "[ai] Timeline suggestions completed",
      );
      res.json(result);
      return;
    } catch (err) {
      log.error(
        { err, userId, durationMs: Date.now() - startedAt },
        "[ai] Timeline suggestions failed",
      );
      throw err;
    }
  });


router.get("/api/v1/timeline/ai-suggestions/debug/:workoutId", isAuthenticated, rateLimiter("aiSuggestionsDebug", 30), asyncHandler(async (req: ExpressRequest<{workoutId: string}>, res: Response) => {
    const userId = getUserId(req);
    const day = await storage.plans.getPlanDay(req.params.workoutId, userId);
    if (!day) {
      sendNotFound(res, "Plan day not found");
      return;
    }
    res.json({
      workoutId: day.id,
      focus: day.focus,
      aiSource: day.aiSource,
      aiRationale: day.aiRationale,
      aiNoteUpdatedAt: day.aiNoteUpdatedAt,
      trace: day.aiInputsUsed?.recommendationTrace ?? null,
      debugSummary: day.aiInputsUsed?.recommendationTrace
        ? `Generated for style ${day.aiInputsUsed.recommendationTrace.trainingStyleId} in phase ${day.aiInputsUsed.recommendationTrace.phase} using ${day.aiInputsUsed.recommendationTrace.strategyRuleVersion} and ${day.aiInputsUsed.recommendationTrace.promptBundleVersion}.`
        : null,
    });
  }));
protectedPost(router, "/api/v1/timeline/ai-suggestions/apply", { limiter: rateLimiter("suggestionApply", 10), middleware: [aiConsentCheck, validateBody(applyTimelineSuggestionSchema)] }, async (req: ExpressRequest<Record<string, never>, unknown, z.infer<typeof applyTimelineSuggestionSchema>>, res: Response) => {
    const userId = getUserId(req);
    const result = await applyTimelineAiSuggestion(userId, req.body, reqLogger(req));
    if (!result) {
      sendNotFound(res, "Plan day not found");
      return;
    }
    res.json(result);
  });

export default router;
