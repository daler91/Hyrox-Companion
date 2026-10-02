import { dayDiff, MAX_PLAN_WEEKS, MIN_PLAN_WEEKS } from "../../dateUtils";
import type { AthleteFactCategory, ChatFactProposalStatus } from "../enums";
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
    // Plans the athlete is switching AWAY from. Retired only once this plan
    // generates successfully — see executePlanGeneration — so a failed generation
    // can never leave them with nothing to train. Bounded because it rides a
    // durable queue payload; ownership is re-checked server-side at apply time.
    supersedePlanIds: z.array(z.string().min(1).max(255)).max(5).optional(),
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
  /** The excerpts themselves; development only (sanitizeRagInfo strips them). */
  chunks?: string[];
  /** Titles of the athlete's materials the excerpts came from, each once. */
  sources?: string[];
  materialCount?: number;
  fallbackReason?: string;
}

/**
 * A fixed safety message the server attaches to a coach chat reply when the
 * athlete's own words match the red-flag symptom or heart-rate-medication
 * patterns (server/services/aiSafety.ts). Deterministic: it is shown whatever
 * the model writes. `urgent` is the medical escalation; `caution` the
 * heart-rate medication disclaimer.
 */
export interface ChatSafetyNotice {
  level: "urgent" | "caution";
  message: string;
}

/**
 * A lasting fact the coach heard in the athlete's message and offers to put
 * on their athlete card (AI coach chat review, I5b). Nothing is written to the
 * card until the athlete saves it.
 */
export interface ChatFactProposal {
  fact: string;
  category: AthleteFactCategory;
  status: ChatFactProposalStatus;
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

