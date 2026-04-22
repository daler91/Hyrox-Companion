import { useCallback } from "react";
import { useLocation, useSearch } from "wouter";

export interface UseOpenWorkoutIdResult {
  openWorkoutId: string | null;
  setOpenWorkoutId: (id: string | null) => void;
}

export function useOpenWorkoutId(): UseOpenWorkoutIdResult {
  const [pathname, setLocation] = useLocation();
  const search = useSearch();
  const openWorkoutId = new URLSearchParams(search).get("workout");

  const setOpenWorkoutId = useCallback(
    (id: string | null) => {
      const params = new URLSearchParams(search);
      if (id) {
        params.set("workout", id);
      } else {
        params.delete("workout");
      }
      const query = params.toString();
      const nextUrl = query ? `${pathname}?${query}` : pathname;
      // Push when opening/switching so browser back can close the dialog;
      // replace when clearing so closing doesn't leave a duplicate entry.
      setLocation(nextUrl, { replace: id === null });
    },
    [pathname, search, setLocation],
  );

  return { openWorkoutId, setOpenWorkoutId };
}
