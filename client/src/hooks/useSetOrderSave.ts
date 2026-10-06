import type { ExerciseSet } from "@shared/schema";
import { useCallback, useRef } from "react";

import { useApiMutation } from "@/hooks/useApiMutation";
import { parseApiError } from "@/lib/apiError";
import { humanizeApiError, queryClient } from "@/lib/queryClient";

type QueryKey = readonly unknown[];
type SortOrderById = ReadonlyMap<string, number>;

/** Saves an owner's whole set order (every set id, in order) and resolves to its sets as stored. */
export type SaveSetOrderRequest = (
  ownerId: string,
  setIds: readonly string[],
) => Promise<ExerciseSet[]>;

interface SetOrderVariables {
  /** Named here, not read from the render: a save that lands after the sheet moved on still updates its owner. */
  readonly ownerId: string;
  readonly setIds: readonly string[];
  /** Which save this is, so an earlier one's response cannot undo a later drag's order. */
  readonly seq: number;
}

export interface SetOrderSaveParams {
  readonly ownerId: string | null;
  /** The owner's set-write family: the save counts towards its `isSaving`, so the save pill and "Complete workout" see it. */
  readonly mutationKey: QueryKey | undefined;
  readonly setsQueryKey: (ownerId: string) => QueryKey;
  readonly patchCachedSets: (
    ownerId: string,
    updater: (sets: ExerciseSet[]) => ExerciseSet[],
  ) => void;
  /** Omitted for an owner without the one-request order route; its table then has no order save. */
  readonly request: SaveSetOrderRequest | undefined;
  readonly onSaved: () => void;
  readonly onFailed: () => void;
}

// One order save at a time, so two quick drags reach the server in the order
// they were made. Fixed rather than per owner: a pending mutation takes the
// latest render's options, and the scope must not change under it.
const SET_ORDER_SAVE_SCOPE = { id: "exercise-set-order-save" };

/** A save's error is the mutation's to report (its toast, its refetch); the tracker only notes whether it landed. */
function landed(): boolean {
  return true;
}

function failed(): boolean {
  return false;
}

/** Writes new positions only: a cell edit still waiting to save keeps its optimistic value. */
function withSortOrders(sets: readonly ExerciseSet[], sortOrderById: SortOrderById): ExerciseSet[] {
  return sets.map((set) => {
    const sortOrder = sortOrderById.get(set.id);
    return sortOrder === undefined || sortOrder === set.sortOrder ? set : { ...set, sortOrder };
  });
}

function positionsOf(setIds: readonly string[]): SortOrderById {
  return new Map(setIds.map((setId, position) => [setId, position]));
}

function storedPositions(saved: readonly ExerciseSet[]): SortOrderById {
  return new Map(saved.map((set) => [set.id, set.sortOrder ?? 0]));
}

function requireRequest(request: SaveSetOrderRequest | undefined): SaveSetOrderRequest {
  if (!request) throw new Error("This list's order can't be saved.");
  return request;
}

function failureToast(error: Error) {
  // Another device added or removed a set since this list was read.
  if (parseApiError(error)?.status === 409) {
    return { title: "This workout changed elsewhere", description: "Showing the latest order." };
  }
  return { title: "Couldn't save the new order", description: humanizeApiError(error) };
}

/**
 * Shows a dragged exercise's new order at once and saves all of it in one
 * request. A drag used to queue one debounced PATCH per moved set: the list
 * snapped back to the old order until the queue fired, a long list could use
 * up the set-write rate limit, and a partial failure split an exercise between
 * saved and unsaved rows, a split a refetch kept. The server writes the whole
 * order or none of it, so a failure puts the stored order back. PF5
 * (CODEBASE_ANALYSIS_2026-10-03)
 *
 * The save is one of the owner's set writes, not a side request: it carries
 * the owner's mutation key, so `isSaving` holds "Complete workout" and the save
 * pill shows it, and `settleSetOrderSaves` lets the owner's flush wait for it
 * and report a failure. Run beside them, "Complete workout" copied the plan
 * day in its pre-drag order and a failed order save went unnoticed.
 */
export function useSetOrderSave({
  ownerId,
  mutationKey,
  setsQueryKey,
  patchCachedSets,
  request,
  onSaved,
  onFailed,
}: SetOrderSaveParams) {
  // Sent and not yet settled; each removes itself once it has.
  const inFlightRef = useRef<Set<Promise<boolean>>>(new Set());
  const latestSeqRef = useRef(0);

  const { mutateAsync } = useApiMutation<ExerciseSet[], Error, SetOrderVariables>({
    mutationKey,
    scope: SET_ORDER_SAVE_SCOPE,
    mutationFn: ({ ownerId: target, setIds }) => requireRequest(request)(target, setIds),
    onMutate: async ({ ownerId: target, setIds }) => {
      // A refetch landing after the optimistic write would put the old order back.
      await queryClient.cancelQueries({ queryKey: setsQueryKey(target) });
      patchCachedSets(target, (sets) => withSortOrders(sets, positionsOf(setIds)));
    },
    onSuccess: (saved, { ownerId: target, seq }) => {
      if (seq === latestSeqRef.current) {
        patchCachedSets(target, (sets) => withSortOrders(sets, storedPositions(saved)));
      }
      onSaved();
    },
    onError: async (_error, { ownerId: target }) => {
      onFailed();
      await queryClient.invalidateQueries({ queryKey: setsQueryKey(target) });
    },
    errorToast: failureToast,
  });

  const saveSetOrder = useCallback(
    (setIds: readonly string[]) => {
      if (!ownerId) return;
      latestSeqRef.current += 1;
      const sent = mutateAsync({ ownerId, setIds, seq: latestSeqRef.current }).then(landed, failed);
      const inFlight = inFlightRef.current;
      inFlight.add(sent);
      sent
        .finally(() => {
          inFlight.delete(sent);
        })
        .catch(() => undefined);
    },
    [ownerId, mutateAsync],
  );

  /** Waits for the order saves already sent; false when any of them failed. */
  const settleSetOrderSaves = useCallback(async (): Promise<boolean> => {
    const outcomes = await Promise.all(inFlightRef.current);
    return outcomes.every(Boolean);
  }, []);

  return { saveSetOrder: request ? saveSetOrder : undefined, settleSetOrderSaves };
}
