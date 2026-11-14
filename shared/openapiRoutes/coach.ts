import type { OpenAPIRegistry, ResponseConfig, RouteConfig } from "@asteasolutions/zod-to-openapi";
import { createSelectSchema } from "drizzle-zod";

import { CHAT_STATUS_STEPS } from "../chat";
import {
  athleteFactCategoryEnum, athleteFacts, athleteFactSourceEnum, chatFactDecisionSchema,
  chatFactProposalStatusEnum, chatFeedbackEnum, chatMessageFeedbackSchema, chatMessageKindEnum, chatMessages,
  chatRequestSchema, coachingMaterials, createAthleteFactSchema, deviceLinkSourceEnum,
  insertChatMessageSchema, insertTimelineAnnotationSchema,
  planDayPriorityEnum, planDayRecoveryEnum, planDays, planDaySkipReasonEnum, recycleBinBatchIdParamsSchema, recycleBinEntityTypeEnum, recycleBinItemIdParamsSchema,
  timelineAnnotations, updateAthleteFactSchema, updateTimelineAnnotationSchema,
  workoutLogs, workoutStatusEnum,
} from "../schema";
import {
  applyTimelineSuggestionSchema,
  chatHistoryQuerySchema,
  createCoachingMaterialSchema,
  updateCoachingMaterialSchema,
} from "../schema/types/coachRequests";
import { z } from "../schema/zod";
import type { OpenApiCommon } from "./common";
import type { EntityComponents } from "./entities";

// ---------------------------------------------------------------------------
// Error cases. Several codes can share a status (a 429 is the rate limiter, the
// AI budget or the AI provider's quota), so an operation lists its cases and
// `fail` folds them into one response per status.
// ---------------------------------------------------------------------------

/** Which envelope an error response carries: ErrorResponse, ValidationErrorResponse, or ErrorResponse plus the AI budget fields. */
type ErrorBody = "error" | "validation" | "aiBudget";

/** One way an operation can fail: its status, what the client is told, and the body (default `error`). */
interface ErrorCase {
  readonly status: number;
  readonly text: string;
  readonly body?: ErrorBody;
}

const RATE_LIMITED: ErrorCase = { status: 429, text: "RATE_LIMITED: too many requests; Retry-After says when to try again" };
const VALIDATION: ErrorCase = { status: 400, text: "VALIDATION_ERROR: the request failed validation", body: "validation" };
/** aiConsentCheck (server/middleware/aiConsent.ts). */
const AI_CONSENT: ErrorCase = { status: 403, text: "AI_COACH_DISABLED: the athlete has not turned AI coaching on (Settings)" };
/** aiBudgetCheck (server/middleware/aibudget.ts). */
const AI_BUDGET: readonly ErrorCase[] = [
  { status: 429, text: "AI_BUDGET_EXCEEDED: the athlete's rolling 24-hour AI allowance is used up (adds currentCostCents and limitCents)", body: "aiBudget" },
  { status: 503, text: "AI_FEATURES_DISABLED, AI_GLOBAL_BUDGET_EXCEEDED or AI_BUDGET_UNAVAILABLE: AI is switched off, the app-wide daily ceiling is reached, or the budget check failed" },
];
/** A failed model call, classified by classifyAiError (server/errors.ts). */
const AI_PROVIDER: readonly ErrorCase[] = [
  { status: 400, text: "AI_INVALID_INPUT: the AI provider rejected the request" },
  { status: 429, text: "AI_QUOTA_EXCEEDED: the AI provider's quota is exhausted; try again in a few minutes" },
  { status: 502, text: "AI_ERROR: the AI provider failed, or its reply couldn't be read" },
  { status: 503, text: "AI_UNAVAILABLE: the AI provider is unavailable or timed out" },
];
/** Routes with their own large-body parser (server/largeBodyParsers.ts). */
const payloadTooLarge = (limit: string): ErrorCase => ({ status: 413, text: `PAYLOAD_TOO_LARGE: the body is over this route's ${limit} limit` });
const notFound = (what: string): ErrorCase => ({ status: 404, text: `NOT_FOUND: ${what}` });
const conflict = (text: string): ErrorCase => ({ status: 409, text });

const json = (schema: z.ZodType) => ({ "application/json": { schema } });

/** The Zod schema of a common response's JSON body. */
function jsonSchemaOf(responses: Record<number, ResponseConfig>, status: number): z.ZodType {
  const media = responses[status]?.content?.["application/json"];
  const schema = media && "schema" in media ? media.schema : undefined;
  if (!(schema instanceof z.ZodType)) throw new Error(`common ${status} response has no Zod schema`);
  return schema;
}

/** An operation without its method, path and security; `tags` overrides the group's. */
type RouteBody = Omit<RouteConfig, "method" | "path" | "security">;

/** Helpers every section registers its operations with. */
interface Kit {
  readonly registry: OpenAPIRegistry;
  /** A registrar for one tag group's operations, all of which require a signed-in user. */
  readonly routes: (tags: string[]) => (method: RouteConfig["method"], path: string, config: RouteBody) => void;
  /** A JSON success response (200 unless `status` says otherwise). */
  readonly ok: (description: string, schema: z.ZodType, extra?: { status?: number; headers?: z.ZodObject }) => Record<number, ResponseConfig>;
  /** 401, 426 and 429 (common.authenticatedResponses), plus these cases, one response per status. */
  readonly fail: (...cases: readonly ErrorCase[]) => Record<number, ResponseConfig>;
  readonly success: OpenApiCommon["success"];
  /** Response headers aiBudgetCheck adds once the athlete nears their daily AI allowance. */
  readonly aiBudgetHeaders: z.ZodObject;
}

function createKit(registry: OpenAPIRegistry, common: OpenApiCommon): Kit {
  const errorBody = jsonSchemaOf(common.error(400, "error"), 400);
  const validationBody = jsonSchemaOf(common.validationError(), 400);
  if (!(errorBody instanceof z.ZodObject)) throw new Error("ErrorResponse is not a Zod object");
  // The AI budget refusal is an ErrorResponse with two extra fields.
  const aiBudgetBody = errorBody.extend({
    currentCostCents: z.number().int().optional().openapi({ description: "AI_BUDGET_EXCEEDED only: the athlete's rolling 24-hour AI spend, in cents" }),
    limitCents: z.number().int().optional().openapi({ description: "AI_BUDGET_EXCEEDED only: the per-athlete 24-hour limit, in cents" }),
  });

  // Cases sharing a status share one response, whose description lists each
  // code; when they carry different envelopes (a 400 from the Zod middleware
  // and one from the handler) the body is an anyOf of both.
  const errors = (cases: readonly ErrorCase[]): Record<number, ResponseConfig> => {
    const byStatus = new Map<number, ErrorCase[]>();
    for (const errorCase of cases) byStatus.set(errorCase.status, [...(byStatus.get(errorCase.status) ?? []), errorCase]);
    const responses: Record<number, ResponseConfig> = {};
    for (const [status, group] of byStatus) {
      const bodies = new Set(group.map((errorCase) => errorCase.body ?? "error"));
      const handlerBody = bodies.has("aiBudget") ? aiBudgetBody : errorBody;
      const hasHandlerBody = bodies.has("error") || bodies.has("aiBudget");
      let schema: z.ZodType = handlerBody;
      if (bodies.has("validation")) schema = hasHandlerBody ? z.union([validationBody, handlerBody]) : validationBody;
      responses[status] = { description: group.map((errorCase) => errorCase.text).join("; "), content: json(schema) };
    }
    return responses;
  };

  return {
    registry,
    routes: (tags) => (method, path, config) => registry.registerPath({ tags, ...config, method, path, security: common.security }),
    ok: (description, schema, extra = {}) => ({
      [extra.status ?? 200]: { description, content: json(schema), ...(extra.headers ? { headers: extra.headers } : {}) },
    }),
    fail: (...cases) => ({ ...common.authenticatedResponses(), ...errors(cases) }),
    success: (description) => common.success(description),
    aiBudgetHeaders: z.object({
      "X-AI-Budget-Warning": z.literal("true").optional().openapi({ description: "Present once the athlete has used most of their rolling 24-hour AI allowance" }),
      "X-AI-Budget-Remaining-Cents": z.string().regex(/^\d+$/).optional().openapi({ description: "Sent with X-AI-Budget-Warning: what is left of the allowance, in cents" }),
    }),
  };
}

const idParam = (description: string) => z.object({ id: z.string().openapi({ description }) });

/**
 * The coach area of the API: AI coach chat (JSON and Server-Sent Events),
 * coaching materials, the athlete card, the timeline and its AI suggestions,
 * timeline annotations and the recycle bin.
 *
 * Not registered, on purpose: GET /api/v1/timeline/ai-suggestions/debug/{workoutId},
 * a debugging aid no client calls.
 */
export function registerCoachPaths(registry: OpenAPIRegistry, common: OpenApiCommon, entities: EntityComponents): void {
  const kit = createKit(registry, common);
  const chat = registerChatComponents(registry, entities);
  registerChatPaths(kit, chat);
  registerCoachingMaterialPaths(kit);
  registerAthleteFactPaths(kit, chat.AthleteFact);
  registerTimelinePaths(kit, chat.ChatRagInfo, entities);
  registerTimelineAnnotationPaths(kit);
  registerRecycleBinPaths(kit);
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

function registerChatComponents(registry: OpenAPIRegistry, entities: EntityComponents) {
  const ChatRagInfo = registry.register(
    "ChatRagInfo",
    z
      .object({
        source: z.enum(["rag", "legacy", "none"]).openapi({ description: "rag: excerpts retrieved from the athlete's coaching materials; legacy: whole materials; none: no materials used" }),
        chunkCount: z.number().int().openapi({ description: "Excerpts the reply drew on" }),
        chunks: z.array(z.string()).optional().openapi({ description: "The excerpts themselves. Never sent in production." }),
        sources: z.array(z.string()).optional().openapi({ description: "Titles of the materials the excerpts came from, each once" }),
        materialCount: z.number().int().optional(),
        fallbackReason: z.string().optional().openapi({ description: "Never sent in production" }),
      })
      .openapi({ description: "What the coach read from the athlete's coaching materials for a reply" }),
  );

  const ChatSafetyNotice = registry.register(
    "ChatSafetyNotice",
    z
      .object({
        level: z.enum(["urgent", "caution"]).openapi({ description: "urgent: a red-flag symptom, seek medical care; caution: a heart-rate medication disclaimer" }),
        message: z.string(),
      })
      .openapi({ description: "Fixed safety copy shown above a coach reply when the athlete's own words matched the red-flag symptom or heart-rate medication patterns. Independent of what the model writes." }),
  );

  const ChatFactProposal = registry.register(
    "ChatFactProposal",
    z
      .object({
        fact: z.string(),
        category: z.enum(athleteFactCategoryEnum),
        status: z.enum(chatFactProposalStatusEnum).openapi({ description: "pending until the athlete answers with POST /api/v1/chat/messages/{id}/fact" }),
      })
      .openapi({ description: "A lasting fact the coach heard in the athlete's message and offers to put on their athlete card. Nothing is written to the card until the athlete saves it." }),
  );

  const AthleteFact = registry.register(
    "AthleteFact",
    createSelectSchema(athleteFacts)
      .extend({
        category: z.enum(athleteFactCategoryEnum),
        source: z.enum(athleteFactSourceEnum).openapi({ description: "Where the fact was first stated" }),
        active: z.boolean().openapi({ description: "False once retired; retired facts stay listed" }),
        reviewOn: z.string().openapi({ description: "YYYY-MM-DD: when to ask whether it is still true (90 days after it was stated or confirmed)", example: "2027-02-05" }),
      })
      .openapi({ description: "One statement on the athlete card: something the coach treats as true every week" }),
  );

  // The same object the plan-proposals routes return (shared/openapiRoutes/entities.ts).
  const ChatPlanProposal = entities.PlanProposal;

  const ChatMessage = registry.register(
    "ChatMessage",
    createSelectSchema(chatMessages)
      .extend({
        role: z.string().openapi({ description: '"user" or "assistant". A plain string: rows written before the role was constrained may hold another value.', example: "assistant" }),
        kind: z.enum(chatMessageKindEnum).openapi({ description: "text: an ordinary turn; proposal: a reply that carried a plan proposal (proposalId); summary: the coach's note on the earlier conversation. rolling notes are never returned by chat history." }),
        timestamp: z.string().datetime().nullable(),
        safetyNotice: ChatSafetyNotice.nullable(),
        ragInfo: ChatRagInfo.nullable(),
        feedback: z.enum(chatFeedbackEnum).nullable().openapi({ description: "The athlete's thumbs on a coach reply" }),
        factProposal: ChatFactProposal.nullable(),
        attachment: z
          .object({
            kind: z.literal("photo"),
            reading: z.string().openapi({ description: "What the photo showed, as the image reader wrote it down" }),
          })
          .nullable()
          .openapi({ description: "What came with an athlete's message; the image itself is never stored" }),
      })
      .openapi({ description: "A stored coach chat message. On a coach reply, ragInfo keeps the source, excerpt count and material titles, never the excerpts." }),
  );

  const ChatHistoryMessage = registry.register(
    "ChatHistoryMessage",
    ChatMessage.extend({ proposal: ChatPlanProposal.optional() }).openapi({
      description: "A chat message as GET /api/v1/chat/history returns it: a reply with a proposalId also carries its proposal, with its current status, while the proposal exists.",
    }),
  );

  const ChatStreamEvent = registry.register(
    "ChatStreamEvent",
    z
      .object({
        ragInfo: ChatRagInfo.optional(),
        safetyNotice: ChatSafetyNotice.optional(),
        status: z.enum(CHAT_STATUS_STEPS).optional().openapi({
          description: "What the coach is doing now, in place of typing dots; sent whenever it changes. drafting_plan: a plan proposal is being written; looking_up_*/searching_notes: a lookup is running; thinking: back to the reply.",
        }),
        text: z.string().optional().openapi({ description: "The next piece of the reply: append it to the text so far. On a proposal reply, its summary." }),
        planProposal: ChatPlanProposal.optional(),
        factProposal: ChatFactProposal.optional(),
        done: z.literal(true).optional().openapi({ description: "Last event of a reply that finished" }),
        error: z.string().optional().openapi({
          description: 'Last event of a reply that was cut short: "timeout" (the 5-minute cap; see reason) or "Stream error" (a provider failure, or the server shutting down). What was sent before it stands (and is saved, on a turn sent with the message ids).',
          example: "Stream error",
        }),
        reason: z.string().optional().openapi({ description: 'With error "timeout": a sentence to show the athlete' }),
      })
      .openapi({
        description:
          "One Server-Sent Event of the coach chat stream, sent as a `data: <json>` line followed by a blank line. Each event carries exactly one of these keys (error may come with reason), in this order: " +
          "ragInfo, the first event of every stream; " +
          "safetyNotice, only when the athlete's words matched the safety patterns, to show above the reply; " +
          "status and text events as the reply is written; " +
          "planProposal, at most once after the text, the plan change the coach drafted (status applied when the athlete's auto-apply setting already applied it); " +
          "factProposal, at most once and only on a turn sent with userMessageId/assistantMessageId, a fact offered for the athlete card (status pending), answered with POST /api/v1/chat/messages/{assistantMessageId}/fact; " +
          "and last done or error. A client that disconnects gets no closing event.",
      }),
  );

  return { ChatRagInfo, ChatSafetyNotice, ChatFactProposal, AthleteFact, ChatPlanProposal, ChatMessage, ChatHistoryMessage, ChatStreamEvent };
}

const CHAT_SAVING =
  "Send userMessageId and assistantMessageId (new UUIDs) and the server owns the conversation: it reads the history from the database, ignores `history`, and saves both turns under those ids. A retry sends the same userMessageId and names the failed reply in replaceAssistantId. Without the ids nothing is saved (the old client path).";

function registerChatPaths({ routes, ok, fail, success, aiBudgetHeaders }: Kit, chat: ReturnType<typeof registerChatComponents>): void {
  const route = routes(["Coach"]);
  const { ChatRagInfo, ChatSafetyNotice, ChatFactProposal, AthleteFact, ChatMessage, ChatHistoryMessage, ChatStreamEvent } = chat;
  const photoUnreadable: ErrorCase = { status: 502, text: "CHAT_PHOTO_UNREADABLE: the photo couldn't be read; nothing was saved and sending it again may work" };
  const sendRefusals = [VALIDATION, RATE_LIMITED, payloadTooLarge("5 MB"), AI_CONSENT, ...AI_BUDGET, photoUnreadable];
  const body = {
    content: {
      "application/json": {
        schema: chatRequestSchema,
        example: {
          message: "How should I pace my sled push at competition?",
          userMessageId: "4f1c8a2e-5b7d-4e0a-9c3f-1a2b3c4d5e6f",
          assistantMessageId: "9b2e7d41-0c6a-4f3e-8a15-2d7c9e0b4a68",
        },
      },
    },
  };

  route("post", "/api/v1/chat/stream", {
    summary: "Send a message to the coach and stream the reply",
    description: `The reply streams as Server-Sent Events (see ChatStreamEvent). ${CHAT_SAVING} The athlete's turn is saved before the first event; the reply, finished or cut off, when the stream ends. A message classified as a plan change (planEditing on) is answered with a plan proposal. Refusals before the stream starts are ordinary JSON errors; once it has started, failures arrive as a closing error event. The stream is cut at 5 minutes. Rate limited to 10/min; the body may be up to 5 MB (one photo).`,
    request: { body },
    responses: {
      200: {
        description: "The reply as a text/event-stream of `data: <ChatStreamEvent JSON>` events. Cache-Control: no-cache.",
        headers: aiBudgetHeaders,
        content: { "text/event-stream": { schema: ChatStreamEvent } },
      },
      ...fail(...sendRefusals),
    },
  });

  route("post", "/api/v1/chat", {
    summary: "Send a message to the coach (whole reply)",
    description: `The non-streaming fallback of POST /api/v1/chat/stream: one JSON reply, never a plan proposal or a fact offer. ${CHAT_SAVING} Both turns are saved only once the reply exists. Rate limited to 10/min; the body may be up to 5 MB (one photo).`,
    request: { body },
    responses: {
      ...ok(
        "The coach's reply, with safetyNotice (to show above it) when the athlete's words matched the safety patterns",
        z.object({ response: z.string(), ragInfo: ChatRagInfo, safetyNotice: ChatSafetyNotice.optional() }),
        { headers: aiBudgetHeaders },
      ),
      ...fail(...sendRefusals, ...AI_PROVIDER),
    },
  });

  route("get", "/api/v1/chat/history", {
    summary: "Get the chat history",
    description:
      "One page of a conversation, oldest first: the general one, or a workout's with focusPlanDayId / focusWorkoutLogId. When older messages exist, X-Next-Cursor and X-Next-Cursor-Id come back; pass them as before and beforeId for the previous page. Rate limited to 60/min.",
    request: { query: chatHistoryQuerySchema },
    responses: {
      ...ok("Messages, oldest first", z.array(ChatHistoryMessage), {
        headers: z.object({
          "X-Next-Cursor": z.string().datetime().optional().openapi({ description: "Only on a full page: pass as `before` for the previous page" }),
          "X-Next-Cursor-Id": z.string().optional().openapi({ description: "Only on a full page: pass as `beforeId` for the previous page" }),
        }),
      }),
      ...fail(VALIDATION),
    },
  });

  route("get", "/api/v1/chat/welcome", {
    summary: "Get the coach's opening line and prompt chips",
    description: "Built from the athlete's training with no model call, so the chat asks every time it opens. Rate limited to 30/min.",
    responses: {
      ...ok(
        "The greeting and the prompt chips under it",
        z.object({
          greeting: z.string(),
          quickActions: z.array(
            z.object({
              id: z.string().openapi({ description: 'Stable chip id. "suggestions" runs the workout-suggestions flow (POST /api/v1/timeline/ai-suggestions) instead of sending a message.', example: "today-session" }),
              label: z.string(),
              message: z.string().optional().openapi({ description: "What tapping the chip sends; the label when absent" }),
            }),
          ),
        }),
      ),
      ...fail(),
    },
  });

  route("post", "/api/v1/chat/message", {
    summary: "Save one chat message",
    description: "The old client-owned save. A client that sends message ids to the chat routes has the server save both turns and does not call this. Rate limited to 20/min.",
    request: { body: { content: json(insertChatMessageSchema) } },
    responses: { ...ok("The saved message", ChatMessage), ...fail(VALIDATION) },
  });

  route("patch", "/api/v1/chat/messages/{id}", {
    summary: "Rate a coach reply",
    description: "Thumbs up or down on one of the athlete's coach replies; null clears it. Rate limited to 60/min.",
    request: { params: idParam("The coach reply's message id"), body: { content: json(chatMessageFeedbackSchema) } },
    responses: {
      ...ok("The rating as stored", z.object({ id: z.string(), feedback: z.enum(chatFeedbackEnum).nullable() })),
      ...fail(VALIDATION, notFound("no coach reply of the athlete's with that id")),
    },
  });

  route("post", "/api/v1/chat/messages/{id}/fact", {
    tags: ["Coach", "Athlete facts"],
    summary: "Answer a fact the coach offered",
    description:
      "save puts the offered fact on the athlete card (re-confirming one it already holds) and marks the offer saved; dismiss marks it dismissed. Calls no model, so no AI consent is needed. Rate limited to 20/min.",
    request: { params: idParam("The message id of the coach reply that carried the factProposal"), body: { content: json(chatFactDecisionSchema) } },
    responses: {
      ...ok("The offer with its new status, and (on save) the card's fact", z.object({ factProposal: ChatFactProposal, fact: AthleteFact.optional() })),
      ...fail(
        VALIDATION,
        notFound("no fact is waiting for an answer on that reply"),
        conflict("ATHLETE_FACT_LIMIT: the card already holds its maximum of active facts; the offer stays pending"),
      ),
    },
  });

  route("delete", "/api/v1/chat/history", {
    summary: "Clear the chat history",
    description:
      "Deletes every chat message of the athlete's, in every conversation, and blanks the copy of the triggering message each plan proposal kept. Rate limited to 5/min.",
    responses: { ...success("Cleared"), ...fail() },
  });
}

// ---------------------------------------------------------------------------
// Coaching materials
// ---------------------------------------------------------------------------

function registerCoachingMaterialPaths({ registry, routes, ok, fail, success, aiBudgetHeaders }: Kit): void {
  const route = routes(["Coach"]);
  const materialType = z.enum(["principles", "document"]).openapi({ description: "principles: always given to the coach; document: searched for relevant excerpts" });
  const CoachingMaterial = registry.register(
    "CoachingMaterial",
    createSelectSchema(coachingMaterials)
      .extend({ type: materialType })
      .openapi({ description: "A coaching document the athlete uploaded for the coach to read" }),
  );
  const CoachingMaterialSummary = registry.register(
    "CoachingMaterialSummary",
    CoachingMaterial.omit({ content: true, userId: true })
      .extend({ contentLength: z.number().int().openapi({ description: "The text's length in characters" }) })
      .openapi({ description: "A coaching material without its text" }),
  );
  const writeRefusals = [VALIDATION, RATE_LIMITED, payloadTooLarge("2 MB"), AI_CONSENT, ...AI_BUDGET];
  const missing = notFound("no such material of the athlete's");

  route("get", "/api/v1/coaching-materials", {
    summary: "List coaching materials with their text",
    description: "Oldest first. Each material can be up to 1.5M characters; use /summaries for a list.",
    responses: { ...ok("The athlete's materials", z.array(CoachingMaterial)), ...fail() },
  });

  route("get", "/api/v1/coaching-materials/summaries", {
    summary: "List coaching materials without their text",
    responses: { ...ok("The athlete's materials, oldest first", z.array(CoachingMaterialSummary)), ...fail() },
  });

  route("post", "/api/v1/coaching-materials", {
    summary: "Add a coaching material",
    description:
      "Stores the material and queues its chunking and embedding in the background (GET /rag-status shows progress). The material's text goes to the AI provider for embedding, so AI consent and budget apply. Body up to 2 MB. Rate limited to 10/min.",
    request: { body: { content: json(createCoachingMaterialSchema) } },
    responses: { ...ok("The stored material", CoachingMaterial, { status: 201, headers: aiBudgetHeaders }), ...fail(...writeRefusals) },
  });

  route("patch", "/api/v1/coaching-materials/{id}", {
    summary: "Edit a coaching material",
    description: "A changed title or content is embedded again in the background. Body up to 2 MB. Rate limited to 10/min.",
    request: { params: idParam("The coaching material's id"), body: { content: json(updateCoachingMaterialSchema) } },
    responses: { ...ok("The updated material", CoachingMaterial, { headers: aiBudgetHeaders }), ...fail(...writeRefusals, missing) },
  });

  route("delete", "/api/v1/coaching-materials/{id}", {
    summary: "Delete a coaching material",
    description: "Also removes its excerpts from the search index. Rate limited to 10/min.",
    request: { params: idParam("The coaching material's id") },
    responses: { ...success("Deleted"), ...fail(missing) },
  });

  route("get", "/api/v1/coaching-materials/rag-status", {
    summary: "Get the coaching-material search status",
    description: "How far each material's embedding has got, and whether the embedding service is up.",
    responses: {
      ...ok(
        "The search index status",
        z.object({
          hasApiKey: z.boolean().openapi({ description: "Whether the server has an embedding provider key" }),
          totalMaterials: z.number().int(),
          totalChunks: z.number().int(),
          allEmbedded: z.boolean().openapi({ description: "Every material has embedded excerpts (false with none)" }),
          materials: z.array(
            z.object({ id: z.string(), title: z.string(), type: materialType, contentLength: z.number().int(), chunkCount: z.number().int(), hasEmbeddings: z.boolean() }),
          ),
          storedDimension: z.number().int().nullable().openapi({ description: "Dimension of the stored embeddings; null when none are stored" }),
          expectedDimension: z.number().int(),
          dimensionMismatch: z.boolean().openapi({ description: "Stored embeddings need re-embedding" }),
          embeddingApi: z.object({
            ok: z.boolean(),
            dimension: z.number().int().optional(),
            error: z.string().optional().openapi({ description: "A sentence for the athlete when ok is false" }),
          }),
        }),
      ),
      ...fail(),
    },
  });

  route("post", "/api/v1/coaching-materials/re-embed", {
    summary: "Embed every coaching material again",
    description: "Runs now, not in the background; a material that fails is reported in errors rather than failing the request. Rate limited to 5/min.",
    responses: {
      ...ok(
        "How many materials were embedded",
        z.object({
          success: z.literal(true),
          materialsProcessed: z.number().int(),
          errors: z.array(z.string()).openapi({ description: '"<materialId>: <message>" for each material that failed' }),
        }),
        { headers: aiBudgetHeaders },
      ),
      ...fail(RATE_LIMITED, AI_CONSENT, ...AI_BUDGET),
    },
  });
}

// ---------------------------------------------------------------------------
// Athlete facts
// ---------------------------------------------------------------------------

function registerAthleteFactPaths({ routes, ok, fail, success }: Kit, AthleteFact: z.ZodType): void {
  const route = routes(["Athlete facts"]);
  const missing = notFound("no such fact of the athlete's");

  route("get", "/api/v1/athlete-facts", {
    summary: "List the athlete card",
    description: "Every fact, retired ones included, oldest first.",
    responses: { ...ok("The athlete's facts", z.array(AthleteFact)), ...fail() },
  });

  route("post", "/api/v1/athlete-facts", {
    summary: "Add a fact to the athlete card",
    description:
      "A fact the card already holds (same text ignoring case, spacing and a closing full stop) is re-confirmed instead: made active again with the new wording and category, its review date moved out. Rate limited to 20/min.",
    request: { body: { content: { "application/json": { schema: createAthleteFactSchema, example: { fact: "No sled at my gym", category: "equipment" } } } } },
    responses: {
      ...ok("Added", AthleteFact, { status: 201 }),
      ...ok("The card already held it; re-confirmed", AthleteFact),
      ...fail(VALIDATION, conflict("ATHLETE_FACT_LIMIT: the card already holds its maximum of active facts")),
    },
  });

  route("post", "/api/v1/athlete-facts/import", {
    summary: "Move the old free-text constraints note onto the card",
    description:
      'Splits the athlete\'s older free-text "Injuries & Limitations" note into a fact per sentence. The note is cleared only once all of it fits under the cap. Rate limited to 20/min.',
    responses: {
      ...ok(
        "What was moved",
        z.object({
          added: z.number().int().openapi({ description: "Facts added, or re-confirmed because the card had them" }),
          skipped: z.number().int().openapi({ description: "Facts that didn't fit under the cap; the note is kept" }),
        }),
      ),
      ...fail(),
    },
  });

  route("patch", "/api/v1/athlete-facts/{id}", {
    summary: "Edit, retire, restore or confirm a fact",
    description: "Confirming (confirm: true) or restoring (active: true) moves the review date out. Rate limited to 20/min.",
    request: { params: idParam("The fact's id"), body: { content: json(updateAthleteFactSchema) } },
    responses: {
      ...ok("The updated fact", AthleteFact),
      ...fail(
        VALIDATION,
        missing,
        conflict("ATHLETE_FACT_LIMIT: restoring it would go over the active cap; ATHLETE_FACT_DUPLICATE: another fact already says the new wording"),
      ),
    },
  });

  route("delete", "/api/v1/athlete-facts/{id}", {
    summary: "Delete a fact",
    description: "Gone for good; retire it (PATCH active: false) to keep it listed. Rate limited to 20/min.",
    request: { params: idParam("The fact's id") },
    responses: { ...success("Deleted"), ...fail(missing) },
  });
}

// ---------------------------------------------------------------------------
// Timeline and its AI suggestions
// ---------------------------------------------------------------------------

function registerTimelineEntry(registry: OpenAPIRegistry, entities: EntityComponents) {
  // One component each across the document (shared/openapiRoutes/entities.ts).
  const TimelineExerciseSet = entities.ExerciseSetRow;
  const TimelineStructureBlock = entities.WorkoutStructureBlock;
  const TimelineCoachNoteInputs = entities.CoachNoteInputs;

  const log = createSelectSchema(workoutLogs).shape;
  const day = createSelectSchema(planDays).shape;
  const TimelineSessionEstimate = registry.register(
    "TimelineSessionEstimate",
    z
      .object({
        durationMin: z.number().nullable().openapi({ description: "Estimated minutes; null when the prescription has nothing to estimate from" }),
        rpe: z.number().nullable().openapi({ description: "Estimated effort, 1-10; null when nothing signals it" }),
        source: z.enum(["structure", "sets", "structure_and_sets", "none"]).openapi({ description: "What the duration was estimated from" }),
        clamped: z.boolean().openapi({ description: "The duration hit the 10 or 180 minute bound, so it is a bound rather than an estimate" }),
      })
      .openapi({
        description:
          "On upcoming planned days: the duration and effort the prescription implies, personalised by the athlete's recent run pace. What a fuelling target uses when the athlete hasn't set expectedDurationMin or expectedRpe. Not AI-refined; GET /api/v1/nutrition/planned-session-estimate/{planDayId} is.",
      }),
  );
  const omittedOtherwise = (text: string) => z.literal(true).optional().openapi({ description: `${text}; omitted otherwise` });

  return registry.register(
    "TimelineEntry",
    z
      .object({
        id: z.string().openapi({ description: '"plan-<planDayId>" for a planned day, "log-<workoutLogId>" for a logged workout', example: "plan-0b6c5a1e-4f3d-4c2b-9a8e-7d6f5e4c3b2a" }),
        date: z.string().openapi({ description: "YYYY-MM-DD the entry sits on", example: "2026-11-07" }),
        type: z.enum(["planned", "logged"]),
        status: z.enum(workoutStatusEnum),
        focus: z.string(),
        mainWorkout: z.string(),
        accessory: z.string().nullable(),
        notes: z.string().nullable(),
        // A plan day's entry (planned, or logged against it)
        excused: omittedOtherwise("A planned day inside an absence the athlete declared (timeline annotation)"),
        skipReason: z.enum(planDaySkipReasonEnum).optional().openapi({ description: "Why a skipped day was skipped, when given" }),
        priority: z.enum(planDayPriorityEnum).optional().openapi({ description: "How much the session matters; on plan-day entries except rest days" }),
        recovery: z.enum(planDayRecoveryEnum).optional().openapi({ description: "What the athlete decided after missing the session" }),
        missedOn: z.string().optional().openapi({ description: "YYYY-MM-DD a folded or shortened session was missed on" }),
        recoverable: omittedOtherwise("A recent miss the timeline should ask about (fold / shorten / let go)"),
        recoveryUndoable: omittedOtherwise("A folded or shortened session whose move can still be taken back"),
        raceDerived: omittedOtherwise("The session shown is set by the plan's race date (race, shakeout, recovery) and can't be edited"),
        expectedDurationMin: day.expectedDurationMin.optional(),
        expectedRpe: day.expectedRpe.optional(),
        plannedTimeOfDayMin: day.plannedTimeOfDayMin.optional().openapi({ description: "Planned start, minutes from midnight" }),
        planDayId: z.string().optional(),
        weekNumber: day.weekNumber.optional(),
        dayName: z.string().optional().openapi({ description: "Weekday of `date`", example: "Saturday" }),
        planName: z.string().nullable().optional(),
        planId: z.string().nullable().optional(),
        aiSource: z.string().nullable().optional().openapi({ description: 'What wrote the plan day\'s coach note ("rag", "legacy", "review", "load_governor", "progression", "generated", ...)' }),
        aiRationale: day.aiRationale.optional(),
        aiNoteUpdatedAt: z.string().datetime().nullable().optional(),
        aiInputsUsed: TimelineCoachNoteInputs.nullable().optional(),
        // A logged workout's entry
        workoutLogId: z.string().optional(),
        duration: log.duration.optional().openapi({ description: "Minutes" }),
        rpe: log.rpe.optional(),
        source: z.string().optional().openapi({ description: '"manual", "strava" or "garmin"', example: "manual" }),
        stravaActivityId: log.stravaActivityId.optional(),
        deviceLinkSource: z.enum(deviceLinkSourceEnum).nullable().optional(),
        countsAsTraining: log.countsAsTraining.optional().openapi({ description: "Absent reads as true" }),
        deviceActivityName: z.string().nullable().optional(),
        deviceSportType: z.string().nullable().optional().openapi({ description: 'The recording\'s sport ("Run", "Ride"); decides whether avgCadence is rpm or steps per minute' }),
        stoppedSeconds: z.number().nullable().optional().openapi({ description: "Seconds the recording's clock ran while the athlete was still; null when unknown" }),
        suggestedPlanDayId: log.suggestedPlanDayId.optional(),
        suggestedWorkoutLogId: log.suggestedWorkoutLogId.optional(),
        suggestedLinkConfidence: log.suggestedLinkConfidence.optional(),
        calories: log.calories.optional(),
        distanceMeters: log.distanceMeters.optional(),
        elevationGain: log.elevationGain.optional(),
        avgHeartrate: log.avgHeartrate.optional(),
        maxHeartrate: log.maxHeartrate.optional(),
        avgSpeed: log.avgSpeed.optional(),
        maxSpeed: log.maxSpeed.optional(),
        avgCadence: log.avgCadence.optional(),
        avgWatts: log.avgWatts.optional(),
        sufferScore: log.sufferScore.optional(),
        plannedSetCount: log.plannedSetCount.optional(),
        actualSetCount: log.actualSetCount.optional(),
        matchedSetCount: log.matchedSetCount.optional(),
        addedSetCount: log.addedSetCount.optional(),
        removedSetCount: log.removedSetCount.optional(),
        compliancePct: log.compliancePct.optional(),
        // Hydrated on every entry with a log or plan day
        exerciseSets: z.array(TimelineExerciseSet).optional().openapi({ description: "The log's sets, or the plan day's prescription; empty on a race-derived day" }),
        structureBlocks: z.array(TimelineStructureBlock).optional(),
        sessionEstimate: TimelineSessionEstimate.optional(),
      })
      .openapi({
        description:
          "One card on the timeline: a planned day (type planned), a workout logged against a plan day (type logged, with planDayId), or an unplanned workout (type logged, no planDayId). Fields that don't apply to the kind are omitted.",
      }),
  );
}

function registerTimelinePaths({ registry, routes, ok, fail, aiBudgetHeaders }: Kit, ChatRagInfo: z.ZodType, entities: EntityComponents): void {
  const route = routes(["Timeline"]);
  const TimelineEntry = registerTimelineEntry(registry, entities);

  route("get", "/api/v1/timeline", {
    summary: "Get the timeline",
    description:
      "Planned days and logged workouts merged, newest date first. The first page (no before) holds every entry from the athlete's today onward plus the latest `limit` past entries; when older entries exist, X-Next-Cursor carries the date to pass as `before` for the next page. Pages never split a date. Sending `offset` uses the older offset window instead, with no cursor. Rate limited to 60/min.",
    request: {
      query: z.object({
        planId: z.string().optional().openapi({ description: "Only this plan's days (all of it, retired or not) and unplanned workouts" }),
        limit: z.number().int().min(1).optional().openapi({ description: "Entries per page, not counting the first page's upcoming entries; default 200, values above 500 are treated as 500" }),
        before: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().openapi({ description: "YYYY-MM-DD: entries dated strictly before it (the previous page's X-Next-Cursor)" }),
        offset: z.number().int().min(0).optional().openapi({ description: "Legacy offset paging; no X-Next-Cursor" }),
      }),
    },
    responses: {
      ...ok("Timeline entries", z.array(TimelineEntry), {
        headers: z.object({
          "X-Next-Cursor": z.string().optional().openapi({ description: "YYYY-MM-DD to pass as `before` for older entries; absent on the last page and with offset" }),
        }),
      }),
      ...fail({ status: 400, text: "BAD_REQUEST: invalid limit, offset or before" }),
    },
  });

  const AiSuggestion = registry.register(
    "AiSuggestion",
    z
      .object({
        workoutId: z.string().openapi({ description: "The plan day's id" }),
        date: z.string().openapi({ description: "YYYY-MM-DD" }),
        focus: z.string(),
        targetField: z.enum(["notes", "mainWorkout", "accessory"]),
        action: z.enum(["replace", "append"]),
        recommendation: z.string(),
        rationale: z.string(),
        priority: z.enum(["low", "medium", "high"]),
      })
      .openapi({ description: "One change the coach suggests to an upcoming planned workout" }),
  );

  route("post", "/api/v1/timeline/ai-suggestions", {
    summary: "Get coach suggestions for upcoming workouts",
    description:
      "One model call over the next five planned days. An empty suggestions list means the coach looked and found nothing to change; a failed call is an error, except a red-flag safety escalation, which comes back as the only suggestion. Rate limited to 3/min.",
    responses: {
      ...ok(
        "The suggestions; ragInfo is absent when there were no upcoming workouts",
        z.object({
          suggestions: z.array(AiSuggestion),
          ragInfo: ChatRagInfo.optional(),
          message: z.string().optional().openapi({ description: "A note for the athlete: no upcoming workouts, a safety escalation, or why nothing changed" }),
          responseMetadata: z
            .record(
              z.string(),
              z.object({ trainingStyleId: z.string(), phase: z.string(), strategyRuleVersion: z.string(), promptBundleVersion: z.string(), rationaleCodes: z.array(z.string()).optional() }),
            )
            .optional()
            .openapi({ description: "The recommendation trace, keyed by suggestion workoutId" }),
        }),
        { headers: aiBudgetHeaders },
      ),
      ...fail(RATE_LIMITED, AI_CONSENT, ...AI_BUDGET, ...AI_PROVIDER),
    },
  });

  route("post", "/api/v1/timeline/ai-suggestions/apply", {
    summary: "Apply a coach suggestion to a plan day",
    description:
      "Writes the suggestion into the plan day's field and records it as the coach's note. On a day with an exercise table (and a target other than notes) the suggestion is parsed into table rows with one more AI call; when that can't happen the day is left unchanged and the 200 says why (applied: false). Rate limited to 10/min.",
    request: { body: { content: json(applyTimelineSuggestionSchema) } },
    responses: {
      ...ok(
        "Whether it was applied",
        z.object({
          applied: z.boolean(),
          structured: z.boolean().openapi({ description: "The exercise table was rewritten (always false when not applied)" }),
          reason: z
            .enum(["ai_budget_exceeded", "ai_disabled", "structured_parse_failed", "structured_partial_replace"])
            .optional()
            .openapi({ description: "Present when applied is false" }),
          message: z.string().optional().openapi({ description: "Present when applied is false: a sentence for the athlete" }),
        }),
      ),
      ...fail(VALIDATION, AI_CONSENT, notFound("no such plan day of the athlete's")),
    },
  });
}

// ---------------------------------------------------------------------------
// Timeline annotations
// ---------------------------------------------------------------------------

function registerTimelineAnnotationPaths({ registry, routes, ok, fail, success }: Kit): void {
  const route = routes(["Timeline"]);
  const TimelineAnnotation = registry.register(
    "TimelineAnnotation",
    createSelectSchema(timelineAnnotations)
      .extend({
        type: z.enum(["injury", "illness", "travel", "rest"]),
        startDate: z.string().openapi({ description: "YYYY-MM-DD, inclusive" }),
        endDate: z.string().openapi({ description: "YYYY-MM-DD, inclusive" }),
      })
      .openapi({ description: "An absence the athlete declared on their timeline. Planned days inside it read as excused instead of missed." }),
  );
  const missing = notFound("no such annotation of the athlete's");

  route("get", "/api/v1/timeline-annotations", {
    summary: "List timeline annotations",
    description: "Every annotation of the athlete's, by start date. Rate limited to 60/min.",
    responses: { ...ok("The annotations", z.array(TimelineAnnotation)), ...fail() },
  });

  route("post", "/api/v1/timeline-annotations", {
    summary: "Add a timeline annotation",
    description: "An injury, illness, travel or rest span from startDate to endDate. Rate limited to 20/min.",
    request: {
      body: {
        content: {
          "application/json": {
            schema: insertTimelineAnnotationSchema,
            example: { startDate: "2026-11-02", endDate: "2026-11-08", type: "illness", note: "Flu" },
          },
        },
      },
    },
    responses: { ...ok("The stored annotation", TimelineAnnotation, { status: 201 }), ...fail(VALIDATION) },
  });

  route("patch", "/api/v1/timeline-annotations/{id}", {
    summary: "Edit a timeline annotation",
    description: "Any subset of the fields; the merged dates must still be in order. Rate limited to 20/min.",
    request: { params: idParam("The annotation's id"), body: { content: json(updateTimelineAnnotationSchema) } },
    responses: {
      ...ok("The updated annotation", TimelineAnnotation),
      ...fail(
        VALIDATION,
        { status: 400, text: "VALIDATION_ERROR (ErrorResponse, details.endDate): the update would put endDate before the stored startDate, or the reverse" },
        missing,
      ),
    },
  });

  route("delete", "/api/v1/timeline-annotations/{id}", {
    summary: "Delete a timeline annotation",
    description: "Rate limited to 20/min.",
    request: { params: idParam("The annotation's id") },
    responses: { ...success("Deleted"), ...fail(missing) },
  });
}

// ---------------------------------------------------------------------------
// Recycle bin
// ---------------------------------------------------------------------------

function registerRecycleBinPaths({ registry, routes, ok, fail, success }: Kit): void {
  const route = routes(["Recycle bin"]);
  const entityType = z.enum(recycleBinEntityTypeEnum);
  const RecycleBinItem = registry.register(
    "RecycleBinItem",
    z
      .object({
        id: z.string(),
        entityType,
        entityId: z.string().openapi({ description: "The deleted record's id, which a restore brings back" }),
        batchId: z.string().nullable().openapi({ description: "Shared by every item one bulk delete produced; restore them together with /batches/{batchId}/restore" }),
        label: z.string(),
        summary: z.string().nullable(),
        entityDate: z.string().nullable().openapi({ description: "YYYY-MM-DD: the record's own date, for display" }),
        childCount: z.number().int().openapi({ description: "Sets, days or logs that come back with it" }),
        deletedAt: z.string().datetime(),
        expiresAt: z.string().datetime().openapi({ description: "When it is purged for good (90 days after the delete)" }),
      })
      .openapi({ description: "A deleted workout, plan day or plan that can still be restored" }),
  );
  const warnings = z.array(z.string()).openapi({ description: "What couldn't be put back exactly" });
  const restoreConflict = "RECYCLE_BIN_CONFLICT: the record, or its device activity, exists again";

  route("get", "/api/v1/recycle-bin", {
    summary: "List the recycle bin",
    description: "Restorable items, newest first, without their contents. Rate limited to 60/min.",
    responses: {
      ...ok(
        "The items and how many there are of each kind",
        z.object({
          items: z.array(RecycleBinItem).openapi({ description: "Capped; counts holds the true totals" }),
          counts: z.object({ total: z.number().int(), workout_log: z.number().int(), plan_day: z.number().int(), training_plan: z.number().int() }),
        }),
      ),
      ...fail(),
    },
  });

  route("post", "/api/v1/recycle-bin/{id}/restore", {
    summary: "Restore one deleted item",
    description: "Puts the record back with its original id. Rate limited to 20/min.",
    request: { params: recycleBinItemIdParamsSchema },
    responses: {
      ...ok("Restored", z.object({ ok: z.literal(true), entityType, entityId: z.string(), batchId: z.string().nullable(), warnings })),
      ...fail(
        VALIDATION,
        notFound("no such item of the athlete's, or it has expired"),
        conflict(`PLAN_OVERLAP: restoring this live plan would put it over another live plan's dates; ${restoreConflict}`),
      ),
    },
  });

  route("post", "/api/v1/recycle-bin/batches/{batchId}/restore", {
    summary: "Restore everything one bulk delete removed",
    description: "All or nothing. Rate limited to 20/min.",
    request: { params: recycleBinBatchIdParamsSchema },
    responses: {
      ...ok(
        "Restored",
        z.object({ ok: z.literal(true), batchId: z.string(), restored: z.array(z.object({ entityType, entityId: z.string() })), warnings }),
      ),
      ...fail(VALIDATION, notFound("no live items with that batch id"), conflict(restoreConflict)),
    },
  });

  route("delete", "/api/v1/recycle-bin/{id}", {
    summary: "Delete an item forever",
    description: "Rate limited to 20/min.",
    request: { params: recycleBinItemIdParamsSchema },
    responses: { ...success("Purged"), ...fail(VALIDATION, notFound("no such item of the athlete's")) },
  });

  route("delete", "/api/v1/recycle-bin", {
    summary: "Empty the recycle bin",
    description: "Purges every item of the athlete's, expired or not. Rate limited to 5/min.",
    responses: { ...ok("Emptied", z.object({ success: z.literal(true), purgedCount: z.number().int() })), ...fail() },
  });
}
