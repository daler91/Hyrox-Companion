import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { QUERY_KEYS } from "@/lib/api";
import { preferences } from "@/lib/api/user";

/**
 * Read the browser's IANA timezone via `Intl.DateTimeFormat().resolvedOptions().timeZone`
 * once the user is authenticated, and PATCH the stored value if it has changed
 * since the last visit (or if the user is brand-new and still defaulted to
 * "UTC"). The server scheduler reads `users.user_timezone` to decide which day
 * counts as Monday / yesterday for that athlete — without this hook everyone
 * stays UTC and weekly-summary emails fire on the wrong calendar day for
 * non-UTC users (C10).
 *
 * Fire-and-forget; failures are intentionally swallowed because this is a
 * background convenience: a stale tz only affects scheduling cadence, never
 * data integrity.
 */
export function useDetectTimezone(
  isAuthenticated: boolean,
  isAppUserLoaded: boolean,
  currentTimezone: string | undefined,
) {
  const hasFired = useRef(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isAuthenticated || !isAppUserLoaded || hasFired.current) return;
    if (typeof Intl === "undefined" || typeof Intl.DateTimeFormat !== "function") return;

    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!detected || detected === currentTimezone) {
      // No-op marks the hook as fired so we don't recompute on every render.
      hasFired.current = true;
      return;
    }

    hasFired.current = true;
    preferences
      .update({ userTimezone: detected })
      .then(() => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.authUser }))
      .catch(() => {
        // Swallow: a 400 (invalid IANA) or transient network error shouldn't
        // bubble into the UI. Next sign-in will retry.
      });
  }, [isAuthenticated, isAppUserLoaded, currentTimezone, queryClient]);
}
