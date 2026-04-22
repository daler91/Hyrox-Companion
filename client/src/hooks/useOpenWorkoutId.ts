import { useCallback } from "react";
import { useLocation, useSearch } from "wouter";

export interface UseOpenWorkoutIdResult {
  openWorkoutId: string | null;
  setOpenWorkoutId: (id: string | null) => void;
}

export function useOpenWorkoutId(): UseOpenWorkoutIdResult {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const openWorkoutId = new URLSearchParams(search).get("workout");

  const setOpenWorkoutId = useCallback(
    (id: string | null) => {
      if (globalThis.window === undefined) return;
      // Read the current URL at call time instead of closing over the
      // hook's reactive values. A mutation's stale `onSuccess` firing after
      // the user has navigated away from Timeline should act on the URL
      // they are on now, not the one that was open when the mutation
      // started.
      const currentPath = globalThis.window.location.pathname;
      const currentSearch = globalThis.window.location.search.slice(1);
      const params = new URLSearchParams(currentSearch);
      const currentWorkout = params.get("workout");

      // No-op when the URL already reflects the target state. Stops stale
      // `setOpenWorkoutId(null)` callbacks from stripping unrelated pages'
      // URLs or yanking the user back to `/`.
      if (currentWorkout === id) return;

      if (id) {
        params.set("workout", id);
      } else {
        params.delete("workout");
      }
      const query = params.toString();
      const nextUrl = query ? `${currentPath}?${query}` : currentPath;
      // Push when opening/switching so browser back can close the dialog;
      // replace when clearing so closing doesn't leave a duplicate entry.
      setLocation(nextUrl, { replace: id === null });
    },
    [setLocation],
  );

  return { openWorkoutId, setOpenWorkoutId };
}

