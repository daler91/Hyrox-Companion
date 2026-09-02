// Training load: EWMA, ACWR and Foster monotony (audit A7: split out of
// trainingLoadService.ts).
//
// The forward pass that turns a day-by-day UTSS series into acute / chronic
// EWMAs, ACWR and its zone, TSB and monotony / strain.
//
// CALIBRATION COUPLING. The ACWR zone boundaries (resolveAcwrZone) and the
// monotony bands (monotonyZone) are read against UTSS as scored by
// stressScores.ts, whose cardio branch is fed by hrModel.ts. Retuning the HR
// model or either stress curve moves every athlete's ratio and monotony, so
// these thresholds and that scoring are one calibration. Do not change one side
// without the other.

import { addDaysToISODate as addDays } from "@shared/dateUtils";
import type { LoadGovernorAcwrZone, TrainingMonotonyZone } from "@shared/schema";

import type { DailyTrainingLoad } from "./types";
import { dateRange, getOrCreateDay, round } from "./utils";

// EWMA decay constants. λ = 2/(N+1) gives an exponential moving average whose
// centre of mass matches the old N-day rolling window: N=7 for acute fatigue,
// N=28 for chronic fitness. EWMA decays load exponentially instead of dropping
// it off a cliff when a big day leaves a fixed window (Williams 2017).
const ACUTE_LAMBDA = 2 / (7 + 1); // 0.25
const CHRONIC_LAMBDA = 2 / (28 + 1); // ≈ 0.069

/**
 * Logged history the EWMAs need behind them before their values mean what their
 * names say.
 *
 * Both are seeded at the first log the CALLER passed, so a short fetch window
 * silently reseeds them: the nutrition recovery path fetched 7 days and read a
 * "28-day chronic baseline" off the result. For an athlete tapering after eight
 * heavy weeks that reported 26.1 against a true 107.2 — a 4x understatement of
 * the baseline their fuelling targets are scaled from, at exactly the moment
 * fuelling matters most (audit H21).
 *
 * Two chronic windows. The seed's weight decays as (1 - CHRONIC_LAMBDA)^n, so it
 * still carries ~13% at 28 days and under 2% at 56 — the point where the answer
 * stops depending on where the caller happened to start looking.
 */
export const EWMA_WARMUP_DAYS = 56;

// Foster monotony classification. Monotony > 2.0 is a well-known overtraining /
// illness predictor; 1.5–2.0 is an early-warning band.
export function monotonyZone(monotony: number | null): TrainingMonotonyZone {
  if (monotony == null) return "unknown";
  if (monotony > 2) return "high_risk";
  if (monotony >= 1.5) return "elevated";
  return "ok";
}

// Monotony diverges as the week's load flattens (mean ÷ SD → ∞ at SD = 0), so it
// is reported at this ceiling instead. 5× the 2.0 high-risk threshold: far enough
// above the band to be unambiguous, small enough to render and to keep strain
// (weekly load × monotony) on a human scale.
const MONOTONY_CEILING = 10;

// Foster monotony (mean ÷ population SD of the trailing 7 days of UTSS) and
// strain (weekly UTSS × monotony).
//
// UNRESOLVED (audit M26): this uses POPULATION SD (÷n). The stated reason used to
// be that it "keeps a single hard day in an otherwise-easy week finite", and that
// reason is simply wrong — both conventions are finite for any week that is not
// perfectly flat, and the SD = 0 case below is what actually handles flatness.
// The real consequence is that ÷n instead of ÷(n−1) makes SD smaller and so
// monotony uniformly larger, by sqrt(7/6) = 8.0%, measured against a 2.0
// threshold taken from Foster's literature. Whether that threshold assumes the
// sample SD could not be established from primary sources here, and switching
// would move every athlete's monotony zone, so it is left as-is and flagged
// rather than changed on a guess.
//
// SD = 0 arises from two situations that mean OPPOSITE things, and conflating
// them is what made this metric silent for the athletes it exists to protect:
//   - every day zero (no training): mean is 0 too, so monotony is 0/0 — genuinely
//     undefined. Reported as null → zone "unknown".
//   - every day identical and non-zero: monotony is unbounded. That is the single
//     strongest overtraining pattern Foster's metric detects, so it is reported at
//     MONOTONY_CEILING → zone "high_risk".
//
// Variance is two-pass on purpose. The one-pass `sumSq/n − mean²` form cancels
// catastrophically once the week's values are identical or near-identical, and
// which way it lands depends on the magnitude of the values: 66 UTSS/day cancelled
// to exactly 0 (silently "ok"), while 94.8 UTSS/day — a 60-minute RPE-7 session —
// left a ~1.3e-6 residue and scored monotony 70,289,952.98 against a threshold of
// 2.0. Same training pattern, two absurd answers, chosen by a float bit pattern.
function computeMonotonyStrain(
  days: Map<string, DailyTrainingLoad>,
  endDate: string,
  /** First date whose trailing 7-day window lies wholly inside the athlete's history. */
  availableFrom: string | null,
): { monotony: number | null; strain: number | null } {
  if (availableFrom == null || endDate < availableFrom) return { monotony: null, strain: null };

  // The window is collected once into `values` and read twice (mean, then squared
  // deviations). The array is what makes the two-pass variance above possible; on
  // a fixed 7-element window its allocation cost is not worth trading for the
  // one-pass form's cancellation.
  const count = 7;
  const values: number[] = [];
  let total = 0;
  for (let offset = 0; offset < count; offset++) {
    const v = days.get(addDays(endDate, -offset))?.utss ?? 0;
    values.push(v);
    total += v;
  }
  const mean = total / count;
  // No load at all this week: monotony is undefined, not low and not high.
  if (mean === 0) return { monotony: null, strain: null };

  // SAMPLE standard deviation, / (n - 1), matching the convention Foster's 2.0
  // threshold was derived under (audit M26).
  //
  // This used to divide by n. The comment justifying that claimed it kept "a
  // single hard day in an otherwise-easy week finite", which is not true —
  // both conventions are finite for any week that is not perfectly flat, and
  // the sd === 0 branch below is what actually handles flatness.
  //
  // The convention is not cosmetic, because monotony is read against an
  // absolute threshold taken from the literature. Foster's 1998 threshold was
  // established with the statistical tooling of the time — SPSS and Excel's
  // STDEV — both of which default to the sample equation; and sports-science
  // methodology treats a 7-day microcycle as a SAMPLE of the athlete's ongoing
  // macrocycle, not a closed population. Dividing by n made sd smaller and
  // monotony correspondingly larger: every score ran 8.01% above what the 2.0
  // threshold was calibrated for, so an athlete whose true monotony was 1.85
  // read 2.00 and was flagged for overtraining.
  //
  // Correcting it moves every athlete's score DOWN by 7.42% (the reciprocal of
  // the same sqrt(7/6) ratio). The window is gated to exactly 7 whole days by
  // `availableFrom`, so the n - 1 denominator is always 6 and never zero.
  let sumSquaredDeviation = 0;
  for (const v of values) sumSquaredDeviation += (v - mean) * (v - mean);
  const sd = Math.sqrt(Math.max(0, sumSquaredDeviation / (count - 1)));

  const monotony = sd === 0 ? MONOTONY_CEILING : Math.min(round(mean / sd, 2), MONOTONY_CEILING);
  return { monotony, strain: round(total * monotony, 1) };
}

export function resolveAcwrZone(acwr: number | null, chronicAvg: number): LoadGovernorAcwrZone {
  if (acwr == null || chronicAvg <= 0) return "insufficient_data";
  if (acwr < 0.8) return "undertraining";
  if (acwr <= 1.3) return "sweet_spot";
  if (acwr <= 1.5) return "yellow";
  return "danger";
}

// ACWR needs a real chronic baseline before the ratio means anything, so the
// ratio is gated behind ~2 weeks of logged history (ACWR_MIN_HISTORY_DAYS). The
// EWMAs are SEEDED at firstLogDate with that day's UTSS (not zero) and advanced
// day-by-day across the whole range, including rest days. Seeding at the first
// real day — instead of letting pre-history zeros bleed into the average — is the
// EWMA-native replacement for the old coverage-adjusted chronic denominator: it
// stops a brand-new athlete's empty pre-history from deflating the baseline and
// inflating ACWR (e.g. 18 steady days read ≈1.0, not "danger").
const ACWR_MIN_HISTORY_DAYS = 14;

// Monotony reads a trailing 7-day window and treats absent days as rest, so it
// needs the whole window to lie inside the athlete's own history. Until then an
// athlete was handed a monotony and a strain computed almost entirely from days
// that predate them — one logged workout scored monotony 0.41 (audit M9). This
// is deliberately its own gate: monotony needs 7 days, not ACWR's 14.
const MONOTONY_WINDOW_DAYS = 7;

// Single forward pass: maintain running acute/chronic EWMAs and derive ACWR,
// zone, TSB (chronic − acute, "Form"), and Foster monotony/strain for each day.
export function applyLoadDynamics(
  days: Map<string, DailyTrainingLoad>,
  start: string,
  end: string,
  firstLogDate: string | null,
): void {
  const ratioFrom = firstLogDate ? addDays(firstLogDate, ACWR_MIN_HISTORY_DAYS - 1) : null;
  const monotonyFrom = firstLogDate ? addDays(firstLogDate, MONOTONY_WINDOW_DAYS - 1) : null;
  let acute: number | null = null;
  let chronic: number | null = null;

  for (const date of dateRange(start, end)) {
    const day = getOrCreateDay(days, date);

    // Pre-history: no baseline to seed from yet.
    if (firstLogDate == null || date < firstLogDate) {
      day.acwr = null;
      day.zone = "insufficient_data";
      day.acuteEwma = null;
      day.chronicEwma = null;
      day.tsb = null;
      day.monotony = null;
      day.strain = null;
      continue;
    }

    if (acute == null || chronic == null) {
      // Seed both EWMAs with the first logged day's UTSS so the baseline is the
      // athlete's real first-day load, not zero.
      acute = day.utss;
      chronic = day.utss;
    } else {
      acute = ACUTE_LAMBDA * day.utss + (1 - ACUTE_LAMBDA) * acute;
      chronic = CHRONIC_LAMBDA * day.utss + (1 - CHRONIC_LAMBDA) * chronic;
    }
    day.acuteEwma = round(acute, 1);
    day.chronicEwma = round(chronic, 1);

    const { monotony, strain } = computeMonotonyStrain(days, date, monotonyFrom);
    day.monotony = monotony;
    day.strain = strain;

    // TSB ("Form") is gated by the SAME history requirement as ACWR. It used to
    // be assigned above this check, so it was non-null from the athlete's very
    // first logged day — and because chronic decays far slower than acute, any
    // gap produces a large positive Form that reads as "peaked". One workout was
    // enough to be told you were sharp for race day (audit C3).
    if (ratioFrom == null || date < ratioFrom) {
      day.acwr = null;
      day.zone = "insufficient_data";
      day.tsb = null;
      continue;
    }
    day.tsb = round(chronic - acute, 1);
    const acwr = chronic > 0 ? round(acute / chronic, 2) : null;
    day.acwr = acwr;
    day.zone = resolveAcwrZone(acwr, chronic);
  }
}
