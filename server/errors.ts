/**
 * Every `code` the API emits. The catalogue used to hold thirteen of the
 * ~35 codes routes actually sent, so a client matching on a code had no
 * single place to look them up and nothing stopped a typo shipping (A6).
 * server/__tests__/errorCodeCatalogue.test.ts fails the suite when a route
 * emits a code that is not listed here.
 */
export enum ErrorCode {
  VALIDATION_ERROR = "VALIDATION_ERROR",
  BAD_REQUEST = "BAD_REQUEST",
  NOT_FOUND = "NOT_FOUND",
  FORBIDDEN = "FORBIDDEN",
  UNAUTHORIZED = "UNAUTHORIZED",
  CONFLICT = "CONFLICT",
  PRECONDITION_FAILED = "PRECONDITION_FAILED",
  PAYLOAD_TOO_LARGE = "PAYLOAD_TOO_LARGE",
  RATE_LIMITED = "RATE_LIMITED",
  COOLDOWN = "COOLDOWN",
  IDEMPOTENT_REQUEST_IN_PROGRESS = "IDEMPOTENT_REQUEST_IN_PROGRESS",
  INVALID_TIMEZONE = "INVALID_TIMEZONE",
  INVALID_CSV = "INVALID_CSV",
  STRUCTURED_ROWS_REQUIRED = "STRUCTURED_ROWS_REQUIRED",
  PARSE_WRITE_THROUGH_REQUIRED = "PARSE_WRITE_THROUGH_REQUIRED",
  EMOM_BUILDER_DISABLED = "EMOM_BUILDER_DISABLED",
  MAF_SETUP_REQUIRED = "MAF_SETUP_REQUIRED",
  PUSH_NOT_CONFIGURED = "PUSH_NOT_CONFIGURED",
  PLAN_OVERLAP = "PLAN_OVERLAP",
  PLAN_GENERATION_IN_PROGRESS = "PLAN_GENERATION_IN_PROGRESS",
  AI_TIMEOUT = "AI_TIMEOUT",
  AI_ERROR = "AI_ERROR",
  AI_QUOTA_EXCEEDED = "AI_QUOTA_EXCEEDED",
  AI_INVALID_INPUT = "AI_INVALID_INPUT",
  AI_UNAVAILABLE = "AI_UNAVAILABLE",
  AI_UPSTREAM_FAILURE = "AI_UPSTREAM_FAILURE",
  AI_FEATURES_DISABLED = "AI_FEATURES_DISABLED",
  AI_COACH_DISABLED = "AI_COACH_DISABLED",
  AI_BUDGET_EXCEEDED = "AI_BUDGET_EXCEEDED",
  AI_BUDGET_UNAVAILABLE = "AI_BUDGET_UNAVAILABLE",
  STRAVA_REAUTH_REQUIRED = "STRAVA_REAUTH_REQUIRED",
  GARMIN_NOT_CONNECTED = "GARMIN_NOT_CONNECTED",
  GARMIN_RECONNECT_REQUIRED = "GARMIN_RECONNECT_REQUIRED",
  GARMIN_AUTH_FAILED = "GARMIN_AUTH_FAILED",
  GARMIN_API_ERROR = "GARMIN_API_ERROR",
  GARMIN_BUSY = "GARMIN_BUSY",
  GARMIN_CIRCUIT_OPEN = "GARMIN_CIRCUIT_OPEN",
  GARMIN_SYNC_TOO_SOON = "GARMIN_SYNC_TOO_SOON",
  EXTERNAL_API_ERROR = "EXTERNAL_API_ERROR",
  INTERNAL_ERROR = "INTERNAL_ERROR",
  INTERNAL_SERVER_ERROR = "INTERNAL_SERVER_ERROR",
}

/** The message text of an arbitrary throw, for pattern classification. */
function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err != null) {
    // Avoid the default [object Object] stringification for arbitrary throws.
    try { return JSON.stringify(err); } catch { return ""; }
  }
  return "";
}

// One pattern list, shared by classifyAiError and isLikelyAiProviderFailure.
// plans.ts kept its own copy that had already drifted ("429" matched one and
// not the other), so a reparse failure could be classified as an AI outage by
// one helper and as a non-AI error by the other (A6).
const AI_QUOTA_PATTERN = /quota|rate.?limit|resource.?exhausted|429/;
const AI_INVALID_PATTERN = /invalid|bad.?request|400|unsupported/;
const AI_UNAVAILABLE_PATTERN = /unavailable|502|503|504|deadline|timeout|timed.?out|overloaded|upstream/;
const AI_PROVIDER_PATTERN = /gemini|google\.?genai|\bai\b/;

/**
 * Whether an unknown throw looks like it came from the AI provider (as opposed
 * to, say, a storage failure in the same handler), so the caller can route it
 * through classifyAiError rather than report a generic 500.
 */
export function isLikelyAiProviderFailure(err: unknown): boolean {
  const lower = errorText(err).toLowerCase();
  return (
    AI_PROVIDER_PATTERN.test(lower) ||
    AI_QUOTA_PATTERN.test(lower) ||
    AI_UNAVAILABLE_PATTERN.test(lower)
  );
}

/**
 * Classify a raw AI provider error into a more specific ErrorCode
 * plus the appropriate HTTP status and a user-facing message (S7). Falls back
 * to a generic AI_ERROR when the message doesn't match any known pattern.
 */
export function classifyAiError(err: unknown): { code: ErrorCode; status: number; message: string } {
  const lower = errorText(err).toLowerCase();
  if (AI_QUOTA_PATTERN.test(lower)) {
    return { code: ErrorCode.AI_QUOTA_EXCEEDED, status: 429, message: "AI quota exceeded — try again in a few minutes." };
  }
  if (AI_INVALID_PATTERN.test(lower)) {
    return { code: ErrorCode.AI_INVALID_INPUT, status: 400, message: "AI rejected the request as invalid — try rephrasing." };
  }
  if (AI_UNAVAILABLE_PATTERN.test(lower)) {
    return { code: ErrorCode.AI_UNAVAILABLE, status: 503, message: "AI service temporarily unavailable." };
  }
  return { code: ErrorCode.AI_ERROR, status: 502, message: "Failed to get response from AI coach" };
}

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: number = 500,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}
