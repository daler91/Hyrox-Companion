import type {
  RecycleBinBatchRestoreResult,
  RecycleBinListResponse,
  RecycleBinRestoreResult,
} from "@shared/schema";

import { typedRequest } from "./client";

/**
 * The recycle bin: snapshots the server writes when a workout, plan day or
 * training plan is deleted, restorable for 90 days. `restore` undoes one
 * delete; `restoreBatch` undoes a whole bulk delete (its `batchId` comes back
 * on the bulk-delete response). A refused restore is an HTTP error (404 for
 * an unknown/expired item, 409 for an overlap or conflict), so a resolved
 * promise is always the `ok: true` shape.
 */
export const recycleBin = {
  list: () => typedRequest<RecycleBinListResponse>("GET", "/api/v1/recycle-bin"),

  restore: (id: string) =>
    typedRequest<RecycleBinRestoreResult>("POST", `/api/v1/recycle-bin/${id}/restore`, {}),

  restoreBatch: (batchId: string) =>
    typedRequest<RecycleBinBatchRestoreResult>(
      "POST",
      `/api/v1/recycle-bin/batches/${batchId}/restore`,
      {},
    ),

  /** "Delete forever". */
  purge: (id: string) => typedRequest<{ success: boolean }>("DELETE", `/api/v1/recycle-bin/${id}`),

  /** "Empty bin". */
  empty: () =>
    typedRequest<{ success: boolean; purgedCount: number }>("DELETE", "/api/v1/recycle-bin"),
} as const;
