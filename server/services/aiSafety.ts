import type { UpcomingWorkout, WorkoutSuggestion } from "../gemini/suggestionService";
import type { TrainingContext } from "../gemini/types";

const PROHIBITED_MEDICAL_ACTION_PATTERNS = [
  /\bdiagnos(?:e|is|ed|ing)\b/i,
  /\bmedication\s+(?:change|adjust|increase|decrease|stop|start|switch)\b/i,
  /\b(?:increase|decrease|stop|start|switch)\s+(?:your\s+)?(?:dose|dosage|medication)\b/i,
  /\bprescrib(?:e|ed|ing)\b/i,
  /\btherapy\b/i,
  /\btreatment\s+plan\b/i,
];

// ⚡ Bolt Performance Optimization:
// `postProcessSuggestionText` runs per-field (recommendation + rationale) for
// every suggestion the AI coach returns, so it's a hot path on every coaching
// response. It used to call `new RegExp(pattern.source, "gi")` inside its loop
// on every invocation, recompiling the same 6 static patterns from scratch
// each time. Regex compilation isn't free — parsing/compiling a pattern is
// measurably slower than reusing a compiled RegExp. Precompiling once at
// module load and reusing the instances removes that redundant work entirely.
// Safe to share across calls: `String.replace` resets a global regex's
// `lastIndex` to 0 before it starts matching, so sequential reuse can't leak
// state between calls (verified by the "removes repeated prohibited medical
// phrases" test, which needs the `g` flag to strip more than one match).
const GLOBAL_PROHIBITED_MEDICAL_ACTION_PATTERNS = PROHIBITED_MEDICAL_ACTION_PATTERNS.map(
  (pattern) => new RegExp(pattern.source, "gi"),
);

const RED_FLAG_SYMPTOM_PATTERNS = [
  /chest\s+pain/i,
  /shortness\s+of\s+breath/i,
  /faint(?:ed|ing)?/i,
  /passed\s+out/i,
  /dizziness|lightheaded/i,
  /irregular\s+heartbeat|palpitations?/i,
  /blood\s+in\s+(?:urine|stool)/i,
  /severe\s+headache/i,
];

const HR_MEDICATION_PATTERNS = [
  /beta\s*-?blocker/i,
  /metoprolol|atenolol|propranolol|bisoprolol|carvedilol/i,
  /calcium\s+channel\s+blocker|diltiazem|verapamil/i,
  /ivabradine/i,
  /digoxin/i,
];

const ESCALATION_MESSAGE =
  "I noticed symptoms that can signal a potentially serious medical issue. Pause hard training and seek prompt medical care. If symptoms are severe, worsening, or include chest pain, fainting, or trouble breathing, seek emergency care now.";

const HR_MED_DISCLAIMER =
  "Heart-rate zones can be unreliable when using heart-rate-affecting medication. Keep intensity conservative, use RPE/talk-test guidance, and consult your clinician before zone-based training changes.";

export function postProcessSuggestionText(text: string): string {
  let output = text;
  for (const globalPattern of GLOBAL_PROHIBITED_MEDICAL_ACTION_PATTERNS) {
    output = output.replace(globalPattern, "medical guidance removed");
  }
  return output;
}


function stripAiInjectedSafetyText(text: string): string {
  return text
    .replaceAll(ESCALATION_MESSAGE, "")
    .replaceAll(HR_MED_DISCLAIMER, "")
    .split("\n")
    .filter((line) => !/^\s*(?:\[AI Coach\]|AI suggestion:)\b/i.test(line.trim()))
    .join(" ");
}

function collectSafetySignalCorpus(trainingContext: TrainingContext, upcomingWorkouts: UpcomingWorkout[]): string {
  const recentWorkoutText = (trainingContext.recentWorkouts ?? []).flatMap((w) => [
    w.mainWorkout,
    w.athleteNote ?? "",
  ]);

  const upcomingWorkoutText = upcomingWorkouts.flatMap((w) => [
    w.mainWorkout,
    w.accessory ?? "",
    w.notes ?? "",
  ]);

  return [...recentWorkoutText, ...upcomingWorkoutText]
    .map((text) => stripAiInjectedSafetyText(text))
    .join("\n");
}

export function analyzeSafetySignals(trainingContext: TrainingContext, upcomingWorkouts: UpcomingWorkout[]): {
  redFlagDetected: boolean;
  hrMedicationDetected: boolean;
} {
  const blob = collectSafetySignalCorpus(trainingContext, upcomingWorkouts);

  return {
    redFlagDetected: RED_FLAG_SYMPTOM_PATTERNS.some((p) => p.test(blob)),
    hrMedicationDetected: HR_MEDICATION_PATTERNS.some((p) => p.test(blob)),
  };
}

export function applySafetyLayerToSuggestions(
  suggestions: WorkoutSuggestion[],
  safety: { redFlagDetected: boolean; hrMedicationDetected: boolean },
): WorkoutSuggestion[] {
  if (safety.redFlagDetected) {
    return suggestions.map((s) => ({
      ...s,
      targetField: "notes",
      action: "append",
      recommendation: ESCALATION_MESSAGE,
      rationale: "Safety escalation triggered due to red-flag symptoms.",
      priority: "high",
    }));
  }

  return suggestions.map((s) => {
    const cleanedRecommendation = postProcessSuggestionText(s.recommendation);
    const cleanedRationale = postProcessSuggestionText(s.rationale);
    const recommendation = safety.hrMedicationDetected
      ? `${cleanedRecommendation}\n\n${HR_MED_DISCLAIMER}`
      : cleanedRecommendation;

    return {
      ...s,
      recommendation,
      rationale: cleanedRationale,
    };
  });
}

export function buildSafetyReviewNote(safety: { redFlagDetected: boolean; hrMedicationDetected: boolean }): string | null {
  if (safety.redFlagDetected) return ESCALATION_MESSAGE;
  if (safety.hrMedicationDetected) return HR_MED_DISCLAIMER;
  return null;
}
