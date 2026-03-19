import type { TrainingContext } from "./gemini/types";

export const BASE_SYSTEM_PROMPT = `You are an expert Hyrox training coach and AI assistant. You help athletes analyze their training data, provide insights, and suggest improvements for Hyrox competitions.

Hyrox is a fitness competition that combines running with functional workout stations:
- 8x 1km runs between stations 1-8 below
- 1.SkiErg (1000m)
- 2.Sled Push (50m)
- 3.Sled Pull (50m)
- 4.Burpee Broad Jumps (80m)
- 5.Rowing (1000m)
- 6.Farmers Carry (200m)
- 7.Sandbag Lunges (100m)
- 8.Wall Balls (75-100 reps)

When users ask about their training:
- Provide specific, actionable advice based on their actual training data when available
- Reference Hyrox-specific training principles
- Be encouraging but honest about areas for improvement
- Suggest workout structures and recovery strategies
- Help with pacing strategies and race-day preparation
- Identify training gaps (e.g., stations not practiced recently)
- Acknowledge their progress and consistency

Keep responses concise but informative. Use bullet points for lists.`;

export const SUGGESTIONS_PROMPT = `You are an expert Hyrox training coach analyzing an athlete's training plan. Based on their past workout history and upcoming scheduled workouts, provide specific, actionable suggestions to optimize their training for Hyrox performance.

Hyrox stations: SkiErg (1000m), Sled Push (50m), Sled Pull (50m), Burpee Broad Jumps (80m), Rowing (1000m), Farmers Carry (200m), Sandbag Lunges (100m), Wall Balls (75-100 reps), plus 8x 1km runs betwen each station.

When making suggestions:
- Identify training gaps (stations not practiced recently)
- Consider recovery and training load balance
- Suggest intensity adjustments based on recent performance
- Recommend exercise substitutions or additions
- Focus on race-specific preparation

Return ONLY valid JSON array with no markdown formatting. Each suggestion should have:
- workoutId: the ID of the upcoming workout
- workoutDate: the scheduled date
- workoutFocus: the original focus of the workout
- targetField: which part to modify - "mainWorkout", "accessory", or "notes"
- action: "replace" to replace the field entirely, or "append" to add to existing content
- recommendation: the specific text to add or replace (just the workout content, not explanation)
- rationale: why this change helps Hyrox performance (1 sentence)
- priority: "high", "medium", or "low"

IMPORTANT RULES:
1. Use "append" for notes to preserve existing workout instructions
2. Use "replace" for mainWorkout only when suggesting a completely different exercise
3. Use "append" for accessory to add extra work without removing existing accessory
4. The recommendation field should contain ONLY the workout text to insert, not explanations
5. Prioritize suggestions for workouts happening soonest (today, tomorrow, this week)

Limit to 1 suggestion per workout, max 5 suggestions total. Only suggest changes where meaningful improvements can be made.`;

export const PARSE_EXERCISES_PROMPT = `You are an expert fitness data parser. Your job is to take free-text workout descriptions and convert them into structured exercise data.

Available exercises and their keys:
HYROX STATIONS: skierg, sled_push, sled_pull, burpee_broad_jump, rowing, farmers_carry, sandbag_lunges, wall_balls
RUNNING: easy_run, tempo_run, interval_run, long_run
STRENGTH: back_squat, front_squat, deadlift, romanian_deadlift, bench_press, overhead_press, pull_up, bent_over_row, lunges, hip_thrust
CONDITIONING: burpees, box_jumps, assault_bike, kettlebell_swings, battle_ropes

Categories: hyrox_station, running, strength, conditioning

If an exercise doesn't match any of the above, use "custom" as the exerciseName. \
You MUST use your best judgment to determine the standard, correctly spelled name of that exercise \
(e.g., fix "bicep culrs" to "Bicep Curls", or "push ups" to "Push-ups") \
and put that cleaned name in the customLabel field.

Return ONLY a valid JSON array with no markdown formatting. Each element should be:
{
  "exerciseName": "<key from list above or 'custom'>",
  "category": "<category>",
  "customLabel": "<only if exerciseName is 'custom', the actual exercise name>",
  "confidence": <integer 0-100 representing how confident you are in the exercise mapping>,
  "missingFields": ["<field names the user did NOT mention that are important for this exercise type>"],
  "sets": [
    { "setNumber": 1, "reps": <number or null>, "weight": <number or null>, "distance": <number or null>, "time": <number or null> }
  ]
}

CONFIDENCE SCORING:
- 95-100: Exact match to a known exercise (e.g. "back squat" -> back_squat)
- 80-94: Strong match with minor ambiguity (e.g. "squats" -> back_squat)
- 60-79: Reasonable guess but could be wrong (e.g. "presses" -> bench_press vs overhead_press)
- 40-59: Weak match, mapped to custom (e.g. unfamiliar abbreviation)
- 0-39: Very uncertain, likely custom exercise with unclear details

IMPORTANT RULES:
1. For "4x8 back squat at 70kg", create 4 set objects each with reps=8, weight=70
2. For "3x10 at 60/65/70kg", create 3 sets with different weights
3. Weight should be in kg (the user's input unit will be handled separately)
4. Distance for running should be in meters (convert km to m: 5km = 5000m)
5. Time should be in minutes
6. If someone says "5 sets of 5 reps" that means 5 set objects each with reps=5
7. For running like "30 min easy run" create 1 set with time=30
8. For "5km run in 25 min" create 1 set with distance=5000, time=25
9. Parse ALL exercises mentioned, even if described casually
10. When weight varies per set (pyramid, ramp up), create individual sets with specific weights
11. If only "reps" is mentioned without sets count, assume 1 set
12. If exerciseName is "custom", YOU MUST provide a clear, standardized exercise name in customLabel. Example: "did 3x10 bicep curlz" -> {"exerciseName": "custom", "customLabel": "Bicep Curls", ...}
13. MISSING FIELDS: For each exercise, identify key fields the user did NOT mention in their text. Use these rules:
    - Strength exercises: flag "Weight" if no weight mentioned, "Reps" if no reps
    - Running exercises: flag "Distance" if no distance, "Time" if no time/duration
    - Hyrox stations: flag "Time" if no time/duration mentioned
    - Conditioning: flag "Reps" if no reps mentioned
    - Only flag fields that are relevant to the exercise type
    - Example: "4x8 back squat" with no weight -> missingFields: ["Weight"]
    - Example: "5km run" with no time -> missingFields: ["Time"]
    - If all key fields are present, use an empty array: missingFields: []`;

export const VALID_EXERCISE_NAMES = new Set([
  "skierg", "sled_push", "sled_pull", "burpee_broad_jump", "rowing",
  "farmers_carry", "sandbag_lunges", "wall_balls",
  "easy_run", "tempo_run", "interval_run", "long_run",
  "back_squat", "front_squat", "deadlift", "romanian_deadlift",
  "bench_press", "overhead_press", "pull_up", "bent_over_row", "lunges", "hip_thrust",
  "burpees", "box_jumps", "assault_bike", "kettlebell_swings", "battle_ropes", "custom",
]);

export const VALID_CATEGORIES = new Set(["hyrox_station", "running", "strength", "conditioning"]);

export const HYROX_EXERCISES = [
  "running", "skierg", "sled push", "sled pull", "burpees",
  "rowing", "farmers carry", "wall balls", "lunges",
];

function formatExerciseDetails(exerciseDetails: NonNullable<TrainingContext["recentWorkouts"][0]["exerciseDetails"]>): string {
  type ExDetail = typeof exerciseDetails[0];
  const grouped = new Map<string, ExDetail[]>();
  for (const ex of exerciseDetails) {
    if (!grouped.has(ex.name)) grouped.set(ex.name, []);
    grouped.get(ex.name)!.push(ex);
  }
  const details: string[] = [];
  grouped.forEach((sets, name) => {
    const parts = [name];
    const firstSet = sets[0];
    const allSameReps = sets.every((s: ExDetail) => s.reps === firstSet.reps);
    if (allSameReps && firstSet.reps && sets.length > 1) parts.push(`${sets.length}x${firstSet.reps}`);
    else if (firstSet.reps) parts.push(`${sets.length > 1 ? sets.length + "x" : ""}${firstSet.reps}reps`);
    if (firstSet.weight) parts.push(`@${firstSet.weight}`);
    if (firstSet.distance) parts.push(`${firstSet.distance}m`);
    if (firstSet.time) parts.push(`${firstSet.time}min`);
    details.push(parts.join(" "));
  });
  return details.join(", ");
}

function buildOverallStats(trainingContext: TrainingContext): string {
  let section = `\nOverall Stats:
- Total workouts tracked: ${trainingContext.totalWorkouts}
- Completed: ${trainingContext.completedWorkouts}
- Planned (upcoming): ${trainingContext.plannedWorkouts}
- Missed: ${trainingContext.missedWorkouts}
- Skipped: ${trainingContext.skippedWorkouts}
- Completion rate: ${trainingContext.completionRate}%
- Current streak: ${trainingContext.currentStreak} day${trainingContext.currentStreak === 1 ? "" : "s"}`;

  if (trainingContext.activePlan) {
    section += `\n\nActive Training Plan: "${trainingContext.activePlan.name}" (${trainingContext.activePlan.totalWeeks} weeks)`;
    if (trainingContext.activePlan.goal) {
      section += `\nPlan Goal: ${trainingContext.activePlan.goal}`;
    }
  }
  return section;
}

function buildExerciseFocus(trainingContext: TrainingContext): string {
  if (Object.keys(trainingContext.exerciseBreakdown).length === 0) return "";

  let section = `\n\nExercise Focus (times trained):`;
  for (const [exercise, count] of Object.entries(trainingContext.exerciseBreakdown)) {
    section += `\n- ${exercise}: ${count}x`;
  }
  return section;
}

function buildStructuredPerformance(trainingContext: TrainingContext): string {
  if (!trainingContext.structuredExerciseStats || Object.keys(trainingContext.structuredExerciseStats).length === 0) return "";

  let section = `\n\nStructured Exercise Performance:`;
  for (const [exercise, stats] of Object.entries(trainingContext.structuredExerciseStats)) {
    let line = `\n- ${exercise}: trained ${stats.count}x`;
    if (stats.maxWeight) line += `, max weight: ${stats.maxWeight}`;
    if (stats.maxDistance) line += `, max distance: ${stats.maxDistance}`;
    if (stats.bestTime) line += `, best time: ${stats.bestTime}min`;
    if (stats.avgReps) line += `, avg reps: ${stats.avgReps}`;
    section += line;
  }
  return section;
}

function buildRecentWorkouts(trainingContext: TrainingContext): string {
  if (trainingContext.recentWorkouts.length === 0) return "";

  let section = `\n\nRecent Workouts (last 7):`;
  for (const workout of trainingContext.recentWorkouts.slice(0, 7)) {
    let line = `\n- ${workout.date}: ${workout.focus || "General"} - ${workout.mainWorkout || "No details"} (${workout.status})`;
    if (workout.exerciseDetails && workout.exerciseDetails.length > 0) {
      line += ` [${formatExerciseDetails(workout.exerciseDetails)}]`;
    }
    section += line;
  }
  return section;
}

export function buildSystemPrompt(trainingContext?: TrainingContext): string {
  if (!trainingContext || trainingContext.totalWorkouts === 0) {
    return BASE_SYSTEM_PROMPT + `\n\nNote: This athlete hasn't logged any training data yet. Encourage them to start tracking their workouts to receive personalized insights.`;
  }

  let contextSection = `\n\n--- ATHLETE'S TRAINING DATA ---\n`;

  contextSection += buildOverallStats(trainingContext);
  contextSection += buildExerciseFocus(trainingContext);
  contextSection += buildStructuredPerformance(trainingContext);
  contextSection += buildRecentWorkouts(trainingContext);

  contextSection += `\n\n--- END TRAINING DATA ---\n\nUse this data to provide personalized coaching. Reference specific workouts and patterns when relevant.`;

  return BASE_SYSTEM_PROMPT + contextSection;
}
