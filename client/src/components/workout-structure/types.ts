export type WorkoutSection = "warmup" | "main" | "accessory" | "cooldown" | "mobility";
export type BlockType = "steady" | "emom" | "rounds" | "amrap" | "interval" | "for_time";
export type StepType = "work" | "rest" | "transition";

export interface WorkoutStep {
  id: string;
  type: StepType;
  exercise?: string;
  target?: string;
  durationSeconds?: number;
}

export interface WorkoutGroup {
  kind: "superset" | "circuit";
  name?: string;
  restSeconds?: number;
}

export interface WorkoutStructureConfig {
  section: WorkoutSection;
  blockType: BlockType;
  rounds?: number;
  timeCapMinutes?: number;
  intervalWorkSeconds?: number;
  intervalRestSeconds?: number;
  emomDurationMinutes?: number;
  emomAlternating?: boolean;
  steps: WorkoutStep[];
  group?: WorkoutGroup;
  featureFlags?: Partial<Record<"intensity" | "load" | "unilateral" | "tempo" | "standards", boolean>>;
}
