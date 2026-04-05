import { z } from "zod";
import { logger } from "../logger";
import { storage } from "../storage";
import { getAiClient, GEMINI_SUGGESTIONS_MODEL, retryWithBackoff } from "../gemini/client";
import { PLAN_GENERATION_PROMPT } from "../prompts";
import { ThinkingLevel } from "@google/genai";
import type { GeneratePlanInput, TrainingPlanWithDays } from "@shared/schema";
import { sanitizeHtml } from "../utils/sanitize";
import { AppError, ErrorCode } from "../errors";

const generatedDaySchema = z.object({
  weekNumber: z.number().min(1),
  dayName: z.enum(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]),
  focus: z.string().max(255),
  mainWorkout: z.string().max(5000),
  accessory: z.string().max(5000).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

type GeneratedDay = z.infer<typeof generatedDaySchema>;

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
      validated.push({
        ...result.data,
        focus: sanitizeHtml(result.data.focus.replaceAll("&", "and")),
        mainWorkout: sanitizeHtml(result.data.mainWorkout.replaceAll("&", "and")),
        accessory: result.data.accessory ? sanitizeHtml(result.data.accessory.replaceAll("&", "and")) : null,
        notes: result.data.notes ? sanitizeHtml(result.data.notes.replaceAll("&", "and")) : null,
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

  const text = response.text || "[]";
  const days = parseAndValidateDays(text);

  if (days.length === 0) {
    throw new AppError(ErrorCode.AI_ERROR, "AI generated no valid plan days", 502);
  }

  // Create the training plan record
  const planName = `AI Plan: ${input.goal.slice(0, 80)}`;
  const plan = await storage.plans.createTrainingPlan({
    userId,
    name: planName,
    sourceFileName: null,
    totalWeeks: input.totalWeeks,
    goal: input.goal,
  });

  // Create plan days
  const planDays = days.map((day) => ({
    planId: plan.id,
    weekNumber: day.weekNumber,
    dayName: day.dayName,
    focus: day.focus,
    mainWorkout: day.mainWorkout,
    accessory: day.accessory || null,
    notes: day.notes || null,
    status: "planned" as const,
    aiSource: "generated" as const,
  }));

  await storage.plans.createPlanDays(planDays);

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
