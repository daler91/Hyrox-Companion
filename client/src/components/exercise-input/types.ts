import type { Timer } from "lucide-react";

export type FieldKey = "reps" | "weight" | "distance" | "time";

export interface FieldConfig {
  icon: typeof Timer;
  getLabel: (wu: string, du: string) => string;
  short: string;
}
