import { describeAiError } from "@/lib/describeAiError";
import { AiBudgetExceededError, humanizeApiError, RateLimitError } from "@/lib/queryClient";
import { SSEStreamError } from "@/lib/sseStream";

/** How a failed chat send should read, and whether sending it again could help. */
export interface ChatFailureDescription {
  /** The athlete pressed Stop. */
  readonly aborted: boolean;
  /** One sentence for the athlete, shown on the failed reply and announced. */
  readonly message: string;
  /**
   * A transient failure worth a Retry button. A spent daily budget, or a
   * request the server refused as invalid, fails the same way again.
   */
  readonly retryable: boolean;
}

export const CHAT_GENERIC_FAILURE = "Something went wrong on our side. Please try again.";
const CHAT_NETWORK_FAILURE = "Your connection dropped. Check your internet and try again.";
const CHAT_SLOW_FAILURE = "The coach took too long to start replying. Please try again.";

/**
 * 5xx bodies are never shown (see humanizeApiError), but these two are
 * operator conditions with a known code, so they get fixed copy instead of
 * "something went wrong" — and no Retry, which cannot clear either.
 */
const KNOWN_UNAVAILABLE_CODES: Readonly<Record<string, string>> = {
  AI_FEATURES_DISABLED: "AI coaching is switched off for now. Please try again later.",
  AI_GLOBAL_BUDGET_EXCEEDED: "The AI coach is very busy right now. Please try again later.",
};

const failure = (message: string, retryable: boolean): ChatFailureDescription => ({
  aborted: false,
  message,
  retryable,
});

/**
 * The HTTP status and body of an apiRequest error (thrown as "403: {...}"), or
 * null for any other error. String ops rather than a regex, for the same
 * SonarCloud hotspot reason as humanizeApiError.
 */
function parseHttpError(error: Error): { status: number; body: string } | null {
  const head = error.message.slice(0, 3);
  const isStatus = error.message[3] === ":" && [...head].every((c) => c >= "0" && c <= "9");
  return isStatus ? { status: Number(head), body: error.message.slice(4).trimStart() } : null;
}

function knownUnavailableMessage(body: string): string | null {
  try {
    const code = (JSON.parse(body) as { code?: unknown } | null)?.code;
    return typeof code === "string" ? (KNOWN_UNAVAILABLE_CODES[code] ?? null) : null;
  } catch {
    return null;
  }
}

function describeHttpFailure(error: Error): ChatFailureDescription {
  const http = parseHttpError(error);
  if (!http) return failure(CHAT_GENERIC_FAILURE, true);
  if (http.status < 500) {
    // The server refused the request (AI coaching off, a message over the
    // limit): its own message says why, and resending won't change it.
    return failure(humanizeApiError(error), false);
  }
  const unavailable = knownUnavailableMessage(http.body);
  return unavailable ? failure(unavailable, false) : failure(CHAT_GENERIC_FAILURE, true);
}

/** Turn a rejected chat send into what the athlete should read. */
export function describeChatFailure(error: unknown): ChatFailureDescription {
  if (error instanceof DOMException && error.name === "AbortError") {
    return { aborted: true, message: "Stopped.", retryable: false };
  }
  if (error instanceof SSEStreamError) {
    // The server's named endings carry a sentence written for the athlete.
    // An expired session needs a sign-in, not a retry.
    return failure(error.reason ?? CHAT_GENERIC_FAILURE, error.message !== "auth-expired");
  }
  if (error instanceof AiBudgetExceededError || error instanceof RateLimitError) {
    const message = describeAiError(error, {
      rateLimitActivity: "sending messages",
      slow: CHAT_SLOW_FAILURE,
      fallback: CHAT_GENERIC_FAILURE,
    });
    return failure(message, error instanceof RateLimitError);
  }
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return failure(CHAT_SLOW_FAILURE, true);
  }
  // fetch reports a dropped connection as a TypeError.
  if (error instanceof TypeError) return failure(CHAT_NETWORK_FAILURE, true);
  if (error instanceof Error) return describeHttpFailure(error);
  return failure(CHAT_GENERIC_FAILURE, true);
}
