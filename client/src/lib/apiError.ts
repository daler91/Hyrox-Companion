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
