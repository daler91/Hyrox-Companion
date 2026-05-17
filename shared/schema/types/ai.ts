import { z } from "../zod";
import { dateStringSchema } from "./requests";
// AI Plan Generation
export const generatePlanInputSchema = z.object({
  goal: z.string().min(1, "Goal is required").max(500, "Goal must be 500 characters or less"),
  totalWeeks: z.number().min(1).max(24).default(8),
  daysPerWeek: z.number().min(2).max(7).default(5),
  experienceLevel: z.enum(["beginner", "intermediate", "advanced"]),
  raceDate: dateStringSchema.optional(),
  startDate: dateStringSchema.optional(),
  restDays: z
    .array(z.enum(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]))
    .optional(),
  focusAreas: z.array(z.string().max(100)).max(10).optional(),
  injuries: z.string().max(500).optional(),
});

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

