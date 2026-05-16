import type { WorkoutStructureConfig } from "./types";

interface EmomPreviewMinute {
  minute: number;
  cycle: number;
  step: WorkoutStructureConfig["steps"][number];
}

interface EmomPreviewResult {
  patternLength: number;
  cycleCount: number;
  minutes: EmomPreviewMinute[];
}

/**
 * Expands an EMOM block into a minute-by-minute schedule. Steps always
 * play in order, one per minute, looping back to the first step once the
 * list runs out — so a 3-step list across 10 minutes simply repeats. The
 * final loop may be partial; that is expected, not an error.
 */
export function buildEmomPreview(config: WorkoutStructureConfig): EmomPreviewResult {
  const duration = config.emomDurationMinutes ?? 0;
  const patternLength = config.steps.length;

  if (config.blockType !== "emom" || duration < 1 || patternLength < 1) {
    return { patternLength, cycleCount: 0, minutes: [] };
  }

  const minutes = Array.from({ length: duration }, (_, minuteIndex) => ({
    minute: minuteIndex + 1,
    cycle: Math.floor(minuteIndex / patternLength) + 1,
    step: config.steps[minuteIndex % patternLength],
  }));

  return {
    patternLength,
    cycleCount: Math.ceil(duration / patternLength),
    minutes,
  };
}
