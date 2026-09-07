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
    // `suspicious` is one of the static SUSPICIOUS_PATTERNS literals above,
    // never a slice of the model's output.
    // bearer:disable javascript_lang_logger_leak
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
 * call and are not raised twice. It throws on a restricted match and returns
 * nothing otherwise; the caller forwards the chunk it already holds.
 *
 * Streaming is inherently best-effort: the chunks before the completing one
 * have already been sent. What this closes is the filter bypass, so the
 * stream is cut and the failure surfaced instead of the phrase being
 * delivered in full.
 */
export function createStreamingOutputValidator(): (chunk: string) => void {
  let tail = "";
  return (chunk: string): void => {
    if (typeof chunk !== "string") return;
    const window = tail + chunk;
    checkAiOutput(window, tail.length);
    tail = window.slice(-(LONGEST_PATTERN_LENGTH - 1));
  };
}

/**
 * Strip control characters from a value on its way into a log line.
 *
 * Anything derived from model output is attacker-influenceable — the parsers
 * echo whatever the athlete typed — and a newline inside a logged string forges
 * a second log record. `server/gemini/exerciseParser/validation.ts` established
 * this boundary; it lives here so the other sites that log model output share
 * one implementation rather than each remembering.
 *
 * This is the log-injection boundary, the third in this file alongside
 * `sanitizeHtml` (XSS) and `sanitizeUserInput` (prompt injection).
 */
export function sanitizeForLog(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, " ");
}

/** One zod issue, structurally — avoids importing zod into this module. */
interface LoggableZodIssue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

/**
 * Reduce zod issues to a single sanitized `path:message | path:message` line.
 *
 * The issue objects themselves do not echo the offending input — checked
 * against zod 4: `code`, `expected`, `values` (the ALLOWED set) and `message`
 * describe the constraint, not the value. What they do carry is `path`, and a
 * path element is an object key straight from the parsed payload, so a model
 * that emits `{"a\nFORGED": 1}` puts a newline into the log line. Hence the
 * sanitize, and hence formatting here rather than logging `error.issues` raw.
 *
 * Capped at four issues: a badly-shaped row produces one per field, and the
 * first few are enough to tell which schema it failed.
 */
export function formatZodIssues(issues: readonly LoggableZodIssue[]): string {
  return sanitizeForLog(
    issues
      .slice(0, 4)
      .map((issue) => `${issue.path.map(String).join(".") || "<root>"}:${issue.message}`)
      .join(" | "),
  );
}
