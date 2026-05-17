import { apiRequest } from "../queryClient";

/** Default request timeout in milliseconds (15 seconds). */
const DEFAULT_TIMEOUT_MS = 15_000;

interface RequestOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

function withTimeout(timeoutMs: number, existingSignal?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), timeoutMs);

  // If an existing signal is provided, forward its abort to our controller
  if (existingSignal) {
    if (existingSignal.aborted) {
      controller.abort(existingSignal.reason);
    } else {
      existingSignal.addEventListener("abort", () => controller.abort(existingSignal.reason), { once: true });
    }
  }

  return { signal: controller.signal, cleanup: () => clearTimeout(timer) };
}

export async function typedRequest<TResponse extends object>(
  method: string,
  url: string,
  data?: unknown,
  options?: RequestOptions,
): Promise<TResponse> {
  const { signal, cleanup } = withTimeout(options?.timeoutMs ?? DEFAULT_TIMEOUT_MS, options?.signal);
  try {
    const res = options?.headers === undefined
      ? await apiRequest(method, url, data, signal)
      : await apiRequest(method, url, data, signal, options.headers);
    return res.json() as Promise<TResponse>;
  } finally {
    cleanup();
  }
}

export function rawRequest(
  method: string,
  url: string,
  data?: unknown,
  options?: RequestOptions,
): Promise<Response> {
  const { signal, cleanup } = withTimeout(options?.timeoutMs ?? DEFAULT_TIMEOUT_MS, options?.signal);
  const request = options?.headers === undefined
    ? apiRequest(method, url, data, signal)
    : apiRequest(method, url, data, signal, options.headers);
  return request.finally(cleanup);
}
