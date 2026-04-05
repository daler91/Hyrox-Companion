import { QueryClient, QueryFunction } from "@tanstack/react-query";

export class RateLimitError extends Error {
  readonly retryAfter: number | null;

  constructor(message: string, retryAfter: number | null) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
  }
}

// CSRF token cache — the server issues a token via GET /api/v1/csrf-token
// paired with a signed cookie. We fetch once, reuse, and refetch on 403 so
// the first mutation after login (which rebinds the session id) recovers
// automatically.
let csrfTokenPromise: Promise<string> | null = null;
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

async function fetchCsrfToken(): Promise<string> {
  const res = await fetch("/api/v1/csrf-token", { credentials: "include" });
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

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;

    if (res.status === 429) {
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
