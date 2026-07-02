import { isTimeoutLikeApiError } from "@/lib/api";
import { createOfflineMutationId, enqueueMutation } from "@/lib/offlineQueue";

export type OfflineFallbackResult<TData> =
  | { status: "saved"; data: TData }
  | { status: "queued"; id: string };

interface RunWithOfflineFallbackOptions<TData> {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
  /**
   * The live API call. Receives the pre-generated idempotency key (undefined
   * only when secure randomness is unavailable) so a request that times out
   * mid-flight and then gets queued replays under the SAME key and dedupes
   * server-side.
   */
  readonly perform: (idempotencyKey: string | undefined) => Promise<TData>;
}

/**
 * Shared offline fallback for queue-backed mutations: skip the network when
 * the browser is offline, otherwise attempt the live call and enqueue on
 * connectivity-shaped failures. Application errors (4xx/5xx responses) are
 * rethrown — only transport failures are queued. Callers branch on the
 * returned status for queued-specific UX (toast copy, skipping invalidation).
 */
export async function runWithOfflineFallback<TData>(
  options: RunWithOfflineFallbackOptions<TData>,
): Promise<OfflineFallbackResult<TData>> {
  if (isBrowserOffline()) {
    const id = createOfflineMutationId();
    enqueueMutation(options.method, options.url, options.body, { id });
    return { status: "queued", id };
  }

  const idempotencyKey = createOptionalIdempotencyKey();

  try {
    return { status: "saved", data: await options.perform(idempotencyKey) };
  } catch (error) {
    if (isConnectivityFailure(error)) {
      const id = idempotencyKey ?? createOfflineMutationId();
      enqueueMutation(options.method, options.url, options.body, { id });
      return { status: "queued", id };
    }
    throw error;
  }
}

export function createOptionalIdempotencyKey(): string | undefined {
  try {
    return createOfflineMutationId();
  } catch (error) {
    if (error instanceof TypeError) return undefined;
    throw error;
  }
}

export function isBrowserOffline(): boolean {
  return globalThis.navigator?.onLine === false;
}

export function isConnectivityFailure(error: unknown): boolean {
  if (isBrowserOffline() || isTimeoutLikeApiError(error)) return true;
  if (error instanceof TypeError) return true;
  if (error instanceof DOMException) {
    return error.name === "AbortError" || error.name === "NetworkError" || error.name === "TimeoutError";
  }
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();
  if (message.startsWith("failed to fetch csrf token")) return false;
  return (
    message.includes("failed to fetch") ||
    message.includes("load failed") ||
    message.includes("network error") ||
    message.includes("networkerror")
  );
}
