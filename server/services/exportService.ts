import type { IStorage } from "../storage";

interface TimelineEntry {
  workoutLogId?: string | null;
  date?: string | null;
  type?: string | null;
  status?: string | null;
  focus?: string | null;
  mainWorkout?: string | null;
  accessory?: string | null;
  notes?: string | null;
  duration?: number | null;
  rpe?: number | null;
}

interface ExerciseSetRow {
  date: string;
  workoutLogId: string;
  exerciseName: string;
  customLabel?: string | null;
  category: string;
  setNumber: number;
  reps?: number | null;
  weight?: number | null;
  distance?: number | null;
  time?: number | null;
  notes?: string | null;
}

function buildWorkoutLogTitles(timeline: TimelineEntry[]): Record<string, string> {
  const titles: Record<string, string> = {};
  for (const entry of timeline) {
    if (entry.workoutLogId) titles[entry.workoutLogId] = entry.focus || "";
  }
  return titles;
}

export async function generateJSON(userId: string, storage: IStorage) {
  const timeline = await storage.getTimeline(userId);
  const plans = await storage.listTrainingPlans(userId);
  const allExerciseSets = await storage.getAllExerciseSetsWithDates(userId);
  const workoutLogTitles = buildWorkoutLogTitles(timeline);

  const exerciseSetRows = allExerciseSets.map((s: ExerciseSetRow) => ({
    date: s.date,
    workoutTitle: workoutLogTitles[s.workoutLogId] || "",
    exerciseName: s.exerciseName,
    customLabel: s.customLabel,
    category: s.category,
    setNumber: s.setNumber,
    reps: s.reps,
    weight: s.weight,
    distance: s.distance,
    time: s.time,
    notes: s.notes,
  }));

  return { timeline, plans, exerciseSets: exerciseSetRows, exportedAt: new Date().toISOString() };
}

const CSV_FORMULA_CHARACTERS = /^[+\-=@|]/;
const CSV_QUOTABLE_CHARACTERS = /[,\n"]/;

function escapeCsv(val: string | null | undefined): string {
  if (val == null) return "";
  const rawStr = String(val);

  // CSV Injection protection: prepend a single quote if the value starts with a character
  // that could be interpreted as a formula in spreadsheet software (=, +, -, @, |).
  const formulaProtected = CSV_FORMULA_CHARACTERS.test(rawStr) ? `'${rawStr}` : rawStr;

  const escaped = formulaProtected.replace(/"/g, '""');
  // If the value contains characters that require quoting (comma, newline, or double quote), wrap it in quotes.
  return CSV_QUOTABLE_CHARACTERS.test(escaped) ? `"${escaped}"` : escaped;
}

function generateTimelineCsvRows(timeline: TimelineEntry[]): string[] {
  const rows: string[] = [];
  for (const entry of timeline) {
    rows.push([
      escapeCsv(entry.date),
      escapeCsv(entry.type),
      escapeCsv(entry.status),
      escapeCsv(entry.focus),
      escapeCsv(entry.mainWorkout),
      escapeCsv(entry.accessory),
      escapeCsv(entry.notes),
      entry.duration != null ? String(entry.duration) : "",
      entry.rpe != null ? String(entry.rpe) : "",
    ].join(","));
  }
  return rows;
}

function generateExerciseSetsCsvRows(allExerciseSets: ExerciseSetRow[], workoutLogTitles: Record<string, string>): string[] {
  const rows: string[] = [];
  for (const s of allExerciseSets) {
    rows.push([
      escapeCsv(s.date),
      escapeCsv(workoutLogTitles[s.workoutLogId] || ""),
      escapeCsv(s.customLabel || s.exerciseName),
      escapeCsv(s.category),
      String(s.setNumber),
      s.reps != null ? String(s.reps) : "",
      s.weight != null ? String(s.weight) : "",
      s.distance != null ? String(s.distance) : "",
      s.time != null ? String(s.time) : "",
      escapeCsv(s.notes),
    ].join(","));
  }
  return rows;
}

export async function generateCSV(userId: string, storage: IStorage): Promise<string> {
  const timeline = await storage.getTimeline(userId);
  const allExerciseSets = await storage.getAllExerciseSetsWithDates(userId);

  const csvRows = ["Date,Type,Status,Focus,Main Workout,Accessory,Notes,Duration,RPE"];
  csvRows.push(...generateTimelineCsvRows(timeline));

  if (allExerciseSets.length > 0) {
    const workoutLogTitles = buildWorkoutLogTitles(timeline);
    csvRows.push("");
    csvRows.push("--- EXERCISE SETS (Per-Set Data) ---");
    csvRows.push("Date,Workout,Exercise,Category,Set #,Reps,Weight,Distance (m),Time (min),Notes");
    csvRows.push(...generateExerciseSetsCsvRows(allExerciseSets, workoutLogTitles));
  }

  return csvRows.join("\n");
}
