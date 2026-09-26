/**
 * Every threshold session grading reads, in one place.
 *
 * Grades are recomputed from the stored buckets on every read, so retuning a
 * number here re-grades every run the next time it is viewed — no backfill.
 */

// ── Stream storage (downsample.ts) ───────────────────────────────────────────

/** Bucket width. 15 s keeps a 3-minute rep as 12 points while an hour stays ~240. */
export const BUCKET_SECONDS = 15;
/** Six hours of buckets; anything longer is not a run we grade. */
export const MAX_BUCKETS = 1440;
/** A gap between samples longer than this is a pause, not 20+ s of running. */
export const MAX_SAMPLE_GAP_S = 20;
/** A bucket's HR is only kept when at least this many seconds of it had HR. */
export const MIN_HR_SECONDS_PER_BUCKET = 5;
/** Plausible heart-rate readings; outside this is strap noise. */
export const HR_MIN_BPM = 30;
export const HR_MAX_BPM = 230;
/** Without Strava's `moving` flag, slower than this (m/s) counts as stopped. */
export const MOVING_SPEED_MS = 0.5;
/** Under a minute of movement is not a session. */
export const MIN_MOVING_SECONDS = 60;
/** HR must cover this share of moving time for the recording to count as having HR. */
export const MIN_HR_COVERAGE = 0.2;

// ── Shared signal rules ─────────────────────────────────────────────────────

/** A bucket needs this much moving time before its pace means anything. */
export const MIN_MOVING_S_FOR_SPEED = 8;
/** Plausible running speeds (m/s) — the same band as workoutEngine/running.ts. */
export const MIN_RUN_SPEED_MS = 1.1;
export const MAX_RUN_SPEED_MS = 6.5;
/** A signal is only used for segmentation when it covers this share of moving buckets. */
export const MIN_SIGNAL_COVERAGE = 0.8;

// ── Easy runs (gradeEasy.ts) ────────────────────────────────────────────────

/** HR takes a while to settle; drift is measured after the first 10 minutes. */
export const EASY_DRIFT_WARMUP_EXCLUDE_S = 600;
/** Drift needs at least this much running after the excluded warm-up. */
export const EASY_MIN_ANALYSED_S = 900;
/** Up to 10% of moving time above the easy ceiling is still an easy run (hills, a crossing). */
export const EASY_ON_TARGET_MAX_ABOVE = 0.1;
/** Past 25% above the ceiling the run was not easy at all. */
export const EASY_CREPT_MAX_ABOVE = 0.25;
/** Last-third HR this much above the first third, finishing over the ceiling, is creep. */
export const EASY_DRIFT_CREPT_PCT = 5;
/** Pace faster than the fast end of easy by more than this counts as "faster than easy". */
export const EASY_PACE_FAST_TOLERANCE = 0.03;
/** Summary fallback: a max HR this far over the ceiling means the run crept up at some point. */
export const SUMMARY_PEAK_TOLERANCE_BPM = 8;
/** Summary fallback without HR: average pace this much faster than easy is too hard / crept. */
export const SUMMARY_EASY_TOO_FAST = 0.05;
export const SUMMARY_EASY_CREPT_FAST = 0.02;

// ── Threshold runs (workSegments.ts, gradeThreshold.ts) ─────────────────────

/** Rolling-median window (buckets) that smooths GPS jitter before segmentation. */
export const SMOOTH_WINDOW_BUCKETS = 3;
/** The work cluster must be at least this much faster than the rest to count as reps. */
export const MIN_SEPARATION_SPEED_RATIO = 1.06;
/** …or, segmenting on HR, this many bpm higher. */
export const MIN_SEPARATION_HR_BPM = 8;
/** The work cluster must cover between 10% and 90% of the run. */
export const MIN_HIGH_CLUSTER_SHARE = 0.1;
export const MAX_HIGH_CLUSTER_SHARE = 0.9;
/** A dip this short inside a rep (a crossing, a turn) does not split it. */
export const MAX_DIP_BUCKETS = 2;
/** Shorter than this is a stride, not threshold work. */
export const MIN_WORK_SEGMENT_S = 180;
/** HR lags pace; the first minute of each rep is left out of work HR. */
export const HR_LAG_S = 60;
/** With no reps found, a run this long is graded as one continuous tempo block. */
export const CONTINUOUS_MIN_S = 900;
export const CONTINUOUS_WARMUP_S = 600;
export const CONTINUOUS_COOLDOWN_S = 300;
/** Work pace this much faster than threshold pace drifted harder. */
export const THRESHOLD_FAST_TOLERANCE = 0.03;
/** Work pace this much slower than threshold pace (with HR under Z4) stayed under. */
export const THRESHOLD_SLOW_TOLERANCE = 0.05;
/** This share of work time in Z5 is harder than threshold, whatever the pace. */
export const THRESHOLD_Z5_SHARE = 0.2;
/** Pace:HR decoupling above this is worth a mention. */
export const DECOUPLING_WARN_PCT = 5;

// ── Targets (targets.ts) ────────────────────────────────────────────────────

/** Written paces outside this band (s/km) are not run paces. */
export const MIN_PLAUSIBLE_PACE_S_PER_KM = 150;
export const MAX_PLAUSIBLE_PACE_S_PER_KM = 600;
/** History window for fitting paces when the plan gives none. */
export const PACE_HISTORY_DAYS = 90;
