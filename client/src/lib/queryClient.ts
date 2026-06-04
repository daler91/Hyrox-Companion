import { QueryClient, QueryFunction } from "@tanstack/react-query";

export class RateLimitError extends Error {
  readonly retryAfter: number | null;

  constructor(message: string, retryAfter: number | null) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
  }
}

export class AiBudgetExceededError extends Error {
  readonly currentCostCents: number;
  readonly limitCents: number;

  constructor(message: string, currentCostCents: number, limitCents: number) {
    super(message);
    this.name = "AiBudgetExceededError";
    this.currentCostCents = currentCostCents;
    this.limitCents = limitCents;
  }
}

function extractServerMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { error?: unknown; message?: unknown };
    const msg = parsed.error ?? parsed.message;
    return typeof msg === "string" && msg.trim().length > 0 ? msg : null;
  } catch {
    return null;
  }
}

/**
 * Turn a thrown API error into a short, human-readable message for toasts.
 * `apiRequest` throws `new Error(`${status}: ${body}`)` for non-ok responses;
 * surfacing that raw string (e.g. `500: {"error":...}`) to users is confusing,
 * so map status ranges to friendly copy and, for other 4xx, prefer the server's
 * own `error` message when present. Non-API errors (network/abort) fall back to
 * their own message or a generic line.
 */
export function humanizeApiError(error: unknown): string {
  const raw = error instanceof Error ? error.message : "";
  // apiRequest throws `${status}: ${body}` where status is a 3-digit HTTP code.
  // Parse it without a regex (string ops only) so this stays off SonarCloud's
  // "regex is security-sensitive" hotspot rule — equivalent and ReDoS-free.
  const colonIdx = raw.indexOf(":");
  const head = colonIdx >= 0 ? raw.slice(0, colonIdx) : "";
  const isHttpStatus = head.length === 3 && [...head].every((c) => c >= "0" && c <= "9");
  if (!isHttpStatus) {
    return raw.trim() || "Something went wrong. Please try again.";
  }
  const status = Number(head);
  // Never surface 5xx bodies — they can carry internals and the server already
  // masks them to "Internal Server Error".
  if (status >= 500) return "Something went wrong on our end. Please try again in a moment.";
  // For 4xx, prefer the server's own actionable message — these are crafted to
  // be shown (Strava "not connected or token expired", AI-consent "enable it in
  // Settings", Zod validation errors). Fall back to friendly status-specific
  // copy only for plain/empty bodies (e.g. a bare "Unauthorized"/"Forbidden").
  const body = raw.slice(colonIdx + 1).trimStart();
  const serverMessage = extractServerMessage(body);
  if (serverMessage) return serverMessage;
  if (status === 401) return "Your session has expired. Please sign in again.";
  if (status === 403) return "You don't have permission to do that.";
  if (status === 404) return "We couldn't find that — it may have already been removed.";
  if (status === 409) return "That conflicts with a more recent change. Refresh and try again.";
  if (status === 413) return "That upload is too large. Try a smaller file or split it up.";
  return "That didn't work — please check your input and try again.";
}

// CSRF token cache — the server issues a token via GET /api/v1/csrf-token
// paired with a signed cookie. We fetch once, reuse, and refetch on 403 so
// the first mutation after login (which rebinds the session id) recovers
// automatically.
let csrfTokenPromise: Promise<string> | null = null;
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

async function fetchCsrfToken(): Promise<string> {
  // W15: bound the request so a stalled network doesn't hang the first mutation
  // after load indefinitely (the caller surfaces the failure to the user).
  const res = await fetch("/api/v1/csrf-token", {
    credentials: "include",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch CSRF token: ${res.status}`);
  }
  const body = (await res.json()) as { csrfToken: string };
  return body.csrfToken;
}

async function getCsrfToken(forceRefresh = false): Promise<string> {
  if (forceRefresh || !csrfTokenPromise) {
    csrfTokenPromise = fetchCsrfToken().catch((err) => {
      csrfTokenPromise = null;
      throw err;
    });
  }
  return csrfTokenPromise;
}

/** Clear the cached CSRF token. Call on auth state transitions so the next
 *  mutation fetches a token bound to the new session identifier. */
export function resetCsrfToken(): void {
  csrfTokenPromise = null;
}

function tryParseAiBudgetError(text: string): AiBudgetExceededError | null {
  try {
    const body = JSON.parse(text) as { code?: string; currentCostCents?: number; limitCents?: number };
    if (body.code === "AI_BUDGET_EXCEEDED") {
      return new AiBudgetExceededError(
        "Daily AI usage limit reached. Your limit resets on a rolling 24-hour basis.",
        body.currentCostCents ?? 0,
        body.limitCents ?? 200,
      );
    }
  } catch {
    // Not JSON — fall through
  }
  return null;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;

    if (res.status === 429) {
      const budgetError = tryParseAiBudgetError(text);
      if (budgetError) throw budgetError;

      const retryAfterRaw = res.headers.get("Retry-After");
      const retryAfter = retryAfterRaw ? Number.parseInt(retryAfterRaw, 10) : null;
      throw new RateLimitError(
        text,
        Number.isNaN(retryAfter) ? null : retryAfter,
      );
    }

    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown,
  signal?: AbortSignal,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  const isMutation = MUTATING_METHODS.has(method.toUpperCase());
  const baseHeaders: Record<string, string> = {
    ...(data ? { "Content-Type": "application/json" } : {}),
    ...extraHeaders,
  };

  const doFetch = async (csrfToken?: string) => {
    const headers = csrfToken ? { ...baseHeaders, "x-csrf-token": csrfToken } : baseHeaders;
    return fetch(url, {
      method,
      headers,
      body: data ? JSON.stringify(data) : undefined,
      credentials: "include",
      signal,
    });
  };

  let res: Response;
  if (isMutation) {
    const token = await getCsrfToken();
    res = await doFetch(token);
    // On 403 the token may have been invalidated (e.g. session rebind after
    // login). Refresh once and retry before surfacing the error.
    if (res.status === 403) {
      const freshToken = await getCsrfToken(true);
      res = await doFetch(freshToken);
    }
  } else {
    res = await doFetch();
  }

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey, signal }) => {
    // Query keys are path segments (e.g. ["/api/v1", "workouts"]) joined to form the URL
    const res = await fetch(queryKey.join("/"), {
      credentials: "include",
      signal,
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- json() returns any; typed via QueryFunction<T>
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000,
      retry: 1,
    },
    mutations: {
      retry: false,
    },
  },
});
