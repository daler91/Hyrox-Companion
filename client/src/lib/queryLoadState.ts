import type { FetchStatus } from "@tanstack/react-query";

/** The fields of a query result that say whether it has answered. */
export interface QueryLoadSnapshot {
  readonly data: unknown;
  readonly errorUpdateCount: number;
  readonly fetchStatus: FetchStatus;
}

export interface QueryLoadState {
  /** No answer yet, including a first fetch paused offline. */
  readonly loading: boolean;
  /** An attempt failed and there is nothing to show. */
  readonly failed: boolean;
  /** Failed, and a retry is in flight or waiting for the network. */
  readonly retrying: boolean;
}

/**
 * Where a query stands, so that having no data is never read as an empty
 * account. A query with data has answered. Without data it is either:
 * - loading: it has not answered yet. This includes a first fetch paused
 *   because the browser is offline, which is pending but not `isLoading`,
 *   and which rendered the first-run welcome, a 0 kcal day and every
 *   analytics tab's "nothing logged yet".
 * - failed: an attempt failed. A retry of a query with no data resets it to
 *   pending, so neither `isError` nor `isRefetching` sees the retry, but the
 *   failure count does. The error stays up while the retry runs, and
 *   `retrying` says it is in flight or waiting for the network.
 * Placeholder data counts as an answer: it is what the page shows meanwhile.
 * U5 (CODEBASE_ANALYSIS_2026-10-03)
 */
export function queryLoadState({
  data,
  errorUpdateCount,
  fetchStatus,
}: QueryLoadSnapshot): QueryLoadState {
  const answered = data !== undefined;
  const failed = !answered && errorUpdateCount > 0;
  return { loading: !answered && !failed, failed, retrying: failed && fetchStatus !== "idle" };
}
