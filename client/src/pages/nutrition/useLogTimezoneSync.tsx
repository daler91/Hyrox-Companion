import type { User } from "@shared/schema";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import { QUERY_KEYS } from "@/lib/api";
import { preferences } from "@/lib/api/user";

import { pageTimezone } from "./utils";

interface TimezoneDrift {
  readonly stored: string;
  readonly page: string;
}

/** The profile's timezone and the one the page dates by, when they disagree.
 *  Null when they agree, or when either is unknown and there is nothing to
 *  correct against. The page's zone, not a fresh Intl lookup: a tab open
 *  across an OS timezone change keeps dating by the zone it loaded with. */
function timezoneDrift(queryClient: QueryClient): TimezoneDrift | null {
  const stored = queryClient.getQueryData<User>(QUERY_KEYS.authUser)?.userTimezone;
  const page = pageTimezone();
  if (!stored || !page || stored === page) return null;
  return { stored, page };
}

/** Save the page's timezone to the profile, and to the cached user so the
 *  next write sees the two agree without another round trip. */
async function savePageTimezone(queryClient: QueryClient, page: string): Promise<void> {
  await preferences.update({ userTimezone: page });
  queryClient.setQueryData<User>(QUERY_KEYS.authUser, (prev) =>
    prev ? { ...prev, userTimezone: page } : prev,
  );
}

/**
 * Runs a food-log write once the server will date it as this page does.
 *
 * The page files an entry under the device's calendar day, but the server
 * derives `logDate` from `loggedAt` in the profile's stored timezone. That is
 * synced once per session (useDetectTimezone), which swallows failures, so
 * after a flight the two disagree: dinner lands on tomorrow, out of sight, and
 * gets logged a second time. Before a write, a stale stored timezone is now
 * brought up to the one the page dates by (`pageTimezone`). When that fails
 * the write waits for the athlete: a toast names the timezone in force and
 * offers "Log anyway".
 * CL65 (CODEBASE_ANALYSIS_2026-10-03)
 *
 * With nothing to correct, the usual case, the write runs synchronously.
 */
export function useLogTimezoneSync(): {
  readonly runSynced: (write: () => void) => void;
  readonly isSyncing: boolean;
} {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isSyncing, setIsSyncing] = useState(false);

  const warnUnsynced = useCallback(
    (drift: TimezoneDrift, write: () => void) => {
      const description =
        `Entries are dated in your profile's timezone (${drift.stored}), not the ` +
        `one this page uses (${drift.page}), so this one may land on a different day.`;
      toast({
        title: "Couldn't update your timezone",
        description,
        action: (
          <ToastAction altText="Log anyway" onClick={write} data-testid="button-log-anyway">
            Log anyway
          </ToastAction>
        ),
      });
    },
    [toast],
  );

  const runSynced = useCallback(
    (write: () => void) => {
      const drift = timezoneDrift(queryClient);
      if (!drift) {
        write();
        return;
      }
      setIsSyncing(true);
      savePageTimezone(queryClient, drift.page).then(
        () => {
          setIsSyncing(false);
          write();
        },
        () => {
          setIsSyncing(false);
          warnUnsynced(drift, write);
        },
      );
    },
    [queryClient, warnUnsynced],
  );

  return { runSynced, isSyncing };
}
