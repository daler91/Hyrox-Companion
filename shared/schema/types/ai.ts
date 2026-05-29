import { dayDiff, MAX_PLAN_WEEKS, MIN_PLAN_WEEKS } from "../../dateUtils";
import { z } from "../zod";
import { dateStringSchema } from "./requests";
// AI Plan Generation
export const generatePlanInputSchema = z
  .object({
    goal: z.string().min(1, "Goal is required").max(500, "Goal must be 500 characters or less"),
    daysPerWeek: z.number().min(2).max(7).default(5),
    experienceLevel: z.enum(["beginner", "intermediate", "advanced"]),
    // Plan length is DERIVED from startDate → endDate (see computePlanWeeks in
    // shared/dateUtils); there is no separate user-entered "weeks" field. The
    // end date can be flagged as the athlete's race date to drive peak/taper
    // programming ("structure phases to peak for this date").
    startDate: dateStringSchema,
    endDate: dateStringSchema,
    endDateIsRaceDate: z.boolean().optional().default(true),
    restDays: z
      .array(z.enum(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]))
      .optional(),
    focusAreas: z.array(z.string().max(100)).max(10).optional(),
    injuries: z.string().max(500).optional(),
  })
  .refine((data) => dayDiff(data.startDate, data.endDate) > 0, {
    message: "End date must be after start date",
    path: ["endDate"],
  })
  .refine(
    (data) => {
      const span = dayDiff(data.startDate, data.endDate);
      // End-after-start ordering is enforced by the refine above; only
      // range-check a valid forward span so we don't double-report the error.
      if (span <= 0) return true;
      const weeks = Math.round(span / 7);
      return weeks >= MIN_PLAN_WEEKS && weeks <= MAX_PLAN_WEEKS;
    },
    {
      message: `Plan length must be between ${MIN_PLAN_WEEKS} and ${MAX_PLAN_WEEKS} weeks`,
      path: ["endDate"],
    },
  );

export type GeneratePlanInput = z.infer<typeof generatePlanInputSchema>;

// AI coaching types (shared between client and server)
export interface RagInfo {
  source: "rag" | "legacy" | "none";
  chunkCount: number;
  chunks?: string[];
  materialCount?: number;
  fallbackReason?: string;
}

export interface WorkoutSuggestion {
  workoutId: string;
  workoutDate: string;
  workoutFocus: string;
  targetField: "mainWorkout" | "accessory" | "notes";
  action: "replace" | "append";
  recommendation: string;
  rationale: string;
  priority: "high" | "medium" | "low";
}

