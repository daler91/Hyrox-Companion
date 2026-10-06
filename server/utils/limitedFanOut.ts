import pLimit from "p-limit";

/**
 * Run `step` over `items`, at most `concurrency` at once, and collect what each
 * returns in item order — for a fan-out of paid calls where one failure fails
 * the whole result.
 *
 * The first step to reject aborts the signal every step is given, so steps
 * still running can cancel their calls, and steps not yet started throw before
 * doing anything. On its own, `Promise.all` over p-limit rejects at the first
 * failure while p-limit goes on starting every queued step, each a billed call
 * for a result that can no longer be used. Queued steps still start and settle
 * rather than being dropped with `clearQueue`, which would either leave their
 * promises pending forever or reject them ahead of the real error. The returned
 * promise rejects with the first failure. The caller's own `signal`, when
 * given, cancels the run the same way.
 * PF15 (CODEBASE_ANALYSIS_2026-10-03)
 */
export async function mapLimitedUntilFailure<T, R>(
  items: readonly T[],
  concurrency: number,
  step: (item: T, signal: AbortSignal) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const failure = new AbortController();
  const stepSignal = signal ? AbortSignal.any([signal, failure.signal]) : failure.signal;
  const limit = pLimit(concurrency);
  return await Promise.all(
    items.map((item) =>
      limit(async () => {
        stepSignal.throwIfAborted();
        try {
          return await step(item, stepSignal);
        } catch (error) {
          failure.abort(error);
          throw error;
        }
      }),
    ),
  );
}
