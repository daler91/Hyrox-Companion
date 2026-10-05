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

// Whole words, and "faint" only as a symptom. These were unanchored, so "a
// faint pull in my hamstring" blocked auto-coach changes and chat plan edits,
// while "dizzy", "light-headed", "trouble breathing" and "chest tightness" got
// no urgent notice at all. Plurals ("chest pains", "severe headaches") and
// faint after a verb or pronoun ("about to faint", "I was faint", "felt pretty
// faint") must keep matching, as they did unanchored. AI26
// (CODEBASE_ANALYSIS_2026-10-03)
const RED_FLAG_SYMPTOM_PATTERNS = [
  /\bchest\s+(?:pains?|tightness|pressure)\b/i,
  /\b(?:pains?|tightness|pressure)\s+in\s+(?:my|the)\s+chest\b/i,
  /\btight\s+chest\b/i,
  /\bchest\s+(?:felt|feels|feeling|was|is|got)\s+tight\b/i,
  /\bshort(?:ness)?\s+of\s+breath\b/i,
  /\b(?:trouble|difficulty)\s+breathing\b/i,
  // faints, fainted, faintness, a faint spell, felt/about to/might faint, I was
  // faint, felt pretty faint, a terse "faint after the sled"; never "a faint
  // pull", "faint soreness" or "the pull was faint".
  /\bfaint(?:s|ed|ing|ness)\b/i,
  /\bfaint\s+spells?\b/i,
  /\bfaint\s+(?:after|during|while|when)\b/i,
  // After a verb, a modal or "I was"; an intensifier between them ("felt
  // pretty faint") is taken out first (hasRedFlagSymptom).
  /\b(?:feel|feels|felt|feeling)\s+faint\b/i,
  /\b(?:go|goes|going|gonna|went)\s+faint\b/i,
  /\b(?:get|gets|got|getting)\s+faint\b/i,
  /\b(?:to|might|could|would|will|may|nearly|almost)\s+faint\b/i,
  /\b(?:i|he|she|we|they)\s+(?:was|were|am|is|are)\s+faint\b/i,
  /\b(?:i['’]m|im)\s+faint\b/i,
  /\b(?:passed|passing|passes|pass)\s+out\b/i,
  /\bblack(?:ed|ing)\s+out\b/i,
  /\bdizz(?:y|iness)\b/i,
  /\blight[\s-]?headed(?:ness)?\b/i,
  /\birregular\s+heart\s?beats?\b|\bpalpitations?\b/i,
  /\bblood\s+in\s+(?:urine|stools?|my\s+urine|my\s+stools?)\b/i,
  /\bsevere\s+headaches?\b/i,
];

// One intensifier right before "faint", removed so the lead-word patterns
// above read "felt pretty faint" as "felt faint". They run on text whose
// whitespace is already single spaces, so each matches one literal space and
// cannot backtrack over a run of them. Two lists rather than one pattern, to
// keep each simple enough to read.
const FAINT_INTENSIFIER_PATTERNS = [
  / (?:really|very|quite|so|slightly|pretty|extremely|super|rather|somewhat|totally|kinda)(?= faint\b)/gi,
  / (?:a (?:bit|little|tad)|(?:kind|sort) of)(?= faint\b)/gi,
];

function hasRedFlagSymptom(text: string): boolean {
  const plain = FAINT_INTENSIFIER_PATTERNS.reduce(
    (out, pattern) => out.replaceAll(pattern, ""),
    text.replaceAll(/\s+/g, " "),
  );
  return RED_FLAG_SYMPTOM_PATTERNS.some((pattern) => pattern.test(plain));
}

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
    redFlagDetected: hasRedFlagSymptom(datedBlob),
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
    redFlagDetected: hasRedFlagSymptom(corpus),
    hrMedicationDetected: HR_MEDICATION_PATTERNS.some((p) => p.test(corpus)),
  };
}

/**
 * The fixed notice shown above the chat reply for those signals, or null. It
 * adds to the reply rather than replacing it, so a pattern false positive
 * costs a banner, not the answer. The escalation outranks the medication
 * disclaimer, as in buildSafetyReviewNote.
 */
export function buildChatSafetyNotice(signals: ChatSafetySignals): ChatSafetyNotice | null {
  if (signals.redFlagDetected) return { level: "urgent", message: ESCALATION_MESSAGE };
  if (signals.hrMedicationDetected) return { level: "caution", message: HR_MED_DISCLAIMER };
  return null;
}
