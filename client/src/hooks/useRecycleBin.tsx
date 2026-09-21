import type {
  RecycleBinBatchRestoreResult,
  RecycleBinListResponse,
  RecycleBinRestoreResult,
} from "@shared/schema";
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";

import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import { api, QUERY_KEYS } from "@/lib/api";
import { humanizeApiError } from "@/lib/queryClient";

import { useApiMutation } from "./useApiMutation";

/**
 * Everything a restore can change on screen: the bin itself, the timeline
 * and plans it puts records back on, and the analytics that count them.
 * Mirrors the invalidations the delete mutations already run.
 */
const RESTORE_INVALIDATIONS = [
  QUERY_KEYS.recycleBin,
  QUERY_KEYS.timeline,
  QUERY_KEYS.workouts,
  QUERY_KEYS.plans,
  QUERY_KEYS.personalRecords,
  QUERY_KEYS.exerciseAnalytics,
  QUERY_KEYS.trainingOverview,
];

export function useRecycleBin(enabled = true) {
  return useQuery<RecycleBinListResponse>({
    queryKey: QUERY_KEYS.recycleBin,
    queryFn: () => api.recycleBin.list(),
    enabled,
  });
}

/** The server explains a refused restore in its own words; keep them, but name the two known cases. */
function restoreErrorToast(error: Error): { title: string; description: string } {
  const message = error.message;
  if (message.includes("PLAN_OVERLAP") || message.includes("already covers")) {
    return {
      title: "Can't restore this plan yet",
      description: "Another plan already covers these dates. Archive that one first.",
    };
  }
  if (message.includes("RECYCLE_BIN_CONFLICT")) {
    return { title: "Couldn't restore", description: humanizeApiError(error) };
  }
  return { title: "Couldn't restore", description: humanizeApiError(error) };
}

function restoredToast(warnings: string[]): { title: string; description?: string } {
  return warnings.length > 0
    ? { title: "Restored", description: warnings.join(" ") }
    : { title: "Restored" };
}

export function useRestoreRecycleBinItem() {
  return useApiMutation<RecycleBinRestoreResult, Error, string>({
    mutationFn: (id) => api.recycleBin.restore(id),
    invalidateQueries: RESTORE_INVALIDATIONS,
    successToast: (data) => restoredToast(data.ok ? data.warnings : []),
    errorToast: restoreErrorToast,
  });
}

export function useRestoreRecycleBinBatch() {
  return useApiMutation<RecycleBinBatchRestoreResult, Error, string>({
    mutationFn: (batchId) => api.recycleBin.restoreBatch(batchId),
    invalidateQueries: RESTORE_INVALIDATIONS,
    successToast: (data) => restoredToast(data.ok ? data.warnings : []),
    errorToast: restoreErrorToast,
  });
}

export function usePurgeRecycleBinItem() {
  return useApiMutation<{ success: boolean }, Error, string>({
    mutationFn: (id) => api.recycleBin.purge(id),
    invalidateQueries: [QUERY_KEYS.recycleBin],
    successToast: "Deleted forever",
    errorToast: "Couldn't delete that item",
  });
}

export function useEmptyRecycleBin() {
  return useApiMutation<{ success: boolean; purgedCount: number }, Error, void>({
    mutationFn: () => api.recycleBin.empty(),
    invalidateQueries: [QUERY_KEYS.recycleBin],
    successToast: (data) => ({
      title:
        data.purgedCount === 1
          ? "1 item deleted forever"
          : `${data.purgedCount} items deleted forever`,
    }),
    errorToast: "Couldn't empty the recycle bin",
  });
}

export type UndoDeleteTarget = { readonly itemId: string } | { readonly batchId: string };

export interface UndoDeleteToastOptions {
  readonly title: string;
  readonly description?: string;
  readonly target: UndoDeleteTarget;
}

/**
 * The delete toast with an Undo action. One toast is visible at a time and it
 * lives a few seconds (client/src/hooks/constants.ts), so this is the fast
 * path for a mis-tap; the Settings → Recycle bin tab is the durable
 * one. A single delete undoes by item id; a bulk delete by its batch id, so
 * the whole selection comes back together.
 */
export function useUndoDeleteToast() {
  const { toast } = useToast();
  const restoreItem = useRestoreRecycleBinItem();
  const restoreBatch = useRestoreRecycleBinBatch();
  const { mutate: restoreItemMutate } = restoreItem;
  const { mutate: restoreBatchMutate } = restoreBatch;

  return useCallback(
    ({ title, description, target }: UndoDeleteToastOptions) => {
      toast({
        title,
        description,
        action: (
          <ToastAction
            altText="Undo delete"
            data-testid="button-undo-delete"
            onClick={() => {
              if ("itemId" in target) restoreItemMutate(target.itemId);
              else restoreBatchMutate(target.batchId);
            }}
          >
            Undo
          </ToastAction>
        ),
      });
    },
    [toast, restoreItemMutate, restoreBatchMutate],
  );
}
