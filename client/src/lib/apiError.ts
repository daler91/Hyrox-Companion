/** A failed apiRequest, as its error message reports it. */
export interface ParsedApiError {
  /** The response's HTTP status. */
  readonly status: number;
  /** The `code` in the server's JSON body; null when it has none or is not JSON. */
  readonly code: string | null;
}

/**
 * The status and error code of a failed apiRequest, or null for any other
 * error. apiRequest throws `${status}: ${body}` for a non-ok response, and the
 * server's JSON body names the failure in `code`. A TypeError, a timeout,
 * RateLimitError or a failed CSRF token fetch has no such prefix; a proxy's
 * error page or a bare status text has a status but no code.
 *
 * Shared, so a caller reads that message here rather than with a private
 * copy, as the offline queue, the workout save and Settings each did. String
 * ops, not a regex, so it stays off SonarCloud's security-sensitive-regex
 * hotspot. CL34 (CODEBASE_ANALYSIS_2026-10-03)
 */
export function parseApiError(error: unknown): ParsedApiError | null {
  if (!(error instanceof Error)) return null;
  const { message } = error;
  const head = message.slice(0, 3);
  const isStatus = message.charAt(3) === ":" && Array.from(head).every((c) => c >= "0" && c <= "9");
  if (!isStatus) return null;
  return { status: Number(head), code: bodyCode(message.slice(4)) };
}

/** The string `code` of a JSON error body, or null. */
function bodyCode(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { code?: unknown } | null;
    return typeof parsed?.code === "string" ? parsed.code : null;
  } catch {
    return null;
  }
}

/** The string `code` of an object (an error payload or response body), or null. */
function objectCode(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const code = (value as Record<string, unknown>).code;
  return typeof code === "string" ? code : null;
}

/**
 * The error code a thrown value carries on itself: its own `code`, else a
 * non-empty `payload.code`, else a non-empty `response.data.code`; null for
 * anything else. It does not read the message (`extractApiErrorCode` does).
 *
 * The workout save and the plan-day parse each kept a private copy, and only
 * the save's read `response.data`. No error the client API throws has a
 * `response` (apiRequest throws a plain Error, RateLimitError or
 * AiBudgetExceededError; a timeout is a DOMException), so the parse reads the
 * same codes it did. (CH-errorCode, REFACTORING_REVIEW 2026-09-23)
 */
export function extractErrorObjectCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;

  const asRecord = error as Record<string, unknown>;
  if (typeof asRecord.code === "string") return asRecord.code;

  const payloadCode = objectCode(asRecord.payload);
  if (payloadCode) return payloadCode;

  const response = typeof asRecord.response === "object" ? (asRecord.response as Record<string, unknown> | null) : null;
  return objectCode(response?.data) || null;
}

/**
 * The error code of a failed request: the one the error carries itself
 * (`extractErrorObjectCode`), else the one in apiRequest's
 * `${status}: ${body}` message (`parseApiError`).
 * (CH-errorCode, REFACTORING_REVIEW 2026-09-23)
 */
export function extractApiErrorCode(error: unknown): string | null {
  return extractErrorObjectCode(error) ?? parseApiError(error)?.code ?? null;
}
