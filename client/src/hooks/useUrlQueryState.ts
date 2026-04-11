import { useCallback, useEffect, useState } from "react";

/**
 * Persist a string-valued piece of UI state in a URL query parameter so that
 * navigating away and back (or sharing a link) preserves the user's selection.
 *
 * - Reads the initial value from `location.search` on first mount, falling back
 *   to `defaultValue` if the key is absent.
 * - Writes via `history.replaceState` on change, keeping other query params intact.
 * - Listens for `popstate` so back/forward navigation updates the state.
 *
 * SSR-safe: returns `defaultValue` when `window` is undefined.
 */
export function useUrlQueryState<T extends string>(
  key: string,
  defaultValue: T,
  allowedValues?: readonly T[],
): [T, (value: T) => void] {
  const readFromUrl = useCallback((): T => {
    if (typeof globalThis.window === "undefined") return defaultValue;
    const params = new URLSearchParams(globalThis.window.location.search);
    const raw = params.get(key);
    if (raw === null) return defaultValue;
    if (allowedValues && !allowedValues.includes(raw as T)) return defaultValue;
    return raw as T;
  }, [key, defaultValue, allowedValues]);

  const [value, setValueState] = useState<T>(readFromUrl);

  useEffect(() => {
    if (typeof globalThis.window === "undefined") return;
    const handlePopState = () => setValueState(readFromUrl());
    globalThis.window.addEventListener("popstate", handlePopState);
    return () => globalThis.window.removeEventListener("popstate", handlePopState);
  }, [readFromUrl]);

  const setValue = useCallback(
    (next: T) => {
      setValueState(next);
      if (typeof globalThis.window === "undefined") return;
      const params = new URLSearchParams(globalThis.window.location.search);
      if (next === defaultValue) {
        params.delete(key);
      } else {
        params.set(key, next);
      }
      const query = params.toString();
      const newUrl = `${globalThis.window.location.pathname}${query ? `?${query}` : ""}${globalThis.window.location.hash}`;
      globalThis.window.history.replaceState(null, "", newUrl);
    },
    [key, defaultValue],
  );

  return [value, setValue];
}
