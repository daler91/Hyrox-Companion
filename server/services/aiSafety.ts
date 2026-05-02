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
  for (const pattern of PROHIBITED_MEDICAL_ACTION_PATTERNS) {
    const globalPattern = new RegExp(pattern.source, "gi");
    output = output.replace(globalPattern, "medical guidance removed");
  }
  return output;
}

export function analyzeSafetySignals(trainingContext: TrainingContext, upcomingWorkouts: UpcomingWorkout[]): {
  redFlagDetected: boolean;
  hrMedicationDetected: boolean;
} {
  const blob = [
    JSON.stringify(trainingContext ?? {}),
    ...upcomingWorkouts.map((w) => `${w.mainWorkout} ${w.accessory ?? ""} ${w.notes ?? ""}`),
  ].join("\n");

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
