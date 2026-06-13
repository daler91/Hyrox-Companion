import type { ExerciseSet } from "@shared/schema";
import type { ReactNode } from "react";

import { ParseStatusStrip } from "@/components/workout/ParseStatusStrip";
import { groupExerciseSets } from "@/lib/exerciseUtils";

import { WorkoutContentsStatus } from "./WorkoutContentsStatus";

interface WorkoutContentsLayoutProps {
  /** Drives the summary strip's exercise count. */
  readonly exerciseSets: ExerciseSet[];
  /** Provenance hint for the summary, e.g. "from coach text". Null hides it. */
  readonly sourceLabel?: string | null;
  /** Block count shown in the summary when greater than 0. Omit for surfaces without blocks. */
  readonly structureBlockCount?: number;
  /** Uppercase summary title; defaults to "Workout contents". */
  readonly summaryLabel?: string;
  /** Show the parsing strip while a text/image parse is in flight. */
  readonly isParsing: boolean;
  /** Collapsed source panel (a configured PrescriptionEditor), rendered above the table. */
  readonly source: ReactNode;
  /** The exercise table (a configured ExerciseTable). Never unmounted by this component. */
  readonly table: ReactNode;
  /** Optional node between the table and the structure disclosure (e.g. a parse-failure alert). */
  readonly belowTable?: ReactNode;
  /** Optional demoted structure builder (a headerless StructureBlocksEditor). Omit when unsupported. */
  readonly structure?: ReactNode;
}

/**
 * Shared composition for the sheet-native workout editors (planned LogSheet,
 * AdhocLogSheet, ReviewSurface). Renders the calmer, composer-aligned order:
 * a one-line contents summary, a parse-status strip, the collapsed source
 * panel (coach text / photo), the exercise table, then a demoted
 * "Add structure (advanced)" disclosure.
 *
 * Pure and slot-based on purpose: it never constructs or wraps the
 * autosaving children (the source panel and the table) in a collapsing
 * container, so it can never unmount them mid-debounce. Each surface keeps
 * its own prop wiring and passes the configured nodes in.
 */
export function WorkoutContentsLayout({
  exerciseSets,
  sourceLabel = null,
  structureBlockCount = 0,
  summaryLabel,
  isParsing,
  source,
  table,
  belowTable,
  structure,
}: WorkoutContentsLayoutProps) {
  const exerciseCount = groupExerciseSets(exerciseSets).length;

  return (
    <div className="space-y-3">
      <WorkoutContentsStatus
        exerciseCount={exerciseCount}
        sourceLabel={sourceLabel}
        structureBlockCount={structureBlockCount}
        summaryLabel={summaryLabel}
      />
      <ParseStatusStrip parsing={isParsing} />
      {source}
      {table}
      {belowTable}
      {structure}
    </div>
  );
}
