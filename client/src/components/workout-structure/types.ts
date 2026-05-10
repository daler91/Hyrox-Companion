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
  id?: string;
  section: WorkoutSection;
  blockType: BlockType;
  emomDurationMinutes?: number;
  emomAlternating?: boolean;
  roundCount?: number;
  timeCapMinutes?: number;
  steps: WorkoutStep[];
  group?: WorkoutGroup;
  score?: import("@shared/schema").StructureBlockScore | null;
  featureFlags?: Partial<Record<"intensity" | "load" | "unilateral" | "tempo" | "standards", boolean>>;
}
