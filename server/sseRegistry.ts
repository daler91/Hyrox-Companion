import { logger } from "./logger";

// Registry of in-flight SSE AbortControllers. `/api/v1/chat/stream`
// registers its controller on connection and unregisters when the
// handler exits. On SIGTERM/SIGINT we call `drainSseStreams` to abort
// every active stream so their handlers reach `res.end()` promptly —
// otherwise `httpServer.close()` would wait on long-lived streams and
// always hit the shutdown-timeout force-exit path (CODEBASE_AUDIT.md §3).
const activeControllers = new Set<AbortController>();

export function registerSseStream(controller: AbortController): () => void {
  activeControllers.add(controller);
  return () => {
    activeControllers.delete(controller);
  };
}

export function activeSseStreamCount(): number {
  return activeControllers.size;
}

/**
 * Abort every in-flight SSE controller and wait up to `timeoutMs` for
 * their handlers to clear the registry (via the unregister callback).
 * Returns the remaining count if the timeout is reached so callers can
 * decide whether to force-close sockets.
 */
export async function drainSseStreams(timeoutMs = 5_000): Promise<number> {
  if (activeControllers.size === 0) return 0;
  logger.info({ count: activeControllers.size }, "Aborting in-flight SSE streams for shutdown");
  for (const controller of activeControllers) {
    try {
      controller.abort();
    } catch {
      // Individual aborts can't fail meaningfully; swallow to keep draining.
    }
  }
  const deadline = Date.now() + timeoutMs;
  while (activeControllers.size > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return activeControllers.size;
}

// Exported for testing so suites can reset state between cases.
export function __resetSseRegistryForTests(): void {
  activeControllers.clear();
}
