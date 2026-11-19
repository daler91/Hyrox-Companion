import type { ExerciseSet, TimelineEntry } from "@shared/schema";

import { groupExerciseSets } from "@/lib/exerciseUtils";
import { formatScheduledDate } from "@/lib/timelineEntryFormat";

// ⚡ Bolt: this lives in its own module, not in EmbeddedWorkoutCoachChat.tsx.
// The Timeline page's eager useEmbeddedCoachRouting hook needs only this
// string helper, and importing it from the component file made the landing
// route statically load the whole coach chat stack (useChatSession,
// ChatInput, CoachPanelChatArea, PlanProposalCard, Radix scroll-area: the
// ~59 kB useChatSession-*.js chunk) on every visit, before any chat opens.
// Keep component-free imports here so that chunk stays lazy.
export function buildWorkoutCoachSeedMessage(
  entry: TimelineEntry,
  exerciseSets: readonly ExerciseSet[] = [],
): string {
  const focus = entry.focus?.trim() || "this workout";
  const groups = groupExerciseSets([...exerciseSets]);
  const exerciseLabel = groups.length === 1 ? "exercise" : "exercises";
  const setLabel = exerciseSets.length === 1 ? "set" : "sets";
  const stats =
    groups.length > 0
      ? ` (${groups.length} ${exerciseLabel}, ${exerciseSets.length} ${setLabel})`
      : "";

  return `Can you walk me through your take on my ${focus} workout on ${formatScheduledDate(
    entry.date,
  )}${stats}?`;
}
