import { useCallback, useEffect, useState } from "react";

const hasWindow = (): boolean => globalThis.window !== undefined;

function readUrlValue<T extends string>(
  key: string,
  defaultValue: T,
  allowedValues?: readonly T[],
): T {
  if (!hasWindow()) return defaultValue;
  const params = new URLSearchParams(globalThis.window.location.search);
  const raw = params.get(key);
  if (raw === null) return defaultValue;
  if (allowedValues && !allowedValues.includes(raw as T)) return defaultValue;
  return raw as T;
}

function buildUrlWithParam(key: string, next: string | null): string {
  const params = new URLSearchParams(globalThis.window.location.search);
  if (next === null) {
    params.delete(key);
  } else {
    params.set(key, next);
  }
  const query = params.toString();
  const queryString = query.length > 0 ? `?${query}` : "";
  const path = globalThis.window.location.pathname;
  const hash = globalThis.window.location.hash;
  return `${path}${queryString}${hash}`;
}

/**
 * Persist a string-valued piece of UI state in a URL query parameter so that
 * navigating away and back (or sharing a link) preserves the user's selection.
 *
 * - Reads the initial value from `location.search` on first mount, falling back
 *   to `defaultValue` if the key is absent or not in `allowedValues`.
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
  const [value, setValue] = useState<T>(() =>
    readUrlValue(key, defaultValue, allowedValues),
  );

  useEffect(() => {
    if (!hasWindow()) return;
    const handlePopState = () => {
      setValue(readUrlValue(key, defaultValue, allowedValues));
    };
    globalThis.window.addEventListener("popstate", handlePopState);
    return () => {
      globalThis.window.removeEventListener("popstate", handlePopState);
    };
  }, [key, defaultValue, allowedValues]);

  const updateValue = useCallback(
    (next: T) => {
      setValue(next);
      if (!hasWindow()) return;
      const newUrl = buildUrlWithParam(key, next === defaultValue ? null : next);
      globalThis.window.history.replaceState(null, "", newUrl);
    },
    [key, defaultValue],
  );

  return [value, updateValue];
}
