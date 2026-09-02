import { AppError, ErrorCode } from "../errors";
import { logger } from "../logger";

/**
 * Safely encodes HTML special characters to their corresponding HTML entities.
 * This prevents XSS attacks when rendering un-trusted data.
 */
export function sanitizeHtml(str: string): string {
  if (typeof str !== "string") return str;
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Sanitizes user input specifically for AI prompt injection prevention.
 * Replaces XML-like tags to ensure users cannot break out of <user_input> delimiters
 * or inject fake system tags.
 */
export function sanitizeUserInput(input: string): string {
  if (typeof input !== "string") return input;
  // Use existing sanitizeHtml logic which handles < and >
  return sanitizeHtml(input);
}


// Restricted keywords/phrases that indicate prompt injection leakage. We don't
// want the AI acknowledging "system prompt", "instructions", or using fake XML
// tags.
const RESTRICTED_PATTERNS = ["<system>", "</system>", "system prompt", "ignore previous instructions"] as const;

// Suspicious variants (bracket/brace system markers, jailbreak phrases) are
// logged for forensic analysis, not blocked — a blacklist is inherently
// incomplete, so the primary defense is structured output, not filtering.
const SUSPICIOUS_PATTERNS = [
  "[system]",
  "{system}",
  "you are an ai",
  "as an ai",
  "override instructions",
  "developer mode",
  "jailbreak",
] as const;

const LONGEST_PATTERN_LENGTH = Math.max(
  ...RESTRICTED_PATTERNS.map((p) => p.length),
  ...SUSPICIOUS_PATTERNS.map((p) => p.length),
);

/**
 * The first pattern whose match ENDS after `afterIndex` in `lowerText`, or
 * null. A match that lies entirely before `afterIndex` was already judged on
 * an earlier call (see createStreamingOutputValidator) and is not reported
 * again.
 */
function findPatternEndingAfter(
  lowerText: string,
  patterns: readonly string[],
  afterIndex: number,
): string | null {
  for (const pattern of patterns) {
    let from = 0;
    for (;;) {
      const index = lowerText.indexOf(pattern, from);
      if (index === -1) break;
      if (index + pattern.length > afterIndex) return pattern;
      from = index + 1;
    }
  }
  return null;
}

function checkAiOutput(output: string, afterIndex: number): void {
  const lowerOutput = output.toLowerCase();
  if (findPatternEndingAfter(lowerOutput, RESTRICTED_PATTERNS, afterIndex)) {
    throw new AppError(
      ErrorCode.AI_ERROR,
      "AI output validation failed: detected restricted system-level content",
      502,
    );
  }
  const suspicious = findPatternEndingAfter(lowerOutput, SUSPICIOUS_PATTERNS, afterIndex);
  if (suspicious) {
    logger.warn({ context: "ai-output-validation", pattern: suspicious }, "Suspicious AI output pattern detected");
  }
}

/**
 * Validates AI output to detect prompt injection leakage or unexpected system-level content.
 * Throws an error or returns a safe fallback if restricted content is detected.
 */
export function validateAiOutput(output: string): string {
  if (typeof output !== "string") return output;
  checkAiOutput(output, 0);
  return output;
}

/**
 * validateAiOutput for a STREAMED response, one chunk at a time.
 *
 * Validating each SSE chunk on its own let a restricted phrase that the
 * provider happened to split across two chunks ("…my system pr" + "ompt…")
 * sail through the primary chat surface (S4). The returned function keeps the
 * tail of what it has already seen — one character short of the longest
 * pattern, the most any single match can straddle — and checks each new chunk
 * together with that tail, so a boundary-split pattern is caught on the chunk
 * that completes it. Matches wholly inside the tail were judged on an earlier
 * call and are not raised twice.
 *
 * Streaming is inherently best-effort: the chunks before the completing one
 * have already been sent. What this closes is the filter bypass, so the
 * stream is cut and the failure surfaced instead of the phrase being
 * delivered in full.
 */
export function createStreamingOutputValidator(): (chunk: string) => string {
  let tail = "";
  return (chunk: string): string => {
    if (typeof chunk !== "string") return chunk;
    const window = tail + chunk;
    checkAiOutput(window, tail.length);
    tail = window.slice(-(LONGEST_PATTERN_LENGTH - 1));
    return chunk;
  };
}
