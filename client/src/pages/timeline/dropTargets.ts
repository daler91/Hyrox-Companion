import {
  type Active,
  type CollisionDetection,
  type DroppableContainer,
  rectIntersection,
} from "@dnd-kit/core";
import { addDaysToISODate } from "@shared/dateUtils";
import type { TimelineEntry } from "@shared/schema";

import { getTodayString } from "@/lib/dateUtils";

/**
 * Whether `entry` can be moved to `date`. A logged workout (a log, or a
 * completed plan day, which carries one) moves through PATCH /workouts/:id,
 * which refuses a date after the athlete's tomorrow; MoveEntryMenu clamps its
 * picker to the same day. A planned session with no log can go anywhere.
 */
export function canMoveEntryTo(entry: TimelineEntry, date: string, today: string): boolean {
  return !entry.workoutLogId || date <= addDaysToISODate(today, 1);
}

function draggedEntry(active: Active): TimelineEntry | undefined {
  return (active.data.current as { entry?: TimelineEntry } | undefined)?.entry;
}

function containerDate(container: DroppableContainer): string | undefined {
  return (container.data.current as { date?: string } | undefined)?.date;
}

/** The day rows `entry` may be dropped on; containers that are not day rows pass through. */
export function allowedDropTargets(
  entry: TimelineEntry | undefined,
  containers: readonly DroppableContainer[],
  today: string,
): DroppableContainer[] {
  if (!entry) return [...containers];
  return containers.filter((container) => {
    const date = containerDate(container);
    return date === undefined || canMoveEntryTo(entry, date, today);
  });
}

/**
 * dnd-kit's default collision detection, over only the days the dragged entry
 * can land on. Every future day was a drop target for a logged workout, so it
 * lit up under the card and the drop then failed with "Couldn't move workout".
 * CL70 (CODEBASE_ANALYSIS_2026-10-03)
 */
export const timelineCollisionDetection: CollisionDetection = (args) =>
  rectIntersection({
    ...args,
    droppableContainers: allowedDropTargets(
      draggedEntry(args.active),
      args.droppableContainers,
      getTodayString(),
    ),
  });
