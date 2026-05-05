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
  error?: string;
}

export function buildEmomPreview(config: WorkoutStructureConfig): EmomPreviewResult {
  const duration = config.emomDurationMinutes ?? 0;
  const patternLength = config.steps.length;

  if (config.blockType !== "emom" || duration < 1 || patternLength < 1) {
    return { patternLength, cycleCount: 0, minutes: [] };
  }

  if (config.emomAlternating && duration % patternLength !== 0) {
    return {
      patternLength,
      cycleCount: Math.floor(duration / patternLength),
      minutes: [],
      error: `Duration (${duration} min) must be divisible by pattern length (${patternLength}) when alternating is enabled.`,
    };
  }

  const minutes = Array.from({ length: duration }, (_, minuteIndex) => {
    const patternIndex = config.emomAlternating ? minuteIndex % patternLength : 0;
    return {
      minute: minuteIndex + 1,
      cycle: Math.floor(minuteIndex / patternLength) + 1,
      step: config.steps[patternIndex],
    };
  });

  return {
    patternLength,
    cycleCount: Math.ceil(duration / patternLength),
    minutes,
  };
}
