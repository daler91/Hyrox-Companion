/**
 * Pure calculator for per-session fuelling targets (Phase 3 of the
 * nutrition↔training integration). From a session's duration + intensity (RPE)
 * and the athlete's bodyweight, recommend carb-forward pre-session fuelling and
 * carb+protein post-session recovery.
 *
 * Browser-safe and DB-free, mirroring shared/nutritionTargets.ts: typed
 * Input/Result shapes, `reasonCodes` + `explanation` for transparency, and no
 * I/O. The numbers are coaching guidance derived from common sports-nutrition
 * rules of thumb (g/kg anchors scaled by session load) — not prescriptions.
 */

export interface SessionFuellingTargetInput {
  /** Session duration in minutes, when known. */
  durationMin: number | null;
  /** Rate of perceived exertion (1–10), when logged. */
  rpe: number | null;
  /** Athlete bodyweight in kg; targets anchor to g/kg when present. */
  bodyweightKg: number | null;
}

export interface SessionFuellingTarget {
  /** Recommended carbs (g) in the pre-session window (0 = none needed). */
  preCarbG: number;
  /** Recommended carbs (g) in the post-session recovery window. */
  postCarbG: number;
  /** Recommended protein (g) in the post-session recovery window. */
  postProteinG: number;
  reasonCodes: string[];
  explanation: string;
}

// g/kg anchors at a moderate (~1h) session; scaled by intensity + duration below.
const POST_PROTEIN_G_PER_KG = 0.3;
const POST_PROTEIN_MIN_G = 20;
const POST_PROTEIN_MAX_G = 40;
const POST_CARB_BASE_G_PER_KG = 0.7;
const PRE_CARB_BASE_G_PER_KG = 0.4;

// Absolute fallbacks when bodyweight is unknown (can't anchor to g/kg).
const DEFAULT_PRE_CARB_G = 30;
const DEFAULT_POST_CARB_G = 60;
const DEFAULT_POST_PROTEIN_G = 25;

const DEFAULT_DURATION_MIN = 60;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Map RPE to an intensity multiplier; null RPE assumes a moderate session. */
function intensityFactor(rpe: number | null): { factor: number; label: string; assumed: boolean } {
  if (rpe == null) return { factor: 1.0, label: "moderate", assumed: true };
  if (rpe <= 4) return { factor: 0.6, label: "easy", assumed: false };
  if (rpe <= 7) return { factor: 1.0, label: "moderate", assumed: false };
  return { factor: 1.35, label: "hard", assumed: false };
}

/**
 * Derive a session's fuelling target. Pre-session carbs are recommended only
 * when the session is long or hard enough to benefit; post-session protein is
 * anchored to bodyweight (clamped to a sensible per-meal range) and post-session
 * carbs scale with how glycogen-depleting the session was (intensity × duration).
 */
export function computeSessionFuellingTarget(
  input: SessionFuellingTargetInput,
): SessionFuellingTarget {
  const reasonCodes: string[] = [];
  const intensity = intensityFactor(input.rpe);
  if (intensity.assumed) reasonCodes.push("assumed_moderate_intensity");

  let durationMin = input.durationMin;
  if (durationMin == null || durationMin <= 0) {
    durationMin = DEFAULT_DURATION_MIN;
    reasonCodes.push("assumed_duration_60min");
  }
  const durH = clamp(durationMin / 60, 0.5, 2.0);

  if (input.bodyweightKg == null || input.bodyweightKg <= 0) {
    reasonCodes.push("no_bodyweight_defaults");
    return {
      preCarbG: DEFAULT_PRE_CARB_G,
      postCarbG: DEFAULT_POST_CARB_G,
      postProteinG: DEFAULT_POST_PROTEIN_G,
      reasonCodes,
      explanation:
        "No bodyweight set — showing general defaults. Add your bodyweight in Settings " +
        "for targets tailored to you. Guidance only.",
    };
  }

  const bw = input.bodyweightKg;

  // Post-session protein: anchored to bodyweight, clamped to a per-meal range.
  const rawProtein = Math.round(bw * POST_PROTEIN_G_PER_KG);
  const postProteinG = clamp(rawProtein, POST_PROTEIN_MIN_G, POST_PROTEIN_MAX_G);
  if (postProteinG !== rawProtein) reasonCodes.push("post_protein_clamped");

  // Post-session carbs: scale with session load (intensity × duration).
  const postCarbG = Math.round(bw * POST_CARB_BASE_G_PER_KG * intensity.factor * durH);

  // Pre-session carbs: skip for short, easy sessions (fasted is fine).
  let preCarbG: number;
  if (durationMin < 45 && intensity.factor < 1.0) {
    preCarbG = 0;
    reasonCodes.push("short_easy_no_pre");
  } else {
    // Pre-fuelling deliberately scales on a narrower band than recovery: a
    // short-but-hard session still warrants a floor of ~45 min worth of carbs
    // (you fuel the intensity, not just the clock), and beyond ~90 min extra
    // pre-loading helps less than during/after fuelling — so duration is
    // re-clamped to [0.75h, 1.5h] here while post-carbs track true duration.
    preCarbG = Math.round(bw * PRE_CARB_BASE_G_PER_KG * intensity.factor * clamp(durH, 0.75, 1.5));
  }

  const preText = preCarbG > 0 ? `~${preCarbG}g carbs beforehand, then ` : "no pre-fuelling needed; ";
  return {
    preCarbG,
    postCarbG,
    postProteinG,
    reasonCodes,
    explanation:
      `For a ${durationMin}-min ${intensity.label} session at ${bw}kg: ${preText}` +
      `~${postCarbG}g carbs and ~${postProteinG}g protein to recover. Guidance only.`,
  };
}
