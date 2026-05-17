import { chatMessages } from "../tables";
import { createInsertSchema, z } from "../zod";
// Chat message types and schemas
export const insertChatMessageSchema = createInsertSchema(chatMessages).omit({
  id: true,
  timestamp: true,
});

export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type ChatMessage = typeof chatMessages.$inferSelect;

// Request Validation Schemas
export const dateStringSchema = z
  .string()
  .max(10)
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be a valid date in YYYY-MM-DD format");

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
    .max(1000, "Message must be 1000 characters or less"),
  history: z
    .array(chatMessageSchema)
    .optional()
    .default([])
    .transform((h) => h.slice(-20)),
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
export const parseExercisesFromImageRequestSchema = z.object({
  mimeType: z.enum(ALLOWED_IMAGE_MIME_TYPES),
  imageBase64: z
    .string()
    .min(1, "Image is required")
    .max(10 * 1024 * 1024, "Image must be 10MB or less"),
});
export type ParseExercisesFromImageRequest = z.infer<typeof parseExercisesFromImageRequestSchema>;

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

