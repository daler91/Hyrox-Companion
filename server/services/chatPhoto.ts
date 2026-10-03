import type { ChatPhoto } from "@shared/schema";
import { z } from "zod";

import { AppError, ErrorCode } from "../errors";
import { logger } from "../logger";
import { CHAT_PHOTO_READING_PROMPT } from "../prompts";
import { callGeminiVisionJson, parseAiJson } from "./nutrition/visionParsing";

/** The most of a photo's reading the coach is given and the message keeps. */
export const CHAT_PHOTO_READING_MAX_CHARS = 1_500;

const UNREADABLE = "Couldn't read that photo. Try again, or say what it shows.";

const photoReadingSchema = z.object({ reading: z.string().trim().min(1) });

/**
 * Read a photo the athlete attached to a chat message into words for the
 * coach (AI coach chat review, I20), with the Gemini vision call the meal and
 * workout photo parsers make. The image goes no further: the reading is what
 * the coach sees and the message keeps. A photo that can't be read refuses the
 * send with CHAT_PHOTO_UNREADABLE, before anything is saved.
 */
export async function readChatPhoto(photo: ChatPhoto, userId: string): Promise<string> {
  try {
    const text = await callGeminiVisionJson({
      imageBase64: photo.imageBase64,
      mimeType: photo.mimeType,
      userId,
      systemInstruction: CHAT_PHOTO_READING_PROMPT,
      userText: "Write down what this photo shows, for the coach.",
      retryLabel: "chat-photo-read",
      emptyResponseMessage: UNREADABLE,
    });
    const parsed = photoReadingSchema.safeParse(
      parseAiJson(text, { logMessage: "[chat-photo] The reading wasn't JSON", errorMessage: UNREADABLE }),
    );
    if (!parsed.success) throw new AppError(ErrorCode.AI_ERROR, UNREADABLE, 502);
    return parsed.data.reading.slice(0, CHAT_PHOTO_READING_MAX_CHARS);
  } catch (error) {
    // A provider or parse error; never the photo or what it showed.
    // bearer:disable javascript_lang_logger_leak
    logger.warn({ err: error }, "[chat-photo] Couldn't read the athlete's photo");
    throw new AppError(ErrorCode.CHAT_PHOTO_UNREADABLE, UNREADABLE, 502);
  }
}
