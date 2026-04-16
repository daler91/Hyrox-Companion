export enum ErrorCode {
  VALIDATION_ERROR = "VALIDATION_ERROR",
  NOT_FOUND = "NOT_FOUND",
  FORBIDDEN = "FORBIDDEN",
  UNAUTHORIZED = "UNAUTHORIZED",
  CONFLICT = "CONFLICT",
  RATE_LIMITED = "RATE_LIMITED",
  AI_TIMEOUT = "AI_TIMEOUT",
  AI_ERROR = "AI_ERROR",
  AI_QUOTA_EXCEEDED = "AI_QUOTA_EXCEEDED",
  AI_INVALID_INPUT = "AI_INVALID_INPUT",
  AI_UNAVAILABLE = "AI_UNAVAILABLE",
  EXTERNAL_API_ERROR = "EXTERNAL_API_ERROR",
  INTERNAL_ERROR = "INTERNAL_ERROR",
}

/**
 * Classify a raw Gemini/google-genai SDK error into a more specific ErrorCode
 * plus the appropriate HTTP status and a user-facing message (S7). Falls back
 * to a generic AI_ERROR when the message doesn't match any known pattern.
 */
export function classifyAiError(err: unknown): { code: ErrorCode; status: number; message: string } {
  let raw = "";
  if (err instanceof Error) {
    raw = err.message;
  } else if (typeof err === "string") {
    raw = err;
  } else if (err != null) {
    // Avoid the default [object Object] stringification for arbitrary throws.
    try { raw = JSON.stringify(err); } catch { raw = ""; }
  }
  const lower = raw.toLowerCase();
  if (/quota|rate.?limit|resource.?exhausted|429/.test(lower)) {
    return { code: ErrorCode.AI_QUOTA_EXCEEDED, status: 429, message: "AI quota exceeded — try again in a few minutes." };
  }
  if (/invalid|bad.?request|400|unsupported/.test(lower)) {
    return { code: ErrorCode.AI_INVALID_INPUT, status: 400, message: "AI rejected the request as invalid — try rephrasing." };
  }
  if (/unavailable|502|503|504|deadline|timeout/.test(lower)) {
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
