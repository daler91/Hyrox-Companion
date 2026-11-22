import { visionBreaker } from "../../ai/circuitBreaker";
import { AppError, ErrorCode } from "../../errors";
import { GEMINI_VISION_MODEL, getAiClient, retryWithBackoff, trackUsageFromResponse } from "../../gemini/client";
import { logger } from "../../logger";
import { validateAiOutput } from "../../utils/sanitize";

/**
 * Shared Gemini-direct vision plumbing for every photo parser: the nutrition
 * meal and label parsers, the chat photo, and the exercise image parse
 * (server/gemini/exerciseParser/provider.ts, which used to carry its own copy;
 * C-vision, REFACTORING_REVIEW 2026-09-23). The provider abstraction has no
 * vision method, so they talk to the Gemini client directly with the image as
 * `inlineData` and a JSON response contract; only the prompts, labels, and
 * error strings differ, so the request/usage/empty-response handling lives here
 * once.
 */
export async function callGeminiVisionJson(opts: {
  imageBase64: string;
  mimeType: string;
  /** Usage is recorded against this athlete; an exercise parse with none records nothing. */
  userId: string | undefined;
  systemInstruction: string;
  /** The text part sent alongside the image, e.g. the transcription instruction. */
  userText: string;
  /** retryWithBackoff label, e.g. "nutrition-meal-parse-image". */
  retryLabel: string;
  /** AppError message for an empty model response. */
  emptyResponseMessage: string;
  /** When set, logged with the response before an empty response's AppError. */
  emptyResponseLog?: string;
}): Promise<string> {
  const response = await retryWithBackoff(
    (signal) =>
      getAiClient().models.generateContent({
        model: GEMINI_VISION_MODEL,
        config: {
          systemInstruction: opts.systemInstruction,
          responseMimeType: "application/json",
          abortSignal: signal,
        },
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: opts.mimeType, data: opts.imageBase64 } },
              { text: opts.userText },
            ],
          },
        ],
      }),
    opts.retryLabel,
    // Vision has its own breaker, apart from the text provider's — AI2
    // (CODEBASE_ANALYSIS_2026-10-03).
    visionBreaker,
  );

  // Track usage before the empty check — the call consumed tokens regardless.
  if (opts.userId) trackUsageFromResponse(opts.userId, GEMINI_VISION_MODEL, "parse", response);

  if (!response.text || response.text.length === 0) {
    // bearer:disable javascript_lang_logger_leak
    if (opts.emptyResponseLog) logger.error({ response }, opts.emptyResponseLog);
    throw new AppError(ErrorCode.AI_ERROR, opts.emptyResponseMessage, 502);
  }
  return validateAiOutput(response.text);
}

/**
 * JSON.parse an AI response, folding a parse failure into the parser's own
 * static log line + AppError (the messages are caller-supplied so they stay
 * static — never interpolate the response into them).
 */
export function parseAiJson(
  responseText: string,
  opts: { logMessage: string; errorMessage: string },
): unknown {
  try {
    return JSON.parse(responseText);
  } catch {
    logger.error(opts.logMessage);
    throw new AppError(ErrorCode.AI_ERROR, opts.errorMessage, 502);
  }
}
