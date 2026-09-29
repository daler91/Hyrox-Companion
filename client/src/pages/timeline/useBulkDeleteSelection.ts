import type { TimelineEntry } from "@shared/schema";
import { useCallback, useMemo, useState } from "react";

import {
  getBulkDeleteSelectionKey,
  isTimelineEntryBulkDeletable,
} from "@/hooks/workout-actions/bulkDelete";

type TimelineEntryGroup = readonly [string, TimelineEntry[]];

export function useBulkDeleteSelection(allVisibleGroups: readonly TimelineEntryGroup[]) {
  const [bulkDeleteMode, setBulkDeleteMode] = useState(false);
  const [selectedBulkEntryKeys, setSelectedBulkEntryKeys] = useState<Set<string>>(() => new Set());
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);

  // ⚡ Bolt Optimization: Replace flatMap().filter() with for...of to avoid intermediate arrays
  const bulkDeletableEntries = useMemo(() => {
    const deletable = [];
    for (const [, entries] of allVisibleGroups) {
      for (const entry of entries) {
        if (isTimelineEntryBulkDeletable(entry)) {
          deletable.push(entry);
        }
      }
    }
    return deletable;
  }, [allVisibleGroups]);

  // ⚡ Bolt Optimization: Replace map().filter() with for...of
  const bulkDeletableEntryKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const entry of bulkDeletableEntries) {
      const key = getBulkDeleteSelectionKey(entry);
      if (key) keys.add(key);
    }
    return keys;
  }, [bulkDeletableEntries]);
  const selectedBulkEntries = useMemo(
    () =>
      bulkDeletableEntries.filter((entry) => {
        const key = getBulkDeleteSelectionKey(entry);
        return key ? selectedBulkEntryKeys.has(key) : false;
      }),
    [bulkDeletableEntries, selectedBulkEntryKeys],
  );

  const clearBulkSelection = useCallback(() => {
    setSelectedBulkEntryKeys(new Set());
  }, []);

  const handleBulkDeleteModeChange = useCallback((enabled: boolean) => {
    setBulkDeleteMode(enabled);
    if (!enabled) {
      setSelectedBulkEntryKeys(new Set());
      setBulkDeleteConfirmOpen(false);
    }
  }, []);

  const handleBulkSelectToggle = useCallback((entry: TimelineEntry) => {
    const key = getBulkDeleteSelectionKey(entry);
    if (!key) return;
    setSelectedBulkEntryKeys((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const handleBulkSelectAll = useCallback(() => {
    setSelectedBulkEntryKeys(new Set(bulkDeletableEntryKeys));
  }, [bulkDeletableEntryKeys]);

  const finishBulkDelete = useCallback(() => {
    setBulkDeleteConfirmOpen(false);
    setSelectedBulkEntryKeys(new Set());
    setBulkDeleteMode(false);
  }, []);

  return {
    bulkDeleteMode,
    bulkDeleteConfirmOpen,
    setBulkDeleteConfirmOpen,
    bulkDeletableEntries,
    selectedBulkEntries,
    selectedBulkEntryKeys,
    clearBulkSelection,
    finishBulkDelete,
    handleBulkDeleteModeChange,
    handleBulkSelectAll,
    handleBulkSelectToggle,
  };
}
