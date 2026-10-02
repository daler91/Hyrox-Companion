import { standingConstraintsText } from "@shared/athleteFacts";
import type { ChatSafetyNotice } from "@shared/schema";

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
  const datedBlob = collectSafetySignalCorpus(trainingContext, upcomingWorkouts);

  // The athlete's standing constraints (the older note and every active fact
  // on the athlete card) join the MEDICATION scan only. That disclaimer
  // appends and is idempotent, so a durable "on beta blockers" keeping it
  // permanently applied is exactly right — whereas the same text sitting in
  // every prompt while the deterministic disclaimer never fires would make the
  // app look like it was told and ignored it.
  //
  // Deliberately NOT in the red-flag corpus: a red flag REPLACES every
  // suggestion with an escalation, and a durable fact mentioning past chest
  // pain would brick auto-coach forever. Red flags stay on dated workout text,
  // which ages out of the context on its own (coach-memory-spec §5.2).
  const standing = standingConstraintsText(trainingContext.trainingConstraints, trainingContext.athleteFacts);
  const medicationBlob = `${datedBlob}\n${standing ?? ""}`;

  return {
    redFlagDetected: RED_FLAG_SYMPTOM_PATTERNS.some((p) => p.test(datedBlob)),
    hrMedicationDetected: HR_MEDICATION_PATTERNS.some((p) => p.test(medicationBlob)),
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

/** The same two signals as analyzeSafetySignals, read from the conversation. */
export interface ChatSafetySignals {
  redFlagDetected: boolean;
  hrMedicationDetected: boolean;
}

/**
 * Scan what the athlete typed into the coach chat — this message and their
 * previous one — with the patterns the auto-coach applies to workout text.
 * analyzeSafetySignals never sees the chat, so before this "I had chest pain
 * on my run, should I still do intervals?" got whatever the model chose to say.
 *
 * The previous user turn is included so the follow-up ("ok, so what about
 * tomorrow?") keeps the safety framing for one more reply. Only the athlete's
 * turns are read: the coach's own replies can quote the escalation.
 */
export function analyzeChatSafety(
  message: string,
  history: ReadonlyArray<{ role: string; content: string }>,
): ChatSafetySignals {
  let previousUserTurn = "";
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "user") {
      previousUserTurn = history[i].content;
      break;
    }
  }
  const corpus = `${message}\n${previousUserTurn}`;
  return {
    redFlagDetected: RED_FLAG_SYMPTOM_PATTERNS.some((p) => p.test(corpus)),
    hrMedicationDetected: HR_MEDICATION_PATTERNS.some((p) => p.test(corpus)),
  };
}

/**
 * The fixed notice shown above the chat reply for those signals, or null. It
 * adds to the reply rather than replacing it, so a pattern false positive
 * ("a faint chance") costs a banner, not the answer. The escalation outranks
 * the medication disclaimer, as in buildSafetyReviewNote.
 */
export function buildChatSafetyNotice(signals: ChatSafetySignals): ChatSafetyNotice | null {
  if (signals.redFlagDetected) return { level: "urgent", message: ESCALATION_MESSAGE };
  if (signals.hrMedicationDetected) return { level: "caution", message: HR_MED_DISCLAIMER };
  return null;
}
