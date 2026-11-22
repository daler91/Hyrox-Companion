import { isTimeoutLikeApiError } from "@/lib/api/constants";

// Toast copy that more than one hook shows for the same failure. Each hook
// wrote its own copy of the text; kept here so the wording cannot drift
// between them. (CH-toasts, REFACTORING_REVIEW 2026-09-23)

/**
 * A failed photo parse, from the workout sheet or the plan-day sheet. A
 * timeout gets its own copy: the server may still finish the parse.
 */
export function photoParseErrorToast(error: unknown): { title: string; description?: string } {
  return isTimeoutLikeApiError(error)
    ? {
        title: "Parsing took too long — please retry.",
        description: "The image may still finish in the background. Refresh to check before retaking.",
      }
    : { title: "Couldn't parse that photo — try a clearer shot." };
}

/** An `AiBudgetExceededError`: the athlete has used the day's AI allowance. */
export function aiBudgetExceededToast() {
  return {
    title: "Daily AI limit reached",
    description: "You've used your daily AI allowance. It resets on a rolling 24-hour basis.",
    variant: "destructive" as const,
  };
}

/**
 * Whether a refused plan restore failed because another live plan already
 * covers its dates (the server's `PLAN_OVERLAP`).
 */
export function isPlanOverlapError(message: string): boolean {
  return message.includes("PLAN_OVERLAP") || message.includes("already covers");
}

/** The copy for a `PLAN_OVERLAP` refusal: say which plan is in the way rather than "failed". */
export function planOverlapToast(): { title: string; description: string } {
  return {
    title: "Can't restore this plan yet",
    description: "Another plan already covers these dates. Archive that one first.",
  };
}
