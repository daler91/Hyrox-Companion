import { useEffect,useState } from "react";

import { useApiMutation } from "@/hooks/useApiMutation";
import { api, QUERY_KEYS } from "@/lib/api";
import { queryClient, RateLimitError } from "@/lib/queryClient";

/**
 * Manual coach-note refresh for a planned day. The athlete clicks Refresh in
 * `CoachTakePanel` after tweaking the prescribed exercises so the static
 * `plan_days.ai_rationale` reflects the new prescription.
 *
 * The server enforces a 30-second cooldown (429 with Retry-After) to prevent
 * mashing the button and racking up Gemini calls; we surface that as a
 * `cooldownUntil` timestamp the UI disables the button against. A successful
 * refresh invalidates the timeline so `entry.aiRationale` / `aiNoteUpdatedAt`
 * pick up the new values on the next render.
 *
 * Keeping this as its own hook (rather than bolting onto usePlanDayExercises)
 * isolates the refresh state — a set edit shouldn't flip the Refresh button
 * into a disabled state and vice versa.
 */
export function usePlanDayCoachNote(planDayId: string | null) {
  // Locally-returned rationale + timestamp from the most recent successful
  // regenerate. We surface these alongside entry.aiRationale so the UI
  // updates immediately, without waiting for the invalidated timeline query
  // to round-trip. Null means "no local override — render the server value".
  const [localRationale, setLocalRationale] = useState<string | null>(null);
  const [localUpdatedAt, setLocalUpdatedAt] = useState<Date | null>(null);

  // Non-null while the server's 30s cooldown window is active. Parsed out
  // of the 429 Retry-After header. A one-shot timer flips it back to null
  // so the Refresh button re-enables without a further click. We don't
  // re-read `Date.now()` during render — `isCoolingDown` is derived purely
  // from this state.
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  useEffect(() => {
    if (cooldownUntil == null) return undefined;
    const remaining = Math.max(0, cooldownUntil - Date.now());
    const id = setTimeout(() => setCooldownUntil(null), remaining);
    return () => clearTimeout(id);
  }, [cooldownUntil]);
  const isCoolingDown = cooldownUntil != null;

  // The hook is called at the always-mounted WorkoutDetailDialogV2 level
  // (Radix Dialog keeps children mounted while closed), so its local
  // state would bleed across entries without a reset. `ownerId` is a
  // render-time sentinel — using this pattern instead of a
  // setState-in-effect satisfies react-hooks/set-state-in-effect, and
  // mirrors the ownerId pattern in usePlanDayExercises.
  const [ownerId, setOwnerId] = useState<string | null>(planDayId);
  if (planDayId !== ownerId) {
    setOwnerId(planDayId);
    setLocalRationale(null);
    setLocalUpdatedAt(null);
    setCooldownUntil(null);
  }

  const regenerate = useApiMutation<
    { planDayId: string; aiRationale: string; aiNoteUpdatedAt: string },
    Error,
    void
  >({
    mutationFn: () => api.plans.regenerateCoachNote(planDayId!),
    onSuccess: async (result) => {
      setLocalRationale(result.aiRationale);
      setLocalUpdatedAt(new Date(result.aiNoteUpdatedAt));
      setCooldownUntil(null);
      // Refresh the timeline so next render reads the server's new rationale
      // and the dialog stays consistent even after the local state resets
      // (e.g. reopen).
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.timeline });
    },
    onError: (err) => {
      // The server returns 429 with a Retry-After header when the 30-second
      // cooldown is active. The client's fetch wrapper surfaces that as a
      // RateLimitError; stash the deadline so the UI can disable the button
      // until the cooldown clears. useApiMutation already renders the
      // "Too many requests" toast for RateLimitError, so we don't show a
      // second errorToast for that path.
      if (err instanceof RateLimitError) {
        const retryAfterMs = (err.retryAfter ?? 30) * 1000;
        setCooldownUntil(Date.now() + retryAfterMs);
      }
    },
    errorToast: "Couldn't refresh coach note — try again in a moment.",
  });

  return {
    regenerate,
    isRegenerating: regenerate.isPending,
    isCoolingDown,
    localRationale,
    localUpdatedAt,
  };
}
