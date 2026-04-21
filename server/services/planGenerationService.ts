import { ThinkingLevel } from "@google/genai";
import {
  exerciseSets,
  exerciseSetSchema,
  type GeneratePlanInput,
  type InsertExerciseSet,
  type ParsedExercise,
  type TrainingPlanWithDays,
} from "@shared/schema";
import { z } from "zod";

import { db } from "../db";
import { AppError, ErrorCode } from "../errors";
import { GEMINI_SUGGESTIONS_MODEL, getAiClient, retryWithBackoff, trackUsageFromResponse } from "../gemini/client";
import { logger } from "../logger";
import { PLAN_GENERATION_PROMPT, VALID_CATEGORIES, VALID_EXERCISE_NAMES } from "../prompts";
import { storage } from "../storage";
import { expandExercisesToPlanDaySetRows } from "./workoutService";

// Structured exercises the model may include per plan day. Optional so we
// degrade gracefully when the model returns the old free-text-only shape.
const generatedExerciseSchema = z.object({
  exerciseName: z.string().min(1),
  category: z.string(),
  customLabel: z.string().optional().nullable(),
  confidence: z.number().min(0).max(100).optional().nullable(),
  sets: z.array(exerciseSetSchema).min(1).max(50),
});

// Exercises are validated separately (below) rather than inside this schema
// so a malformed exercise entry does NOT cause us to drop the whole day's
// free-text fallback — the day still renders with focus/mainWorkout/etc.
const generatedDaySchema = z.object({
  weekNumber: z.number().min(1),
  dayName: z.enum(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]),
  focus: z.string().max(255),
  mainWorkout: z.string().max(5000),
  accessory: z.string().max(5000).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

type GeneratedDay = z.infer<typeof generatedDaySchema> & {
  exercises: GeneratedExercise[] | null;
};
type GeneratedExercise = z.infer<typeof generatedExerciseSchema>;

function buildGenerationPrompt(input: GeneratePlanInput): string {
  const lines: string[] = [
    `Generate a ${input.totalWeeks}-week training plan with ${input.daysPerWeek} training days per week.`,
    ``,
    `ATHLETE PROFILE:`,
    `- Goal: ${input.goal}`,
    `- Experience Level: ${input.experienceLevel}`,
    `- Training Days Per Week: ${input.daysPerWeek}`,
    `- Total Weeks: ${input.totalWeeks}`,
  ];

  if (input.raceDate) {
    lines.push(`- Race Date: ${input.raceDate} (structure phases to peak for this date)`);
  }

  if (input.focusAreas && input.focusAreas.length > 0) {
    lines.push(`- Focus Areas: ${input.focusAreas.join(", ")} (prioritize these in programming)`);
  }

  if (input.injuries) {
    lines.push(`- Injuries/Limitations: ${input.injuries} (avoid exercises that aggravate these)`);
  }

  if (input.restDays && input.restDays.length > 0) {
    lines.push(`- Rest Days: ${input.restDays.join(", ")} (these MUST be rest days every week, schedule all training on the remaining days)`);
  }

  // Include rest days in the total
  const restDaysPerWeek = 7 - input.daysPerWeek;
  lines.push(
    ``,
    `Generate ${input.totalWeeks * 7} day entries (${input.daysPerWeek} training + ${restDaysPerWeek} rest per week).`,
    `Return the complete JSON array for ALL weeks.`,
  );

  return lines.join("\n");
}

// Normalize a single AI-returned exercise into the ParsedExercise shape the
// rest of the backend already consumes. Mirrors the hardening in
// `exerciseParser.ts`: unknown exerciseName collapses to "custom" + a
// customLabel, an empty label triggers low-confidence so the UI can prompt
// for review.
// Plain text rendered via React — no HTML encoding needed. See
// exerciseParser.ts sanitizeLabel for the rationale.
function sanitizeLabel(v: string): string {
  return v.replaceAll("&", "and");
}

function defaultConfidence(isKnown: boolean): number {
  return isKnown ? 95 : 50;
}

function resolveGeneratedConfidence(raw: GeneratedExercise, isKnown: boolean): number {
  if (typeof raw.confidence === "number") {
    return Math.min(100, Math.max(0, Math.round(raw.confidence)));
  }
  return defaultConfidence(isKnown);
}

function normalizeGeneratedExercise(raw: GeneratedExercise): ParsedExercise {
  const isKnown = VALID_EXERCISE_NAMES.has(raw.exerciseName) && raw.exerciseName !== "custom";
  const validCategory = VALID_CATEGORIES.has(raw.category);
  let confidence = resolveGeneratedConfidence(raw, isKnown);

  let customLabel: string | undefined;
  if (isKnown) {
    customLabel = raw.customLabel ? sanitizeLabel(raw.customLabel) : undefined;
  } else {
    const label =
      (raw.customLabel && raw.customLabel.trim().length > 0 && raw.customLabel) ||
      (raw.exerciseName !== "custom" && raw.exerciseName.trim().length > 0 && raw.exerciseName) ||
      "Unknown exercise";
    customLabel = sanitizeLabel(label);
    if (!raw.customLabel || raw.customLabel.trim().length === 0) {
      confidence = Math.min(confidence, 40);
    }
  }

  return {
    exerciseName: isKnown ? sanitizeLabel(raw.exerciseName) : "custom",
    category: validCategory ? sanitizeLabel(raw.category) : "conditioning",
    customLabel,
    confidence,
    sets: raw.sets.map((s, i) => ({
      setNumber: s.setNumber ?? i + 1,
      ...(s.reps != null && { reps: s.reps }),
      ...(s.weight != null && { weight: s.weight }),
      ...(s.distance != null && { distance: s.distance }),
      ...(s.time != null && { time: s.time }),
    })),
  };
}

// Validate the optional exercises array on a raw day. Individual malformed
// exercises are dropped with a warning; the returned array is empty if none
// validate or if the field was absent. Returning null signals "no structured
// exercises", so the day still renders from its free-text fields.
function validateDayExercises(rawDay: Record<string, unknown> | null | undefined): GeneratedExercise[] | null {
  const raw = rawDay?.exercises;
  if (!Array.isArray(raw)) return null;
  const validated: GeneratedExercise[] = [];
  for (let i = 0; i < raw.length; i++) {
    const result = generatedExerciseSchema.safeParse(raw[i]);
    if (result.success) {
      validated.push(result.data);
    } else {
      logger.warn(
        { issues: result.error.issues, index: i },
        "[planGen] Dropping invalid exercise entry",
      );
    }
  }
  return validated;
}

function parseAndValidateDays(text: string): GeneratedDay[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    logger.error({ responseLength: text.length }, "[planGen] JSON parse failed");
    throw new AppError(ErrorCode.AI_ERROR, "Failed to parse AI response as JSON", 502);
  }

  if (!Array.isArray(raw)) {
    throw new TypeError("AI response is not an array");
  }

  const validated: GeneratedDay[] = [];
  for (const item of raw) {
    const result = generatedDaySchema.safeParse(item);
    if (result.success) {
      const exercises = validateDayExercises(item as Record<string, unknown>);
      validated.push({
        ...result.data,
        focus: result.data.focus.replaceAll("&", "and"),
        mainWorkout: result.data.mainWorkout.replaceAll("&", "and"),
        accessory: result.data.accessory ? result.data.accessory.replaceAll("&", "and") : null,
        notes: result.data.notes ? result.data.notes.replaceAll("&", "and") : null,
        exercises,
      });
    } else {
      logger.warn(
        { issues: result.error.issues },
        "[planGen] Dropping invalid day",
      );
    }
  }

  return validated;
}

function calculateStartDate(raceDate: string, totalWeeks: number): string {
  const race = new Date(raceDate);
  const start = new Date(race);
  start.setDate(start.getDate() - totalWeeks * 7);
  // Align to nearest Monday
  const dayOfWeek = start.getDay();
  let mondayOffset: number;
  if (dayOfWeek === 0) mondayOffset = 1;        // Sunday → next Monday
  else if (dayOfWeek === 1) mondayOffset = 0;    // Already Monday
  else mondayOffset = 8 - dayOfWeek;             // Tue-Sat → next Monday
  start.setDate(start.getDate() + mondayOffset);
  return start.toISOString().split("T")[0];
}

export async function generatePlan(
  input: GeneratePlanInput,
  userId: string,
): Promise<TrainingPlanWithDays> {
  const prompt = buildGenerationPrompt(input);

  logger.info(
    { userId, totalWeeks: input.totalWeeks, daysPerWeek: input.daysPerWeek, experienceLevel: input.experienceLevel },
    "[planGen] Generating AI training plan",
  );

  const response = await retryWithBackoff(
    () =>
      getAiClient().models.generateContent({
        model: GEMINI_SUGGESTIONS_MODEL,
        config: {
          systemInstruction: PLAN_GENERATION_PROMPT,
          responseMimeType: "application/json",
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
        },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      }),
    "planGeneration",
  );

  trackUsageFromResponse(userId, GEMINI_SUGGESTIONS_MODEL, "plan_generation", response);

  const text = response.text || "[]";
  const days = parseAndValidateDays(text);

  if (days.length === 0) {
    throw new AppError(ErrorCode.AI_ERROR, "AI generated no valid plan days", 502);
  }

  // Plan, plan days, and their structured exercise sets are written inside
  // a single transaction so a failure in any step rolls the whole plan back.
  // Previously an error in the exerciseSets insert left a half-created plan
  // in the database, which retries would duplicate.
  const planName = `AI Plan: ${input.goal.slice(0, 80)}`;
  const { plan, daysWithExercises, totalSetRows } = await db.transaction(async (tx) => {
    const createdPlan = await storage.plans.createTrainingPlan({
      userId,
      name: planName,
      sourceFileName: null,
      totalWeeks: input.totalWeeks,
      goal: input.goal,
    }, tx);

    const planDaysPayload = days.map((day) => ({
      planId: createdPlan.id,
      weekNumber: day.weekNumber,
      dayName: day.dayName,
      focus: day.focus,
      mainWorkout: day.mainWorkout,
      accessory: day.accessory || null,
      notes: day.notes || null,
      status: "planned" as const,
      aiSource: "generated" as const,
    }));

    const createdPlanDays = await storage.plans.createPlanDays(planDaysPayload, tx);

    // Expand structured exercises under each plan day. We pair generated
    // days with persisted plan days positionally rather than by
    // (weekNumber, dayName) because Gemini can (rarely) return duplicate
    // day entries in a week, which would collide in a map and silently
    // attach one day's prescribed sets to another's plan_day row.
    // createPlanDays preserves input order via RETURNING, so index mapping
    // is 1:1.
    if (createdPlanDays.length !== planDaysPayload.length) {
      throw new AppError(
        ErrorCode.INTERNAL_ERROR,
        "createPlanDays returned unexpected row count",
        500,
      );
    }

    const allSetRows: InsertExerciseSet[] = [];
    let dwe = 0;
    for (let i = 0; i < days.length; i++) {
      const day = days[i];
      if (!day.exercises || day.exercises.length === 0) continue;
      const pd = createdPlanDays[i];
      const normalised = day.exercises.map(normalizeGeneratedExercise);
      try {
        allSetRows.push(...expandExercisesToPlanDaySetRows(normalised, pd.id));
        dwe++;
      } catch (err) {
        logger.warn(
          { err, planDayId: pd.id },
          "[planGen] Failed to expand generated exercises into set rows",
        );
      }
    }

    if (allSetRows.length > 0) {
      await tx.insert(exerciseSets).values(allSetRows);
    }

    return { plan: createdPlan, daysWithExercises: dwe, totalSetRows: allSetRows.length };
  });

  logger.info(
    { userId, planId: plan.id, daysWithExercises, totalSetRows, totalDays: days.length },
    "[planGen] Persisted structured plan-day exercises",
  );

  // Auto-schedule the plan if a start date is provided or can be derived from race date
  let resolvedStartDate: string | undefined;
  if (input.startDate) {
    resolvedStartDate = input.startDate;
  } else if (input.raceDate) {
    resolvedStartDate = calculateStartDate(input.raceDate, input.totalWeeks);
  }
  if (resolvedStartDate) {
    await storage.plans.schedulePlan(plan.id, resolvedStartDate, userId);
  }

  // Fetch the complete plan with days
  const fullPlan = await storage.plans.getTrainingPlan(plan.id, userId);
  if (!fullPlan) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "Failed to retrieve generated plan", 500);
  }

  logger.info(
    { userId, planId: plan.id, dayCount: days.length },
    "[planGen] AI plan generated successfully",
  );

  return fullPlan;
}
