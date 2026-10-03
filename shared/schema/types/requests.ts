import { CHAT_MESSAGE_MAX_LENGTH, CHAT_PHOTO_MAX_BASE64_CHARS } from "../../chat";
import { WEEKLY_REVIEW_INTENT_MAX_LENGTH } from "../../weeklyReview";
import { chatFeedbackEnum } from "../enums";
import { chatMessages } from "../tables";
import { createInsertSchema, z } from "../zod";
// Chat message types and schemas
/**
 * The body of POST /api/v1/chat/message: which side spoke, and what it said.
 *
 * The `role` column is a bare varchar(20), so the generated schema accepted any
 * short string — a client could seed "system" turns (or anything else) into its
 * own stored history, which `chatService` then replays into the model context.
 * The conversation only has two sides; constrain to exactly those, and bound
 * the content so a single message can't be used to park a large blob in the
 * chat table.
 *
 * Only these two fields. The schema used to omit just `id` and `timestamp`,
 * which left `userId` required: the client never sends one (the server takes
 * it from the session), so every save was refused with a 400 the client did
 * not surface. The metadata columns (kind, proposal, safety notice, retrieval,
 * focus) are the server's to write.
 */
export const insertChatMessageSchema = createInsertSchema(chatMessages)
  .pick({ role: true, content: true })
  .extend({
    role: z.enum(["user", "assistant"]),
    content: z.string().min(1).max(50_000),
  });

export type ChatMessageBody = z.infer<typeof insertChatMessageSchema>;

/** Body for `PATCH /api/v1/chat/messages/:id`: the athlete's thumbs on a coach reply, or null to clear it (I23). */
export const chatMessageFeedbackSchema = z.object({ feedback: z.enum(chatFeedbackEnum).nullable() });
export type ChatMessageFeedbackBody = z.infer<typeof chatMessageFeedbackSchema>;

/** Body for `POST /api/v1/chat/messages/:id/fact`: the athlete's answer to a fact the coach offered (I5b). */
export const chatFactDecisionSchema = z.object({ decision: z.enum(["save", "dismiss"]) });
export type ChatFactDecisionBody = z.infer<typeof chatFactDecisionSchema>;
/** A chat row as the server writes it; the user id is always the session's. */
export type InsertChatMessage = typeof chatMessages.$inferInsert;
export type ChatMessage = typeof chatMessages.$inferSelect;

// Request Validation Schemas
export const dateStringSchema = z
  .string()
  .max(10)
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be a valid date in YYYY-MM-DD format");

/**
 * Body for `POST /api/v1/weekly-review/intent`. `week` is any date inside the
 * target week — the handler anchors it to the Monday, exactly as the review's
 * GET does with `?week=`. A null or blank intent clears the week's line.
 */
export const weeklyReviewIntentSchema = z.object({
  week: dateStringSchema,
  intent: z
    .string()
    .max(WEEKLY_REVIEW_INTENT_MAX_LENGTH, `Intent must be ${WEEKLY_REVIEW_INTENT_MAX_LENGTH} characters or less`)
    .nullable()
    .optional(),
});

export const parseExercisesRequestSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, "Text is required")
    .max(2000, "Text must be 2000 characters or less"),
});

/**
 * Image-parse request. We transport the image as a base64 string inside the
 * JSON body (no multer / multipart) so the global body parser and CSRF
 * pipeline apply unchanged; the route caps body size at 10MB on its own
 * express.json() middleware. The base64 length cap matches that budget —
 * an accepted string can decode to ~7.5MB of image bytes, which is
 * comfortably above the ≤1.5MB payloads the client compresses to.
 */
export const ALLOWED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

/**
 * Leading bytes each accepted format must start with, as base64-decoded bytes.
 * WebP is RIFF....WEBP — bytes 0-3 and 8-11 — so it is checked in two pieces.
 */
const IMAGE_MAGIC_BYTES: Record<AllowedImageMimeType, { offset: number; bytes: number[] }[]> = {
  "image/jpeg": [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }],
  "image/png": [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  "image/webp": [
    { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }, // "RIFF"
    { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] }, // "WEBP"
  ],
};

/** Decode just the first `byteCount` bytes of a base64 string. */
function decodeBase64Prefix(base64: string, byteCount: number): Uint8Array | null {
  // 4 base64 chars encode 3 bytes; take enough chars to cover byteCount.
  const charCount = Math.ceil(byteCount / 3) * 4;
  const prefix = base64.slice(0, charCount);
  try {
    const binary = atob(prefix);
    const out = new Uint8Array(Math.min(binary.length, byteCount));
    // atob yields one code unit per byte (all < 0x100), so codePointAt === charCodeAt here.
    for (let i = 0; i < out.length; i++) out[i] = binary.codePointAt(i) ?? 0;
    return out;
  } catch {
    return null; // not valid base64
  }
}

/**
 * Check the payload actually is the format it claims to be.
 *
 * The enum only constrained the mimeType STRING — the bytes were forwarded to
 * the vision model untouched, so a mislabelled or non-image payload was billed
 * for and sent upstream before anything noticed. This is a cheap sanity check
 * on the first few bytes, not a full decode: it makes the declared type and the
 * content agree, which is what the downstream inlineData contract assumes.
 */
function imageBytesMatchDeclaredType(
  mimeType: AllowedImageMimeType,
  imageBase64: string,
): boolean {
  const signatures = IMAGE_MAGIC_BYTES[mimeType];
  const needed = Math.max(...signatures.map((s) => s.offset + s.bytes.length));
  const decoded = decodeBase64Prefix(imageBase64, needed);
  if (!decoded || decoded.length < needed) return false;
  return signatures.every((sig) =>
    sig.bytes.every((byte, i) => decoded[sig.offset + i] === byte),
  );
}

/** An image in a JSON body: an accepted type, base64 within `maxChars`, whose bytes really are that type. */
function base64ImageSchema(maxChars: number, tooLarge: string) {
  return z
    .object({
      mimeType: z.enum(ALLOWED_IMAGE_MIME_TYPES),
      imageBase64: z.string().min(1, "Image is required").max(maxChars, tooLarge),
    })
    .superRefine((value, ctx) => {
      if (!imageBytesMatchDeclaredType(value.mimeType, value.imageBase64)) {
        ctx.addIssue({
          code: "custom",
          path: ["imageBase64"],
          message: `Image data is not a valid ${value.mimeType} file`,
        });
      }
    });
}

export const parseExercisesFromImageRequestSchema = base64ImageSchema(10 * 1024 * 1024, "Image must be 10MB or less");
export type ParseExercisesFromImageRequest = z.infer<typeof parseExercisesFromImageRequestSchema>;

/** A photo attached to a chat message (AI coach chat review, I20). */
export const chatPhotoSchema = base64ImageSchema(CHAT_PHOTO_MAX_BASE64_CHARS, "Photo must be 3MB or less");
export type ChatPhoto = z.infer<typeof chatPhotoSchema>;

export const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z
    .string()
    .min(1, "Message content cannot be empty")
    .max(50000, "Message must be 50000 characters or less"),
});

export const chatRequestSchema = z.object({
  message: z
    .string()
    .min(1, "Message is required")
    .max(CHAT_MESSAGE_MAX_LENGTH, `Message must be ${CHAT_MESSAGE_MAX_LENGTH} characters or less`),
  history: z
    .array(chatMessageSchema)
    .optional()
    .default([])
    .transform((h) => h.slice(-20)),
  // Conversational plan editing: opt-out flag for chat surfaces that don't
  // render proposal cards.
  planEditing: z.boolean().optional().default(true),
  // The workout the athlete is viewing when chatting from the workout-detail
  // dialog: its plan day ("make this day easier") and/or its log. The server
  // loads them, ownership-checked, into the chat prompt's FOCUSED WORKOUT.
  focusPlanDayId: z.string().max(255).optional(),
  focusWorkoutLogId: z.string().max(255).optional(),
  // The server-owned conversation (server/services/chatConversation.ts): a
  // client that sends its message ids has the server save both turns and read
  // the history from the database, ignoring `history`. A retry sends the same
  // userMessageId (saved once) and the failed reply's id to replace.
  userMessageId: z.uuid().optional(),
  assistantMessageId: z.uuid().optional(),
  replaceAssistantId: z.uuid().optional(),
  // One photo with the message (I20): read for the coach, never stored.
  photo: chatPhotoSchema.optional(),
})
  .refine((body) => (body.userMessageId === undefined) === (body.assistantMessageId === undefined), {
    message: "Send userMessageId and assistantMessageId together",
    path: ["assistantMessageId"],
  })
  .refine((body) => body.userMessageId === undefined || body.userMessageId !== body.assistantMessageId, {
    message: "userMessageId and assistantMessageId must differ",
    path: ["assistantMessageId"],
  });

export const importPlanRequestSchema = z.object({
  csvContent: z
    .string()
    .min(1, "CSV content is required")
    .max(100000, "CSV content must be 100,000 characters or less"),
  fileName: z.string().max(255, "File name must be 255 characters or less").optional(),
  planName: z.string().max(255, "Plan name must be 255 characters or less").optional(),
});

export const schedulePlanRequestSchema = z.object({
  startDate: dateStringSchema,
});

// 🛡️ Sentinel: numeric bounds on measurable fields
// (CODEBASE_REVIEW_2026-04-12.md #33). Prevents negative weights from stray
// minus signs in voice input and unreasonable distances/times that would
// break analytics aggregates downstream. exerciseSetSchema is reused for
// AI-parsed output so reps uses .min(0) (Gemini may legitimately emit a
// zero-rep "failed attempt" row); incomingExerciseSchema is user-submitted
// and uses .min(1) on reps since a zero-rep user log is meaningless.

