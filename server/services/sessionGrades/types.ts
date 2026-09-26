import type {
  EasyGradeMetrics,
  SessionGradeConfidence,
  SessionGradeDataSource,
  SessionGradeTargets,
  SessionGradeVerdict,
  SessionUngradeableReason,
  ThresholdGradeMetrics,
} from "@shared/schema";
import type { SessionStreamSamples } from "@shared/schema/sessionStream";

/** What a grader decides; the service wraps it with the session's identity. */
export interface GradeOutcome {
  verdict: SessionGradeVerdict;
  evidence: string[];
  confidence: SessionGradeConfidence | null;
  dataSource: SessionGradeDataSource | null;
  ungradeableReason: SessionUngradeableReason | null;
  easy: EasyGradeMetrics | null;
  threshold: ThresholdGradeMetrics | null;
}

/** The whole-run numbers every Strava log carries. */
export interface SummaryMetrics {
  avgHr: number | null;
  maxHr: number | null;
  /** m/s. */
  avgSpeed: number | null;
  /** Moving minutes. */
  durationMin: number | null;
}

export interface GradeContext {
  targets: SessionGradeTargets;
  /** The athlete's distance unit, for paces in evidence. */
  distanceUnit: string;
  /** False for treadmill/virtual runs, whose pace is not GPS. */
  speedTrusted: boolean;
  /** A long run's harder finish to leave out, minutes. */
  hardFinishMinutes: number | null;
}

export interface Grader {
  stream(samples: SessionStreamSamples, ctx: GradeContext): GradeOutcome;
  summary(summary: SummaryMetrics, ctx: GradeContext): GradeOutcome;
}

export function ungradeable(
  reason: GradeOutcome["ungradeableReason"],
  evidence: string[],
  dataSource: GradeOutcome["dataSource"] = null,
): GradeOutcome {
  return {
    verdict: "ungradeable",
    evidence,
    confidence: null,
    dataSource,
    ungradeableReason: reason,
    easy: null,
    threshold: null,
  };
}
